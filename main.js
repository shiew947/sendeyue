/* ───────────────────────────────────────────────────────────────
   Particle Christmas Tree
   3D 点云 + 加色混合 + 景深衰减，Canvas 2D 单遍绘制
   ─────────────────────────────────────────────────────────────── */
(() => {
  'use strict';

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ── 场景常量 ─────────────────────────────────────────────── */
  const TREE = { radius: 0.73, height: 2.0, fov: 3.4, turns: 10.5 };
  const TAU = Math.PI * 2;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const easeOutCubic = (v) => 1 - Math.pow(1 - v, 3);

  const PALETTE = {
    snow: '238,248,255',
    mint: '158,255,224',
    jade: '72,228,166',
    pine: '38,186,142',
    gold: '255,215,150',
    amber: '255,176,104',
    rose: '255,152,172',
  };

  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, fit = 300;
  let parts = [];
  let flakes = [];
  let bokeh = [];
  let quality = 1;

  /* ── 预渲染精灵（避免逐帧建渐变） ─────────────────────────── */
  function makeGlow(rgb) {
    const S = 96;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const r = S / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, `rgba(${rgb},1)`);
    grad.addColorStop(0.16, `rgba(${rgb},0.82)`);
    grad.addColorStop(0.38, `rgba(${rgb},0.3)`);
    grad.addColorStop(0.66, `rgba(${rgb},0.075)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    return c;
  }

  function makeFlare() {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const h = S / 2;
    g.globalCompositeOperation = 'lighter';

    const halo = g.createRadialGradient(h, h, 0, h, h, h * 0.52);
    halo.addColorStop(0, 'rgba(255,236,200,0.34)');
    halo.addColorStop(0.34, 'rgba(255,208,146,0.10)');
    halo.addColorStop(1, 'rgba(255,190,120,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, S, S);

    const core = g.createRadialGradient(h, h, 0, h, h, h * 0.17);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.22, 'rgba(255,248,224,0.7)');
    core.addColorStop(0.55, 'rgba(255,214,150,0.16)');
    core.addColorStop(1, 'rgba(255,200,130,0)');
    g.fillStyle = core;
    g.fillRect(0, 0, S, S);

    g.filter = 'blur(9px)';
    const spikes = [
      [0, 0.5, 0.011],
      [Math.PI / 2, 0.5, 0.011],
      [Math.PI / 4, 0.26, 0.008],
      [-Math.PI / 4, 0.26, 0.008],
    ];
    for (const [rot, lenR, thickR] of spikes) {
      const len = S * lenR;
      const thick = S * thickR;
      g.save();
      g.translate(h, h);
      g.rotate(rot);
      const lg = g.createLinearGradient(-len, 0, len, 0);
      lg.addColorStop(0, 'rgba(255,236,196,0)');
      lg.addColorStop(0.36, 'rgba(255,246,226,0.30)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      lg.addColorStop(0.64, 'rgba(255,246,226,0.30)');
      lg.addColorStop(1, 'rgba(255,236,196,0)');
      g.fillStyle = lg;
      g.fillRect(-len, -thick / 2, len * 2, thick);
      g.restore();
    }
    g.filter = 'none';
    return c;
  }

  const SPR = {
    snow: makeGlow(PALETTE.snow),
    mint: makeGlow(PALETTE.mint),
    jade: makeGlow(PALETTE.jade),
    pine: makeGlow(PALETTE.pine),
    gold: makeGlow(PALETTE.gold),
    amber: makeGlow(PALETTE.amber),
    rose: makeGlow(PALETTE.rose),
  };
  const FLARE = makeFlare();

  const SPRITE_LIST = [SPR.snow, SPR.mint, SPR.jade, SPR.pine, SPR.gold, SPR.amber, SPR.rose];
  const SPRITE_IDX = new Map(SPRITE_LIST.map((sp, i) => [sp, i]));
  let buckets = [];

  /* ── 生成粒子 ─────────────────────────────────────────────── */
  function buildParticles() {
    parts = [];
    const narrow = W < 760;
    const half = TREE.height / 2;
    const foliageN = Math.round((narrow ? 1750 : 2700) * quality);
    const garlandN = Math.round((narrow ? 740 : 1180) * quality);

    // 树体：圆锥面上的柔和松针点云
    for (let i = 0; i < foliageN; i++) {
      const u = 1 - Math.pow(1 - Math.random(), 0.7); // 略偏底部，但保住上半段的体量
      const maxR = TREE.radius * Math.pow(1 - u, 0.74);
      const shell = Math.random() < 0.66;
      const rad = shell
        ? maxR * (0.86 + 0.14 * Math.random())
        : maxR * Math.pow(Math.random(), 0.55) * 0.88;

      const r = Math.random();
      let sprite = SPR.jade;
      let size = 0.048;
      let alpha = 0.5;
      let tw = 0.7 + Math.random() * 1.6;

      if (r > 0.72) {
        sprite = SPR.mint; size = 0.04; alpha = 0.44; tw = 1.1 + Math.random() * 2.2;
      } else if (r > 0.5) {
        sprite = SPR.pine; size = 0.055; alpha = 0.36; tw = 0.5 + Math.random();
      } else if (r > 0.34) {
        sprite = SPR.snow; size = 0.032; alpha = 0.34; tw = 1.4 + Math.random() * 2.6;
      }

      parts.push({
        ang: Math.random() * TAU,
        rad,
        y: -half + u * TREE.height + (Math.random() - 0.5) * 0.035,
        u,
        sprite,
        size: size * (0.75 + Math.random() * 0.55),
        a: alpha * (0.7 + Math.random() * 0.6),
        tw,
        ph: Math.random() * TAU,
        z0: (Math.random() - 0.5) * 0.02,
        delay: 0.05 + u * 0.5 + Math.random() * 0.12,
        layer: 0,
      });
    }

    // 螺旋灯串：绕树 11.5 圈的金色光点
    for (let i = 0; i < garlandN; i++) {
      const u = i / (garlandN - 1);
      const maxR = TREE.radius * Math.pow(1 - u, 0.74);
      const ang = u * TAU * TREE.turns;
      const isRose = i % 37 === 0;
      const isWhite = i % 5 === 0;

      parts.push({
        ang: ang + (Math.random() - 0.5) * 0.035,
        rad: maxR * (1.005 + (Math.random() - 0.5) * 0.05),
        y: -half + u * TREE.height + (Math.random() - 0.5) * 0.016,
        u,
        sprite: isRose ? SPR.rose : isWhite ? SPR.snow : SPR.gold,
        size: (isRose ? 0.085 : isWhite ? 0.05 : 0.066) * (0.8 + Math.random() * 0.5),
        a: isRose ? 0.8 : 0.52,
        tw: 1.5 + Math.random() * 2.6,
        ph: Math.random() * TAU,
        z0: 0,
        delay: 0.2 + u * 0.55 + Math.random() * 0.1,
        layer: 1,
      });
    }

    // 挂饰：稀疏的大颗暖光，缓慢呼吸
    for (let i = 0; i < (narrow ? 34 : 58); i++) {
      const u = 0.06 + Math.random() * 0.82;
      const maxR = TREE.radius * Math.pow(1 - u, 0.74);
      parts.push({
        ang: Math.random() * TAU,
        rad: maxR * (0.94 + Math.random() * 0.1),
        y: -half + u * TREE.height,
        u,
        sprite: Math.random() < 0.34 ? SPR.rose : Math.random() < 0.6 ? SPR.amber : SPR.gold,
        size: 0.1 + Math.random() * 0.07,
        a: 0.5,
        tw: 0.35 + Math.random() * 0.7,
        ph: Math.random() * TAU,
        z0: 0,
        delay: 0.35 + u * 0.5,
        layer: 2,
      });
    }

    // 地面积雪：树根周围散开的冷光尘
    const groundN = narrow ? 90 : 170;
    for (let i = 0; i < groundN; i++) {
      const a = Math.random() * TAU;
      const rr = TREE.radius * (0.25 + Math.pow(Math.random(), 0.7) * 1.55);
      parts.push({
        ang: a,
        rad: rr,
        y: -half - Math.random() * 0.02,
        u: 0,
        sprite: Math.random() < 0.3 ? SPR.mint : SPR.snow,
        size: 0.02 + Math.random() * 0.035,
        a: 0.12 + Math.random() * 0.14,
        tw: 0.4 + Math.random() * 1.2,
        ph: Math.random() * TAU,
        z0: 0,
        delay: 0.1 + Math.random() * 0.4,
        layer: 3,
      });
    }

    // 按精灵分桶：加色混合与绘制顺序无关，分组后每帧只切换 7 次贴图
    buckets = SPRITE_LIST.map(() => []);
    for (let i = 0; i < parts.length; i++) {
      buckets[SPRITE_IDX.get(parts[i].sprite)].push(parts[i]);
    }
  }

  function buildSnow() {
    flakes = [];
    const n = W < 760 ? 150 : 300;
    for (let i = 0; i < n; i++) {
      flakes.push({
        x: Math.random(),
        y: Math.random(),
        z: Math.random(),
        r: 0.4 + Math.random() * 1.5,
        sp: 0.0016 + Math.random() * 0.0055,
        sway: Math.random() * TAU,
        swaySp: 0.35 + Math.random() * 1.1,
        a: 0.1 + Math.random() * 0.45,
      });
    }
    bokeh = [];
    for (let i = 0; i < (W < 760 ? 16 : 34); i++) {
      bokeh.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.05 + Math.random() * 0.16,
        sp: 0.00006 + Math.random() * 0.00022,
        ph: Math.random() * TAU,
        a: 0.02 + Math.random() * 0.05,
        sprite: Math.random() < 0.5 ? SPR.mint : SPR.gold,
      });
    }
  }

  /* ── 尺寸 ─────────────────────────────────────────────────── */
  let resizeTimer = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const narrow = W < 760;
    fit = narrow ? Math.min(W * 0.47, H * 0.31) : Math.min(H * 0.36, W * 0.32);
    cx = W * 0.5;
    cy = narrow ? H * 0.4 : H * 0.47;

    buildSnow();
  }

  /* ── 交互状态 ─────────────────────────────────────────────── */
  let time = 0;
  let baseRot = 0;
  let mx = 0, my = 0, tmx = 0, tmy = 0;
  let last = performance.now();
  let reduced = motionQuery.matches;
  let slowFrames = 0;
  let degraded = false;
  // ?quality=high 可强制满血粒子数（默认在弱设备上自动降级）
  const forceHigh = new URLSearchParams(location.search).get('quality') === 'high';

  window.addEventListener('pointermove', (e) => {
    tmx = (e.clientX / W) * 2 - 1;
    tmy = (e.clientY / H) * 2 - 1;
  }, { passive: true });

  window.addEventListener('pointerleave', () => { tmx = 0; tmy = 0; }, { passive: true });

  motionQuery.addEventListener('change', (e) => { reduced = e.matches; });

  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { resize(); buildParticles(); }, 160);
  });

  /* ── 绘制 ─────────────────────────────────────────────────── */
  function drawBokeh(t) {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of bokeh) {
      b.y -= b.sp * 16;
      b.x += Math.sin(t * 0.13 + b.ph) * 0.06;
      if (b.y < -0.2 * H) { b.y = H * 1.1; b.x = Math.random() * W; }
      const s = b.r * Math.min(W, H) * 2;
      ctx.globalAlpha = b.a * (0.6 + 0.4 * Math.sin(t * 0.5 + b.ph));
      ctx.drawImage(b.sprite, b.x - s / 2, b.y - s / 2, s, s);
    }
  }

  function drawSnow(t, dtF, near) {
    ctx.globalCompositeOperation = 'lighter';
    const scale = Math.max(0.85, Math.min(W, H) / 900);
    for (const f of flakes) {
      if ((f.z >= 0.45) !== near) continue;
      const sx = f.x * W + Math.sin(t * f.swaySp + f.sway) * 16;
      const sy = f.y * H;
      const s = (0.7 + f.z * 2.9) * f.r * scale;
      ctx.globalAlpha = f.a * (0.3 + f.z * 0.8);
      ctx.drawImage(SPR.snow, sx - s, sy - s, s * 2, s * 2);
    }
    void dtF;
  }

  function drawTree() {
    ctx.globalCompositeOperation = 'lighter';

    // 减弱动效时直接呈现最终画面，避免"永远停在入场第 0 帧"
    const intro = reduced ? 99 : Math.max(0, time - 0.15);
    const breathe = 1 + Math.sin(time * 0.55) * 0.008;
    const cosR = Math.cos(baseRot + mx * 0.55);
    const sinR = Math.sin(baseRot + mx * 0.55);
    const shiftY = -my * 16;
    const fov = TREE.fov;

    // 树体内的暖光核心，让体积"亮起来"
    if (intro > 0.4) {
      const ie = easeOutCubic(clamp01((intro - 0.4) / 1.1));
      const r = fit * 0.62;
      const gy = cy - my * 16;
      const ig = ctx.createRadialGradient(cx, gy, 0, cx, gy, r);
      ig.addColorStop(0, 'rgba(255,214,158,0.10)');
      ig.addColorStop(0.45, 'rgba(150,255,214,0.045)');
      ig.addColorStop(1, 'rgba(80,180,170,0)');
      ctx.globalAlpha = ie;
      ctx.save();
      ctx.translate(cx, gy);
      ctx.scale(1, 1.5);
      ctx.translate(-cx, -gy);
      ctx.fillStyle = ig;
      ctx.fillRect(cx - r, gy - r, r * 2, r * 2);
      ctx.restore();
    }

    for (let b = 0; b < buckets.length; b++) {
      const sprite = SPRITE_LIST[b];
      const bucket = buckets[b];
      for (let i = 0; i < bucket.length; i++) {
      const p = bucket[i];

      // 入场：由下往上逐层生长
      const e = clamp01((intro - p.delay) / 0.8);
      if (e <= 0) continue;
      const ee = easeOutCubic(e);

      // 每颗粒子独立的轻微摆动，让"松针"有呼吸感
      const sway = Math.sin(time * 0.6 + p.u * 3.1 + p.ang * 0.4) * 0.028;
      const a = p.ang + sway;
      const rad = p.rad * breathe;

      const x0 = Math.cos(a) * rad;
      const z0 = Math.sin(a) * rad;

      const xr = x0 * cosR - z0 * sinR;
      const zr = x0 * sinR + z0 * cosR;

      const d = fov + zr;
      if (d < 0.2) continue;
      const s = fov / d;

      const sx = cx + xr * s * fit;
      const sy = cy - (p.y * s + p.z0) * fit + shiftY + (1 - ee) * 26;

      if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) continue;

      const twk = 0.5 + 0.5 * Math.sin(time * p.tw + p.ph);
      // 远侧粒子压暗，树体才有实体感
      const depth = 0.4 + 0.6 * clamp01((s - 0.8) / 0.44);
      let glow = p.a * (0.42 + 0.58 * twk) * ee * depth;

      // 灯串上流动的光波
      if (p.layer === 1) {
        const wave = 0.5 + 0.5 * Math.sin(p.u * TAU * 2.5 - time * 2.1);
        glow *= 0.5 + 0.95 * wave * wave;
      }

      if (glow <= 0.004) continue;

      const sz = p.size * fit * s * (0.92 + 0.12 * twk);
      ctx.globalAlpha = glow > 1 ? 1 : glow;
      ctx.drawImage(sprite, sx - sz * 0.5, sy - sz * 0.5, sz, sz);
      }
    }
  }

  function drawGroundGlow() {
    const y = cy + (TREE.height / 2) * fit;
    const r = fit * 1.5;
    const g = ctx.createRadialGradient(cx, y, 0, cx, y, r);
    g.addColorStop(0, 'rgba(120,255,206,0.10)');
    g.addColorStop(0.42, 'rgba(80,200,190,0.045)');
    g.addColorStop(1, 'rgba(40,120,140,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(cx, y);
    ctx.scale(1, 0.3);
    ctx.translate(-cx, -y);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  function drawStar() {
    const intro = reduced ? 99 : Math.max(0, time - 0.15);
    const e = clamp01((intro - 0.75) / 0.9);
    if (e <= 0) return;
    const ee = easeOutCubic(e);

    const y = TREE.height / 2 + 0.075;
    const sy = cy - y * fit - my * 16;
    const pulse = 1 + Math.sin(time * 1.15) * 0.045 + Math.sin(time * 2.7) * 0.015;
    const s = fit * 0.62 * pulse * ee;

    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.translate(cx, sy);
    ctx.rotate(time * 0.035);
    ctx.globalAlpha = 0.85 * ee;
    ctx.drawImage(FLARE, -s / 2, -s / 2, s, s);
    ctx.restore();

    // 星芒外的一层柔和光晕
    const halo = fit * 0.9 * pulse;
    ctx.globalAlpha = 0.3 * ee;
    ctx.drawImage(FLARE, cx - halo / 2, sy - halo / 2, halo, halo);
  }

  /* ── 点击迸出的心愿星火 ───────────────────────────────────── */
  const sparks = [];

  function burst(x, y) {
    if (reduced) return;
    if (sparks.length > 260) return;
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.4;
      const speed = 0.6 + Math.random() * 2.6;
      sparks.push({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 0.5,
        life: 1,
        decay: 0.008 + Math.random() * 0.012,
        size: 0.028 + Math.random() * 0.05,
        sprite: Math.random() < 0.4 ? SPR.snow : Math.random() < 0.6 ? SPR.gold : SPR.mint,
      });
    }
  }

  function drawSparks(dtF) {
    if (!sparks.length) return;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= s.decay * dtF;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      s.x += s.vx * dtF;
      s.y += s.vy * dtF;
      s.vx *= 0.985;
      s.vy = s.vy * 0.985 + 0.006;
      const k = s.life * s.life;
      const sz = s.size * fit * (0.7 + 0.9 * k);
      ctx.globalAlpha = 0.85 * k;
      ctx.drawImage(s.sprite, s.x - sz * 0.5, s.y - sz * 0.5, sz, sz);
    }
  }

  /* ── 主循环 ───────────────────────────────────────────────── */
  function frame(now) {
    const raw = (now - last) / 1000;
    const dt = Math.min(raw > 0 ? raw : 0.016, 0.05);
    last = now;
    const dtF = dt * 60;

    if (!forceHigh && raw > 0.028 && raw < 0.4) {
      if (++slowFrames > 45 && !degraded) {
        degraded = true;
        quality = 0.7;
        buildParticles();
      }
    } else if (slowFrames > 0) {
      slowFrames--;
    }

    if (!reduced) {
      time += dt;
      baseRot += dt * 0.115;
    }

    // 鼠标视差缓动
    mx += (tmx - mx) * Math.min(1, dt * 3.4);
    my += (tmy - my) * Math.min(1, dt * 3.4);

    // 雪花
    if (!reduced) {
      for (const f of flakes) {
        f.y += (0.0007 + f.z * 0.0024) * dtF * (0.55 + f.z);
        f.x += Math.sin(time * f.swaySp * 0.6 + f.sway) * 0.00022 * dtF;
        if (f.y > 1.06) { f.y = -0.06; f.x = Math.random(); }
        if (f.x > 1.04) f.x -= 1.08;
        if (f.x < -0.04) f.x += 1.08;
      }
    }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (!reduced) drawBokeh(time);
    drawGroundGlow();
    drawSnow(time, dtF, false);
    drawTree();
    drawStar();
    drawSparks(dtF);
    drawSnow(time, dtF, true);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    requestAnimationFrame(frame);
  }

  /* ── 八音盒（WebAudio 合成，无外部音频文件） ────────────────── */
  const NOTE = {
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
    G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33,
  };
  const MELODY = [
    ['E4', 1], ['E4', 1], ['E4', 2],
    ['E4', 1], ['E4', 1], ['E4', 2],
    ['E4', 1], ['G4', 1], ['C4', 1.5], ['D4', 0.5], ['E4', 4],
    ['F4', 1], ['F4', 1], ['F4', 1.5], ['F4', 0.5],
    ['F4', 1], ['E4', 1], ['E4', 1], ['E4', 0.5], ['E4', 0.5],
    ['E4', 1], ['D4', 1], ['D4', 1], ['E4', 1],
    ['D4', 2], ['G4', 2],
    ['E4', 1], ['E4', 1], ['E4', 2],
    ['E4', 1], ['E4', 1], ['E4', 2],
    ['E4', 1], ['G4', 1], ['C4', 1.5], ['D4', 0.5], ['E4', 4],
    ['F4', 1], ['F4', 1], ['F4', 1.5], ['F4', 0.5],
    ['F4', 1], ['E4', 1], ['E4', 1], ['E4', 0.5], ['E4', 0.5],
    ['G4', 1], ['G4', 1], ['F4', 1], ['D4', 1],
    ['C4', 4],
  ];
  const BEAT = 0.44;

  const soundBtn = document.getElementById('sound');
  let ac = null, master = null, wet = null;
  let playing = false, noteIdx = 0, nextNoteAt = 0, schedulerId = 0;

  function initAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();

    master = ac.createGain();
    master.gain.value = 0;

    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;

    const delay = ac.createDelay(1);
    delay.delayTime.value = 0.26;
    const fb = ac.createGain();
    fb.gain.value = 0.28;
    wet = ac.createGain();
    wet.gain.value = 0.3;

    master.connect(lp);
    lp.connect(ac.destination);
    lp.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(ac.destination);
    return true;
  }

  function bell(freq, when, dur) {
    const g = ac.createGain();
    g.connect(master);
    g.connect(wet);

    const decay = Math.min(1.9, Math.max(0.6, dur * 1.5));
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.26, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);

    const fundamental = ac.createOscillator();
    fundamental.type = 'sine';
    fundamental.frequency.value = freq;

    const shimmer = ac.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.value = freq * 3.01;
    const shimmerGain = ac.createGain();
    shimmerGain.gain.value = 0.16;
    shimmer.connect(shimmerGain);
    shimmerGain.connect(g);

    const body = ac.createOscillator();
    body.type = 'triangle';
    body.frequency.value = freq * 2;
    const bodyGain = ac.createGain();
    bodyGain.gain.value = 0.08;
    body.connect(bodyGain);
    bodyGain.connect(g);

    fundamental.connect(g);
    fundamental.start(when);
    shimmer.start(when);
    body.start(when);

    const stop = when + decay + 0.05;
    fundamental.stop(stop);
    shimmer.stop(stop);
    body.stop(stop);
  }

  function scheduler() {
    if (!playing || !ac) return;
    while (nextNoteAt < ac.currentTime + 1.4) {
      const [name, beats] = MELODY[noteIdx];
      bell(NOTE[name], nextNoteAt, beats * BEAT);
      nextNoteAt += beats * BEAT;
      noteIdx = (noteIdx + 1) % MELODY.length;
    }
    schedulerId = window.setTimeout(scheduler, 420);
  }

  function setPlaying(on) {
    if (!ac && !initAudio()) return;
    playing = on;

    if (on) {
      if (ac.state === 'suspended') ac.resume();
      nextNoteAt = ac.currentTime + 0.12;
      master.gain.cancelScheduledValues(ac.currentTime);
      master.gain.setTargetAtTime(0.5, ac.currentTime, 0.9);
      scheduler();
      soundBtn.setAttribute('aria-pressed', 'true');
      soundBtn.setAttribute('aria-label', '关闭八音盒音乐');
    } else {
      master.gain.cancelScheduledValues(ac.currentTime);
      master.gain.setTargetAtTime(0, ac.currentTime, 0.25);
      window.clearTimeout(schedulerId);
      soundBtn.setAttribute('aria-pressed', 'false');
      soundBtn.setAttribute('aria-label', '开启八音盒音乐');
    }
  }

  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    burst(e.clientX, e.clientY);
  }, { passive: true });

  soundBtn.addEventListener('click', () => setPlaying(!playing));

  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) {
      if (playing) setPlaying(false);
    }
  });

  /* ── 启动 ─────────────────────────────────────────────────── */
  resize();
  buildParticles();
  requestAnimationFrame(frame);
})();
