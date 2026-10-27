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
    labelMode: 'code', beadMm: 2.6, autoTrim: true,
  };
  const DEFAULT_DISPLAY = { code: true, grid: true, board: false, coords: true };

  const S = {
    img: null, imgFull: null, imgName: '', imgW: 0, imgH: 0,
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
    if (name === 'workspace') {
      requestAnimationFrame(() => {
        drawPreview();
        layoutCanvas();
      });
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
    $('#changeBtn').addEventListener('click', () => input.click());

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
    $('#sampleTop').addEventListener('click', () => loadSample());
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

        S.imgFull = c;
        S.imgW = w; S.imgH = h;
        applyTrim();
        S.imgW = S.img.width; S.imgH = S.img.height;
        S.imgName = file.name.replace(/\.[^.]+$/, '');
        if (!S.title) S.title = S.imgName;
        $('#titleInput').value = S.title;
        $('#uploadThumb').src = url;
        $('#uploadName').textContent = file.name;
        $('#uploadDim').textContent = `${img.width} × ${img.height} 像素`;
        $('#uploadEmpty').classList.add('hidden');
        $('#uploadPreview').classList.remove('hidden');
        $('#calibrate').classList.remove('hidden');
        $('#viewHome').classList.add('has-image');
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

    if (!hasImg) {
      $('#homeEstimate').textContent = '上传图片后显示用量估算';
      $$('#homePresets em[data-home-est]').forEach(em => { em.textContent = '—'; });
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
    if (!S.img) { toast('请先选择一张图片'); return; }
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
    const res = E.generate(S.img, { ...S.opts, cols: S.cols });
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
  }

  function updateMeta() {
    const used = S.palette.filter(p => p.count > 0).length;
    $('#wsMeta').textContent =
      `${S.cols} × ${S.rows} · ${fmtNum(S.total)} 颗 · ${used} 色`;
    $('#costLine').textContent =
      `约 ${fmtCm(S.cols)} × ${fmtCm(S.rows)} cm · ${fmtTime(S.total)}`;
    $('#exportContents').textContent = '包含：标题 · 坐标 · 色号 · 图例 · 统计';
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

  function regenerate() {
    if (!S.grid.length) { updateHomeUI(); saveSettings(); return; }
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
    if (S.imgFull) {
      applyTrim();
      S.imgW = S.img.width;
      S.imgH = S.img.height;
    }
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
      if (adv) { S.opts[adv] = e.target.value; saveSettings(); regenerate(); return; }
      const chk = e.target.dataset.advCheck;
      if (chk) {
        S.opts[chk] = e.target.checked;
        if (chk === 'autoTrim') {
          applyTrim();
          S.imgW = S.img.width; S.imgH = S.img.height;
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
      updateHomeUI();
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
      storage: (() => { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; } })(),
    };
  }

  async function runSelftest(cfg) {
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{transition:none !important;animation:none !important}';
    document.head.appendChild(style);
    await loadSample();
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
      loadSample().then(() => {
        if (mode === 'home' || mode === 'calibrate') { document.documentElement.dataset.ready = '1'; return; }
        generateAndOpen();
        if (mode === 'export') { syncExportUI(); openSheet('sheetExport'); }
        if (mode === 'settings') { syncSettingsUI(); openSheet('sheetSettings'); }
        if (mode === 'legend') { renderLegendLists(); openSheet('sheetLegend'); }
        if (mode === 'advanced') { openSheet('sheetAdvanced'); }
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
  /* 初始化                                                               */
  /* ------------------------------------------------------------------ */
  function init() {
    loadSettings();
    S.opts.cols = S.cols;
    initUpload();
    renderHomePresets();
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
    ['settingsDesktop', 'settingsMobile'].forEach(id => {
      const host = document.getElementById(id);
      host.addEventListener('click', onSettingsClick);
      host.addEventListener('change', onSettingsChange);
    });
    syncDisplayUI();
    syncAdvancedUI();
    updateHomeUI();
    $('#titleInput').value = '';
    document.documentElement.dataset.booted = '1';
    bootHash();
  }

  document.addEventListener('DOMContentLoaded', init);

  // 供自动化测试 / 调试
  window.__PD__ = {
    S, loadSample, generateAndOpen, generatePattern, setCols, setTool,
    excludeColor, restoreAll, undo, redo, fitToWindow, openSheet, closeSheets,
    drawPreview, collectSummary, makeChart, setZoom,
  };
})();
