#!/usr/bin/env node
/**
 * 拼豆工作室 · 混元生图本地代理
 *
 * 为什么需要它：
 *   - 混元接口需要 Bearer API Key，Key 绝不能放进前端；
 *   - 浏览器直连 tokenhub 会被 CORS 拦截；
 *   - 这个代理只监听 127.0.0.1，Key 只留在本机。
 *
 * 启动：
 *   node tools/hunyuan-proxy.mjs
 *   HUNYUAN_API_KEY=sk-... node tools/hunyuan-proxy.mjs
 *   HUNYUAN_MOCK=1 node tools/hunyuan-proxy.mjs   # 不消耗额度，返回原图，用于联调
 *
 * Key 读取顺序：
 *   1. HUNYUAN_API_KEY
 *   2. KOK_IMAGE_GEN_API_KEY
 *   3. KOK 的 UserDefaults: Translator-App.KoK -> image_gen_api_key
 *   4. ~/.config/pindou/hunyuan-key
 *   5. 项目根目录 .env.local 的 HUNYUAN_API_KEY=...
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || '127.0.0.1';
const ENDPOINT = process.env.HUNYUAN_URL || 'https://tokenhub.tencentmaas.com/v1/wand/hunyuan-image/v35-generation';
const MODEL = process.env.HUNYUAN_MODEL || 'hy-image-v3.5-preview';
const MOCK = process.env.HUNYUAN_MOCK === '1';
const MOCK_DELAY = Number(process.env.MOCK_DELAY_MS || 900);
const MAX_BODY = 16 * 1024 * 1024;

const CA_BUNDLE = (() => {
  for (const f of ['/etc/ssl/cert.pem', '/private/etc/ssl/cert.pem']) {
    try { if (fs.existsSync(f)) return fs.readFileSync(f); } catch { /* ignore */ }
  }
  return undefined;
})();

/**
 * 用 node:https 而不是 fetch：
 * 本机 Node 的 fetch/undici 不读系统钥匙串；curl 正常但 fetch 会报
 * UNABLE_TO_GET_ISSUER_CERT_LOCALLY。显式加载系统 CA 可以稳定工作。
 */
function requestBuffer(urlString, { method = 'GET', headers = {}, body = null, timeout = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, {
      method,
      headers,
      ...(u.protocol === 'https:' && CA_BUNDLE ? { ca: CA_BUNDLE } : {}),
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.setTimeout(timeout, () => req.destroy(new Error('REQUEST_TIMEOUT')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const PRESETS = {
  pixel: {
    label: 'AI 像素化',
    prompt: '把参考图中的主体（人物、动物或物品）重绘为干净的复古像素画，16-bit 像素艺术风格。保留脸型、发型外轮廓、眼镜、眼睛、鼻子、嘴、表情和姿势，不要把眼睛画小或改变嘴型，不要省略五官。严格像素网格，硬边缘，无抗锯齿、无渐变、无模糊、无噪点。限制在 12–14 个颜色，平涂大色块；头发合并成 4–6 个大色块，不要一根根发丝、不要碎发、不要孤立像素、不要一像素宽线条；皮肤不要细碎高光。主体居中，纯白背景，无阴影、无地面、无文字、无水印，正方形构图。为拼豆优化：轮廓闭合，色块边界清晰，减少细小纹理。',
  },
};

function readFileKey(file) {
  try {
    if (!fs.existsSync(file)) return '';
    const raw = fs.readFileSync(file, 'utf8');
    const m = raw.match(/^\s*HUNYUAN_API_KEY\s*=\s*["']?([^"'\s]+)["']?\s*$/m);
    return m ? m[1].trim() : raw.trim();
  } catch { return ''; }
}

function readKokDefaults() {
  try {
    const v = execFileSync('/usr/bin/defaults', ['read', 'Translator-App.KoK', 'image_gen_api_key'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (v) return v;
  } catch { /* ignore */ }
  try {
    const plist = path.join(os.homedir(), 'Library/Preferences/Translator-App.KoK.plist');
    const v = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :image_gen_api_key', plist], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (v) return v;
  } catch { /* ignore */ }
  return '';
}

function resolveKey() {
  if (MOCK) return { key: 'mock', source: 'mock' };
  const envKey = (process.env.HUNYUAN_API_KEY || process.env.KOK_IMAGE_GEN_API_KEY || '').trim();
  if (envKey) return { key: envKey, source: 'env' };
  const kok = readKokDefaults();
  if (kok) return { key: kok, source: 'KOK image_gen_api_key' };
  const cfg = readFileKey(path.join(os.homedir(), '.config/pindou/hunyuan-key'));
  if (cfg) return { key: cfg, source: '~/.config/pindou/hunyuan-key' };
  const local = readFileKey(path.join(ROOT, '.env.local'));
  if (local) return { key: local, source: '.env.local' };
  return { key: '', source: '' };
}

function corsOrigin(req) {
  const origin = req.headers.origin || '';
  if (!origin) return '*';
  if (origin === 'null') return 'null';
  if (origin === 'https://kakarorkaka.github.io') return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return '';
}

function headers(req, extra = {}) {
  const allow = corsOrigin(req);
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra,
  };
  if (allow) h['Access-Control-Allow-Origin'] = allow;
  h['Vary'] = 'Origin';
  return h;
}

function send(req, res, status, obj) {
  const body = JSON.stringify(obj);
  const h = headers(req);
  if (!h['Access-Control-Allow-Origin'] && req.headers.origin) {
    // 非白名单来源：不返回数据，避免本地代理被任意网站调用
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'ORIGIN_NOT_ALLOWED' }));
    return;
  }
  res.writeHead(status, h);
  res.end(body);
}

const hits = new Map();
function rateLimited(req) {
  if (MOCK) return false;
  const ip = req.socket.remoteAddress || 'local';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60_000);
  if (arr.length >= 8) { hits.set(ip, arr); return true; }
  arr.push(now);
  hits.set(ip, arr);
  return false;
}

async function readJson(req) {
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('BAD_JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function pickPreset(body) {
  const id = 'pixel';
  const p = PRESETS.pixel;
  const extra = String(body.prompt || '').trim().slice(0, 600);
  const prompt = extra ? `${p.prompt}\n补充要求：${extra}` : p.prompt;
  return { id, prompt };
}

async function callHunyuan({ image, preset, prompt, key }) {
  const body = {
    model: MODEL,
    session: `pindou-${randomUUID()}`,
    size: process.env.HUNYUAN_SIZE || '1024x1024',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: image } },
      ],
    }],
  };
  const started = Date.now();
  const payload = JSON.stringify(body);
  const resp = await requestBuffer(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
    body: payload,
    timeout: 180_000,
  });
  const text = resp.body.toString('utf8');
  let data = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  if (resp.status !== 200) {
    const msg = data?.error?.message_zh || data?.error?.message || text.slice(0, 300);
    throw Object.assign(new Error(msg || `HUNYUAN_HTTP_${resp.status}`), { status: resp.status });
  }
  const url = data?.choices?.[0]?.delta?.image?.url;
  if (!url) throw Object.assign(new Error('HUNYUAN_EMPTY_IMAGE'), { status: 502 });
  const imgResp = await requestBuffer(url, { timeout: 90_000 });
  if (imgResp.status !== 200) throw Object.assign(new Error(`IMAGE_DOWNLOAD_${imgResp.status}`), { status: 502 });
  const buf = imgResp.body;
  if (!buf.length) throw Object.assign(new Error('IMAGE_EMPTY'), { status: 502 });
  const ct = (imgResp.headers['content-type'] || 'image/png').split(';')[0];
  return {
    image: `data:${ct};base64,${buf.toString('base64')}`,
    model: MODEL,
    preset,
    prompt,
    session: body.session,
    usage: data?.tokenhub_usage || null,
    ms: Date.now() - started,
  };
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  if (req.method === 'OPTIONS') {
    const h = headers(req);
    if (!h['Access-Control-Allow-Origin'] && req.headers.origin) {
      res.writeHead(403); res.end(); return;
    }
    res.writeHead(204, h); res.end(); return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/ai/health')) {
      const k = resolveKey();
      send(req, res, 200, {
        ok: true,
        configured: !!k.key,
        source: k.source || null,
        mock: MOCK,
        model: MODEL,
        endpointHost: new URL(ENDPOINT).host,
        presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label })),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/ai/stylize') {
      if (rateLimited(req)) { send(req, res, 429, { error: 'RATE_LIMIT', message: '请求太频繁，请稍后再试' }); return; }
      const body = await readJson(req);
      const image = String(body.image || '');
      if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(image)) {
        send(req, res, 400, { error: 'BAD_IMAGE', message: '需要 data:image/... base64 图片' }); return;
      }
      if (image.length > 12 * 1024 * 1024) {
        send(req, res, 413, { error: 'IMAGE_TOO_LARGE', message: '图片太大，请先压缩' }); return;
      }
      const { key, source } = resolveKey();
      if (!key) {
        send(req, res, 503, {
          error: 'NO_KEY',
          message: '未找到混元 API Key。请在 KOK 生图设置中填入，或设置 HUNYUAN_API_KEY 后重启代理。',
          source: null,
        });
        return;
      }
      const { id, prompt } = pickPreset(body);
      if (MOCK) {
        await new Promise(r => setTimeout(r, MOCK_DELAY));
        send(req, res, 200, { image, mock: true, model: MODEL, preset: id, prompt, source: 'mock', ms: Date.now() - started });
        return;
      }
      try {
        const out = await callHunyuan({ image, preset: id, prompt, key });
        console.log(`[ai] ${id} ok ${out.ms}ms key=${source}`);
        send(req, res, 200, { ...out, source });
      } catch (e) {
        const status = e.status === 401 || e.status === 403 ? 401 : (e.status || 502);
        console.error(`[ai] ${id} failed status=${status} ${String(e.message).slice(0, 200)}`);
        send(req, res, status, {
          error: status === 401 ? 'KEY_INVALID' : 'HUNYUAN_ERROR',
          message: status === 401 ? '混元 Key 无效或已过期' : String(e.message || '混元生图失败'),
          status,
        });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      send(req, res, 200, {
        name: 'pindou-hunyuan-proxy',
        endpoints: ['GET /health', 'POST /api/ai/stylize'],
        mock: MOCK,
        configured: !!resolveKey().key,
      });
      return;
    }

    send(req, res, 404, { error: 'NOT_FOUND' });
  } catch (e) {
    send(req, res, e.status || 500, { error: 'PROXY_ERROR', message: String(e.message || e) });
  } finally {
    if (url.pathname !== '/health') console.log(`[http] ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
  }
});

server.listen(PORT, HOST, () => {
  const k = resolveKey();
  console.log('');
  console.log('  拼豆工作室 · 混元生图代理');
  console.log(`  http://${HOST}:${PORT}`);
  console.log(`  model: ${MODEL}`);
  console.log(`  key: ${k.key ? `已读取（${k.source}）` : '未配置'}`);
  console.log(`  mode: ${MOCK ? 'MOCK（不调用混元、不消耗额度）' : 'LIVE（会消耗混元额度）'}`);
  console.log('');
  console.log('  打开 http://127.0.0.1:8124/index.html ，上传图片后点「AI 风格化」');
  console.log('  停止：Ctrl+C');
  console.log('');
});
