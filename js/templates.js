/* ==========================================================================
   内置模板库：每个模板画在 320×320 白底 canvas 上，交给转换引擎处理
   ========================================================================== */
(function () {
  'use strict';

  const C = {
    ink: '#2F2B2F', red: '#FD7C72', redDark: '#C1444A', pink: '#FFA9AD',
    palePink: '#FFD6D9', yellow: '#FFDA45', gold: '#EDB045',
    green: '#3DAF80', greenLight: '#65E2A6', blue: '#41CCFF', blueDark: '#3677D2',
    cream: '#FFFBE1', white: '#FFFFFF', purple: '#B843C5', brown: '#78524B',
  };

  function makeCanvas(size) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    return { c, ctx };
  }

  function star(ctx, cx, cy, outer, inner, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = -Math.PI / 2 + i * Math.PI / points;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  const list = [
    {
      id: 'heart', name: '爱心',
      draw(ctx) {
        ctx.fillStyle = C.red;
        ctx.beginPath();
        ctx.moveTo(160, 262);
        ctx.bezierCurveTo(52, 190, 44, 108, 92, 86);
        ctx.bezierCurveTo(124, 71, 150, 92, 160, 112);
        ctx.bezierCurveTo(170, 92, 196, 71, 228, 86);
        ctx.bezierCurveTo(276, 108, 268, 190, 160, 262);
        ctx.fill();
        ctx.fillStyle = C.palePink;
        ctx.beginPath();
        ctx.ellipse(104, 122, 26, 18, -0.5, 0, Math.PI * 2);
        ctx.fill();
      },
    },
    {
      id: 'star', name: '星星',
      draw(ctx) {
        ctx.fillStyle = C.yellow;
        star(ctx, 160, 156, 126, 52, 5);
        ctx.fill();
        ctx.fillStyle = C.gold;
        star(ctx, 160, 162, 62, 26, 5);
        ctx.fill();
        ctx.fillStyle = C.cream;
        ctx.beginPath();
        ctx.arc(120, 108, 12, 0, Math.PI * 2);
        ctx.fill();
      },
    },
    {
      id: 'flower', name: '小花',
      draw(ctx) {
        ctx.strokeStyle = C.green;
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(160, 208);
        ctx.lineTo(160, 286);
        ctx.stroke();
        ctx.fillStyle = C.green;
        ctx.beginPath();
        ctx.ellipse(196, 246, 30, 15, -0.5, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
          ctx.fillStyle = C.pink;
          ctx.beginPath();
          ctx.ellipse(160 + Math.cos(a) * 62, 140 + Math.sin(a) * 62, 44, 34, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = C.yellow;
        ctx.beginPath();
        ctx.arc(160, 140, 42, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.gold;
        ctx.beginPath();
        ctx.arc(160, 140, 18, 0, Math.PI * 2);
        ctx.fill();
      },
    },
    {
      id: 'bunny', name: '小兔',
      draw(ctx) {
        ctx.fillStyle = C.cream;
        ctx.beginPath();
        ctx.ellipse(112, 105, 26, 62, -0.22, 0, Math.PI * 2);
        ctx.ellipse(208, 105, 26, 62, 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.pink;
        ctx.beginPath();
        ctx.ellipse(112, 108, 12, 40, -0.22, 0, Math.PI * 2);
        ctx.ellipse(208, 108, 12, 40, 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.cream;
        ctx.beginPath();
        ctx.arc(160, 196, 96, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.ink;
        ctx.beginPath();
        ctx.arc(126, 190, 9, 0, Math.PI * 2);
        ctx.arc(194, 190, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.redDark;
        ctx.beginPath();
        ctx.moveTo(160, 206); ctx.lineTo(150, 196); ctx.lineTo(170, 196); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = C.palePink;
        ctx.beginPath();
        ctx.ellipse(112, 228, 18, 12, 0, 0, Math.PI * 2);
        ctx.ellipse(208, 228, 18, 12, 0, 0, Math.PI * 2);
        ctx.fill();
      },
    },
    {
      id: 'cat', name: '猫咪',
      draw(ctx) {
        ctx.fillStyle = C.ink;
        ctx.beginPath();
        ctx.arc(160, 190, 98, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(72, 130); ctx.lineTo(86, 44); ctx.lineTo(136, 88); ctx.closePath();
        ctx.moveTo(248, 130); ctx.lineTo(234, 44); ctx.lineTo(184, 88); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = C.pink;
        ctx.beginPath();
        ctx.moveTo(84, 118); ctx.lineTo(92, 62); ctx.lineTo(122, 92); ctx.closePath();
        ctx.moveTo(236, 118); ctx.lineTo(228, 62); ctx.lineTo(198, 92); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = C.cream;
        ctx.beginPath();
        ctx.ellipse(126, 186, 26, 20, 0, 0, Math.PI * 2);
        ctx.ellipse(194, 186, 26, 20, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.ink;
        ctx.beginPath();
        ctx.ellipse(126, 188, 9, 18, 0, 0, Math.PI * 2);
        ctx.ellipse(194, 188, 9, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.pink;
        ctx.beginPath();
        ctx.moveTo(160, 220); ctx.lineTo(150, 210); ctx.lineTo(170, 210); ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(120, 240); ctx.lineTo(160, 236); ctx.lineTo(200, 240);
        ctx.stroke();
      },
    },
    {
      id: 'rainbow', name: '彩虹',
      draw(ctx) {
        const colors = [C.red, C.gold, C.yellow, C.green, C.blue, C.purple];
        const radii = [150, 126, 102, 78, 54, 30];
        colors.forEach((color, i) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 22;
          ctx.beginPath();
          ctx.arc(160, 240, radii[i], Math.PI, Math.PI * 2);
          ctx.stroke();
        });
        ctx.fillStyle = C.cream;
        ctx.beginPath();
        ctx.arc(58, 250, 34, 0, Math.PI * 2);
        ctx.arc(100, 258, 26, 0, Math.PI * 2);
        ctx.arc(262, 250, 34, 0, Math.PI * 2);
        ctx.arc(220, 258, 26, 0, Math.PI * 2);
        ctx.fill();
      },
    },
    {
      id: 'sakura', name: '樱花',
      draw(ctx) {
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
          ctx.fillStyle = C.pink;
          ctx.beginPath();
          ctx.ellipse(160 + Math.cos(a) * 58, 158 + Math.sin(a) * 58, 40, 28, a, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = C.palePink;
          ctx.beginPath();
          ctx.arc(160 + Math.cos(a) * 82, 158 + Math.sin(a) * 82, 9, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = C.gold;
        ctx.beginPath();
        ctx.arc(160, 158, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.redDark;
        [0, 1, 2, 3, 4].forEach(i => {
          const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
          ctx.beginPath();
          ctx.arc(160 + Math.cos(a) * 18, 158 + Math.sin(a) * 18, 5, 0, Math.PI * 2);
          ctx.fill();
        });
      },
    },
    {
      id: 'gift', name: '礼物',
      draw(ctx) {
        ctx.fillStyle = C.red;
        ctx.fillRect(76, 152, 168, 132);
        ctx.fillStyle = C.redDark;
        ctx.fillRect(64, 128, 192, 34);
        ctx.fillStyle = C.gold;
        ctx.fillRect(148, 128, 24, 156);
        ctx.fillStyle = C.pink;
        ctx.beginPath();
        ctx.ellipse(136, 108, 34, 24, 0.4, 0, Math.PI * 2);
        ctx.ellipse(184, 108, 34, 24, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.yellow;
        ctx.beginPath();
        ctx.arc(160, 116, 18, 0, Math.PI * 2);
        ctx.fill();
      },
    },
    {
      id: 'smile', name: '笑脸',
      draw(ctx) {
        ctx.fillStyle = C.yellow;
        ctx.beginPath();
        ctx.arc(160, 160, 116, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.ink;
        ctx.beginPath();
        ctx.arc(126, 142, 13, 0, Math.PI * 2);
        ctx.arc(194, 142, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 11;
        ctx.beginPath();
        ctx.arc(160, 176, 58, 0.22 * Math.PI, 0.78 * Math.PI);
        ctx.stroke();
        ctx.fillStyle = C.palePink;
        ctx.beginPath();
        ctx.ellipse(100, 196, 18, 12, 0, 0, Math.PI * 2);
        ctx.ellipse(220, 196, 18, 12, 0, 0, Math.PI * 2);
        ctx.fill();
      },
    },
    {
      id: 'cloud', name: '云朵',
      draw(ctx) {
        ctx.fillStyle = C.blue;
        ctx.beginPath();
        ctx.ellipse(112, 178, 46, 38, 0, 0, Math.PI * 2);
        ctx.ellipse(164, 152, 56, 48, 0, 0, Math.PI * 2);
        ctx.ellipse(216, 178, 44, 36, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(76, 178, 172, 38);
        ctx.fillStyle = C.cream;
        ctx.beginPath();
        ctx.ellipse(140, 132, 26, 18, -0.35, 0, Math.PI * 2);
        ctx.fill();
      },
    },
    {
      id: 'moon', name: '月亮',
      draw(ctx) {
        ctx.save();
        ctx.fillStyle = C.yellow;
        ctx.beginPath();
        ctx.arc(152, 156, 96, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(192, 134, 88, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = C.gold;
        star(ctx, 244, 78, 20, 8, 5);
        ctx.fill();
        ctx.fillStyle = C.yellow;
        star(ctx, 262, 150, 12, 5, 5);
        ctx.fill();
        ctx.fillStyle = C.cream;
        star(ctx, 228, 222, 9, 4, 5);
        ctx.fill();
      },
    },
    {
      id: 'butterfly', name: '蝴蝶',
      draw(ctx) {
        ctx.fillStyle = C.pink;
        ctx.beginPath();
        ctx.ellipse(112, 118, 44, 54, -0.35, 0, Math.PI * 2);
        ctx.ellipse(208, 118, 44, 54, 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.purple;
        ctx.beginPath();
        ctx.ellipse(118, 208, 36, 42, 0.3, 0, Math.PI * 2);
        ctx.ellipse(202, 208, 36, 42, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.gold;
        ctx.beginPath();
        ctx.arc(112, 118, 14, 0, Math.PI * 2);
        ctx.arc(208, 118, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.ink;
        ctx.beginPath();
        ctx.ellipse(160, 168, 14, 62, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(154, 108); ctx.quadraticCurveTo(138, 74, 126, 66);
        ctx.moveTo(166, 108); ctx.quadraticCurveTo(182, 74, 194, 66);
        ctx.stroke();
      },
    },
  ];

  const PALETTES = {
    heart: ['#FD7C72', '#FFD6D9'],
    star: ['#FFDA45', '#EDB045', '#FFFBE1'],
    flower: ['#FFA9AD', '#FFDA45', '#EDB045', '#3DAF80'],
    bunny: ['#FFFBE1', '#FFA9AD', '#FFD6D9', '#2F2B2F', '#C1444A'],
    cat: ['#2F2B2F', '#FFA9AD', '#FFFBE1', '#FFFBE1'],
    rainbow: ['#FD7C72', '#EDB045', '#FFDA45', '#3DAF80', '#41CCFF', '#B843C5', '#FFFBE1'],
    sakura: ['#FFA9AD', '#FFD6D9', '#EDB045', '#C1444A'],
    gift: ['#FD7C72', '#C1444A', '#EDB045', '#FFA9AD', '#FFDA45'],
    smile: ['#FFDA45', '#2F2B2F', '#FFD6D9'],
    cloud: ['#A0E2FB', '#FFFBE1', '#3677D2'],
    moon: ['#FFDA45', '#EDB045', '#FFFBE1'],
    butterfly: ['#FFA9AD', '#B843C5', '#2F2B2F', '#EDB045'],
  };
  list.forEach(t => { t.colors = PALETTES[t.id] || []; });

  const thumbCache = {};

  function renderSource(id, size) {
    const tpl = list.find(t => t.id === id);
    if (!tpl) return null;
    const s = size || 320;
    const { c, ctx } = makeCanvas(s);
    ctx.save();
    ctx.scale(s / 320, s / 320);
    tpl.draw(ctx);
    ctx.restore();
    return c;
  }

  function renderThumb(id, size) {
    const key = id + '@' + (size || 120);
    if (thumbCache[key]) return thumbCache[key];
    const src = renderSource(id, 320);
    if (!src) return '';
    const s = size || 120;
    const { c, ctx } = makeCanvas(s);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, s, s);
    const url = c.toDataURL('image/png');
    thumbCache[key] = url;
    return url;
  }

  window.PindouTemplates = {
    list,
    get(id) { return list.find(t => t.id === id) || null; },
    renderSource,
    renderThumb,
  };
})();
