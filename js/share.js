/* ==========================================================================
   分享：图案 → 压缩链接；图案 → 分享卡（含二维码）
   ========================================================================== */
(function () {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------- base64url ---------- */
  function toB64Url(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64Url(str) {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ---------- 压缩（有 CompressionStream 时用 deflate） ---------- */
  async function encodePayload(obj) {
    const raw = enc.encode(JSON.stringify(obj));
    if (window.CompressionStream) {
      try {
        const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        const buf = await new Response(stream).arrayBuffer();
        return 'z' + toB64Url(new Uint8Array(buf));
      } catch (e) { /* fall through */ }
    }
    return 'j' + toB64Url(raw);
  }

  async function decodePayload(code) {
    const flag = code[0];
    let data = fromB64Url(code.slice(1));
    if (flag === 'z') {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const buf = await new Response(stream).arrayBuffer();
      data = new Uint8Array(buf);
    }
    return JSON.parse(dec.decode(data));
  }

  /* ---------- 网格 RLE ---------- */
  function gridToRle(grid) {
    const rle = [];
    let prev = null, count = 0;
    for (const row of grid) {
      for (const v of row) {
        const val = v < 0 ? 0 : v + 1;
        if (val === prev) { count++; }
        else {
          if (prev !== null) rle.push(count, prev);
          prev = val; count = 1;
        }
      }
    }
    if (prev !== null) rle.push(count, prev);
    return rle;
  }

  function rleToGrid(rle, cols, rows) {
    const flat = new Int16Array(cols * rows);
    let pos = 0;
    for (let i = 0; i < rle.length; i += 2) {
      const count = rle[i], val = rle[i + 1];
      const idx = val === 0 ? -1 : val - 1;
      for (let k = 0; k < count && pos < flat.length; k++) flat[pos++] = idx;
    }
    const grid = [];
    for (let y = 0; y < rows; y++) {
      const row = [];
      for (let x = 0; x < cols; x++) row.push(flat[y * cols + x]);
      grid.push(row);
    }
    return grid;
  }

  /* ---------- 色号 → 十六进制 ---------- */
  const codeMaps = {};
  function codeToHex(brand) {
    if (!codeMaps[brand]) {
      const map = {};
      const data = window.PINDOU_COLORS;
      Object.keys(data).forEach(hex => {
        const code = data[hex][brand];
        if (code) map[code] = hex;
      });
      codeMaps[brand] = map;
    }
    return codeMaps[brand];
  }

  function payloadFromState(S) {
    return {
      v: 1,
      t: S.title || '拼豆图纸',
      b: S.opts.brand,
      c: S.cols,
      r: S.rows,
      p: S.palette.map(p => p.code),
      g: gridToRle(S.grid),
    };
  }

  function stateFromPayload(payload) {
    const brand = payload.b || 'MARD';
    const hexMap = codeToHex(brand);
    const codes = payload.p || [];
    const palette = codes.map(code => ({
      code, hex: hexMap[code] || '#CCCCCC', count: 0,
    }));
    const grid = rleToGrid(payload.g || [], payload.c, payload.r);
    const counts = new Array(palette.length).fill(0);
    let total = 0;
    for (const row of grid) for (const v of row) if (v >= 0) { counts[v]++; total++; }
    palette.forEach((p, i) => { p.count = counts[i]; });
    return {
      title: payload.t || '拼豆图纸',
      brand,
      cols: payload.c,
      rows: payload.r,
      palette,
      grid,
      total,
    };
  }

  async function buildLink(S) {
    const code = await encodePayload(payloadFromState(S));
    const base = location.origin + location.pathname;
    return { url: base + '#p=' + code, code };
  }

  function readHashPayload() {
    const m = /^#p=([A-Za-z0-9\-_]+)/.exec(location.hash);
    return m ? m[1] : null;
  }

  /* ---------- 分享卡 ---------- */
  function drawQR(ctx, url, x, y, maxSize) {
    if (typeof qrcode !== 'function') return false;
    try {
      const qr = qrcode(0, 'L');
      qr.addData(url);
      qr.make();
      const n = qr.getModuleCount();
      if (n > 105) return false;
      const box = maxSize;
      const pad = 12;
      const cell = Math.floor((box - pad * 2) / n);
      const size = cell * n;
      const ox = x + Math.floor((box - size) / 2);
      const oy = y + Math.floor((box - size) / 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x, y, box, box);
      ctx.fillStyle = '#1F2224';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function truncate(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }

  function renderCard(opts) {
    const {
      title, cols, rows, grid, palette, brand, total, colors, url,
    } = opts;
    const W = 1080, H = 1350, M = 80;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const SANS = '"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
    const SERIF = '"Noto Serif SC","Songti SC","STSong",serif';

    ctx.fillStyle = '#F6F4EF';
    ctx.fillRect(0, 0, W, H);

    /* 顶部品牌 */
    ctx.fillStyle = '#1F2224';
    for (let i = 0; i < 9; i++) {
      const cx = M + (i % 3) * 16;
      const cy = 64 + Math.floor(i / 3) * 16;
      ctx.beginPath();
      ctx.arc(cx, cy, 4.6, 0, Math.PI * 2);
      ctx.fillStyle = i === 4 ? '#B34A38' : '#1F2224';
      ctx.fill();
    }
    ctx.fillStyle = '#1F2224';
    ctx.font = `600 24px ${SERIF}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('拼豆工作室', M + 68, 70);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#746F66';
    ctx.font = `500 18px ${SANS}`;
    ctx.fillText('PINDOU STUDIO', W - M, 70);

    /* 标题与元信息 */
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1F2224';
    ctx.font = `600 52px ${SERIF}`;
    ctx.fillText(truncate(ctx, title || '拼豆图纸', W - M * 2), M, 158);
    ctx.font = `22px ${SANS}`;
    ctx.fillStyle = '#63676E';
    ctx.fillText(`${cols} × ${rows} 格 · ${total.toLocaleString('zh-CN')} 颗 · ${colors} 色 · ${brand}`, M, 208);

    /* 图案 */
    const areaX = M, areaY = 250, areaW = W - M * 2, areaH = 720;
    const cell = Math.max(2, Math.floor(Math.min(areaW / cols, areaH / rows)));
    const gx = areaX + Math.floor((areaW - cols * cell) / 2);
    const gy = areaY + Math.floor((areaH - rows * cell) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(areaX, areaY - 6, areaW, areaH + 12);
    ctx.clip();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = grid[y][x];
        if (v < 0) continue;
        ctx.fillStyle = palette[v].hex;
        ctx.fillRect(gx + x * cell, gy + y * cell, cell, cell);
      }
    }
    ctx.strokeStyle = 'rgba(31,34,36,.06)';
    ctx.lineWidth = 1;
    for (let i = 10; i < cols; i += 10) {
      const x = gx + i * cell;
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + rows * cell); ctx.stroke();
    }
    for (let j = 10; j < rows; j += 10) {
      const y = gy + j * cell;
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + cols * cell, y); ctx.stroke();
    }
    ctx.restore();

    /* 分隔线 */
    ctx.strokeStyle = '#E5E1D8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(M, 1010); ctx.lineTo(W - M, 1010);
    ctx.stroke();

    /* 二维码与链接 */
    const qrOk = drawQR(ctx, url, M, 1032, 240);
    const textX = qrOk ? M + 260 : M;
    ctx.fillStyle = '#1F2224';
    ctx.font = `600 24px ${SERIF}`;
    ctx.textAlign = 'left';
    ctx.fillText('打开链接，拼同款图纸', textX, 1086);
    ctx.font = `18px ${SANS}`;
    ctx.fillStyle = '#63676E';
    let display = url.replace(/^https?:\/\//, '');
    if (display.length > 46) display = display.slice(0, 44) + '…';
    ctx.fillText(display, textX, 1126);
    ctx.fillStyle = '#9A958A';
    ctx.font = `16px ${SANS}`;
    ctx.fillText('所有处理在浏览器完成 · 无需登录', textX, 1164);

    /* 底部品牌 */
    ctx.fillStyle = '#1F2224';
    ctx.font = `600 18px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.fillText('拼豆工作室', M, 1290);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#746F66';
    ctx.font = `16px ${SANS}`;
    ctx.fillText('把一张图，变成一张图纸。', W - M, 1290);

    return canvas;
  }

  window.PindouShare = {
    encodePayload,
    decodePayload,
    payloadFromState,
    stateFromPayload,
    buildLink,
    readHashPayload,
    renderCard,
    gridToRle,
    rleToGrid,
  };
})();
