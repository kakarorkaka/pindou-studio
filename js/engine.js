/* ==========================================================================
   拼豆工作室 · 计算引擎
   图片 → 网格 → 品牌色号 → 图纸渲染
   ========================================================================== */
(function () {
  'use strict';

  const DATA = window.PINDOU_COLORS;
  const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const SYMBOLS = (function () {
    const s = [];
    for (let c = 65; c <= 90; c++) s.push(String.fromCharCode(c));
    for (let c = 97; c <= 122; c++) s.push(String.fromCharCode(c));
    for (let i = 0; i <= 9; i++) s.push(String(i));
    s.push('+', '−', '×', '÷', '○', '●', '△', '▲', '□', '■', '☆', '★', '♥', '♠', '♦', '♣');
    return s;
  })();

  /* ---------- 颜色工具 ---------- */
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function rgbToLab(r, g, b) {
    let R = r / 255, G = g / 255, B = b / 255;
    R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
    G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
    B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
    const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return { L: 116 * f(Y) - 16, a: 500 * (f(X) - f(Y)), b: 200 * (f(Y) - f(Z)) };
  }

  function ciede2000(l1, l2) {
    const C1 = Math.hypot(l1.a, l1.b), C2 = Math.hypot(l2.a, l2.b);
    const Cbar = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
    const a1p = (1 + G) * l1.a, a2p = (1 + G) * l2.a;
    const C1p = Math.hypot(a1p, l1.b), C2p = Math.hypot(a2p, l2.b);
    let h1p = Math.atan2(l1.b, a1p) * 180 / Math.PI; if (h1p < 0) h1p += 360;
    let h2p = Math.atan2(l2.b, a2p) * 180 / Math.PI; if (h2p < 0) h2p += 360;
    const dLp = l2.L - l1.L, dCp = C2p - C1p;
    let dhp;
    if (C1p * C2p === 0) dhp = 0;
    else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
    else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
    else dhp = h2p - h1p + 360;
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);
    const Lbar = (l1.L + l2.L) / 2, Cbarp = (C1p + C2p) / 2;
    let hbarp;
    if (C1p * C2p === 0) hbarp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;
    const rad = Math.PI / 180;
    const T = 1 - 0.17 * Math.cos((hbarp - 30) * rad) + 0.24 * Math.cos(2 * hbarp * rad)
      + 0.32 * Math.cos((3 * hbarp + 6) * rad) - 0.20 * Math.cos((4 * hbarp - 63) * rad);
    const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
    const Rc = 2 * Math.sqrt(Math.pow(Cbarp, 7) / (Math.pow(Cbarp, 7) + Math.pow(25, 7)));
    const Sl = 1 + 0.015 * Math.pow(Lbar - 50, 2) / Math.sqrt(20 + Math.pow(Lbar - 50, 2));
    const Sc = 1 + 0.045 * Cbarp;
    const Sh = 1 + 0.015 * Cbarp * T;
    const Rt = -Math.sin(2 * dTheta * rad) * Rc;
    return Math.sqrt(
      Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2)
      + Rt * (dCp / Sc) * (dHp / Sh)
    );
  }

  function colorDist(c1, c2, l1, l2, mode) {
    if (mode === 'lab') {
      const dl = l1.L - l2.L, da = l1.a - l2.a, db = l1.b - l2.b;
      return dl * dl + da * da + db * db;
    }
    if (mode === 'cie') return ciede2000(l1, l2);
    const dr = c1.r - c2.r, dg = c1.g - c2.g, db = c1.b - c2.b;
    return dr * dr + dg * dg + db * db;
  }

  function nearestIdx(c, list, labs, mode) {
    const lab = (mode === 'lab' || mode === 'cie') ? rgbToLab(c.r, c.g, c.b) : null;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = colorDist(c, list[i], lab, labs ? labs[i] : null, mode);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /* ---------- 聚类 ---------- */
  function medianCut(pixels, maxColors) {
    if (!pixels.length) return [];
    const uniq = new Set(pixels.map(p => p.r + ',' + p.g + ',' + p.b));
    const target = Math.max(1, Math.min(maxColors, uniq.size));
    const boxes = [pixels];
    let guard = 0;
    while (boxes.length < target && guard++ < 600) {
      let bestIdx = -1, bestScore = -1, bestKey = 'r';
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (box.length < 2) continue;
        let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
        for (const p of box) {
          if (p.r < minR) minR = p.r; if (p.r > maxR) maxR = p.r;
          if (p.g < minG) minG = p.g; if (p.g > maxG) maxG = p.g;
          if (p.b < minB) minB = p.b; if (p.b > maxB) maxB = p.b;
        }
        const rR = maxR - minR, rG = maxG - minG, rB = maxB - minB;
        let key = 'r', range = rR;
        if (rG >= rR && rG >= rB) { key = 'g'; range = rG; }
        if (rB >= rR && rB >= rG) { key = 'b'; range = rB; }
        const score = range * box.length;
        if (score > bestScore) { bestScore = score; bestIdx = i; bestKey = key; }
      }
      if (bestIdx < 0) break;
      const box = boxes[bestIdx];
      box.sort((a, b) => a[bestKey] - b[bestKey]);
      const mid = box.length >> 1;
      boxes.splice(bestIdx, 1, box.slice(0, mid), box.slice(mid));
    }
    return boxes.map(box => {
      let r = 0, g = 0, b = 0;
      for (const p of box) { r += p.r; g += p.g; b += p.b; }
      const n = box.length;
      return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), n };
    });
  }

  /* 中位切分种子 + 2 轮 Lab Lloyd 微调（保留色彩多样性，消除簇内噪声） */
  function kmeansLab(pixels, k, maxIter) {
    if (!pixels.length) return [];
    const uniq = new Set(pixels.map(p => p.r + ',' + p.g + ',' + p.b)).size;
    if (pixels.length <= k || uniq <= k) {
      const map = new Map();
      for (const p of pixels) {
        const key = p.r + ',' + p.g + ',' + p.b;
        if (!map.has(key)) map.set(key, { r: p.r, g: p.g, b: p.b, n: 0 });
        map.get(key).n++;
      }
      return [...map.values()];
    }
    let sample = pixels;
    if (pixels.length > 16000) {
      const step = Math.ceil(pixels.length / 16000);
      sample = [];
      for (let i = 0; i < pixels.length; i += step) sample.push(pixels[i]);
    }
    const centroids = medianCut(sample, k).map(s => ({ r: s.r, g: s.g, b: s.b, n: s.n }));
    const n = centroids.length;
    if (n <= 1) return centroids;
    const cLab = centroids.map(c => rgbToLab(c.r, c.g, c.b));
    const pxLab = sample.map(p => {
      const lab = rgbToLab(p.r, p.g, p.b);
      return { r: p.r, g: p.g, b: p.b, L: lab.L, a: lab.a, b: lab.b };
    });
    for (let iter = 0; iter < maxIter; iter++) {
      const sums = Array.from({ length: n }, () => ({ r: 0, g: 0, b: 0, L: 0, a: 0, b: 0, n: 0 }));
      for (const p of pxLab) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i < n; i++) {
          const dl = cLab[i].L - p.L, da = cLab[i].a - p.a, db = cLab[i].b - p.b;
          const d = dl * dl + da * da + db * db;
          if (d < bd) { bd = d; bi = i; }
        }
        const s = sums[bi];
        s.r += p.r; s.g += p.g; s.b += p.b; s.L += p.L; s.a += p.a; s.b += p.b; s.n++;
      }
      for (let i = 0; i < n; i++) {
        const s = sums[i];
        if (!s.n) continue;
        centroids[i] = { r: s.r / s.n, g: s.g / s.n, b: s.b / s.n, n: s.n };
        cLab[i] = { L: s.L / s.n, a: s.a / s.n, b: s.b / s.n };
      }
    }
    const finals = Array.from({ length: n }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (const p of pixels) {
      const lab = rgbToLab(p.r, p.g, p.b);
      let bi = 0, bd = Infinity;
      for (let i = 0; i < n; i++) {
        const dl = cLab[i].L - lab.L, da = cLab[i].a - lab.a, db = cLab[i].b - lab.b;
        const d = dl * dl + da * da + db * db;
        if (d < bd) { bd = d; bi = i; }
      }
      finals[bi].r += p.r; finals[bi].g += p.g; finals[bi].b += p.b; finals[bi].n++;
    }
    return finals
      .filter(s => s.n > 0)
      .map(s => ({ r: Math.round(s.r / s.n), g: Math.round(s.g / s.n), b: Math.round(s.b / s.n), n: s.n }));
  }

  /* ---------- 采样 ---------- */
  function downscale(src, w, h, nearest) {
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const c = out.getContext('2d');
    if (nearest) {
      c.imageSmoothingEnabled = false;
      c.drawImage(src, 0, 0, w, h);
      return out;
    }
    let cur = document.createElement('canvas');
    cur.width = src.width; cur.height = src.height;
    cur.getContext('2d').drawImage(src, 0, 0);
    while (cur.width / 2 >= w * 2 && cur.height / 2 >= h * 2) {
      const half = document.createElement('canvas');
      half.width = Math.max(1, Math.floor(cur.width / 2));
      half.height = Math.max(1, Math.floor(cur.height / 2));
      const hc = half.getContext('2d');
      hc.imageSmoothingEnabled = true;
      hc.imageSmoothingQuality = 'high';
      hc.drawImage(cur, 0, 0, half.width, half.height);
      cur = half;
    }
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(cur, 0, 0, w, h);
    return out;
  }

  function sampleCells(work, cols, rows, opts) {
    const big = downscale(work, cols * 2, rows * 2, !!(opts && opts.flat));
    const data = big.getContext('2d').getImageData(0, 0, cols * 2, rows * 2).data;
    const pixels = [];
    const pixelAt = [];
    const nearWhite = [];
    const t = opts.blank ? opts.whiteTh : -1;

    for (let y = 0; y < rows; y++) {
      const row = [], nwRow = [];
      for (let x = 0; x < cols; x++) {
        let sr = 0, sg = 0, sb = 0, sa = 0;
        const subs = [];
        const colorSubs = [];
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const i = ((y * 2 + dy) * (cols * 2) + (x * 2 + dx)) * 4;
            const a = data[i + 3];
            sr += data[i] * a; sg += data[i + 1] * a; sb += data[i + 2] * a; sa += a;
            if (a >= 32) {
              const sp = { r: data[i], g: data[i + 1], b: data[i + 2] };
              subs.push(sp);
              if (!(t > 0 && sp.r >= t && sp.g >= t && sp.b >= t)) colorSubs.push(sp);
            }
          }
        }
        let px = null, nw = false;
        if (sa >= 510) {
          // 白底图边缘去灰：边缘格若一半以上是白色，直接留空；否则只用非白子像素取色
          const cleanEdge = !!opts.edgeClean && t > 0 && subs.length > 0;
          if (cleanEdge && colorSubs.length < 2) {
            nw = true;
            px = null;
          } else {
            const use = cleanEdge && colorSubs.length ? colorSubs : subs;
            let r, g, b;
            if (opts.sampling === 'dominant' && use.length) {
              const freq = new Map();
              for (const s of use) {
                const key = (s.r >> 4) * 256 + (s.g >> 4) * 16 + (s.b >> 4);
                let f = freq.get(key);
                if (!f) { f = [0, 0, 0, 0]; freq.set(key, f); }
                f[0] += s.r; f[1] += s.g; f[2] += s.b; f[3]++;
              }
              let best = null;
              for (const f of freq.values()) if (!best || f[3] > best[3]) best = f;
              r = Math.round(best[0] / best[3]);
              g = Math.round(best[1] / best[3]);
              b = Math.round(best[2] / best[3]);
            } else if (cleanEdge && colorSubs.length) {
              let cr = 0, cg = 0, cb = 0;
              for (const s of colorSubs) { cr += s.r; cg += s.g; cb += s.b; }
              r = Math.round(cr / colorSubs.length);
              g = Math.round(cg / colorSubs.length);
              b = Math.round(cb / colorSubs.length);
            } else {
              r = Math.round(sr / sa); g = Math.round(sg / sa); b = Math.round(sb / sa);
            }
            if (t > 0 && r >= t && g >= t && b >= t) {
              nw = true;
              if (!opts.boundary) px = null;
              else px = { r, g, b };
            } else {
              px = { r, g, b };
            }
          }
        }
        if (px) pixels.push(px);
        row.push(px); nwRow.push(nw);
      }
      pixelAt.push(row); nearWhite.push(nwRow);
    }

    if (opts.blank && opts.boundary && t > 0) {
      const visited = new Uint8Array(rows * cols);
      const stack = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if ((y === 0 || x === 0 || y === rows - 1 || x === cols - 1) && nearWhite[y][x]) {
            visited[y * cols + x] = 1;
            stack.push([y, x]);
          }
        }
      }
      while (stack.length) {
        const [cy, cx] = stack.pop();
        pixelAt[cy][cx] = null;
        for (const [ny, nx] of [[cy - 1, cx], [cy + 1, cx], [cy, cx - 1], [cy, cx + 1]]) {
          if (ny < 0 || nx < 0 || ny >= rows || nx >= cols) continue;
          const ni = ny * cols + nx;
          if (!visited[ni] && nearWhite[ny][nx]) { visited[ni] = 1; stack.push([ny, nx]); }
        }
      }
      pixels.length = 0;
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++)
          if (pixelAt[y][x]) pixels.push(pixelAt[y][x]);
    }

    return { pixelAt, pixels };
  }

  /* ---------- 色板构建 ---------- */
  function brandColors(brand) {
    return Object.keys(DATA).map(hex => {
      const code = DATA[hex][brand];
      if (!code) return null;
      const rgb = hexToRgb(hex);
      return { hex, code, r: rgb.r, g: rgb.g, b: rgb.b };
    }).filter(Boolean);
  }

  function buildPalette(pixels, opts) {
    if (!pixels.length) return [];
    const want = opts.maxColors;
    const brandList = brandColors(opts.brand);
    const mode = opts.match;
    const brandLabs = (mode === 'lab' || mode === 'cie')
      ? brandList.map(c => rgbToLab(c.r, c.g, c.b)) : null;
    const kMax = want >= 205 ? 128 : 96;
    const k = Math.max(1, Math.min(kMax, want * 3,
      new Set(pixels.map(p => p.r + ',' + p.g + ',' + p.b)).size));
    const clusters = kmeansLab(pixels, k, 2);
    const candMap = new Map();
    for (const cl of clusters) {
      const bi = nearestIdx(cl, brandList, brandLabs, mode);
      const b = brandList[bi];
      if (!candMap.has(b.code)) candMap.set(b.code, { ...b, count: 0 });
      candMap.get(b.code).count += cl.n;
    }
    let codes = [...candMap.values()];
    while (codes.length > want) {
      let bi = -1, bj = -1, bd = Infinity;
      for (let i = 0; i < codes.length; i++) {
        for (let j = i + 1; j < codes.length; j++) {
          const dr = codes[i].r - codes[j].r, dg = codes[i].g - codes[j].g, db = codes[i].b - codes[j].b;
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; bi = i; bj = j; }
        }
      }
      if (bi < 0) break;
      let keep = bi, drop = bj;
      if (codes[bi].count < codes[bj].count) { keep = bj; drop = bi; }
      codes[keep].count += codes[drop].count;
      codes.splice(drop, 1);
    }
    return codes.sort((a, b) => b.count - a.count);
  }

  /* ---------- 吸附 + 抖动 + 空间合并 ---------- */
  function spatialMerge(grid, palette, th) {
    if (th <= 0 || !grid.length) return grid;
    const rows = grid.length, cols = grid[0].length;
    const visited = new Uint8Array(rows * cols);
    const out = grid.map(r => r.slice());
    const st = th * th;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (visited[y * cols + x] || out[y][x] < 0) continue;
        const seed = palette[out[y][x]];
        const stack = [[y, x]];
        visited[y * cols + x] = 1;
        const region = [];
        const freq = new Map();
        while (stack.length) {
          const [cy, cx] = stack.pop();
          const ci = out[cy][cx];
          region.push([cy, cx]);
          freq.set(ci, (freq.get(ci) || 0) + 1);
          for (const [ny, nx] of [[cy - 1, cx], [cy + 1, cx], [cy, cx - 1], [cy, cx + 1]]) {
            if (ny < 0 || nx < 0 || ny >= rows || nx >= cols) continue;
            const ni = ny * cols + nx;
            if (visited[ni] || out[ny][nx] < 0) continue;
            const ncol = palette[out[ny][nx]];
            const dr = seed.r - ncol.r, dg = seed.g - ncol.g, db = seed.b - ncol.b;
            if (dr * dr + dg * dg + db * db <= st) { visited[ni] = 1; stack.push([ny, nx]); }
          }
        }
        let best = -1, bestN = -1;
        for (const [ci, n] of freq) if (n > bestN) { bestN = n; best = ci; }
        for (const [cy, cx] of region) out[cy][cx] = best;
      }
    }
    return out;
  }

  function assignAndMerge(pixelAt, palette, opts) {
    const rows = pixelAt.length, cols = pixelAt[0].length;
    const mode = opts.match;
    const labs = (mode === 'lab' || mode === 'cie')
      ? palette.map(c => rgbToLab(c.r, c.g, c.b)) : null;
    const dither = (opts.dither !== 'off' && palette.length >= 2) ? opts.dither : 'off';
    const cache = dither === 'off' ? new Map() : null;
    const grid = [];
    let errCur = new Array(cols).fill(null);
    let errNext = new Array(cols).fill(null);

    for (let y = 0; y < rows; y++) {
      const gRow = new Array(cols);
      for (let x = 0; x < cols; x++) {
        const px = pixelAt[y][x];
        if (!px) { gRow[x] = -1; errCur[x] = null; continue; }
        let sel;
        if (dither === 'fs') {
          const e = errCur[x] || { r: 0, g: 0, b: 0 };
          const rr = px.r + e.r, gg = px.g + e.g, bb = px.b + e.b;
          sel = nearestIdx({ r: rr, g: gg, b: bb }, palette, labs, mode);
          const q = palette[sel];
          const er = rr - q.r, eg = gg - q.g, eb = bb - q.b;
          const addErr = (arr, i, w) => {
            if (i < 0 || i >= cols) return;
            if (!arr[i]) arr[i] = { r: 0, g: 0, b: 0 };
            arr[i].r += er * w; arr[i].g += eg * w; arr[i].b += eb * w;
          };
          addErr(errCur, x + 1, 7 / 16);
          addErr(errNext, x - 1, 3 / 16);
          addErr(errNext, x, 5 / 16);
          addErr(errNext, x + 1, 1 / 16);
        } else if (dither === 'bayer') {
          let i1 = 0, i2 = 1, d1 = Infinity, d2 = Infinity;
          const lab = (mode === 'lab' || mode === 'cie') ? rgbToLab(px.r, px.g, px.b) : null;
          for (let i = 0; i < palette.length; i++) {
            const d = colorDist(px, palette[i], lab, labs ? labs[i] : null, mode);
            if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = i; }
            else if (d < d2) { d2 = d; i2 = i; }
          }
          const ratio = d2 > 0 ? d1 / d2 : 0;
          sel = ratio > (BAYER4[y & 3][x & 3] + 0.5) / 16 ? i2 : i1;
        } else {
          const key = px.r + ',' + px.g + ',' + px.b;
          let v = cache.get(key);
          if (v === undefined) { v = nearestIdx(px, palette, labs, mode); cache.set(key, v); }
          sel = v;
        }
        gRow[x] = sel;
      }
      grid.push(gRow);
      errCur = errNext;
      errNext = new Array(cols).fill(null);
    }

    const merged = opts.merge > 0 ? spatialMerge(grid, palette, opts.merge) : grid;
    // 白底图边缘的浅灰色抗锯齿像素：只留空与背景相邻的浅灰格，避免一圈灰边
    if (opts.edgeClean) {
      const emptyAt = (y, x) => y < 0 || x < 0 || y >= rows || x >= cols || merged[y][x] < 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const v = merged[y][x];
          if (v < 0) continue;
          const c = palette[v];
          const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
          const lum = (c.r + c.g + c.b) / 3;
          if (mx - mn <= 22 && lum > 150 &&
              (emptyAt(y - 1, x) || emptyAt(y + 1, x) || emptyAt(y, x - 1) || emptyAt(y, x + 1))) {
            merged[y][x] = -1;
          }
        }
      }
    }
    const counts = new Array(palette.length).fill(0);
    for (const row of merged) for (const v of row) if (v >= 0) counts[v]++;
    return { grid: merged, counts };
  }

  /* ---------- 生成 ---------- */
  function generate(source, opts) {
    const cols = Math.max(8, Math.min(400, Math.round(opts.cols)));
    let rows = Math.max(1, Math.round(cols * source.height / source.width));
    if (opts.square) rows = cols;

    let work = source;
    if (opts.square && source.width !== source.height) {
      const side = Math.min(source.width, source.height);
      const ox = Math.floor((source.width - side) / 2);
      const oy = Math.floor((source.height - side) / 2);
      const crop = document.createElement('canvas');
      crop.width = side; crop.height = side;
      crop.getContext('2d').drawImage(source, ox, oy, side, side, 0, 0, side, side);
      work = crop;
    }

    const { pixelAt, pixels } = sampleCells(work, cols, rows, opts);
    const palette = buildPalette(pixels, opts);
    if (!palette.length) {
      return { cols, rows, grid: Array.from({ length: rows }, () => new Array(cols).fill(-1)), palette: [], total: 0, empty: cols * rows };
    }
    const { grid, counts } = assignAndMerge(pixelAt, palette, opts);

    const order = palette.map((p, i) => ({ p, i })).sort((a, b) => counts[b.i] - counts[a.i]);
    const idxMap = new Map(order.map((o, ni) => [o.i, ni]));
    const sortedPalette = order.map((o, ni) => ({ ...o.p, count: counts[o.i] }));
    const sortedGrid = grid.map(row => row.map(v => (v < 0 ? -1 : idxMap.get(v))));
    let total = 0;
    for (const row of sortedGrid) for (const v of row) if (v >= 0) total++;
    return { cols, rows, grid: sortedGrid, palette: sortedPalette, total, empty: cols * rows - total };
  }

  /* ---------- 颜色排除重映射 ---------- */
  function remapExcluded(grid, palette, excluded, mode) {
    const rows = grid.length, cols = grid[0].length;
    const allowedIdx = [];
    for (let i = 0; i < palette.length; i++) if (!excluded.has(palette[i].code)) allowedIdx.push(i);
    const changed = [];
    if (!allowedIdx.length) return { grid, changed };
    const list = allowedIdx.map(i => palette[i]);
    const labs = (mode === 'lab' || mode === 'cie') ? list.map(c => rgbToLab(c.r, c.g, c.b)) : null;
    const cache = new Map();
    const out = grid.map(r => r.slice());
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = out[y][x];
        if (v < 0 || !excluded.has(palette[v].code)) continue;
        const key = palette[v].r + ',' + palette[v].g + ',' + palette[v].b;
        let sel = cache.get(key);
        if (sel === undefined) { sel = nearestIdx(palette[v], list, labs, mode); cache.set(key, sel); }
        const nv = allowedIdx[sel];
        out[y][x] = nv;
        changed.push({ x, y, before: v, after: nv });
      }
    }
    return { grid: out, changed };
  }

  /* ---------- 图纸渲染 ---------- */
  function textColorFor(hex) {
    const c = hexToRgb(hex);
    const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    return lum > 150 ? '#1F2224' : '#FFFFFF';
  }

  function renderChart(spec) {
    const {
      cols, rows, grid, palette, excluded,
      title, brand, cellSize, labelMode, boardLines,
    } = spec;
    const F = '"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
    const SERIF = '"Noto Serif SC","Songti SC","STSong",serif';
    const headerH = 62, coordH = 28, coordW = 44, pad = 14;
    const gridW = cols * cellSize, gridH = rows * cellSize;
    const contentW = coordW + gridW + pad * 2;

    const shown = palette.filter(p => p.count > 0 && !excluded.has(p.code));
    const chipW = 132, chipH = 42;
    const perRow = Math.max(1, Math.floor((contentW - pad * 2) / chipW));
    const legendRows = Math.ceil(shown.length / perRow) || 1;
    const legendBlockH = 30 + legendRows * (chipH + 8) + 10;
    const W = contentW;
    const H = headerH + coordH + gridH + 18 + legendBlockH + 46;

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    /* 标题栏 */
    ctx.fillStyle = '#1F2224';
    ctx.fillRect(0, 0, W, headerH);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 21px ${SERIF}`;
    ctx.fillText(title || '拼豆图纸', pad, 24);
    ctx.font = `12px ${F}`;
    ctx.fillStyle = '#C9CFD6';
    ctx.fillText(`${cols} × ${rows} 格 · 品牌 ${brand} · 每格 1 颗豆`, pad, 45);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8C949C';
    ctx.font = `11px ${F}`;
    const d = new Date();
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    ctx.fillText(`${ds} · 拼豆工作室`, W - pad, 46);

    const ox = coordW, oy = headerH + coordH;

    /* 格子 */
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = grid[y][x];
        if (v < 0) continue;
        ctx.fillStyle = palette[v].hex;
        ctx.fillRect(ox + x * cellSize, oy + y * cellSize, cellSize, cellSize);
      }
    }

    /* 格内色号 / 符号 */
    if (labelMode !== 'none') {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const v = grid[y][x];
          if (v < 0) continue;
          const p = palette[v];
          const text = labelMode === 'code' ? p.code : SYMBOLS[v];
          ctx.font = `600 ${Math.min(cellSize * (text.length >= 4 ? 0.26 : 0.32), 11)}px ${F}`;
          ctx.fillStyle = textColorFor(p.hex);
          ctx.fillText(text, ox + x * cellSize + cellSize / 2, oy + y * cellSize + cellSize / 2 + 0.5);
        }
      }
    }

    /* 网格线 */
    for (let i = 0; i <= cols; i++) {
      const x = ox + i * cellSize;
      ctx.strokeStyle = (i % 10 === 0) ? '#4A5560' : '#E3E7EC';
      ctx.lineWidth = (i % 10 === 0) ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(x + 0.5, oy); ctx.lineTo(x + 0.5, oy + gridH); ctx.stroke();
    }
    for (let j = 0; j <= rows; j++) {
      const y = oy + j * cellSize;
      ctx.strokeStyle = (j % 10 === 0) ? '#4A5560' : '#E3E7EC';
      ctx.lineWidth = (j % 10 === 0) ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(ox, y + 0.5); ctx.lineTo(ox + gridW, y + 0.5); ctx.stroke();
    }

    /* 钉板边界线 */
    if (boardLines) {
      ctx.strokeStyle = '#2F6FE4'; ctx.lineWidth = 2;
      for (let i = 29; i < cols; i += 29) {
        const x = ox + i * cellSize;
        ctx.beginPath(); ctx.moveTo(x + 0.5, oy); ctx.lineTo(x + 0.5, oy + gridH); ctx.stroke();
      }
      for (let j = 29; j < rows; j += 29) {
        const y = oy + j * cellSize;
        ctx.beginPath(); ctx.moveTo(ox, y + 0.5); ctx.lineTo(ox + gridW, y + 0.5); ctx.stroke();
      }
    }

    /* 坐标 */
    ctx.fillStyle = '#4A5560';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `11px ${F}`;
    for (let i = 0; i < cols; i++) {
      if (i % 10 === 0 || i === cols - 1) {
        ctx.fillText(String(i + 1), ox + i * cellSize + cellSize / 2, headerH + coordH / 2);
      }
    }
    ctx.textAlign = 'right';
    for (let j = 0; j < rows; j++) {
      if (j % 10 === 0 || j === rows - 1) {
        ctx.fillText(String(j + 1), ox - 6, oy + j * cellSize + cellSize / 2);
      }
    }

    /* 图例 */
    const ly = oy + gridH + 24;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1F2224';
    ctx.font = `600 14px ${SERIF}`;
    ctx.fillText('色号图例 / 购物清单（按用量排序）', pad, ly + 6);

    let total = 0, shownN = 0;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      if (p.count <= 0 || excluded.has(p.code)) continue;
      total += p.count;
      const rx = shownN % perRow, ry = Math.floor(shownN / perRow);
      shownN++;
      const cx = pad + rx * chipW, cy = ly + 22 + ry * (chipH + 8);
      ctx.fillStyle = p.hex;
      ctx.fillRect(cx, cy, 34, chipH);
      ctx.strokeStyle = '#C9CFD7'; ctx.lineWidth = 1;
      ctx.strokeRect(cx + 0.5, cy + 0.5, 33, chipH - 1);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#1F2224';
      ctx.font = `600 12px ${F}`;
      ctx.fillText(p.code, cx + 44, cy + 14);
      ctx.fillStyle = '#6B6F76';
      ctx.font = `11.5px ${F}`;
      ctx.fillText(`${p.count.toLocaleString()} 颗`, cx + 44, cy + 30);
    }

    let empty = 0;
    for (const row of grid) for (const v of row) if (v < 0) empty++;
    const ty = ly + 22 + legendRows * (chipH + 8) + 4;
    ctx.fillStyle = '#1F2224';
    ctx.font = `600 12.5px ${F}`;
    ctx.fillText(`总计 ${total.toLocaleString()} 颗 · 用色 ${shown.length} 种 · 留空 ${empty.toLocaleString()} 格`, pad, ty + 6);
    ctx.fillStyle = '#9AA3AD';
    ctx.font = `11px ${F}`;
    ctx.fillText(
      '提示：按行列坐标从左上角开始拼；打印请选择 100% 缩放。'
      + (boardLines ? ' 蓝色线 = 29×29 钉板边界。' : ''),
      pad, ty + 24
    );

    return canvas;
  }

  function csvText(spec) {
    const { palette, excluded, brand } = spec;
    const lines = ['品牌,色号,颜色(Hex),颗数'];
    let total = 0;
    for (const p of palette) {
      if (p.count <= 0 || excluded.has(p.code)) continue;
      lines.push(`${brand},${p.code},${p.hex},${p.count}`);
      total += p.count;
    }
    lines.push(`总计,,,${total}`);
    return '\ufeff' + lines.join('\r\n');
  }

  window.PindouEngine = {
    generate,
    remapExcluded,
    renderChart,
    csvText,
    textColorFor,
    estimateRows(cols, w, h, square) {
      return square ? cols : Math.max(1, Math.round(cols * h / w));
    },
  };
})();
