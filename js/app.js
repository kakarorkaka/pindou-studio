/* ==========================================================================
   拼豆工作室 · 应用逻辑
   ========================================================================== */
(function () {
  'use strict';

  const E = window.PindouEngine;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const PRESETS = [
    { label: '速成', cols: 24 },
    { label: '标准', cols: 40 },
    { label: '精细', cols: 64 },
  ];
  const BRANDS = [
    ['MARD', 'MARD（推荐）'],
    ['COCO', 'COCO'],
    ['漫漫', '漫漫'],
    ['盼盼', '盼盼（纯数字色号）'],
    ['咪小窝', '咪小窝（纯数字）'],
  ];
  const LS_KEY = 'pindou-studio-v1';

  const DEFAULTS = {
    cols: 40, square: false, brand: 'MARD', maxColors: 16,
    sampling: 'avg', match: 'lab', dither: 'off', merge: 0,
    blank: true, boundary: false, whiteTh: 240,
    labelMode: 'code', beadMm: 2.6, autoTrim: true, style: 'original',
  };
  const DEFAULT_DISPLAY = { code: true, grid: true, board: false, coords: true };

  const S = {
    img: null, imgFull: null, imgName: '', imgW: 0, imgH: 0,
    sourceOriginal: null, uploadOriginal: null, sourceMode: 'image', whiteBg: false,
    remixOf: null, gallerySort: 'featured', galleryCat: 'all', galleryQuery: '', mode: 'image',
    text: '', textColor: '#2F2B2F', textOutline: true, templateId: null,
    projectId: null,
    cols: 40, rows: 40, total: 0, empty: 0,
    grid: [], palette: [], excluded: new Set(),
    selected: 0, tool: 'brush',
    display: { ...DEFAULT_DISPLAY },
    opts: { ...DEFAULTS },
    fit: true, cell: 16,
    history: [], future: [],
    gridBackup: null,
    dirty: false,
    title: '',
  };

  let activeSheet = null;
  let toastTimer = null;
  let regenTimer = null;
  const pointers = new Map();
  let stroke = null;
  let lpTimer = null;
  let pinch = null;
  let pan = null;
  let spaceDown = false;

  /* ------------------------------------------------------------------ */
  /* 工具函数                                                             */
  /* ------------------------------------------------------------------ */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function fmtTime(beads) {
    const h = beads / 600;
    if (h < 0.95) {
      const m = Math.max(5, Math.round(h * 60 / 5) * 5);
      return m >= 60 ? '约 1 小时' : `约 ${m} 分钟`;
    }
    const v = h < 2 ? Math.round(h * 2) / 2 : Math.round(h);
    return `约 ${v} 小时`;
  }
  function fmtCm(cols) {
    return (cols * S.opts.beadMm / 10).toFixed(1);
  }
  function fmtNum(n) { return n.toLocaleString('zh-CN'); }
  function sanitizeName(s) {
    return (s || '拼豆图纸').replace(/[\\/:*?"<>|#\s]+/g, '_').slice(0, 60) || '拼豆图纸';
  }

  /* 自动裁掉四周的白边/透明边（仅在留白明显时） */
  function computeTrimRect(canvas) {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return null;
    const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const a = data[i + 3];
        const white = data[i] >= 244 && data[i + 1] >= 244 && data[i + 2] >= 244;
        if (a > 16 && !white) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if ((bw * bh) / (w * h) > 0.82) return null;   // 留白不明显则不裁
    const padX = Math.max(2, Math.round(w * 0.015));
    const padY = Math.max(2, Math.round(h * 0.015));
    return {
      x: Math.max(0, minX - padX), y: Math.max(0, minY - padY),
      w: Math.min(w, maxX + padX + 1) - Math.max(0, minX - padX),
      h: Math.min(h, maxY + padY + 1) - Math.max(0, minY - padY),
    };
  }

  function applyTrim() {
    if (!S.imgFull) return;
    if (!S.opts.autoTrim) { S.img = S.imgFull; return; }
    const rect = computeTrimRect(S.imgFull);
    if (!rect) { S.img = S.imgFull; return; }
    const c = document.createElement('canvas');
    c.width = rect.w; c.height = rect.h;
    c.getContext('2d').drawImage(S.imgFull, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    S.img = c;
  }

  /* 画面风格：原图 / 卡通 / 像素 / 剪影 */
  function applyStyle(src, style) {
    if (!src || style === 'original') return src;
    const w = src.width, h = src.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');

    if (style === 'cartoon') {
      const scale = Math.min(1, 140 / Math.max(w, h));
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(w * scale));
      small.height = Math.max(1, Math.round(h * scale));
      const sctx = small.getContext('2d');
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(src, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const levels = 6;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 16) continue;
        for (let k = 0; k < 3; k++) {
          d[i + k] = Math.round(d[i + k] / 255 * (levels - 1)) / (levels - 1) * 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return out;
    }

    if (style === 'pixel') {
      const block = Math.max(2, Math.round(Math.max(w, h) / 120));
      const sw = Math.max(1, Math.round(w / block));
      const sh = Math.max(1, Math.round(h / block));
      const small = document.createElement('canvas');
      small.width = sw; small.height = sh;
      const sctx = small.getContext('2d');
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(src, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
      return out;
    }

    if (style === 'silhouette') {
      ctx.drawImage(src, 0, 0);
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 16) { d[i + 3] = 0; continue; }
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (lum > 190) { d[i + 3] = 0; }
        else {
          d[i] = 47; d[i + 1] = 43; d[i + 2] = 47; d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return out;
    }
    return src;
  }

  function flattenColors(canvas, colors) {
    if (!colors || !colors.length) return canvas;
    const hexToRgb = hex => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    });
    // 以「白 → 目标色」的覆盖率判断边缘：覆盖率 >= 50% 取纯色，否则留空
    const list = colors.map(hex => {
      const c = hexToRgb(hex);
      return { r: c.r, g: c.g, b: c.b, vr: c.r - 255, vg: c.g - 255, vb: c.b - 255, len2: (c.r - 255) ** 2 + (c.g - 255) ** 2 + (c.b - 255) ** 2 };
    });
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 100) { d[i + 3] = 0; continue; }
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const wr = r - 255, wg = g - 255, wb = b - 255;
      let best = null, bestRes = Infinity, bestA = 0;
      for (const c of list) {
        if (c.len2 < 1) continue;
        const a = (wr * c.vr + wg * c.vg + wb * c.vb) / c.len2;
        if (a <= 0) continue;
        const er = wr - a * c.vr, eg = wg - a * c.vg, eb = wb - a * c.vb;
        const res = er * er + eg * eg + eb * eb;
        if (res < bestRes) { bestRes = res; best = c; bestA = a; }
      }
      if (best && bestA >= 0.5) {
        d[i] = best.r; d[i + 1] = best.g; d[i + 2] = best.b; d[i + 3] = 255;
      } else {
        d[i + 3] = 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function detectWhiteBg(canvas) {
    if (!canvas) return false;
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return false;
    const ctx = canvas.getContext('2d');
    const pts = [
      [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
      [w >> 1, 0], [0, h >> 1], [w - 1, h >> 1], [w >> 1, h - 1],
    ];
    let white = 0;
    for (const [x, y] of pts) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      if (d[3] < 40 || (d[0] >= 238 && d[1] >= 238 && d[2] >= 238)) white++;
    }
    return white >= pts.length * 0.75;
  }

  function refreshSource() {
    if (!S.sourceOriginal) return;
    S.imgFull = S.sourceMode === 'image'
      ? applyStyle(S.sourceOriginal, S.opts.style)
      : S.sourceOriginal;
    applyTrim();
    S.imgW = S.img.width;
    S.imgH = S.img.height;
  }

  function saveSettings() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        cols: S.cols, opts: S.opts, display: S.display,
      }));
    } catch (e) { /* ignore */ }
  }
  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (!raw) return;
      if (raw.opts) S.opts = { ...DEFAULTS, ...raw.opts };
      if (raw.display) S.display = { ...DEFAULT_DISPLAY, ...raw.display };
      if (raw.cols) S.cols = clamp(raw.cols, 8, 400);
      S.opts.cols = S.cols;
    } catch (e) { /* ignore */ }
  }

  function toast(text, opts) {
    opts = opts || {};
    $('#toastText').textContent = text;
    const undoBtn = $('#toastUndo');
    undoBtn.classList.toggle('hidden', !opts.undo);
    undoBtn.onclick = opts.undo ? () => { opts.undo(); hideToast(); } : null;
    const el = $('#toast');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, opts.duration || 2800);
  }
  function hideToast() { $('#toast').classList.remove('show'); }

  /* ------------------------------------------------------------------ */
  /* 视图切换                                                             */
  /* ------------------------------------------------------------------ */
  function showView(name) {
    $('#viewHome').classList.toggle('hidden', name !== 'home');
    $('#viewWorkspace').classList.toggle('hidden', name !== 'workspace');
    $('#viewGallery').classList.toggle('hidden', name !== 'gallery');
    if (name === 'workspace') {
      requestAnimationFrame(() => {
        drawPreview();
        layoutCanvas();
      });
    }
    if (name === 'gallery') {
      renderGallery();
    }
  }

  /* ------------------------------------------------------------------ */
  /* 首页：上传                                                           */
  /* ------------------------------------------------------------------ */
  function initUpload() {
    const card = $('#uploadCard');
    const input = $('#fileInput');

    card.addEventListener('click', e => {
      if (e.target.closest('#uploadPreview .upload-actions')) return;
      input.click();
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) loadFile(input.files[0]).finally(() => { input.value = ''; });
    });
    $('#changeImageBtn').addEventListener('click', e => { e.stopPropagation(); input.click(); });
    $('#changeBtn').addEventListener('click', () => {
      if (S.sourceMode === 'image' && S.img) input.click();
      else $('#backBtn').click();
    });

    ['dragenter', 'dragover'].forEach(ev => card.addEventListener(ev, e => {
      e.preventDefault();
      card.classList.add('drag');
    }));
    ['dragleave', 'drop'].forEach(ev => card.addEventListener(ev, e => {
      e.preventDefault();
      card.classList.remove('drag');
    }));
    card.addEventListener('drop', e => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });

    document.addEventListener('paste', e => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items || []);
      const fileItem = items.find(it => it.kind === 'file' && /^image\//.test(it.type));
      if (fileItem) loadFile(fileItem.getAsFile());
    });

    $('#sampleBtn').addEventListener('click', () => loadSample());
  }

  function loadSample() {
    return fetch('assets/sample-panda.png')
      .then(r => {
        if (!r.ok) throw new Error('sample missing');
        return r.blob();
      })
      .then(blob => loadFile(new File([blob], '小熊猫挂件.png', { type: 'image/png' })))
      .catch(() => toast('示例图加载失败，请手动上传一张图片'));
  }

  function loadFile(file) {
    return new Promise((resolve) => {
      if (!file) return resolve(false);
      if (!/^image\//.test(file.type)) { toast('请选择图片文件（JPG / PNG / WEBP）'); return resolve(false); }
      if (file.size > 20 * 1024 * 1024) { toast('图片超过 20MB，请压缩后再试'); return resolve(false); }

      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const maxDim = 1600;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);

        S.sourceOriginal = c;
        S.uploadOriginal = c;
        S.sourceMode = 'image';
        S.whiteBg = detectWhiteBg(c);
        S.projectId = null;
        S.title = '';
        aiOriginal = null;
        aiCandidate = null;
        $('#aiRestoreBtn').classList.add('hidden');
        refreshSource();
        S.imgName = file.name.replace(/\.[^.]+$/, '');
        if (!S.title) S.title = S.imgName;
        $('#titleInput').value = S.title;
        $('#uploadThumb').src = url;
        $('#uploadName').textContent = file.name;
        $('#uploadDim').textContent = `${img.width} × ${img.height} 像素`;
        $('#uploadEmpty').classList.add('hidden');
        $('#uploadPreview').classList.remove('hidden');
        updateCalibrateVisibility();
        updateHomeUI();

        if (!$('#viewWorkspace').classList.contains('hidden')) {
          closeAllSheets();
          S.fit = true;
          generatePattern(true);
          layoutCanvas();
        }
        URL.revokeObjectURL(url);
        if (!$('#viewHome').classList.contains('hidden')) {
          setTimeout(() => {
            const cal = $('#calibrate');
            if (cal && !cal.classList.contains('hidden')) {
              cal.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 220);
        }
        resolve(true);
      };
      img.onerror = () => {
        toast('图片无法读取，请换一张试试');
        URL.revokeObjectURL(url);
        resolve(false);
      };
      img.src = url;
    });
  }

  /* ------------------------------------------------------------------ */
  /* 首页：校准                                                           */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* 图片效果预览：四档尺寸 / 风格 / 去背景 / 裁切                         */
  /* ------------------------------------------------------------------ */
  const PREVIEW_SIZES = [
    { size: 24, label: '速成', hint: '小挂件' },
    { size: 40, label: '标准', hint: '推荐' },
    { size: 64, label: '精细', hint: '摆件' },
    { size: 96, label: '大幅', hint: '海报级' },
  ];
  let previewTimer = null;
  let previewToken = 0;
  const previewData = new Map();
  let cropState = null;
  let cropDrag = null;

  /* ---------- 混元 AI 风格化 ---------- */
  const AI_PRESETS = [
    { id: 'cartoon', label: '日系卡通', desc: '平涂色块' },
    { id: 'pixel', label: '复古像素', desc: '32-bit 像素' },
    { id: 'figure', label: 'Q 版手办', desc: '黏土质感' },
    { id: 'sticker', label: '贴纸描边', desc: '粗描边' },
    { id: 'cutout', label: '白底抠图', desc: '只换背景' },
  ];
  let aiBase = '';
  let aiPreset = 'cartoon';
  let aiCandidate = null;
  let aiOriginal = null;
  let aiBusy = false;
  let aiTimer = null;
  let aiReady = false;

  function drawPatternCanvas(canvas, grid, palette, maxPx) {
    if (!canvas || !grid || !grid.length) return;
    const cols = grid[0].length, rows = grid.length;
    const cell = Math.max(1, Math.floor(maxPx / Math.max(cols, rows)));
    canvas.width = cols * cell;
    canvas.height = rows * cell;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#F6F4EF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = grid[y][x];
        if (v < 0) continue;
        ctx.fillStyle = palette[v].hex;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }

  function renderStyleChips() {
    const host = $('#ipStyles');
    if (!host) return;
    host.innerHTML = '';
    const defs = [['original', '原图'], ['cartoon', '卡通'], ['pixel', '像素'], ['silhouette', '剪影']];
    defs.forEach(([style, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.style = style;
      b.className = 'style-chip' + (S.opts.style === style ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        if (S.opts.style === style) return;
        S.opts.style = style;
        saveSettings();
        refreshSource();
        updateHomeUI();
      });
      host.appendChild(b);
    });
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(buildPreviewData, 140);
  }

  async function buildPreviewData() {
    if (!S.img || S.mode !== 'image' || S.sourceMode !== 'image') return;
    if ($('#calibrate').classList.contains('hidden')) return;
    const token = ++previewToken;
    const host = $('#ipSizes');
    host.innerHTML = PREVIEW_SIZES.map(p => `
      <div class="ip-size loading">
        <div class="ip-skeleton"></div>
        <b>${p.label}</b><span>${p.size} 格 · ${p.hint}</span><em>生成中…</em>
      </div>`).join('');
    $('#ipBigMeta').textContent = '正在生成预览…';
    previewData.clear();
    try {
      for (const p of PREVIEW_SIZES) {
        await new Promise(r => setTimeout(r, 16));
        if (token !== previewToken) return;
        const opts = { ...S.opts, cols: p.size };
        opts.edgeClean = S.whiteBg && S.opts.blank;
        opts.flat = false;
        const res = E.generate(S.img, opts);
        previewData.set(p.size, res);
      }
      if (token !== previewToken) return;
      renderSizeCards();
      updatePreviewSelection();
    } catch (e) {
      if (token === previewToken) {
        $('#ipBigMeta').textContent = '预览生成失败，换张图片试试';
      }
    }
  }

  function renderSizeCards() {
    const host = $('#ipSizes');
    host.innerHTML = '';
    PREVIEW_SIZES.forEach(p => {
      const d = previewData.get(p.size);
      if (!d) return;
      const used = d.palette.filter(x => x.count > 0).length;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ip-size' + (S.cols === p.size ? ' active' : '');
      b.dataset.size = p.size;
      const c = document.createElement('canvas');
      drawPatternCanvas(c, d.grid, d.palette, 150);
      b.appendChild(c);
      const tail = document.createElement('span');
      tail.innerHTML = `<b>${p.label}</b><span>${p.size} 格 · ${p.hint}</span><em>≈ ${fmtNum(d.total)} 颗 · ${used} 色</em>`;
      b.appendChild(tail);
      b.addEventListener('click', () => selectPreviewSize(p.size));
      host.appendChild(b);
    });
  }

  function selectPreviewSize(size) {
    S.cols = size;
    S.opts.cols = size;
    saveSettings();
    $$('.ip-size').forEach(b => b.classList.toggle('active', +b.dataset.size === size));
    updatePreviewSelection();
  }

  function updatePreviewSelection() {
    const d = previewData.get(S.cols);
    if (!d) return;
    const used = d.palette.filter(x => x.count > 0).length;
    drawPatternCanvas($('#ipBig'), d.grid, d.palette, 360);
    $('#ipBigMeta').textContent = `${d.cols} × ${d.rows} · ${fmtNum(d.total)} 颗 · ${used} 色 · ${S.opts.brand}`;
    $('#homeEstimate').textContent =
      `将生成 ${d.cols} × ${d.rows} 格 · 约 ${fmtNum(d.total)} 颗 · ${used} 色`
      + ` · 约 ${fmtCm(d.cols)} × ${fmtCm(d.rows)} cm · ${fmtTime(d.total)}`;
    $('#generateLabel').textContent = `使用 ${S.cols} 格生成`;
    const pal = d.palette.filter(x => x.count > 0).sort((a, b) => b.count - a.count);
    const host = $('#ipPalette');
    if (host) {
      host.innerHTML = pal.slice(0, 8).map(p =>
        `<span class="ip-pal"><i style="background:${p.hex}"></i>${p.code} · ${fmtNum(p.count)}</span>`).join('')
        + (pal.length > 8 ? `<span class="ip-pal">+${pal.length - 8} 色</span>` : '');
    }
  }

  function refreshPreviewUI(force) {
    const wrap = $('#imagePreview');
    const show = S.mode === 'image' && S.sourceMode === 'image' && !!S.sourceOriginal && !!S.img;
    if (wrap) wrap.classList.toggle('hidden', !show);
    const sizeField = $('#sizeField');
    if (sizeField) sizeField.classList.toggle('hidden', show);
    if (!show) return;
    if ($('#calibrate').classList.contains('hidden')) return;
    $('#calibrateTitle').textContent = '效果预览';
    $('#calibrateNote').textContent = '先看效果，再选尺寸';
    if (force || S._previewSrc !== S.sourceOriginal) {
      S._previewSrc = S.sourceOriginal;
      $('#ipOriginal').src = S.sourceOriginal.toDataURL('image/jpeg', 0.82);
      renderStyleChips();
    }
    $$('#ipStyles .style-chip').forEach(b => b.classList.toggle('active', b.dataset.style === S.opts.style));
    $('#ipBlank').checked = !!S.opts.blank;
    if (!PREVIEW_SIZES.some(p => p.size === S.cols)) {
      S.cols = 40;
      S.opts.cols = 40;
      saveSettings();
    }
    schedulePreview();
  }


  /* ---------- AI 风格化：混元生图 ---------- */
  function aiBases() {
    const stored = (() => { try { return localStorage.getItem('pindou-ai-base') || ''; } catch (e) { return ''; } })();
    return [...new Set([stored, 'http://127.0.0.1:8788', 'http://127.0.0.1:8787']
      .filter(Boolean).map(s => s.replace(/\/+$/, '')))];
  }

  function aiSetStatus(kind, text) {
    const dot = $('#aiDot');
    if (dot) dot.className = 'ai-dot ' + kind;
    const t = $('#aiStatusText');
    if (t) t.textContent = text;
  }

  function aiShowSetup(show) {
    $('#aiSetupBox').classList.toggle('hidden', !show);
    $('#aiGenerateBtn').disabled = !aiReady;
  }

  async function checkAIService() {
    aiReady = false;
    aiSetStatus('', '检查 AI 服务…');
    $('#aiGenerateBtn').disabled = true;
    for (const base of aiBases()) {
      try {
        const res = await fetch(base + '/health', { signal: AbortSignal.timeout(2600) });
        if (!res.ok) continue;
        const h = await res.json();
        aiBase = base;
        try { localStorage.setItem('pindou-ai-base', base); } catch (e) { /* ignore */ }
        $('#aiBaseInput').value = base;
        if (!h.configured) {
          aiSetStatus('warn', '代理已连接，但未找到混元 Key');
          $('#aiHint').textContent = '在 KOK 生图设置中填入 Key，或设置 HUNYUAN_API_KEY 后重启代理。';
          aiShowSetup(true);
          return false;
        }
        aiReady = true;
        aiSetStatus(h.mock ? 'ok' : 'ok', h.mock ? '已连接 · 联调模式（不调用混元）' : '已连接 · 混元 v3.5');
        $('#aiHint').textContent = h.mock ? '当前是 Mock 模式，返回原图，仅用于联调。' : '生成约 20 秒，每次会消耗一次混元额度。';
        aiShowSetup(false);
        return true;
      } catch (e) { /* try next base */ }
    }
    aiSetStatus('bad', '未连接 · 请启动本地 AI 服务');
    $('#aiHint').textContent = '运行 node tools/hunyuan-proxy.mjs 后点「重试」。';
    aiShowSetup(true);
    return false;
  }

  function renderAIPresets() {
    const host = $('#aiPresets');
    host.innerHTML = '';
    AI_PRESETS.forEach(p => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ai-preset' + (aiPreset === p.id ? ' active' : '');
      b.dataset.aiPreset = p.id;
      b.innerHTML = `<b>${p.label}</b><small>${p.desc}</small>`;
      b.addEventListener('click', () => {
        aiPreset = p.id;
        $$('#aiPresets .ai-preset').forEach(x => x.classList.toggle('active', x === b));
      });
      host.appendChild(b);
    });
  }

  function aiSquareSource() {
    const max = 1024;
    const c = document.createElement('canvas');
    c.width = max; c.height = max;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, max, max);
    const src = S.sourceOriginal;
    const scale = Math.min(max / src.width, max / src.height);
    const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, (max - w) / 2, (max - h) / 2, w, h);
    return c.toDataURL('image/jpeg', 0.9);
  }

  async function openAI() {
    if (!S.sourceOriginal) { toast('先选择一张图片'); return; }
    aiCandidate = null;
    aiBusy = false;
    $('#aiBefore').src = S.sourceOriginal.toDataURL('image/jpeg', 0.82);
    $('#aiAfter').removeAttribute('src');
    $('#aiResult').classList.add('hidden');
    $('#aiActions').classList.remove('hidden');
    $('#aiProgress').classList.add('hidden');
    $('#aiHint').textContent = '';
    $('#aiGenerateBtn').textContent = '生成 AI 风格图';
    renderAIPresets();
    $('#aiBaseInput').value = aiBase || 'http://127.0.0.1:8788';
    openSheet('sheetAI');
    checkAIService();
  }

  async function generateAI() {
    if (aiBusy) return;
    if (!aiReady) {
      await checkAIService();
      if (!aiReady) return;
    }
    aiBusy = true;
    $('#aiGenerateBtn').disabled = true;
    $('#aiActions').classList.add('hidden');
    $('#aiResult').classList.add('hidden');
    $('#aiProgress').classList.remove('hidden');
    const started = Date.now();
    const tick = () => {
      $('#aiProgressText').textContent = `正在生成… ${Math.max(1, Math.round((Date.now() - started) / 1000))}s`;
    };
    tick();
    aiTimer = setInterval(tick, 1000);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 200000);
    try {
      const body = {
        image: aiSquareSource(),
        preset: aiPreset,
        prompt: $('#aiPrompt').value.trim(),
      };
      const res = await fetch(aiBase + '/api/ai/stylize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.message || 'AI 生成失败');
        err.code = data.error;
        err.status = res.status;
        throw err;
      }
      if (!data.image || !/^data:image\//.test(data.image)) throw new Error('AI 返回的图片格式不正确');
      aiCandidate = data.image;
      $('#aiAfter').src = data.image;
      $('#aiResult').classList.remove('hidden');
      $('#aiActions').classList.add('hidden');
      $('#aiHint').textContent = data.mock ? 'Mock 模式返回原图；配置 Key 后会调用混元。' : '生成完成，可对比后使用；使用后会重新计算四档图纸。';
      aiSetStatus('ok', data.mock ? '已连接 · 联调模式（不调用混元）' : '已连接 · 混元 v3.5');
    } catch (e) {
      $('#aiProgress').classList.add('hidden');
      $('#aiActions').classList.remove('hidden');
      const msg = e.name === 'AbortError' ? '生成超时（200 秒），请重试' : (e.message || '生成失败');
      if (e.code === 'NO_KEY' || e.status === 503) {
        aiSetStatus('warn', '未找到混元 Key');
        aiShowSetup(true);
      } else if (e.status === 401) {
        aiSetStatus('bad', '混元 Key 无效或已过期');
      } else {
        aiSetStatus('bad', '生成失败 · 检查代理/网络');
      }
      $('#aiHint').textContent = msg;
    } finally {
      clearInterval(aiTimer);
      clearTimeout(to);
      aiBusy = false;
      $('#aiGenerateBtn').disabled = !aiReady;
      $('#aiProgress').classList.add('hidden');
    }
  }

  async function useAI() {
    if (!aiCandidate) return;
    try {
      const img = await imageFromDataUrl(aiCandidate);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      if (!aiOriginal) aiOriginal = S.sourceOriginal;
      S.sourceOriginal = c;
      S.uploadOriginal = c;
      S.whiteBg = detectWhiteBg(c);
      S.projectId = null;
      refreshSource();
      updateHomeUI();
      $('#aiRestoreBtn').classList.remove('hidden');
      closeSheets();
      toast('已应用 AI 效果');
    } catch (e) {
      toast('AI 图片加载失败，请重试');
    }
  }

  function restoreAI() {
    if (!aiOriginal) return;
    S.sourceOriginal = aiOriginal;
    S.uploadOriginal = aiOriginal;
    S.whiteBg = detectWhiteBg(aiOriginal);
    refreshSource();
    updateHomeUI();
    $('#aiRestoreBtn').classList.add('hidden');
    aiOriginal = null;
    toast('已恢复原图');
  }

  function bindAI() {
    $('#aiOpenBtn').addEventListener('click', openAI);
    $('#aiRestoreBtn').addEventListener('click', restoreAI);
    $('#aiCheckBtn').addEventListener('click', checkAIService);
    $('#aiSetupBtn').addEventListener('click', () => {
      $('#aiSetupBox').classList.toggle('hidden');
      $('#aiSetupBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    $('#aiGenerateBtn').addEventListener('click', generateAI);
    $('#aiRegenBtn').addEventListener('click', generateAI);
    $('#aiUseBtn').addEventListener('click', useAI);
    $('#aiSaveBase').addEventListener('click', async () => {
      const v = $('#aiBaseInput').value.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//.test(v)) { toast('请填写 http(s) 地址'); return; }
      try { localStorage.setItem('pindou-ai-base', v); } catch (e) { /* ignore */ }
      aiBase = v;
      await checkAIService();
    });
    renderAIPresets();
  }

  /* ---------- 裁切 ---------- */
  function openCrop() {
    const base = S.uploadOriginal || S.sourceOriginal;
    if (!base) { toast('先选择一张图片'); return; }
    const el = $('#cropImage');
    el.onload = () => {
      cropState = {
        img: el, ratio: '1', zoom: 1, ox: 0, oy: 0,
        W: el.naturalWidth, H: el.naturalHeight, Fw: 0, Fh: 0,
      };
      $$('#cropRatios .g-filter').forEach(b => b.classList.toggle('active', b.dataset.ratio === '1'));
      $('#cropZoom').value = '1';
      openSheet('sheetCrop');
      setTimeout(layoutCrop, 280);
    };
    el.src = base.toDataURL('image/jpeg', 0.92);
  }

  function layoutCrop() {
    if (!cropState) return;
    const stage = $('#cropStage');
    const aspect = cropState.ratio === 'original' ? cropState.W / cropState.H : +cropState.ratio;
    stage.style.aspectRatio = String(aspect);
    cropState.ox = 0;
    cropState.oy = 0;
    requestAnimationFrame(() => {
      cropState.Fw = stage.clientWidth;
      cropState.Fh = stage.clientHeight;
      renderCrop();
    });
  }

  function renderCrop() {
    if (!cropState) return;
    const { img, W, H, Fw, Fh, zoom } = cropState;
    if (!Fw || !Fh) return;
    const base = Math.max(Fw / W, Fh / H);
    const scale = base * zoom;
    const iw = W * scale, ih = H * scale;
    const maxX = Math.max(0, (iw - Fw) / 2);
    const maxY = Math.max(0, (ih - Fh) / 2);
    cropState.ox = clamp(cropState.ox, -maxX, maxX);
    cropState.oy = clamp(cropState.oy, -maxY, maxY);
    img.style.width = iw + 'px';
    img.style.height = ih + 'px';
    img.style.left = ((Fw - iw) / 2 + cropState.ox) + 'px';
    img.style.top = ((Fh - ih) / 2 + cropState.oy) + 'px';
    if ($('#cropZoom').value !== String(zoom)) $('#cropZoom').value = String(zoom);
  }

  function applyCrop() {
    if (!cropState) return;
    const { img, W, H, Fw, Fh, zoom, ox, oy } = cropState;
    const base = Math.max(Fw / W, Fh / H);
    const scale = base * zoom;
    const iw = W * scale, ih = H * scale;
    const left = (Fw - iw) / 2 + ox;
    const top = (Fh - ih) / 2 + oy;
    const sw = Math.min(W, Fw / scale);
    const sh = Math.min(H, Fh / scale);
    const sx = clamp(-left / scale, 0, Math.max(0, W - sw));
    const sy = clamp(-top / scale, 0, Math.max(0, H - sh));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sw));
    out.height = Math.max(1, Math.round(sh));
    out.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
    S.sourceOriginal = out;
    S.whiteBg = detectWhiteBg(out);
    S.projectId = null;
    refreshSource();
    $('#uploadThumb').src = out.toDataURL('image/jpeg', 0.85);
    closeSheets();
    updateHomeUI();
    toast('已应用裁切');
  }

  function bindCrop() {
    $('#ipCropBtn').addEventListener('click', openCrop);
    $('#ipBlank').addEventListener('change', e => {
      S.opts.blank = e.target.checked;
      saveSettings();
      schedulePreview();
    });
    $('#cropCancel').addEventListener('click', closeSheets);
    $('#cropApply').addEventListener('click', applyCrop);
    $('#cropZoom').addEventListener('input', e => {
      if (!cropState) return;
      cropState.zoom = +e.target.value;
      renderCrop();
    });
    $('#cropRatios').addEventListener('click', e => {
      const b = e.target.closest('[data-ratio]');
      if (!b || !cropState) return;
      cropState.ratio = b.dataset.ratio;
      $$('#cropRatios .g-filter').forEach(x => x.classList.toggle('active', x === b));
      layoutCrop();
    });
    const stage = $('#cropStage');
    stage.addEventListener('pointerdown', e => {
      if (!cropState) return;
      stage.setPointerCapture(e.pointerId);
      cropDrag = { x: e.clientX, y: e.clientY, ox: cropState.ox, oy: cropState.oy };
    });
    stage.addEventListener('pointermove', e => {
      if (!cropDrag || !cropState) return;
      cropState.ox = cropDrag.ox + (e.clientX - cropDrag.x);
      cropState.oy = cropDrag.oy + (e.clientY - cropDrag.y);
      renderCrop();
    });
    const end = () => { cropDrag = null; };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }

  function renderHomePresets() {
    const host = $('#homePresets');
    host.innerHTML = PRESETS.map(p => `
      <button class="preset" type="button" data-home-cols="${p.cols}">
        <b>${p.label}</b><span>${p.cols} 格</span><em data-home-est="${p.cols}">—</em>
      </button>`).join('') + `
      <button class="preset" type="button" data-home-cols="custom">
        <b>自定义</b><span>8–400</span><em>—</em>
      </button>`;

    host.addEventListener('click', e => {
      const btn = e.target.closest('[data-home-cols]');
      if (!btn) return;
      const v = btn.dataset.homeCols;
      if (v === 'custom') {
        $('#homeCustom').classList.remove('hidden');
        $('#homeCustomInput').focus();
        S.cols = clamp(parseInt($('#homeCustomInput').value, 10) || 40, 8, 400);
      } else {
        S.cols = +v;
        $('#homeCustom').classList.add('hidden');
      }
      S.opts.cols = S.cols;
      saveSettings();
      updateHomeUI();
    });
    $('#homeCustomInput').addEventListener('input', () => {
      const v = parseInt($('#homeCustomInput').value, 10);
      if (v >= 8 && v <= 400) {
        S.cols = v;
        S.opts.cols = v;
        saveSettings();
        updateHomeUI();
      }
    });
    $('#homeBrand').addEventListener('change', e => {
      S.opts.brand = e.target.value;
      saveSettings();
      updateHomeUI();
    });
    $('#homeColors').addEventListener('change', e => {
      S.opts.maxColors = +e.target.value;
      saveSettings();
      updateHomeUI();
    });
    $('#generateBtn').addEventListener('click', generateAndOpen);
    $('#homeAdvancedBtn').addEventListener('click', () => openSheet('sheetAdvanced'));
  }

  function updateHomeUI() {
    const hasImg = !!S.img;
    const showPreview = S.mode === 'image' && S.sourceMode === 'image' && !!S.sourceOriginal;
    const customActive = !PRESETS.some(p => p.cols === S.cols);
    $$('#homePresets .preset').forEach(btn => {
      const v = btn.dataset.homeCols;
      const active = v === 'custom' ? customActive : +v === S.cols;
      btn.classList.toggle('active', active);
    });
    $('#homeCustom').classList.toggle('hidden', !customActive);
    if (customActive) $('#homeCustomInput').value = S.cols;
    $('#homeBrand').value = S.opts.brand;
    $('#homeColors').value = String(S.opts.maxColors);

    const title = $('#calibrateTitle');
    const note = $('#calibrateNote');
    const label = $('#generateLabel');
    const sizeField = $('#sizeField');
    const previewWrap = $('#imagePreview');
    if (title) title.textContent = showPreview ? '效果预览' : '选择图纸规格';
    if (note) note.textContent = showPreview ? '先看效果，再选尺寸' : '默认即可，之后还能改';
    if (label) label.textContent = showPreview ? `使用 ${S.cols} 格生成` : '生成图纸';
    if (sizeField) sizeField.classList.toggle('hidden', showPreview);
    if (previewWrap) previewWrap.classList.toggle('hidden', !showPreview);

    if (!hasImg) {
      $('#homeEstimate').textContent = '上传图片后显示用量估算';
      $$('#homePresets em[data-home-est]').forEach(em => { em.textContent = '—'; });
      return;
    }
    if (showPreview) {
      refreshPreviewUI();
      return;
    }
    const rows = E.estimateRows(S.cols, S.imgW, S.imgH, S.opts.square);
    const beads = S.cols * rows;
    $('#homeEstimate').textContent =
      `将生成 ${S.cols} × ${rows} 格 · 约 ${fmtNum(beads)} 颗 · ${S.opts.maxColors >= 205 ? '不限色' : S.opts.maxColors + ' 色'}`
      + ` · 约 ${fmtCm(S.cols)} × ${fmtCm(rows)} cm · ${fmtTime(beads)}`;
    $$('#homePresets em[data-home-est]').forEach(em => {
      const c = +em.dataset.homeEst;
      const r = E.estimateRows(c, S.imgW, S.imgH, S.opts.square);
      const b = c * r;
      em.textContent = `≈ ${fmtNum(b)} 颗 · ${fmtTime(b)}`;
    });
  }

  /* ------------------------------------------------------------------ */
  /* 生成                                                                 */
  /* ------------------------------------------------------------------ */
  function generateAndOpen() {
    if (!S.img) {
      toast(S.mode === 'text' ? '请先输入文字' : S.mode === 'template' ? '请先选择一个模板' : '请先选择一张图片');
      return;
    }
    if (S.opts.cols !== S.cols) S.opts.cols = S.cols;
    showView('workspace');
    S.fit = true;
    generatePattern(false);
    buildSettingsPanels();
    fitToWindow();
    updateAll();
    document.documentElement.dataset.ready = '1';
  }

  function generatePattern(notify) {
    if (!S.img) return false;
    const genOpts = { ...S.opts, cols: S.cols };
    if (S.sourceMode !== 'image') genOpts.sampling = 'dominant';
    genOpts.edgeClean = S.whiteBg && S.opts.blank;
    genOpts.flat = S.sourceMode !== 'image';
    const res = E.generate(S.img, genOpts);
    if (!res.palette.length || !res.total) {
      toast('这张图没有可拼的内容，换一张试试');
      return false;
    }
    S.cols = res.cols; S.rows = res.rows;
    S.grid = res.grid; S.palette = res.palette;
    S.total = res.total; S.empty = res.empty;
    S.excluded = new Set();
    S.gridBackup = null;
    S.history = []; S.future = [];
    S.selected = 0;
    S.dirty = false;
    S.tool = 'brush';
    S.fit = true;
    syncToolUI();
    updateAll();
    if (notify) {
      toast(`已生成 ${S.cols} × ${S.rows} 格 · ${fmtNum(S.total)} 颗`);
    }
    return true;
  }

  function updateAll() {
    updateMeta();
    drawPreview();
    renderLegendLists();
    syncSettingsUI();
    updateHistoryButtons();
    scheduleSave();
  }

  function updateMeta() {
    const used = S.palette.filter(p => p.count > 0).length;
    $('#wsMeta').textContent =
      `${S.cols} × ${S.rows} · ${fmtNum(S.total)} 颗 · ${used} 色`;
    $('#costLine').textContent =
      `约 ${fmtCm(S.cols)} × ${fmtCm(S.rows)} cm · ${fmtTime(S.total)}`;
    $('#exportContents').textContent = '包含：标题 · 坐标 · 色号 · 图例 · 统计';
    const changeBtn = $('#changeBtn');
    if (changeBtn) changeBtn.textContent = S.sourceMode === 'image' ? '更换图片' : '更换来源';
  }

  /* ------------------------------------------------------------------ */
  /* 画布绘制                                                             */
  /* ------------------------------------------------------------------ */
  function canvasMargins() {
    return S.display.coords ? { mL: 34, mT: 24 } : { mL: 8, mT: 8 };
  }

  function computeFitCell() {
    const vp = $('#canvasViewport');
    if (!vp || !vp.clientWidth) return S.cell || 16;
    const { mL, mT } = canvasMargins();
    const availW = vp.clientWidth - 26 - mL;
    const availH = vp.clientHeight - 26 - mT;
    if (availW < 40 || availH < 40) return S.cell || 16;
    const c = Math.floor(Math.min(availW / S.cols, availH / S.rows));
    return clamp(c, 2, 36);
  }

  function fitToWindow() {
    S.fit = true;
    drawPreview();
  }

  function setZoom(cell, anchor) {
    const vp = $('#canvasViewport');
    const before = { cell: S.cell };
    S.fit = false;
    S.cell = clamp(Math.round(cell), 6, 36);
    if (anchor && vp) {
      const vr = vp.getBoundingClientRect();
      const cv = $('#patternCanvas');
      const cr = cv.getBoundingClientRect();
      const { mL, mT } = canvasMargins();
      const localX = anchor.x - vr.left, localY = anchor.y - vr.top;
      const anchorX = (localX + vp.scrollLeft - (cr.left - vr.left) - mL) / before.cell;
      const anchorY = (localY + vp.scrollTop - (cr.top - vr.top) - mT) / before.cell;
      drawPreview();
      const cr2 = cv.getBoundingClientRect();
      const m2 = canvasMargins();
      vp.scrollLeft = (cr2.left - vr.left) + vp.scrollLeft + m2.mL + anchorX * S.cell - localX;
      vp.scrollTop = (cr2.top - vr.top) + vp.scrollTop + m2.mT + anchorY * S.cell - localY;
    } else {
      drawPreview();
    }
  }

  function updateZoomUI() {
    const range = $('#zoomRange');
    range.value = clamp(S.cell, 6, 36);
    $('#zoomLabel').textContent = (S.fit ? '适应 · ' : '') + S.cell + 'px';
  }

  function drawPreview() {
    const canvas = $('#patternCanvas');
    if (!S.grid.length) { canvas.width = 0; canvas.height = 0; return; }
    if (S.fit) S.cell = computeFitCell();
    const cell = S.cell;
    const { mL, mT } = canvasMargins();
    const W = mL + S.cols * cell + 2;
    const H = mT + S.rows * cell + 2;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    for (let y = 0; y < S.rows; y++) {
      for (let x = 0; x < S.cols; x++) {
        const v = S.grid[y][x];
        const px = mL + x * cell, py = mT + y * cell;
        if (v < 0) {
          ctx.fillStyle = '#F1EEE6';
          ctx.fillRect(px, py, cell, cell);
        } else {
          ctx.fillStyle = S.palette[v].hex;
          ctx.fillRect(px, py, cell, cell);
        }
      }
    }

    if (S.display.code && S.opts.labelMode !== 'none' && cell >= 16) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let y = 0; y < S.rows; y++) {
        for (let x = 0; x < S.cols; x++) {
          const v = S.grid[y][x];
          if (v < 0) continue;
          const p = S.palette[v];
          const label = S.opts.labelMode === 'code' ? p.code : labelSymbol(v);
          const fontPx = Math.min(Math.max(cell * (label.length >= 4 ? 0.36 : 0.46), 6), 11.5);
          ctx.font = `600 ${fontPx}px "PingFang SC","Noto Sans SC",sans-serif`;
          ctx.fillStyle = E.textColorFor(p.hex);
          ctx.fillText(label, mL + x * cell + cell / 2, mT + y * cell + cell / 2 + 0.5);
        }
      }
    }

    ctx.lineWidth = 1;
    const drawLight = cell >= 4;
    for (let i = 0; i <= S.cols; i++) {
      const major = i % 10 === 0;
      if (!major && !drawLight) continue;
      const x = mL + i * cell;
      ctx.strokeStyle = major ? '#4A5560' : '#E3E7EC';
      ctx.beginPath(); ctx.moveTo(x + 0.5, mT); ctx.lineTo(x + 0.5, mT + S.rows * cell); ctx.stroke();
    }
    for (let j = 0; j <= S.rows; j++) {
      const major = j % 10 === 0;
      if (!major && !drawLight) continue;
      const y = mT + j * cell;
      ctx.strokeStyle = major ? '#4A5560' : '#E3E7EC';
      ctx.beginPath(); ctx.moveTo(mL, y + 0.5); ctx.lineTo(mL + S.cols * cell, y + 0.5); ctx.stroke();
    }

    if (S.display.board) {
      ctx.strokeStyle = '#2F6FE4';
      ctx.lineWidth = 1.5;
      for (let i = 29; i < S.cols; i += 29) {
        const x = mL + i * cell;
        ctx.beginPath(); ctx.moveTo(x + 0.5, mT); ctx.lineTo(x + 0.5, mT + S.rows * cell); ctx.stroke();
      }
      for (let j = 29; j < S.rows; j += 29) {
        const y = mT + j * cell;
        ctx.beginPath(); ctx.moveTo(mL, y + 0.5); ctx.lineTo(mL + S.cols * cell, y + 0.5); ctx.stroke();
      }
    }

    if (S.display.coords) {
      ctx.font = '9.5px "PingFang SC","Noto Sans SC",sans-serif';
      ctx.fillStyle = '#4A5560';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < S.cols; i++) {
        if (i % 10 === 0 || i === S.cols - 1) {
          ctx.fillText(String(i + 1), mL + i * cell + cell / 2, mT - 10);
        }
      }
      ctx.textAlign = 'right';
      for (let j = 0; j < S.rows; j++) {
        if (j % 10 === 0 || j === S.rows - 1) {
          ctx.fillText(String(j + 1), mL - 5, mT + j * cell + cell / 2);
        }
      }
    }

    layoutCanvas();
    updateZoomUI();
    updateCanvasHint();
  }

  function updateCanvasHint() {
    const hint = $('#canvasHint');
    if (!hint) return;
    const codesHidden = S.display.code && S.opts.labelMode !== 'none' && S.cell < 16;
    hint.textContent = codesHidden
      ? '放大到 16px/格以上显示色号 · 空格拖动 · 右键擦除'
      : '空格 + 拖动平移 · 右键擦除 · ⌘Z 撤销';
  }

  const SYMBOLS = (function () {
    const s = [];
    for (let c = 65; c <= 90; c++) s.push(String.fromCharCode(c));
    for (let c = 97; c <= 122; c++) s.push(String.fromCharCode(c));
    for (let i = 0; i <= 9; i++) s.push(String(i));
    s.push('+', '−', '×', '÷', '○', '●', '△', '▲', '□', '■', '☆', '★', '♥', '♠', '♦', '♣');
    return s;
  })();
  function labelSymbol(idx) { return SYMBOLS[idx] || '?'; }

  function layoutCanvas() {
    const vp = $('#canvasViewport');
    const canvas = $('#patternCanvas');
    if (!vp || !canvas.width) return;
    const padX = Math.max(12, Math.floor((vp.clientWidth - canvas.width) / 2));
    const padY = Math.max(12, Math.floor((vp.clientHeight - canvas.height) / 2));
    canvas.style.margin = `${padY}px ${padX}px`;
  }

  /* ------------------------------------------------------------------ */
  /* 设置面板                                                             */
  /* ------------------------------------------------------------------ */
  function settingsHTML() {
    const customActive = !PRESETS.some(p => p.cols === S.cols);
    return `
      <div class="sg">
        <div class="sg-label">尺寸 <span class="sg-hint">横向格数</span></div>
        <div class="preset-row">
          ${PRESETS.map(p => `
            <button class="preset" type="button" data-cols="${p.cols}">
              <b>${p.label}</b><span>${p.cols} 格</span><em data-est="${p.cols}"></em>
            </button>`).join('')}
          <button class="preset ${customActive ? 'active' : ''}" type="button" data-cols="custom">
            <b>自定义</b><span>8–400</span><em></em>
          </button>
        </div>
        <div class="custom-size ${customActive ? '' : 'hidden'}" data-custom>
          <input type="number" data-custom-input min="8" max="400" step="1" value="${S.cols}" inputmode="numeric">
          <span>格宽</span>
        </div>
      </div>
      <div class="sg grid2">
        <label>品牌
          <select class="select" data-brand>${BRANDS.map(b => `<option value="${b[0]}">${b[1]}</option>`).join('')}</select>
        </label>
        <label>颜色数
          <select class="select" data-colors>
            <option value="8">8 色</option>
            <option value="12">12 色</option>
            <option value="16">16 色</option>
            <option value="24">24 色</option>
            <option value="32">32 色</option>
            <option value="205">不限</option>
          </select>
        </label>
      </div>
      <div class="sg grid2">
        <label>豆子直径
          <select class="select" data-bead>
            <option value="2.6">2.6mm</option>
            <option value="5">5mm</option>
          </select>
        </label>
        <label>格内标注
          <select class="select" data-label>
            <option value="code">色号</option>
            <option value="symbol">符号</option>
            <option value="none">不标注</option>
          </select>
        </label>
      </div>
      <button class="btn btn-ghost btn-block" type="button" data-open-advanced>高级参数…</button>
      <button class="btn btn-ghost btn-block" type="button" data-reset-all>恢复推荐默认</button>`;
  }

  function buildSettingsPanels() {
    $('#settingsDesktop').innerHTML = settingsHTML() + `
      <div class="legend-block">
        <div class="legend-head"><span>图例</span><span class="legend-count" data-legend-count>—</span></div>
        <div class="legend-list" id="legendListDesktop"></div>
      </div>`;
    $('#settingsMobile').innerHTML = settingsHTML() +
      `<div class="sheet-tip">改动会立即重新生成图纸。</div>`;
    syncSettingsUI();
    renderLegendLists();
  }

  function syncSettingsUI() {
    ['settingsDesktop', 'settingsMobile'].forEach(id => {
      const host = document.getElementById(id);
      if (!host) return;
      const customActive = !PRESETS.some(p => p.cols === S.cols);
      $$('[data-cols]', host).forEach(btn => {
        const v = btn.dataset.cols;
        btn.classList.toggle('active', v === 'custom' ? customActive : +v === S.cols);
      });
      const custom = $('[data-custom]', host);
      if (custom) custom.classList.toggle('hidden', !customActive);
      const ci = $('[data-custom-input]', host);
      if (ci) ci.value = S.cols;
      const brand = $('[data-brand]', host);
      if (brand) brand.value = S.opts.brand;
      const colors = $('[data-colors]', host);
      if (colors) colors.value = String(S.opts.maxColors);
      const bead = $('[data-bead]', host);
      if (bead) bead.value = String(S.opts.beadMm);
      const label = $('[data-label]', host);
      if (label) label.value = S.opts.labelMode;
      if (S.img) {
        $$('[data-est]', host).forEach(em => {
          const c = +em.dataset.est;
          const rows = E.estimateRows(c, S.imgW, S.imgH, S.opts.square);
          em.textContent = `≈ ${fmtNum(c * rows)} 颗`;
        });
      }
    });
  }

  function onSettingsClick(e) {
    const host = e.currentTarget;
    const preset = e.target.closest('[data-cols]');
    if (preset) {
      const v = preset.dataset.cols;
      if (v === 'custom') {
        const input = $('[data-custom-input]', host);
        if (input) { input.value = S.cols; input.focus(); input.select(); }
        return;
      }
      setCols(+v);
      return;
    }
    if (e.target.closest('[data-open-advanced]')) {
      closeSheets();
      setTimeout(() => openSheet('sheetAdvanced'), 180);
      return;
    }
    if (e.target.closest('[data-reset-all]')) resetAll();
  }

  function onSettingsChange(e) {
    const t = e.target;
    if (t.matches('[data-custom-input]')) {
      const v = parseInt(t.value, 10);
      if (v >= 8 && v <= 400) setCols(v);
      return;
    }
    if (t.matches('[data-brand]')) { S.opts.brand = t.value; regenerate(); return; }
    if (t.matches('[data-colors]')) { S.opts.maxColors = +t.value; regenerate(); return; }
    if (t.matches('[data-bead]')) { S.opts.beadMm = +t.value; updateMeta(); saveSettings(); return; }
    if (t.matches('[data-label]')) { S.opts.labelMode = t.value; drawPreview(); saveSettings(); return; }
  }

  function setCols(cols) {
    S.cols = clamp(cols, 8, 400);
    S.opts.cols = S.cols;
    saveSettings();
    if (S.grid.length) {
      generatePattern(true);
      buildSettingsPanels();
      fitToWindow();
    } else {
      updateHomeUI();
      updateAll();
    }
    syncSettingsUI();
  }

  function remapBrandCodes(brand) {
    const data = window.PINDOU_COLORS;
    const map = {};
    Object.keys(data).forEach(hex => {
      const code = data[hex][brand];
      if (code) map[hex] = code;
    });
    S.palette.forEach(p => { if (map[p.hex]) p.code = map[p.hex]; });
  }

  function regenerate() {
    if (!S.grid.length) { updateHomeUI(); saveSettings(); return; }
    if (!S.img) {
      remapBrandCodes(S.opts.brand);
      saveSettings();
      updateAll();
      toast(`已切换为 ${S.opts.brand} 色号（无原图，尺寸与颜色数保持）`);
      return;
    }
    saveSettings();
    generatePattern(false);
    buildSettingsPanels();
    fitToWindow();
  }

  function resetAll() {
    S.opts = { ...DEFAULTS };
    S.display = { ...DEFAULT_DISPLAY };
    S.cols = DEFAULTS.cols;
    S.opts.cols = S.cols;
    if (S.sourceOriginal) refreshSource();
    saveSettings();
    syncAdvancedUI();
    syncDisplayUI();
    if (S.grid.length) { generatePattern(false); buildSettingsPanels(); fitToWindow(); }
    else updateHomeUI();
    toast('已恢复推荐默认');
  }

  /* ------------------------------------------------------------------ */
  /* 高级参数                                                             */
  /* ------------------------------------------------------------------ */
  function buildAdvanced() {
    const host = $('#advancedMobile');
    host.innerHTML = `
      <div class="adv-row">
        <span class="adv-label">采样方式</span>
        <select class="select" data-adv="sampling">
          <option value="avg">盒式平均（平滑，适合照片）</option>
          <option value="dominant">主导色（边缘更干净，适合卡通）</option>
        </select>
        <span class="adv-help">卡通 / logo 选主导色，避免色块边缘发灰。</span>
      </div>
      <div class="adv-row">
        <span class="adv-label">颜色匹配</span>
        <select class="select" data-adv="match">
          <option value="lab">Lab（推荐）</option>
          <option value="cie">CIEDE2000（更准，稍慢）</option>
          <option value="rgb">RGB（最快）</option>
        </select>
      </div>
      <div class="adv-row">
        <span class="adv-label">渐变抖动</span>
        <select class="select" data-adv="dither">
          <option value="off">关（推荐）</option>
          <option value="bayer">Bayer 4×4</option>
          <option value="fs">Floyd–Steinberg</option>
        </select>
        <span class="adv-help">照片渐变多时开启，卡通图案建议关闭。</span>
      </div>
      <div class="adv-row">
        <span class="adv-label">画面风格</span>
        <select class="select" data-adv="style">
          <option value="original">原图（推荐）</option>
          <option value="cartoon">卡通（色块更干净）</option>
          <option value="pixel">像素（复古颗粒）</option>
          <option value="silhouette">剪影（单色轮廓）</option>
        </select>
        <span class="adv-help">仅对「图片」来源生效；文字与模板保持矢量清晰。</span>
      </div>
      <div class="adv-row">
        <span class="adv-label">区域合并（去杂色）</span>
        <div class="adv-slider">
          <input type="range" data-adv-range="merge" min="0" max="80" step="5">
          <span data-adv-val="merge">关</span>
        </div>
        <span class="adv-help">照片噪点多时调高（25–60），卡通保持 0。</span>
      </div>
      <div class="adv-row">
        <span class="adv-label">构图</span>
        <label class="adv-check"><input type="checkbox" data-adv-check="autoTrim"> 自动裁掉四周白边（留白明显时）</label>
        <span class="adv-help">让图案尽量占满图纸；不想改变构图时关闭。</span>
      </div>
      <div class="adv-row">
        <span class="adv-label">背景处理</span>
        <label class="adv-check"><input type="checkbox" data-adv-check="blank"> 白色 / 透明背景留空</label>
        <label class="adv-check"><input type="checkbox" data-adv-check="boundary"> 仅移除与边缘连通的背景（保留主体内部白色）</label>
        <div class="adv-slider">
          <span class="adv-help" style="margin:0;min-width:52px">白色阈值</span>
          <input type="range" data-adv-range="whiteTh" min="200" max="250" step="5">
          <span data-adv-val="whiteTh">240</span>
        </div>
      </div>
      <button class="btn btn-ghost btn-block" type="button" data-reset-adv>恢复推荐默认</button>`;
  }

  function syncAdvancedUI() {
    const host = $('#advancedMobile');
    if (!host || !host.children.length) return;
    $$('[data-adv]', host).forEach(sel => { sel.value = S.opts[sel.dataset.adv]; });
    $$('[data-adv-check]', host).forEach(cb => { cb.checked = !!S.opts[cb.dataset.advCheck]; });
    $$('[data-adv-range]', host).forEach(r => {
      r.value = S.opts[r.dataset.advRange];
      updateAdvVal(r.dataset.advRange);
    });
  }
  function updateAdvVal(key) {
    const el = $(`[data-adv-val="${key}"]`);
    if (!el) return;
    const v = S.opts[key];
    el.textContent = key === 'merge' ? (v ? String(v) : '关') : String(v);
  }

  function bindAdvanced() {
    const host = $('#advancedMobile');
    host.addEventListener('change', e => {
      const adv = e.target.dataset.adv;
      if (adv) {
        S.opts[adv] = e.target.value;
        if (adv === 'style') {
          refreshSource();
          updateHomeUI();
          regenerate();
        } else {
          regenerate();
        }
        saveSettings();
        return;
      }
      const chk = e.target.dataset.advCheck;
      if (chk) {
        S.opts[chk] = e.target.checked;
        if (chk === 'autoTrim') {
          refreshSource();
          updateHomeUI();
        }
        saveSettings();
        regenerate();
        return;
      }
    });
    host.addEventListener('input', e => {
      const r = e.target.dataset.advRange;
      if (!r) return;
      S.opts[r] = +e.target.value;
      updateAdvVal(r);
      saveSettings();
      clearTimeout(regenTimer);
      regenTimer = setTimeout(regenerate, 160);
    });
    host.addEventListener('click', e => {
      if (e.target.closest('[data-reset-adv]')) {
        S.opts = { ...S.opts, sampling: DEFAULTS.sampling, match: DEFAULTS.match,
          dither: DEFAULTS.dither, merge: DEFAULTS.merge, blank: DEFAULTS.blank,
          boundary: DEFAULTS.boundary, whiteTh: DEFAULTS.whiteTh };
        saveSettings();
        syncAdvancedUI();
        regenerate();
        toast('高级参数已恢复推荐默认');
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 显示开关                                                             */
  /* ------------------------------------------------------------------ */
  function syncDisplayUI() {
    $$('[data-display]').forEach(cb => {
      cb.checked = !!S.display[cb.dataset.display];
    });
  }

  function bindDisplay() {
    $$('[data-display]').forEach(cb => {
      cb.addEventListener('change', () => {
        S.display[cb.dataset.display] = cb.checked;
        saveSettings();
        drawPreview();
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 工具                                                                 */
  /* ------------------------------------------------------------------ */
  function setTool(tool) {
    S.tool = tool;
    syncToolUI();
  }
  function syncToolUI() {
    $$('[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === S.tool);
    });
    const cv = $('#patternCanvas');
    cv.classList.remove('tool-hand', 'tool-eraser', 'tool-eyedropper');
    if (S.tool === 'hand') cv.classList.add('tool-hand');
    if (S.tool === 'eraser') cv.classList.add('tool-eraser');
    if (S.tool === 'eyedropper') cv.classList.add('tool-eyedropper');
  }

  /* ------------------------------------------------------------------ */
  /* 图例 / 颜色排除                                                      */
  /* ------------------------------------------------------------------ */
  function renderLegendLists() {
    const html = legendHTML();
    const d = $('#legendListDesktop');
    if (d) d.innerHTML = html;
    const m = $('#legendListMobile');
    if (m) m.innerHTML = html;
    const used = S.palette.filter(p => p.count > 0 && !S.excluded.has(p.code)).length;
    $$('[data-legend-count]').forEach(el => { el.textContent = `${used} 色 · ${fmtNum(S.total)} 颗`; });
    const sheetCount = $('#legendSheetCount');
    if (sheetCount) sheetCount.textContent = `${used} 色 · ${fmtNum(S.total)} 颗`;
    $('#restoreAllBtn').classList.toggle('hidden', S.excluded.size === 0);
  }

  function legendHTML() {
    if (!S.palette.length) return '<div class="legend-empty">生成图纸后，这里会显示每个色号的用量。</div>';
    const items = S.palette.map((p, i) => {
      const excluded = S.excluded.has(p.code);
      if (!excluded && p.count <= 0) return '';
      const selected = i === S.selected && !excluded;
      return `
        <div class="legend-item ${excluded ? 'excluded' : ''} ${selected ? 'selected' : ''}" data-code="${p.code}">
          <span class="legend-swatch" style="background:${p.hex}"></span>
          <span class="legend-code">${p.code}</span>
          <span class="legend-count">${excluded ? '已排除' : fmtNum(p.count) + ' 颗'}</span>
          ${excluded ? '' : `<button class="legend-x" type="button" data-exclude="${p.code}" aria-label="排除 ${p.code}">✕</button>`}
        </div>`;
    }).join('');
    return items || '<div class="legend-empty">没有可用的颜色。</div>';
  }

  function bindLegend() {
    document.addEventListener('click', e => {
      const row = e.target.closest('.legend-item');
      if (!row) return;
      const code = row.dataset.code;
      if (e.target.closest('.legend-x')) { excludeColor(code); return; }
      if (row.classList.contains('excluded')) { restoreAll(); return; }
      const idx = S.palette.findIndex(p => p.code === code);
      if (idx >= 0) {
        S.selected = idx;
        setTool('brush');
        renderLegendLists();
      }
    });
    $('#restoreAllBtn').addEventListener('click', restoreAll);
  }

  function excludeColor(code) {
    if (!S.grid.length) return;
    const allowed = S.palette.some(p => p.code !== code && !S.excluded.has(p.code));
    if (!allowed) { toast('至少保留一种颜色'); return; }
    const exBefore = new Set(S.excluded);
    const backupBefore = S.gridBackup;
    if (!S.gridBackup) S.gridBackup = S.grid.map(r => r.slice());
    S.excluded.add(code);
    const res = E.remapExcluded(S.grid, S.palette, S.excluded, S.opts.match);
    const diffs = res.changed.map(c => ({ x: c.x, y: c.y, before: c.before, after: c.after }));
    S.grid = res.grid;
    updateCounts();
    pushHistory({
      diffs,
      exBefore, exAfter: new Set(S.excluded),
      backupBefore, backupAfter: S.gridBackup,
    });
    S.dirty = true;
    updateAll();
    toast(`已排除 ${code}，${res.changed.length} 格替换为相近色`, { undo: undo });
  }

  function restoreAll() {
    if (!S.excluded.size) { toast('当前没有排除的颜色'); return; }
    const exBefore = new Set(S.excluded);
    const backupBefore = S.gridBackup;
    const target = S.gridBackup || S.grid.map(r => r.slice());
    const diffs = [];
    for (let y = 0; y < S.rows; y++) {
      for (let x = 0; x < S.cols; x++) {
        const before = S.grid[y][x];
        const after = target[y][x];
        if (before !== after) diffs.push({ x, y, before, after });
      }
    }
    S.grid = target.map(r => r.slice());
    S.excluded.clear();
    S.gridBackup = null;
    updateCounts();
    pushHistory({
      diffs,
      exBefore, exAfter: new Set(),
      backupBefore, backupAfter: null,
    });
    S.dirty = true;
    updateAll();
    toast('已恢复全部颜色', { undo: undo });
  }

  function updateCounts() {
    const counts = new Array(S.palette.length).fill(0);
    let total = 0;
    for (const row of S.grid) {
      for (const v of row) if (v >= 0) { counts[v]++; total++; }
    }
    S.palette.forEach((p, i) => { p.count = counts[i]; });
    S.total = total;
    S.empty = S.cols * S.rows - total;
  }

  /* ------------------------------------------------------------------ */
  /* 历史记录                                                             */
  /* ------------------------------------------------------------------ */
  function pushHistory(entry) {
    if (!entry.diffs.length && entry.exBefore === entry.exAfter) return;
    S.history.push(entry);
    if (S.history.length > 30) S.history.shift();
    S.future = [];
    updateHistoryButtons();
  }

  function applyEntry(entry, dir) {
    for (const d of entry.diffs) {
      S.grid[d.y][d.x] = dir === 'undo' ? d.before : d.after;
    }
    if (dir === 'undo') {
      S.excluded = new Set(entry.exBefore);
      S.gridBackup = entry.backupBefore;
    } else {
      S.excluded = new Set(entry.exAfter);
      S.gridBackup = entry.backupAfter;
    }
    updateCounts();
    updateAll();
  }

  function undo() {
    if (!S.history.length) return;
    const entry = S.history.pop();
    S.future.push(entry);
    applyEntry(entry, 'undo');
    S.dirty = S.history.length > 0;
    updateHistoryButtons();
  }

  function redo() {
    if (!S.future.length) return;
    const entry = S.future.pop();
    S.history.push(entry);
    applyEntry(entry, 'redo');
    S.dirty = true;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    const u = $('#undoBtn'), r = $('#redoBtn');
    if (u) u.disabled = !S.history.length;
    if (r) r.disabled = !S.future.length;
  }

  /* ------------------------------------------------------------------ */
  /* 画布交互：绘制 / 擦除 / 取色 / 平移 / 双指缩放                         */
  /* ------------------------------------------------------------------ */
  function canvasPoint(e) {
    const canvas = $('#patternCanvas');
    const rect = canvas.getBoundingClientRect();
    const { mL, mT } = canvasMargins();
    const x = e.clientX - rect.left - mL;
    const y = e.clientY - rect.top - mT;
    const cx = Math.floor(x / S.cell);
    const cy = Math.floor(y / S.cell);
    if (cx < 0 || cy < 0 || cx >= S.cols || cy >= S.rows) return null;
    return { x: cx, y: cy };
  }

  function setCell(x, y, val) {
    const old = S.grid[y][x];
    if (old === val) return false;
    S.grid[y][x] = val;
    if (old >= 0) S.palette[old].count--;
    if (val >= 0) S.palette[val].count++;
    if (old < 0 && val >= 0) S.total++;
    if (old >= 0 && val < 0) S.total--;
    S.dirty = true;
    return true;
  }

  function applyStrokeCell(c) {
    if (!stroke) return;
    if (c.x === stroke.lastX && c.y === stroke.lastY) return;
    const val = stroke.erase ? -1 : S.selected;
    const before = S.grid[c.y][c.x];
    if (before === val) { stroke.lastX = c.x; stroke.lastY = c.y; return; }
    setCell(c.x, c.y, val);
    if (!stroke.diffs.has(c.y * S.cols + c.x)) {
      stroke.diffs.set(c.y * S.cols + c.x, { x: c.x, y: c.y, before, after: val });
    }
    stroke.lastX = c.x; stroke.lastY = c.y;
    drawPreview();
  }

  function startStroke(e) {
    const c = canvasPoint(e);
    if (!c) return;
    stroke = {
      erase: e.button === 2 || S.tool === 'eraser',
      diffs: new Map(), lastX: -1, lastY: -1,
      startX: e.clientX, startY: e.clientY,
    };
    applyStrokeCell(c);
    if (e.pointerType === 'touch' && !stroke.erase && S.tool === 'brush') {
      clearTimeout(lpTimer);
      lpTimer = setTimeout(() => {
        if (!stroke) return;
        stroke.erase = true;
        applyStrokeCell({ x: stroke.lastX, y: stroke.lastY });
        if (navigator.vibrate) navigator.vibrate(12);
      }, 450);
    }
  }

  function finishStroke() {
    if (!stroke) return;
    clearTimeout(lpTimer);
    const diffs = [...stroke.diffs.values()];
    if (diffs.length) {
      pushHistory({
        diffs,
        exBefore: new Set(S.excluded), exAfter: new Set(S.excluded),
        backupBefore: S.gridBackup, backupAfter: S.gridBackup,
      });
      updateMeta();
      renderLegendLists();
      scheduleSave();
    }
    stroke = null;
  }

  function startPan(e) {
    const vp = $('#canvasViewport');
    pan = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop };
    $('#patternCanvas').classList.add('dragging');
  }

  function handlePointerDown(e) {
    if (e.pointerType === 'touch') e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      if (stroke) { finishStroke(); }
      const pts = [...pointers.values()];
      pinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        cell: S.cell,
        lastMidX: (pts[0].x + pts[1].x) / 2,
        lastMidY: (pts[0].y + pts[1].y) / 2,
      };
      return;
    }
    if (pointers.size > 2) return;

    if (e.button === 1 || S.tool === 'hand' || spaceDown) { startPan(e); return; }
    if (S.tool === 'eyedropper') { pickColor(e); return; }
    startStroke(e);
  }

  function pickColor(e) {
    const c = canvasPoint(e);
    if (!c) return;
    const v = S.grid[c.y][c.x];
    if (v < 0) { toast('这一格是留空，没有颜色可取'); return; }
    S.selected = v;
    setTool('brush');
    renderLegendLists();
    toast(`已取色 ${S.palette[v].code}`);
  }

  function handlePointerMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size >= 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const vp = $('#canvasViewport');

      if (Math.abs(dist - pinch.dist) > 6) {
        const newCell = clamp(Math.round(pinch.cell * dist / pinch.dist), 4, 36);
        if (newCell !== S.cell) {
          setZoom(newCell, { x: midX, y: midY });
        }
      } else {
        vp.scrollLeft -= (midX - pinch.lastMidX);
        vp.scrollTop -= (midY - pinch.lastMidY);
      }
      pinch.lastMidX = midX; pinch.lastMidY = midY;
      return;
    }

    if (pan) {
      const vp = $('#canvasViewport');
      vp.scrollLeft = pan.sl - (e.clientX - pan.x);
      vp.scrollTop = pan.st - (e.clientY - pan.y);
      return;
    }

    if (stroke) {
      if (e.pointerType === 'touch') {
        const dx = e.clientX - (stroke.startX || e.clientX);
        const dy = e.clientY - (stroke.startY || e.clientY);
        if (Math.abs(dx) + Math.abs(dy) > 8) clearTimeout(lpTimer);
      }
      const c = canvasPoint(e);
      if (c) applyStrokeCell(c);
    }
  }

  function handlePointerUp(e) {
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) pinch = null;
    if (pan) { pan = null; $('#patternCanvas').classList.remove('dragging'); }
    if (stroke) finishStroke();
  }

  function bindCanvas() {
    const canvas = $('#patternCanvas');
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    // 滚轮缩放（Ctrl / ⌘ + 滚轮）
    $('#canvasViewport').addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom(S.cell + (e.deltaY > 0 ? -1 : 1), { x: e.clientX, y: e.clientY });
    }, { passive: false });

    // 空格平移
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && !isTyping(e)) {
        spaceDown = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'Space') spaceDown = false;
    });

    // 视口尺寸变化
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if ($('#viewWorkspace').classList.contains('hidden')) return;
        if (S.fit) drawPreview(); else layoutCanvas();
      });
      ro.observe($('#canvasViewport'));
    } else {
      window.addEventListener('resize', () => {
        if (S.fit) drawPreview(); else layoutCanvas();
      });
    }
  }

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  /* ------------------------------------------------------------------ */
  /* 缩放控件                                                             */
  /* ------------------------------------------------------------------ */
  function bindZoom() {
    $('#zoomRange').addEventListener('input', e => {
      S.fit = false;
      S.cell = clamp(+e.target.value, 6, 36);
      drawPreview();
    });
    $('#zoomIn').addEventListener('click', () => setZoom(S.cell + 2));
    $('#zoomOut').addEventListener('click', () => setZoom(S.cell - 2));
    $('#fitBtn').addEventListener('click', fitToWindow);
  }

  /* ------------------------------------------------------------------ */
  /* 工具按钮                                                             */
  /* ------------------------------------------------------------------ */
  function bindTools() {
    $$('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });
    $('#legendBtn').addEventListener('click', () => {
      renderLegendLists();
      openSheet('sheetLegend');
    });
    $('#settingsBtn').addEventListener('click', () => {
      syncSettingsUI();
      openSheet('sheetSettings');
    });
    $('#undoBtn').addEventListener('click', undo);
    $('#redoBtn').addEventListener('click', redo);
    $('#backBtn').addEventListener('click', async () => {
      if (S.dirty) {
        const ok = await confirmDialog('返回首页后，本次的手动修改不会保留。', '返回首页');
        if (!ok) return;
      }
      closeAllSheets();
      showView('home');
      setMode(S.sourceMode || 'image');
      updateHomeUI();
      refreshRecent();
    });
    $('#exportBtn').addEventListener('click', () => {
      syncExportUI();
      openSheet('sheetExport');
    });
    $('#titleInput').addEventListener('input', e => {
      S.title = e.target.value.trim();
    });
  }

  /* ------------------------------------------------------------------ */
  /* 浮层                                                                 */
  /* ------------------------------------------------------------------ */
  function openSheet(id) {
    const el = document.getElementById(id);
    if (el) openSheetEl(el);
  }
  function openSheetEl(el) {
    if (activeSheet && activeSheet !== el) closeSheetEl(activeSheet, true);
    activeSheet = el;
    el.hidden = false;
    const scrim = $('#scrim');
    scrim.hidden = false;
    requestAnimationFrame(() => {
      el.classList.add('open');
      scrim.classList.add('show');
    });
    el._returnFocus = document.activeElement;
    el.setAttribute('tabindex', '-1');
    setTimeout(() => {
      try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }, 60);
  }
  function closeSheetEl(el, instant) {
    if (!el) return;
    el.classList.remove('open');
    if (instant) {
      el.hidden = true;
    } else {
      setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, 240);
    }
    if (el === activeSheet) {
      activeSheet = null;
      const scrim = $('#scrim');
      scrim.classList.remove('show');
      setTimeout(() => { if (!activeSheet) scrim.hidden = true; }, 240);
    }
    const ret = el._returnFocus;
    if (ret && ret.focus) { try { ret.focus(); } catch (e) { /* ignore */ } }
  }
  function closeSheets() {
    if (activeSheet) closeSheetEl(activeSheet);
  }
  function closeAllSheets() {
    $$('.sheet.open').forEach(el => closeSheetEl(el, true));
    activeSheet = null;
    const scrim = $('#scrim');
    scrim.classList.remove('show');
    scrim.hidden = true;
  }

  function confirmDialog(text, okText) {
    return new Promise(resolve => {
      const el = document.createElement('section');
      el.className = 'sheet';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.innerHTML = `
        <div class="sheet-head"><h2 class="serif">提示</h2></div>
        <div class="sheet-body">
          <p style="margin:0;color:var(--ink-2);font-size:13px;line-height:1.8">${text}</p>
          <div class="sheet-actions">
            <button class="btn btn-primary btn-block" type="button" data-ok>${okText || '确定'}</button>
            <button class="btn btn-ghost btn-block" type="button" data-cancel>取消</button>
          </div>
        </div>`;
      document.body.appendChild(el);
      openSheetEl(el);
      const done = v => {
        closeSheetEl(el);
        setTimeout(() => el.remove(), 260);
        resolve(v);
      };
      el.querySelector('[data-ok]').addEventListener('click', () => done(true));
      el.querySelector('[data-cancel]').addEventListener('click', () => done(false));
    });
  }

  function bindSheets() {
    $('#scrim').addEventListener('click', closeSheets);
    $$('[data-close]').forEach(btn => btn.addEventListener('click', closeSheets));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (activeSheet) { e.preventDefault(); closeSheets(); } }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 导出                                                                 */
  /* ------------------------------------------------------------------ */
  function makeChart(cellSize) {
    return E.renderChart({
      cols: S.cols, rows: S.rows, grid: S.grid, palette: S.palette,
      excluded: S.excluded,
      title: S.title || '拼豆图纸',
      brand: S.opts.brand,
      cellSize: cellSize || 24,
      labelMode: S.opts.labelMode,
      boardLines: S.display.board,
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }

  function syncExportUI() {
    if (!$('#exportCell').value) $('#exportCell').value = '24';
  }

  function bindExport() {
    $('#exportPng').addEventListener('click', () => {
      const cell = clamp(parseInt($('#exportCell').value, 10) || 24, 10, 64);
      const canvas = makeChart(cell);
      canvas.toBlob(blob => {
        if (!blob) { toast('导出失败，请重试'); return; }
        downloadBlob(blob, `${sanitizeName(S.title)}_${S.cols}x${S.rows}_${S.opts.brand}.png`);
        S.dirty = false;
        closeSheets();
        toast(`图纸已导出 · ${fmtNum(S.total)} 颗 / ${S.palette.filter(p => p.count > 0).length} 色`);
      }, 'image/png');
    });
    $('#exportPrint').addEventListener('click', () => {
      const canvas = makeChart(S.cols > 60 ? 18 : 24);
      const img = $('#printImg');
      img.onload = () => window.print();
      img.src = canvas.toDataURL('image/png');
      closeSheets();
    });
    $('#exportCsv').addEventListener('click', () => {
      const text = E.csvText({ palette: S.palette, excluded: S.excluded, brand: S.opts.brand });
      downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }),
        `${sanitizeName(S.title)}_购物清单_${S.opts.brand}.csv`);
      closeSheets();
      toast('购物清单已导出');
    });
  }

  /* ------------------------------------------------------------------ */
  /* 键盘快捷键                                                           */
  /* ------------------------------------------------------------------ */
  function bindKeyboard() {
    document.addEventListener('keydown', e => {
      if (isTyping(e) || e.metaKey || e.ctrlKey) {
        if ((e.metaKey || e.ctrlKey) && !isTyping(e)) {
          if (e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) redo(); else undo();
          } else if (e.key.toLowerCase() === 'e') {
            e.preventDefault();
            syncExportUI();
            openSheet('sheetExport');
          }
        }
        return;
      }
      if ($('#viewWorkspace').classList.contains('hidden')) return;
      const k = e.key.toLowerCase();
      if (k === 'b') setTool('brush');
      else if (k === 'e') setTool('eraser');
      else if (k === 'i') setTool('eyedropper');
      else if (k === 'h') setTool('hand');
      else if (k === 'f') fitToWindow();
      else if (k === 'g') {
        S.display.grid = !S.display.grid;
        syncDisplayUI(); saveSettings(); drawPreview();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 自检                                                                 */
  /* ------------------------------------------------------------------ */
  function collectSummary() {
    const vp = $('#canvasViewport');
    const cv = $('#patternCanvas');
    const chart = makeChart(24);
    const cctx = chart.getContext('2d');
    const corner = cctx.getImageData(8, 8, 1, 1).data;
    const active = activeSheet;
    return {
      vw: innerWidth, vh: innerHeight,
      docOverflowX: document.documentElement.scrollWidth > innerWidth + 1,
      homeVisible: !$('#viewHome').classList.contains('hidden'),
      wsVisible: !$('#viewWorkspace').classList.contains('hidden'),
      inspectorDisplay: getComputedStyle($('#inspector')).display,
      toolbarDisplay: getComputedStyle($('#mobileToolbar')).display,
      canvas: { w: cv.width, h: cv.height, cell: S.cell, fit: S.fit, vpW: vp.clientWidth, vpH: vp.clientHeight },
      viewportScroll: { sw: vp.scrollWidth, sh: vp.scrollHeight, cw: vp.clientWidth, ch: vp.clientHeight },
      cols: S.cols, rows: S.rows, total: S.total, emptyCount: S.empty,
      colorsUsed: S.palette.filter(p => p.count > 0).length,
      palette: S.palette.slice(0, 6).map(p => ({ code: p.code, count: p.count, excluded: S.excluded.has(p.code) })),
      legendDesktop: $$('#legendListDesktop .legend-item').length,
      legendMobile: $$('#legendListMobile .legend-item').length,
      meta: $('#wsMeta').textContent,
      cost: $('#costLine').textContent,
      tool: S.tool,
      mode: S.mode,
      sourceMode: S.sourceMode,
      display: { ...S.display },
      sheetOpen: active ? active.id : null,
      sheetRect: active ? {
        w: Math.round(active.getBoundingClientRect().width),
        h: Math.round(active.getBoundingClientRect().height),
        top: Math.round(active.getBoundingClientRect().top),
      } : null,
      chart: { w: chart.width, h: chart.height, corner: [corner[0], corner[1], corner[2]] },
      boardPixel: (() => {
        const px = cctx.getImageData(44 + 29 * 24 + 1, 90 + 40, 1, 1).data;
        return [px[0], px[1], px[2]];
      })(),
      csv: E.csvText({ palette: S.palette, excluded: S.excluded, brand: S.opts.brand }).split('\r\n').slice(0, 3),
      toast: $('#toastText').textContent,
      history: S.history.length,
      selected: S.selected,
      projects: S._projects || null,
      share: S._share || null,
      manifest: !!document.querySelector('link[rel="manifest"]'),
      pwa: { hasSW: 'serviceWorker' in navigator, controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller), registrations: S._swCount === undefined ? null : S._swCount },
      storage: (() => { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; } })(),
    };
  }

  async function runSelftest(cfg) {
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{transition:none !important;animation:none !important}';
    document.head.appendChild(style);
    if (cfg.text || cfg.template) {
      if (cfg.text) {
        setMode('text');
        $('#textInput').value = cfg.text;
        buildTextSource();
      } else {
        setMode('template');
        selectTemplate(cfg.template);
      }
    } else {
      await loadSample();
    }
    if (cfg.cols) setCols(cfg.cols);
    if (cfg.brand) { S.opts.brand = cfg.brand; updateHomeUI(); }
    if (cfg.colors) S.opts.maxColors = cfg.colors;
    generateAndOpen();
    if (cfg.cols) { /* 已在上方 setCols 处理 */ }
    if (cfg.afterCols) setCols(cfg.afterCols);
    if (cfg.afterBrand) { S.opts.brand = cfg.afterBrand; regenerate(); }
    if (cfg.afterColors) { S.opts.maxColors = cfg.afterColors; regenerate(); }
    if (cfg.board) { S.display.board = true; syncDisplayUI(); drawPreview(); }
    if (cfg.zoom) setZoom(cfg.zoom);
    else if (cfg.fit !== false) fitToWindow();
    if (cfg.paint) testPaint(10, 10, S.selected);
    if (cfg.erase) testPaint(11, 10, -1);
    if (cfg.exclude) excludeColor(cfg.exclude);
    if (cfg.undo) undo();
    if (cfg.clickPreset) {
      const b = document.querySelector('#settingsDesktop [data-cols="' + cfg.clickPreset + '"]');
      if (b) b.click();
    }
    if (cfg.clickTool) {
      const b = document.querySelector('[data-tool="' + cfg.clickTool + '"]');
      if (b) b.click();
    }
    if (cfg.clickDisplay) {
      const b = document.querySelector('[data-display="' + cfg.clickDisplay + '"]');
      if (b) b.click();
    }
    if (cfg.shareTest) {
      try {
        const link = await window.PindouShare.buildLink(S);
        const payload = await window.PindouShare.decodePayload(link.code);
        const st = window.PindouShare.stateFromPayload(payload);
        const card = window.PindouShare.renderCard({
          title: S.title || '拼豆图纸',
          cols: S.cols, rows: S.rows, grid: S.grid, palette: S.palette,
          brand: S.opts.brand, total: S.total,
          colors: S.palette.filter(p => p.count > 0).length,
          url: link.url,
        });
        S._share = {
          urlLen: link.url.length,
          decodedTotal: st.total,
          decodedCols: st.cols,
          equal: st.total === S.total && st.cols === S.cols,
          cardW: card.width,
          cardH: card.height,
        };
        if (cfg.shareOpen) {
          await loadSharedPattern(link.code);
          S._share.loadedTotal = S.total;
          S._share.loadedTitle = S.title;
        }
      } catch (e) {
        S._share = { error: String(e) };
      }
    }
    if (cfg.projectTest) {
      try {
        await saveProject();
        const list = await window.PindouProjects.all();
        S._projects = {
          count: list.length,
          firstTotal: list[0] ? list[0].total : null,
          thumb: !!(list[0] && list[0].thumb),
          source: !!(list[0] && list[0].source),
        };
        if (list[0]) {
          await loadProject(list[0].id);
          S._projects.loadedTotal = S.total;
          S._projects.loadedTitle = S.title;
        }
      } catch (e) {
        S._projects = { error: String(e) };
      }
    }
    if (cfg.pwaTest) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        S._swCount = regs.length;
      } catch (e) { S._swCount = -1; }
    }
    if (cfg.sheet) openSheet(cfg.sheet);
    await new Promise(r => setTimeout(r, 80));
    return collectSummary();
  }

  /* 供测试直接修改单个格子（等价于一次点击） */
  function testPaint(x, y, val) {
    const before = S.grid[y][x];
    if (before === val) return;
    setCell(x, y, val);
    pushHistory({
      diffs: [{ x, y, before, after: val }],
      exBefore: new Set(S.excluded), exAfter: new Set(S.excluded),
      backupBefore: S.gridBackup, backupAfter: S.gridBackup,
    });
    updateAll();
  }

  function bootHash() {
    const hash = location.hash;
    if (hash === '#gallery') {
      openGallery();
      document.documentElement.dataset.ready = '1';
      return;
    }
    const workMatch = /^#g=([A-Za-z0-9_-]+)/.exec(hash);
    if (workMatch) {
      openGallery();
      openWork(workMatch[1]);
      document.documentElement.dataset.ready = '1';
      return;
    }
    const shared = window.PindouShare.readHashPayload();
    if (shared) {
      loadSharedPattern(shared);
      return;
    }
    if (hash.startsWith('#selftest')) {
      let cfg = {};
      const idx = hash.indexOf('=');
      if (idx > 0) { try { cfg = JSON.parse(decodeURIComponent(hash.slice(idx + 1))); } catch (e) { /* ignore */ } }
      runSelftest(cfg).then(summary => {
        const pre = $('#selftestResult');
        pre.hidden = false;
        pre.textContent = JSON.stringify(summary);
        document.documentElement.dataset.selftest = 'done';
      }).catch(err => {
        const pre = $('#selftestResult');
        pre.hidden = false;
        pre.textContent = JSON.stringify({ error: String(err) });
        document.documentElement.dataset.selftest = 'error';
      });
    } else if (hash.startsWith('#demo')) {
      const mode = hash.split('=')[1] || 'workspace';
      if (mode === 'text') {
        setMode('text');
        $('#textInput').value = '生日快乐';
        buildTextSource();
        generateAndOpen();
        document.documentElement.dataset.ready = '1';
        return;
      }
      if (mode === 'template') {
        setMode('template');
        selectTemplate('heart');
        generateAndOpen();
        document.documentElement.dataset.ready = '1';
        return;
      }
      if (mode === 'home') {
        document.documentElement.dataset.ready = '1';
        return;
      }
      if (mode === 'gallery') {
        openGallery();
        document.documentElement.dataset.ready = '1';
        return;
      }
      loadSample().then(() => {
        if (mode === 'calibrate') { document.documentElement.dataset.ready = '1'; return; }
        generateAndOpen();
        if (mode === 'export') { syncExportUI(); openSheet('sheetExport'); }
        if (mode === 'settings') { syncSettingsUI(); openSheet('sheetSettings'); }
        if (mode === 'legend') { renderLegendLists(); openSheet('sheetLegend'); }
        if (mode === 'advanced') { openSheet('sheetAdvanced'); }
        if (mode === 'share') { openShareSheet(); }
        if (mode === 'help') { openSheet('sheetHelp'); }
        if (mode === 'pro') { openSheet('sheetPro'); }
        if (mode === 'publish') { openPublish(); }
        document.documentElement.dataset.ready = '1';
      });
    } else if (hash === '#printdump') {
      loadSample().then(() => {
        generateAndOpen();
        setTimeout(() => {
          $('#printImg').src = makeChart(24).toDataURL('image/png');
          document.documentElement.dataset.ready = '1';
        }, 60);
      });
    } else if (hash === '#chartdump') {
      loadSample().then(() => {
        generatePattern(false);
        const chart = makeChart(24);
        document.body.innerHTML = '';
        document.body.style.margin = '0';
        document.body.style.background = '#fff';
        const img = new Image();
        img.src = chart.toDataURL('image/png');
        img.style.display = 'block';
        document.body.appendChild(img);
        document.documentElement.dataset.ready = '1';
      });
    }
  }


  /* ------------------------------------------------------------------ */
  /* 首页：三模式                                                         */
  /* ------------------------------------------------------------------ */
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setMode(mode) {
    S.mode = mode;
    $$('.mode-tab').forEach(b => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#modeImage').classList.toggle('hidden', mode !== 'image');
    $('#modeText').classList.toggle('hidden', mode !== 'text');
    $('#modeTemplate').classList.toggle('hidden', mode !== 'template');
    if (mode === 'text') setTimeout(() => { $('#textInput').focus(); }, 60);
    updateCalibrateVisibility();
    updateHomeUI();
    refreshRecent();
  }

  function updateCalibrateVisibility() {
    const has = !!S.img && !!S.sourceOriginal && S.sourceMode === S.mode;
    $('#calibrate').classList.toggle('hidden', !has);
    $('#viewHome').classList.toggle('has-image', has);
    refreshRecent();
  }

  /* ---------- 文字模式 ---------- */
  function setupTextMode() {
    const COLORS = ['#2F2B2F', '#C1444A', '#FFA9AD', '#FFDA45', '#3DAF80', '#3677D2'];
    const host = $('#textSwatches');
    host.innerHTML = COLORS.map((hex, i) =>
      `<button class="swatch-btn ${i === 0 ? 'active' : ''}" style="background:${hex}" data-color="${hex}" aria-label="文字颜色 ${i + 1}" type="button"></button>`
    ).join('');
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-color]');
      if (!b) return;
      S.textColor = b.dataset.color;
      $$('.swatch-btn', host).forEach(x => x.classList.toggle('active', x === b));
      buildTextSource();
    });
    $('#textOutline').addEventListener('change', () => {
      S.textOutline = $('#textOutline').checked;
      buildTextSource();
    });
    let timer = null;
    $('#textInput').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(buildTextSource, 220);
    });
    $('#textInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); buildTextSource(); }
    });
  }

  function buildTextSource() {
    const raw = $('#textInput').value.replace(/\s+/g, ' ').trim().slice(0, 12);
    S.text = raw;
    const preview = $('#textPreview');
    const pctx = preview.getContext('2d');
    pctx.fillStyle = '#FFFFFF';
    pctx.fillRect(0, 0, preview.width, preview.height);

    if (!raw) {
      S.img = null;
      S.sourceOriginal = null;
      S.uploadOriginal = null;
      updateCalibrateVisibility();
      return;
    }

    const W = 900, H = 360;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 210;
    const fontOf = n => `700 ${n}px "PingFang SC","Noto Sans SC","Hiragino Sans GB","Microsoft YaHei",sans-serif`;
    ctx.font = fontOf(size);
    while (size > 56 && ctx.measureText(raw).width > W - 120) {
      size -= 8;
      ctx.font = fontOf(size);
    }
    if (S.textOutline) {
      ctx.strokeStyle = '#2F2B2F';
      ctx.lineWidth = Math.max(6, size * 0.055);
      ctx.strokeText(raw, W / 2, H / 2);
    }
    ctx.fillStyle = S.textColor;
    ctx.fillText(raw, W / 2, H / 2);

    const flatColors = [S.textColor];
    if (S.textOutline) flatColors.push('#2F2B2F');
    flattenColors(c, flatColors);

    const scale = Math.min(preview.width / W, preview.height / H);
    pctx.drawImage(c, 0, 0, W, H,
      (preview.width - W * scale) / 2,
      (preview.height - H * scale) / 2,
      W * scale, H * scale);

    S.sourceOriginal = c;
    S.sourceMode = 'text';
    S.whiteBg = true;
    S.projectId = null;
    S.title = raw;
    S.display.code = false;
    syncDisplayUI();
    refreshSource();
    $('#titleInput').value = S.title;
    updateCalibrateVisibility();
    updateHomeUI();
  }

  /* ---------- 模板模式 ---------- */
  function setupTemplates() {
    const host = $('#templateGrid');
    host.innerHTML = window.PindouTemplates.list.map(t => `
      <button class="template-card" type="button" data-template="${t.id}">
        <img class="template-thumb" src="${window.PindouTemplates.renderThumb(t.id, 120)}" alt="${t.name}" loading="lazy">
        <span class="template-name">${t.name}</span>
      </button>`).join('');
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-template]');
      if (b) selectTemplate(b.dataset.template);
    });
  }

  function selectTemplate(id) {
    const tpl = window.PindouTemplates.get(id);
    if (!tpl) return;
    S.templateId = id;
    S.sourceOriginal = window.PindouTemplates.renderSource(id, 320);
    flattenColors(S.sourceOriginal, tpl.colors);
    S.sourceMode = 'template';
    S.whiteBg = true;
    S.projectId = null;
    S.title = tpl.name;
    S.display.code = false;
    syncDisplayUI();
    refreshSource();
    $$('#templateGrid .template-card').forEach(x => {
      x.classList.toggle('active', x.dataset.template === id);
    });
    $('#titleInput').value = S.title;
    updateCalibrateVisibility();
    updateHomeUI();
  }

  /* ------------------------------------------------------------------ */
  /* 作品库（IndexedDB）                                                  */
  /* ------------------------------------------------------------------ */
  function canvasDataUrl(src, maxDim, quality) {
    if (!src) return null;
    const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * scale));
    c.height = Math.max(1, Math.round(src.height * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality || 0.86);
  }

  function makeThumb() {
    if (!S.grid.length) return '';
    const cell = Math.max(1, Math.floor(360 / Math.max(S.cols, S.rows)));
    const c = document.createElement('canvas');
    c.width = S.cols * cell;
    c.height = S.rows * cell;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#F6F4EF';
    ctx.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < S.rows; y++) {
      for (let x = 0; x < S.cols; x++) {
        const v = S.grid[y][x];
        if (v < 0) continue;
        ctx.fillStyle = S.palette[v].hex;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    return c.toDataURL('image/png');
  }

  function scheduleSave() {
    if (!S.grid.length || !window.PindouProjects) return;
    clearTimeout(scheduleSave._t);
    scheduleSave._t = setTimeout(saveProject, 1600);
  }

  async function saveProject() {
    if (!S.grid.length || !window.PindouProjects) return;
    try {
      if (!S.projectId) {
        S.projectId = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      }
      const existing = await window.PindouProjects.get(S.projectId).catch(() => null);
      const project = {
        id: S.projectId,
        title: S.title || '未命名作品',
        brand: S.opts.brand,
        cols: S.cols, rows: S.rows,
        grid: S.grid.map(row => row.slice()),
        palette: S.palette.map(p => ({ code: p.code, hex: p.hex, count: p.count })),
        total: S.total,
        sourceMode: S.sourceMode,
        whiteBg: !!S.whiteBg,
        thumb: makeThumb(),
        source: (existing && existing.source) || canvasDataUrl(S.sourceOriginal, 800, 0.86),
        createdAt: existing ? existing.createdAt : Date.now(),
        updatedAt: Date.now(),
      };
      await window.PindouProjects.put(project);
      await window.PindouProjects.trim(24);
    } catch (e) { /* 存储不可用时静默 */ }
  }

  async function refreshRecent() {
    if (!window.PindouProjects) return;
    let list = [];
    try { list = await window.PindouProjects.all(); } catch (e) { return; }
    const sec = $('#recentSection');
    const wrap = $('#recentGrid');
    if (!list.length) { sec.classList.add('hidden'); return; }
    wrap.innerHTML = list.slice(0, 8).map(p => `
      <div class="recent-card" data-project="${p.id}">
        <img class="recent-thumb" src="${p.thumb || ''}" alt="">
        <div class="recent-title">${escapeHtml(p.title || '未命名作品')}</div>
        <div class="recent-meta">${p.cols} × ${p.rows} · ${p.total.toLocaleString('zh-CN')} 颗</div>
        <button class="recent-del" type="button" data-delete="${p.id}" aria-label="删除作品">✕</button>
      </div>`).join('');
    sec.classList.remove('hidden');
  }

  function imageFromDataUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async function loadProject(id) {
    if (!window.PindouProjects) return;
    const p = await window.PindouProjects.get(id).catch(() => null);
    if (!p) return;
    S.projectId = p.id;
    S.title = p.title || '未命名作品';
    S.opts.brand = p.brand || 'MARD';
    S.opts.cols = p.cols;
    S.cols = p.cols;
    S.rows = p.rows;
    S.grid = p.grid.map(row => row.slice());
    S.palette = p.palette.map(x => ({ ...x }));
    S.excluded = new Set();
    S.history = [];
    S.future = [];
    S.gridBackup = null;
    S.selected = 0;
    updateCounts();
    S.dirty = false;
    S.sourceOriginal = null;
    S.uploadOriginal = null;
    S.img = null;
    S.imgFull = null;
    aiOriginal = null;
    aiCandidate = null;
    $('#aiRestoreBtn').classList.add('hidden');
    if (p.source) {
      try {
        const img = await imageFromDataUrl(p.source);
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        S.sourceOriginal = c;
        S.uploadOriginal = c;
        S.sourceMode = p.sourceMode || 'image';
        S.whiteBg = p.whiteBg !== undefined ? !!p.whiteBg : detectWhiteBg(c);
        refreshSource();
      } catch (e) { /* ignore */ }
    }
    $('#titleInput').value = S.title;
    showView('workspace');
    buildSettingsPanels();
    S.fit = true;
    fitToWindow();
    updateAll();
    toast(p.source ? '已打开作品' : '已打开作品（无原图，无法重新生成）');
  }

  async function deleteProject(id) {
    if (!window.PindouProjects) return;
    try { await window.PindouProjects.del(id); } catch (e) { /* ignore */ }
    if (S.projectId === id) S.projectId = null;
    refreshRecent();
    toast('作品已删除');
  }

  /* ------------------------------------------------------------------ */
  /* 分享                                                                 */
  /* ------------------------------------------------------------------ */
  let shareState = null;

  async function openShareSheet() {
    if (!S.grid.length) { toast('请先生成图纸'); return; }
    closeSheets();
    try {
      const link = await window.PindouShare.buildLink(S);
      shareState = link;
      const card = window.PindouShare.renderCard({
        title: S.title || '拼豆图纸',
        cols: S.cols, rows: S.rows, grid: S.grid, palette: S.palette,
        brand: S.opts.brand, total: S.total,
        colors: S.palette.filter(p => p.count > 0 && !S.excluded.has(p.code)).length,
        url: link.url,
      });
      $('#shareCardImg').src = card.toDataURL('image/png');
      $('#shareHint').textContent = link.url.length > 1400
        ? '图纸较大，分享卡未放二维码；可以复制链接发给朋友。'
        : '别人打开链接，就能看到同一张图纸。';
      openSheet('sheetShare');
      saveProject();
    } catch (e) {
      toast('生成分享失败，请重试');
    }
  }

  function shareCaptionText() {
    const title = S.title || '拼豆图纸';
    const colors = S.palette.filter(p => p.count > 0).length;
    const url = shareState ? shareState.url : '';
    return [
      `【${title}】${S.cols}×${S.rows} · ${fmtNum(S.total)} 颗 · ${colors} 色`,
      '一张可以照着拼的拼豆图纸，链接打开就能拼同款：',
      url,
      '#拼豆 #拼豆图纸 #手工 #DIY',
    ].join('\n');
  }

  async function copyShareCaption() {
    if (!shareState) return;
    try {
      await navigator.clipboard.writeText(shareCaptionText());
      toast('小红书文案已复制');
    } catch (e) {
      toast('复制失败，请重试');
    }
  }

  async function copyShareLink() {
    if (!shareState || !shareState.url) return;
    const url = shareState.url;
    try {
      await navigator.clipboard.writeText(url);
      toast('分享链接已复制');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('分享链接已复制'); }
      catch (err) { toast('复制失败，请手动选择链接'); }
      ta.remove();
    }
  }

  function downloadShareCard() {
    const img = $('#shareCardImg');
    if (!img.src) return;
    const a = document.createElement('a');
    a.href = img.src;
    a.download = `${sanitizeName(S.title)}_分享卡.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('分享卡已下载');
  }

  async function nativeShare() {
    if (!shareState || !shareState.url) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: S.title || '拼豆图纸',
          text: '来看看这张拼豆图纸',
          url: shareState.url,
        });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    copyShareLink();
  }

  async function loadSharedPattern(code) {
    try {
      const payload = await window.PindouShare.decodePayload(code);
      const st = window.PindouShare.stateFromPayload(payload);
      S.projectId = null;
      S.title = st.title;
      S.opts.brand = st.brand;
      S.opts.cols = st.cols;
      S.cols = st.cols;
      S.rows = st.rows;
      S.grid = st.grid;
      S.palette = st.palette;
      S.excluded = new Set();
      S.history = [];
      S.future = [];
      S.gridBackup = null;
      S.selected = 0;
      S.sourceOriginal = null;
      S.uploadOriginal = null;
      S.img = null;
      S.imgFull = null;
      S.sourceMode = 'image';
      S.remixOf = null;
      aiOriginal = null;
      aiCandidate = null;
      $('#aiRestoreBtn').classList.add('hidden');
      updateCounts();
      $('#titleInput').value = S.title;
      showView('workspace');
      buildSettingsPanels();
      S.fit = true;
      fitToWindow();
      updateAll();
      toast('已打开分享的图纸');
    } catch (e) {
      toast('分享链接已损坏');
    }
  }


  /* ------------------------------------------------------------------ */
  /* 作品墙                                                               */
  /* ------------------------------------------------------------------ */
  const COMMUNITY_REPO = 'https://github.com/kakarorkaka/pindou-community';
  const COLLECT_KEY = 'pindou-collects';
  let currentWork = null;
  let publishState = null;

  function works() { return window.PINDOU_WORKS || []; }

  function getCollects() {
    try { return new Set(JSON.parse(localStorage.getItem(COLLECT_KEY) || '[]')); }
    catch (e) { return new Set(); }
  }
  function saveCollects(set) {
    try { localStorage.setItem(COLLECT_KEY, JSON.stringify([...set])); } catch (e) { /* ignore */ }
  }

  function categories() {
    const set = new Set(['全部']);
    works().forEach(w => { if (w.category) set.add(w.category); });
    return [...set];
  }

  function filteredWorks() {
    let list = works().slice();
    if (S.galleryCat !== 'all') {
      list = list.filter(w => w.category === S.galleryCat || (w.tags || []).includes(S.galleryCat));
    }
    const q = S.galleryQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(w => (w.title + ' ' + (w.tags || []).join(' ')).toLowerCase().includes(q));
    }
    if (S.gallerySort === 'new') {
      list.sort((a, b) => (b.order || 0) - (a.order || 0));
    } else {
      list.sort((a, b) => (b.featured || 0) - (a.featured || 0) || (b.order || 0) - (a.order || 0));
    }
    return list;
  }

  function workCard(w, compact) {
    return `
      <article class="work-card" data-work="${w.id}" tabindex="0">
        <div class="work-thumb-wrap"><img class="work-thumb" loading="lazy" src="${w.thumb}" alt="${escapeHtml(w.title)}"></div>
        <div class="work-card-body">
          <div class="work-card-title">${escapeHtml(w.title)}</div>
          <div class="work-card-meta">${w.cols} × ${w.rows} · ${fmtNum(w.total)} 颗 · ${w.colors} 色</div>
          <div class="work-card-tags">${(w.tags || []).slice(0, 3).map(t => `<span class="work-tag">${escapeHtml(t)}</span>`).join('')}</div>
          <div class="work-card-author">@${escapeHtml(w.author || '拼豆工作室')}</div>
          ${compact ? '' : `<button class="btn btn-ghost make-btn" type="button" data-make="${w.id}">拼同款</button>`}
        </div>
      </article>`;
  }

  function renderGallery() {
    const grid = $('#galleryGrid');
    if (!grid) return;
    if (!grid.dataset.bound) {
      grid.dataset.bound = '1';
      grid.addEventListener('click', e => {
        const make = e.target.closest('[data-make]');
        if (make) { e.stopPropagation(); const w = works().find(x => x.id === make.dataset.make); if (w) makeWork(w, false); return; }
        const card = e.target.closest('[data-work]');
        if (card) openWork(card.dataset.work);
      });
      grid.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          const card = e.target.closest('[data-work]');
          if (card) { e.preventDefault(); openWork(card.dataset.work); }
        }
      });
    }
    const filters = $('#galleryFilters');
    if (!filters.dataset.bound) {
      filters.dataset.bound = '1';
      filters.innerHTML = categories().map(c => `<button class="g-filter ${c === '全部' ? 'active' : ''}" type="button" data-cat="${c}">${c}</button>`).join('');
      filters.addEventListener('click', e => {
        const b = e.target.closest('[data-cat]');
        if (!b) return;
        S.galleryCat = b.dataset.cat === '全部' ? 'all' : b.dataset.cat;
        $$('.g-filter', filters).forEach(x => x.classList.toggle('active', x === b));
        renderGallery();
      });
    }
    const list = filteredWorks();
    grid.innerHTML = list.map(w => workCard(w, false)).join('');
    $('#galleryEmpty').classList.toggle('hidden', list.length > 0);
  }

  function renderFeatured() {
    const host = $('#featuredGrid');
    const sec = $('#featuredSection');
    if (!host || !sec) return;
    const list = works().slice().sort((a, b) => (b.featured || 0) - (a.featured || 0) || (b.order || 0) - (a.order || 0)).slice(0, 4);
    if (!list.length) { sec.classList.add('hidden'); return; }
    host.innerHTML = list.map(w => workCard(w, true)).join('');
    host.onclick = e => {
      const card = e.target.closest('[data-work]');
      if (card) openWork(card.dataset.work);
    };
    sec.classList.remove('hidden');
  }

  function openGallery() {
    renderFeatured();
    showView('gallery');
  }

  function openWork(id) {
    const w = works().find(x => x.id === id);
    if (!w) return;
    currentWork = w;
    $('#workTitle').textContent = w.title;
    $('#workImage').src = w.thumb;
    $('#workMeta').textContent = `${w.cols} × ${w.rows} · ${fmtNum(w.total)} 颗 · ${w.colors} 色 · ${w.brand}`;
    $('#workAuthor').textContent = `@${w.author || '拼豆工作室'}`;
    $('#workTags').innerHTML = (w.tags || []).map(t => `<span class="work-tag">${escapeHtml(t)}</span>`).join('');
    $('#workPalette').innerHTML = (w.preview || []).map(p =>
      `<span class="wp"><i style="background:${p.hex}"></i>${p.code} · ${fmtNum(p.count)} 颗</span>`).join('');
    const collected = getCollects().has(w.id);
    $('#workCollect').textContent = collected ? '已收藏' : '收藏';
    openSheet('sheetWork');
  }

  async function makeWork(w, remix) {
    if (!w) return;
    closeSheets();
    await loadSharedPattern(w.code);
    S.remixOf = remix ? w : null;
    if (remix) toast(`已载入，改编自「${w.title}」，发布时请保留署名`);
    else toast('已载入同款图纸');
  }

  async function copyWorkLink(w) {
    const url = location.href.split('#')[0] + '#g=' + w.id;
    try {
      await navigator.clipboard.writeText(url);
      toast('作品链接已复制');
    } catch (e) {
      toast('复制失败，请手动复制地址栏链接');
    }
  }

  /* ------------------------------------------------------------------ */
  /* 发布到作品墙                                                         */
  /* ------------------------------------------------------------------ */
  function fillPublishForm() {
    const title = S.title || '未命名作品';
    $('#publishTitleInput').value = title;
    const cat = S.sourceMode === 'text' ? '文字' : S.sourceMode === 'template' ? '其他' : '动物';
    $('#publishCategory').value = cat;
    const tags = S.sourceMode === 'template'
      ? (window.PindouTemplates.get(S.templateId) ? '模板, 新手' : '模板')
      : S.sourceMode === 'text' ? '文字, 祝福' : '图片, 挂件';
    $('#publishTagsInput').value = tags;
    $('#publishRights').checked = false;
  }

  async function openPublish() {
    if (!S.grid.length) { toast('请先生成一张图纸'); return; }
    closeSheets();
    const link = await window.PindouShare.buildLink(S);
    const card = window.PindouShare.renderCard({
      title: S.title || '拼豆图纸',
      cols: S.cols, rows: S.rows, grid: S.grid, palette: S.palette,
      brand: S.opts.brand, total: S.total,
      colors: S.palette.filter(p => p.count > 0).length,
      url: link.url,
    });
    publishState = { link, card };
    $('#publishCardImg').src = card.toDataURL('image/png');
    fillPublishForm();
    openSheet('sheetPublish');
  }

  function submissionText() {
    const title = ($('#publishTitleInput').value || S.title || '未命名作品').trim();
    const tags = ($('#publishTagsInput').value || '').split(/[,，]/).map(t => t.trim()).filter(Boolean).slice(0, 5);
    const cat = $('#publishCategory').value;
    const colors = S.palette.filter(p => p.count > 0).length;
    const remix = S.remixOf ? `改编自：${S.remixOf.title}（${S.remixOf.id}）\n` : '';
    const body = [
      '【作品投稿】',
      `标题：${title}`,
      `分类：${cat}`,
      `标签：${tags.join('、')}`,
      `规格：${S.cols}×${S.rows} · ${fmtNum(S.total)} 颗 · ${colors} 色 · ${S.opts.brand}`,
      `分享链接：${publishState.link.url}`,
      remix + '权利声明：本人拥有该图案的权利或已获授权，同意在拼豆工作室作品墙展示。',
    ].join('\n');
    const url = `${COMMUNITY_REPO}/issues/new?title=${encodeURIComponent('作品投稿：' + title)}&body=${encodeURIComponent(body)}&labels=submission`;
    return { body, url, title, tags, cat };
  }

  async function submitWork() {
    if (!$('#publishRights').checked) {
      toast('请先确认权利声明');
      return;
    }
    const { body, url } = submissionText();
    // 先同步打开窗口，避免 await 之后被浏览器拦截
    const win = window.open(url, '_blank');
    if (win) win.opener = null;
    navigator.clipboard.writeText(body).catch(() => {});
    if (win) {
      $('#publishHint').textContent = '已打开投稿页，提交后等待审核（1–3 天）。';
      toast('已打开投稿页，提交后等待审核');
    } else {
      $('#publishHint').innerHTML = `弹窗被拦截。请<a href="${url}" target="_blank" rel="noopener">点此打开投稿页</a>，投稿内容已复制。`;
      toast('弹窗被拦截，请点提示里的链接');
    }
  }

  function publishCaption() {
    const title = ($('#publishTitleInput').value || S.title || '拼豆图纸').trim();
    const cat = $('#publishCategory').value;
    const colors = S.palette.filter(p => p.count > 0).length;
    return [
      `【${title}】${S.cols}×${S.rows} · ${fmtNum(S.total)} 颗 · ${colors} 色`,
      '一张可以照着拼的拼豆图纸，链接打开就能拼同款：',
      publishState.link.url,
      `#拼豆 #拼豆图纸 #手工 #DIY #${cat}`,
    ].join('\n');
  }

  async function copyPublishCaption() {
    try {
      await navigator.clipboard.writeText(publishCaption());
      toast('小红书文案已复制');
    } catch (e) {
      toast('复制失败，请重试');
    }
  }

  function downloadPublishCard() {
    if (!publishState) return;
    const a = document.createElement('a');
    a.href = publishState.card.toDataURL('image/png');
    a.download = `${sanitizeName(S.title)}_分享卡.png`;
    a.click();
    toast('分享卡已下载');
  }

  function bindGallery() {
    $('#galleryBtn').addEventListener('click', openGallery);
    $('#viewGalleryBtn').addEventListener('click', openGallery);
    $('#galleryBack').addEventListener('click', () => {
      showView('home');
      updateHomeUI();
      refreshRecent();
    });
    $('#galleryPublishBtn').addEventListener('click', () => {
      if (!S.grid.length) { toast('先做一张图纸，再来发布'); showView('home'); return; }
      openPublish();
    });
    $$('.g-tab').forEach(tab => tab.addEventListener('click', () => {
      S.gallerySort = tab.dataset.sort;
      $$('.g-tab').forEach(t => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      renderGallery();
    }));
    $('#gallerySearch').addEventListener('input', e => {
      S.galleryQuery = e.target.value;
      renderGallery();
    });
    $('#workMake').addEventListener('click', () => { if (currentWork) makeWork(currentWork, false); });
    $('#workRemix').addEventListener('click', () => { if (currentWork) makeWork(currentWork, true); });
    $('#workCollect').addEventListener('click', () => {
      if (!currentWork) return;
      const set = getCollects();
      if (set.has(currentWork.id)) set.delete(currentWork.id); else set.add(currentWork.id);
      saveCollects(set);
      $('#workCollect').textContent = set.has(currentWork.id) ? '已收藏' : '收藏';
    });
    $('#workShare').addEventListener('click', () => { if (currentWork) copyWorkLink(currentWork); });
    $('#openPublishBtn').addEventListener('click', openPublish);
    $('#submitWork').addEventListener('click', submitWork);
    $('#copyCaption').addEventListener('click', copyPublishCaption);
    $('#downloadPublishCard').addEventListener('click', downloadPublishCard);
    renderFeatured();
  }

  /* ------------------------------------------------------------------ */
  /* 初始化                                                               */
  /* ------------------------------------------------------------------ */
  function bindNewUI() {
    $$('.mode-tab').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
    $('#helpBtn').addEventListener('click', () => openSheet('sheetHelp'));
    $('#proBtn').addEventListener('click', () => openSheet('sheetPro'));
    $('#openShareBtn').addEventListener('click', () => {
      closeSheets();
      setTimeout(openShareSheet, 180);
    });
    $('#copyShareLink').addEventListener('click', copyShareLink);
    $('#copyShareCaption').addEventListener('click', copyShareCaption);
    $('#downloadShareCard').addEventListener('click', downloadShareCard);
    $('#nativeShare').addEventListener('click', nativeShare);
    $('#recentGrid').addEventListener('click', e => {
      const del = e.target.closest('[data-delete]');
      if (del) { e.stopPropagation(); deleteProject(del.dataset.delete); return; }
      const card = e.target.closest('[data-project]');
      if (card) loadProject(card.dataset.project);
    });
  }

  function init() {
    loadSettings();
    S.opts.cols = S.cols;
    initUpload();
    renderHomePresets();
    setupTextMode();
    setupTemplates();
    buildAdvanced();
    bindAdvanced();
    bindDisplay();
    bindZoom();
    bindTools();
    bindCanvas();
    bindLegend();
    bindSheets();
    bindExport();
    bindKeyboard();
    bindNewUI();
    bindGallery();
    bindCrop();
    bindAI();
    ['settingsDesktop', 'settingsMobile'].forEach(id => {
      const host = document.getElementById(id);
      host.addEventListener('click', onSettingsClick);
      host.addEventListener('change', onSettingsChange);
    });
    syncDisplayUI();
    syncAdvancedUI();
    updateHomeUI();
    $('#titleInput').value = '';
    refreshRecent();
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
    document.documentElement.dataset.booted = '1';
    bootHash();
  }

  document.addEventListener('DOMContentLoaded', init);

  // 供自动化测试 / 调试
  window.__PD__ = {
    S, loadSample, generateAndOpen, generatePattern, setCols, setTool,
    excludeColor, restoreAll, undo, redo, fitToWindow, openSheet, closeSheets,
    drawPreview, collectSummary, makeChart, setZoom,
    setMode, selectTemplate, buildTextSource, loadSharedPattern,
    openGallery, openWork, openPublish, submissionText, makeWork,
  };
})();
