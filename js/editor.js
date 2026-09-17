'use strict';
/* =====================================================================
   StickMotion Studio — editor.js
   Canvas, kamera, gesty, pozowanie IK, odtwarzanie, eksport. Start aplikacji.
   ===================================================================== */
(function () {
  const C = AB.core;
  const U = AB.ui;
  const $ = U.$;

  /* ---------- stan ---------- */
  const state = AB.state = {
    scene: null,
    selId: null,
    frame: 0,
    playing: false,
    loop: true,
    playT: 0,
    cam: { cx: 640, cy: 360, rel: 1 },
    exporting: false,
  };
  const selObj = () => state.scene.objects.find(o => o.id === state.selId) || null;

  let needsDraw = true, needsTL = true;
  const undoStack = [], redoStack = [];
  const snap = () => JSON.stringify(state.scene);
  function commit(pre) {
    if (snap() === pre) return;
    undoStack.push(pre);
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    updateUndoUI();
  }
  function act(fn) { const pre = snap(); fn(); commit(pre); scheduleSave(); }
  function updateUndoUI() {
    $('btnUndo').toggleAttribute('disabled', !undoStack.length);
    $('btnRedo').toggleAttribute('disabled', !redoStack.length);
  }

  /* ---------- zapis ---------- */
  let saveTimer = 0;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => C.saveAutosave(state.scene), 700);
  }
  function flushSave() { clearTimeout(saveTimer); C.saveAutosave(state.scene); }

  /* ---------- widok / canvas ---------- */
  const V = { cv: null, ctx: null, W: 300, H: 200, dpr: 1, rect: null, bg: null };
  const SP0 = { a: [] }, SP1 = { a: [] }, SPp = { a: [] }, SPn = { a: [] };
  const JX = new Float64Array(11), JY = new Float64Array(11);
  const IKOUT = [0, 0];
  const HANDLES = [['head', 2], ['handL', 4], ['handR', 6], ['footL', 8], ['footR', 10], ['root', 0]];

  const fitScale = () => Math.min(V.W / C.WORLD.w, V.H / C.WORLD.h) * 0.97;
  const camZ = () => fitScale() * state.cam.rel;
  function toWorld(x, y) {
    const z = camZ();
    return { x: (x - V.W / 2) / z + state.cam.cx, y: (y - V.H / 2) / z + state.cam.cy };
  }
  function toScreenX(wx, z) { return (wx - state.cam.cx) * z + V.W / 2; }
  function toScreenY(wy, z) { return (wy - state.cam.cy) * z + V.H / 2; }

  function resize() {
    const r = V.cv.getBoundingClientRect();
    V.rect = r; V.W = r.width; V.H = r.height;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (V.W * V.H * dpr * dpr > 3200000) dpr = Math.max(1, Math.sqrt(3200000 / (V.W * V.H)));
    V.dpr = dpr;
    V.cv.width = Math.max(1, Math.round(V.W * dpr));
    V.cv.height = Math.max(1, Math.round(V.H * dpr));
    needsDraw = true;
  }
  function setAppH() {
    document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
  }
  function fit() { state.cam.cx = 640; state.cam.cy = 360; state.cam.rel = 1; needsDraw = true; }

  /* ---------- tło (cache offscreen) ---------- */
  const mctx = document.createElement('canvas').width ? document.createElement('canvas').getContext('2d') : null;
  function rebuildBg() {
    if (!V.bg) { V.bg = document.createElement('canvas'); V.bg.width = 1280; V.bg.height = 720; }
    const c = V.bg.getContext('2d');
    const s = state.scene;
    const pre = C.BG_PRESETS[s.bg.preset] || null;
    const top = pre ? pre.a : s.bg.color, bot = pre ? pre.b : s.bg.color;
    const g = c.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    c.fillStyle = g; c.fillRect(0, 0, 1280, 720);
    if (pre && pre.stars) {
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      c.fillStyle = 'rgba(255,255,255,.85)';
      for (let i = 0; i < 70; i++) {
        const x = rnd() * 1280, y = rnd() * 480, r = rnd() * 1.6 + 0.5;
        c.globalAlpha = 0.25 + rnd() * 0.7;
        c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      }
      c.globalAlpha = 1;
    }
    if (s.grid) {
      c.strokeStyle = pre && pre.dark ? 'rgba(255,255,255,.09)' : 'rgba(40,60,90,.10)';
      c.lineWidth = 1;
      c.beginPath();
      for (let x = 80; x < 1280; x += 80) { c.moveTo(x, 0); c.lineTo(x, 720); }
      for (let y = 80; y < 720; y += 80) { c.moveTo(0, y); c.lineTo(1280, y); }
      c.stroke();
    }
    if (s.floor) {
      const ink = pre ? pre.ink : '#3a4351';
      c.fillStyle = ink;
      c.globalAlpha = 0.07;
      c.fillRect(0, C.WORLD.floorY, 1280, 720 - C.WORLD.floorY);
      c.globalAlpha = 0.8;
      c.fillRect(0, C.WORLD.floorY - 2, 1280, 3.5);
      c.globalAlpha = 1;
    }
  }

  /* ---------- rysowanie obiektów ---------- */
  const shadeCache = new Map();
  function shade(hex, amt) {
    const key = hex + amt;
    let v = shadeCache.get(key);
    if (v) return v;
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g2 = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    v = 'rgb(' + r + ',' + g2 + ',' + b + ')';
    shadeCache.set(key, v);
    return v;
  }

  const measureCache = new Map();
  function textWidth(text, px) {
    const key = text + '@' + px;
    let w = measureCache.get(key);
    if (w == null) {
      mctx.font = '700 ' + px + 'px system-ui,sans-serif';
      w = mctx.measureText(text).width;
      if (measureCache.size > 300) measureCache.clear();
      measureCache.set(key, w);
    }
    return w;
  }
  function bubbleDims(o, p) {
    const fs = Math.max(9, 22 * p.s);
    const tw = textWidth(o.text || '…', Math.round(fs));
    const w = Math.min(640, Math.max(74 * p.s, tw + 30 * p.s));
    return { w, h: 48 * p.s, fs };
  }

  function face(ctx, r, dark) {
    ctx.fillStyle = dark; ctx.strokeStyle = dark;
    ctx.beginPath();
    ctx.arc(-r * 0.32, -r * 0.12, r * 0.11, 0, 7);
    ctx.arc(r * 0.32, -r * 0.12, r * 0.11, 0, 7);
    ctx.fill();
    ctx.lineWidth = Math.max(1.4, r * 0.14);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, r * 0.12, r * 0.38, 0.35, Math.PI - 0.35);
    ctx.stroke();
  }

  function drawRig(ctx, o, p, tint) {
    const rig = C.RIGS[o.type], s = p.s;
    C.computeJoints(o, p, JX, JY);
    const main = tint || o.color;
    const back = tint || shade(o.color, -26);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const lw = Math.max(2.5, rig.width * s);

    // kończyny dalsze (ciemniejsze)
    ctx.strokeStyle = back; ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(JX[0], JY[0]); ctx.lineTo(JX[7], JY[7]); ctx.lineTo(JX[8], JY[8]);
    ctx.moveTo(JX[1], JY[1]); ctx.lineTo(JX[3], JY[3]); ctx.lineTo(JX[4], JY[4]);
    ctx.stroke();

    // tułów + kończyny bliższe
    ctx.strokeStyle = main;
    ctx.beginPath();
    ctx.moveTo(JX[0], JY[0]); ctx.lineTo(JX[9], JY[9]); ctx.lineTo(JX[10], JY[10]);
    ctx.moveTo(JX[1], JY[1]); ctx.lineTo(JX[5], JY[5]); ctx.lineTo(JX[6], JY[6]);
    ctx.moveTo(JX[0], JY[0]); ctx.lineTo(JX[1], JY[1]);
    ctx.stroke();

    // głowa (w lokalnym układzie: obrót + odbicie)
    const r = rig.headR * s;
    const worldHead = p.flip ? Math.PI - p.a[1] : p.a[1];
    ctx.save();
    ctx.translate(JX[2], JY[2]);
    ctx.rotate(worldHead + Math.PI / 2);
    if (rig.ponytail) {
      ctx.strokeStyle = main; ctx.lineWidth = Math.max(2, r * 0.3);
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.15);
      ctx.quadraticCurveTo(-r * 1.55, 0, -r * 1.3, r * 0.95);
      ctx.moveTo(-r * 0.5, r * 0.1);
      ctx.quadraticCurveTo(-r * 1.35, r * 0.3, -r * 0.9, r * 1.1);
      ctx.stroke();
    }
    ctx.fillStyle = main;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    if (o.face && !tint) face(ctx, r, '#222838');
    ctx.restore();
  }

  function drawBall(ctx, o, p, tint) {
    const r = C.RIGS.ball.r * p.s;
    const main = tint || o.color;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a[0] || 0);
    ctx.fillStyle = main;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.strokeStyle = shade(o.color, -30); ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = Math.max(2, r * 0.16); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.62, -2.3, -1.35); ctx.stroke();
    if (o.face && !tint) face(ctx, r * 0.9, '#222838');
    ctx.restore();
  }

  function drawBox(ctx, o, p, tint) {
    const w = C.RIGS.box.w * p.s, h = C.RIGS.box.h * p.s;
    const main = tint || o.color;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a[0] || 0);
    U.rr(ctx, -w / 2, -h / 2, w, h, Math.min(10 * p.s, w * 0.14));
    ctx.fillStyle = main; ctx.fill();
    ctx.strokeStyle = shade(o.color, -34); ctx.lineWidth = Math.max(1.6, 3 * p.s);
    ctx.stroke();
    ctx.strokeStyle = shade(o.color, -22); ctx.lineWidth = Math.max(1.2, 2.2 * p.s);
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 7 * p.s, 0); ctx.lineTo(w / 2 - 7 * p.s, 0);
    ctx.moveTo(0, -h / 2 + 7 * p.s); ctx.lineTo(0, h / 2 - 7 * p.s);
    ctx.stroke();
    ctx.restore();
  }

  function drawBubble(ctx, o, p, tint) {
    const d = bubbleDims(o, p);
    const x = p.x, y = p.y, s = p.s;
    ctx.save();
    if (tint) ctx.globalAlpha *= 0.85;
    // ogonek
    const tx = x - d.w * 0.22;
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#2a3040';
    ctx.lineWidth = Math.max(1.5, 3 * s);
    ctx.beginPath();
    ctx.moveTo(tx - 8 * s, y + d.h / 2 - 2);
    ctx.lineTo(tx - 6 * s, y + d.h / 2 + 15 * s);
    ctx.lineTo(tx + 12 * s, y + d.h / 2 - 2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // bańka
    U.rr(ctx, x - d.w / 2, y - d.h / 2, d.w, d.h, Math.min(18 * s, d.h / 2));
    ctx.fill(); ctx.stroke();
    // tekst
    ctx.fillStyle = '#20263a';
    ctx.font = '700 ' + d.fs.toFixed(1) + 'px system-ui,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.text || '…', x, y + 1);
    ctx.restore();
  }

  function drawObject(ctx, o, p, alpha, tint) {
    ctx.globalAlpha = alpha;
    const kind = C.RIGS[o.type].kind;
    if (kind === 'char') drawRig(ctx, o, p, tint);
    else if (kind === 'ball') drawBall(ctx, o, p, tint);
    else if (kind === 'box') drawBox(ctx, o, p, tint);
    else drawBubble(ctx, o, p, tint);
    ctx.globalAlpha = 1;
  }

  function drawWorld(ctx, f, onion) {
    ctx.drawImage(V.bg, 0, 0);
    const s = state.scene;
    if (onion && s.onion > 0) {
      for (let dir = -1; dir <= 1; dir += 2) {
        for (let d = 1; d <= s.onion; d++) {
          const gf = f + dir * d;
          if (gf < 0 || gf >= s.duration) continue;
          const alpha = (dir < 0 ? 0.30 : 0.26) / d;
          const tint = dir < 0 ? '#ff5d5d' : '#3ddc84';
          const sp = dir < 0 ? SPp : SPn;
          for (const o of s.objects) {
            const ks = o.keys;
            let ok = false;
            if (dir < 0) { for (const k of ks) if (k.f <= gf) { ok = true; break; } }
            else { for (const k of ks) if (k.f >= gf) { ok = true; break; } }
            if (!ok) continue;
            C.poseAt(o, gf, sp);
            drawObject(ctx, o, sp, alpha, tint);
          }
        }
      }
    }
    for (const o of s.objects) {
      C.poseAt(o, f, SP0);
      drawObject(ctx, o, SP0, 1, null);
    }
  }

  function draw() {
    const ctx = V.ctx, z = camZ();
    ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    ctx.clearRect(0, 0, V.W, V.H);
    ctx.save();
    ctx.translate(V.W / 2, V.H / 2);
    ctx.scale(z, z);
    ctx.translate(-state.cam.cx, -state.cam.cy);
    ctx.beginPath(); ctx.rect(0, 0, 1280, 720); ctx.clip();
    drawWorld(ctx, state.frame, !state.playing);
    ctx.restore();
    // ramka świata (tylko edytor)
    ctx.strokeStyle = 'rgba(255,255,255,.09)';
    ctx.lineWidth = 1;
    ctx.strokeRect(toScreenX(0, z) + 0.5, toScreenY(0, z) + 0.5, 1280 * z - 1, 720 * z - 1);
    if (!state.scene.objects.length) {
      ctx.fillStyle = '#5d6579';
      ctx.font = '600 15px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Dotknij „＋ Postać”, aby dodać bohatera 🎬', V.W / 2, V.H / 2 - 10);
      ctx.font = '500 12px system-ui';
      ctx.fillText('albo odtwórz scenę demo ▶', V.W / 2, V.H / 2 + 12);
    }
    if (state.selId && !state.playing) drawHandles(z);
  }

  const HPOS = new Float64Array(14); // 6 par: głowa, l/r dłoń, l/r stopa, root
  function handlePositions(z) {
    const o = selObj();
    if (!o) return null;
    const p = C.poseAt(o, state.frame, SP1);
    if (C.RIGS[o.type].kind === 'char') {
      C.computeJoints(o, p, JX, JY);
      for (let i = 0; i < 6; i++) {
        HPOS[i * 2] = toScreenX(JX[HANDLES[i][1]], z);
        HPOS[i * 2 + 1] = toScreenY(JY[HANDLES[i][1]], z);
      }
    } else {
      HPOS[0] = toScreenX(p.x, z); HPOS[1] = toScreenY(p.y, z);
      HPOS[2] = HPOS[3] = HPOS[4] = HPOS[5] = HPOS[6] = HPOS[7] = HPOS[8] = HPOS[9] = HPOS[10] = HPOS[11] = NaN;
    }
    return p;
  }

  function drawHandles(z) {
    const o = selObj();
    handlePositions(z);
    const ctx = V.ctx;
    const dragPart = drag && drag.mode === 'obj' ? drag.part : null;
    for (let i = 0; i < 6; i++) {
      const sx = HPOS[i * 2], sy = HPOS[i * 2 + 1];
      if (isNaN(sx)) continue;
      const isRoot = HANDLES[i][0] === 'root';
      const active = dragPart === HANDLES[i][0];
      ctx.beginPath();
      if (isRoot) U.rr(ctx, sx - 8, sy - 8, 16, 16, 5);
      else ctx.arc(sx, sy, active ? 9 : 7.5, 0, 7);
      ctx.fillStyle = active ? '#8b7cf6' : 'rgba(255,255,255,.96)';
      ctx.fill();
      ctx.strokeStyle = '#8b7cf6'; ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  /* ---------- wskazywanie ---------- */
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const x = ax + t * dx, y = ay + t * dy;
    return Math.hypot(px - x, py - y);
  }

  function pick(px, py) {
    const z = camZ();
    // 1) uchwyty zaznaczonego obiektu
    if (state.selId) {
      const so = selObj();
      const isProp = C.RIGS[so.type].kind !== 'char';
      handlePositions(z);
      for (let i = 0; i < 6; i++) {
        const sx = HPOS[i * 2], sy = HPOS[i * 2 + 1];
        if (isNaN(sx)) continue;
        if (Math.hypot(px - sx, py - sy) <= 21) {
          const part = (isProp && HANDLES[i][0] !== 'root') ? 'root' : HANDLES[i][0];
          return { obj: so, part };
        }
      }
    }
    const w = toWorld(px, py);
    const objs = state.scene.objects;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      const p = C.poseAt(o, state.frame, SP1);
      const kind = C.RIGS[o.type].kind;
      if (kind === 'char') {
        C.computeJoints(o, p, JX, JY);
        const hr = C.RIGS[o.type].headR * p.s + 10 / z;
        if (Math.hypot(w.x - JX[2], w.y - JY[2]) <= hr) return { obj: o, part: 'body' };
        const th = 11 / z;
        if (segDist(w.x, w.y, JX[0], JY[0], JX[1], JY[1]) <= th) return { obj: o, part: 'body' };
        if (segDist(w.x, w.y, JX[0], JY[0], JX[7], JY[7]) <= th) return { obj: o, part: 'body' };
        if (segDist(w.x, w.y, JX[7], JY[7], JX[8], JY[8]) <= th) return { obj: o, part: 'body' };
        if (segDist(w.x, w.y, JX[0], JY[0], JX[9], JY[9]) <= th) return { obj: o, part: 'body' };
        if (segDist(w.x, w.y, JX[9], JY[9], JX[10], JY[10]) <= th) return { obj: o, part: 'body' };
        if (segDist(w.x, w.y, JX[1], JY[1], JX[3], JY[3]) <= th) return { obj: o, part: 'body' };
        if (segDist(w.x, w.y, JX[3], JY[3], JX[4], JY[4]) <= th) return { obj: o, part: 'body' };
        if (segDist(w.x, w.y, JX[1], JY[1], JX[5], JY[5]) <= th) return { obj: o, part: 'body' };
        if (segDist(w.x, w.y, JX[5], JY[5], JX[6], JY[6]) <= th) return { obj: o, part: 'body' };
      } else if (kind === 'ball') {
        if (Math.hypot(w.x - p.x, w.y - p.y) <= C.RIGS.ball.r * p.s + 12 / z) return { obj: o, part: 'root' };
      } else if (kind === 'box') {
        const c = Math.cos(-(p.a[0] || 0)), sn = Math.sin(-(p.a[0] || 0));
        const lx = (w.x - p.x) * c - (w.y - p.y) * sn;
        const ly = (w.x - p.x) * sn + (w.y - p.y) * c;
        if (Math.abs(lx) <= C.RIGS.box.w * p.s / 2 + 10 / z && Math.abs(ly) <= C.RIGS.box.h * p.s / 2 + 10 / z)
          return { obj: o, part: 'root' };
      } else {
        const d = bubbleDims(o, p);
        if (Math.abs(w.x - p.x) <= d.w / 2 + 8 / z && w.y >= p.y - d.h / 2 - 8 / z && w.y <= p.y + d.h / 2 + 18 / z)
          return { obj: o, part: 'root' };
      }
    }
    return null;
  }

  /* ---------- gesty na scenie ---------- */
  const ptrs = new Map();
  let drag = null;

  function beginDrag(hit, x, y) {
    const o = hit.obj;
    const pre = snap();
    const key = C.upsertKey(o, state.frame);
    drag = {
      mode: 'obj', pre, obj: o, part: hit.part, key,
      lx: x, ly: y, w0: toWorld(x, y),
      startPX: key.pose.x, startPY: key.pose.y,
    };
    const a = key.pose.a;
    if (hit.part === 'handL') drag.side = C.bendSide(a[2], a[3], 1);
    else if (hit.part === 'handR') drag.side = C.bendSide(a[4], a[5], 1);
    else if (hit.part === 'footL') drag.side = C.bendSide(a[6], a[7], -1);
    else if (hit.part === 'footR') drag.side = C.bendSide(a[8], a[9], -1);
    needsTL = true;
  }

  function applyObjDrag(x, y) {
    const o = drag.obj, p = drag.key.pose, rig = C.RIGS[o.type];
    if (drag.part === 'root' || drag.part === 'body') {
      const t = toWorld(x, y);
      p.x = C.clamp(drag.startPX + (t.x - drag.w0.x), -150, 1430);
      p.y = C.clamp(drag.startPY + (t.y - drag.w0.y), -150, 870);
      return;
    }
    const t = toWorld(x, y);
    if (drag.part === 'head') {
      C.computeJoints(o, p, JX, JY);
      const ang = Math.atan2(t.y - JY[1], t.x - JX[1]);
      const rel = C.clamp(C.normDelta(ang + Math.PI / 2), -1.15, 1.15);
      p.a[1] = -Math.PI / 2 + rel;
      return;
    }
    if (!rig || rig.kind !== 'char') return;
    C.computeJoints(o, p, JX, JY);
    if (drag.part === 'handL' || drag.part === 'handR') {
      const u = rig.armU * p.s, l = rig.armL * p.s;
      C.solveIK(JX[1], JY[1], t.x, t.y, u, l, drag.side, IKOUT);
      p.a[drag.part === 'handL' ? 2 : 4] = IKOUT[0];
      p.a[drag.part === 'handL' ? 3 : 5] = IKOUT[1];
    } else {
      const u = rig.legU * p.s, l = rig.legL * p.s;
      C.solveIK(JX[0], JY[0], t.x, t.y, u, l, drag.side, IKOUT);
      p.a[drag.part === 'footL' ? 6 : 8] = IKOUT[0];
      p.a[drag.part === 'footL' ? 7 : 9] = IKOUT[1];
    }
  }

  function startPinch() {
    const it = ptrs.values();
    const a = it.next().value, b = it.next().value;
    drag = {
      mode: 'pinch',
      d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
      m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      cam0: { cx: state.cam.cx, cy: state.cam.cy, rel: state.cam.rel },
      z0: camZ(),
    };
  }
  function updatePinch() {
    const it = ptrs.values();
    const a = it.next().value, b = it.next().value;
    const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const rel = C.clamp(drag.cam0.rel * d / drag.d0, 0.35, 8);
    const z = fitScale() * rel;
    const wx = (drag.m0.x - V.W / 2) / drag.z0 + drag.cam0.cx;
    const wy = (drag.m0.y - V.H / 2) / drag.z0 + drag.cam0.cy;
    state.cam.rel = rel;
    state.cam.cx = C.clamp(wx - (mx - V.W / 2) / z, -420, 1700);
    state.cam.cy = C.clamp(wy - (my - V.H / 2) / z, -420, 1140);
    needsDraw = true;
  }

  function evPos(e) {
    return { x: e.clientX - V.rect.left, y: e.clientY - V.rect.top };
  }

  function onDown(e) {
    if (state.exporting) return;
    e.preventDefault();
    V.rect = V.cv.getBoundingClientRect();
    const p = evPos(e);
    V.cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, p);
    if (drag) { if (ptrs.size === 2 && drag.mode !== 'obj') startPinch(); return; }
    if (ptrs.size === 2) { startPinch(); return; }
    const hit = pick(p.x, p.y);
    if (hit) {
      if (hit.obj.id !== state.selId) select(hit.obj);
      beginDrag(hit, p.x, p.y);
    } else {
      drag = { mode: 'panmaybe', sx: p.x, sy: p.y };
    }
  }
  function onMove(e) {
    if (!ptrs.has(e.pointerId) || !drag) return;
    e.preventDefault();
    const p = evPos(e);
    ptrs.set(e.pointerId, p);
    if (drag.mode === 'pinch') { updatePinch(); return; }
    if (drag.mode === 'panmaybe') {
      if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 7) drag.mode = 'pan';
      else return;
    }
    if (drag.mode === 'pan') {
      const z = camZ();
      state.cam.cx -= (p.x - drag.lx) / z;
      state.cam.cy -= (p.y - drag.ly) / z;
      drag.lx = p.x; drag.ly = p.y;
      needsDraw = true;
      return;
    }
    if (drag.mode === 'obj') { applyObjDrag(p.x, p.y); needsDraw = true; }
  }
  function onUp(e) {
    ptrs.delete(e.pointerId);
    if (!drag) return;
    if (drag.mode === 'panmaybe') select(null);
    if (drag.mode === 'pinch' && ptrs.size < 2) { drag = null; return; }
    if (drag.mode === 'obj') { needsTL = true; }
    if (drag.pre) commit(drag.pre);
    scheduleSave();
    drag = null;
  }

  function wireStage() {
    V.cv.addEventListener('pointerdown', onDown);
    V.cv.addEventListener('pointermove', onMove);
    V.cv.addEventListener('pointerup', onUp);
    V.cv.addEventListener('pointercancel', onUp);
    V.cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = V.rect || V.cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const z0 = camZ();
      const wx = (mx - V.W / 2) / z0 + state.cam.cx;
      const wy = (my - V.H / 2) / z0 + state.cam.cy;
      state.cam.rel = C.clamp(state.cam.rel * Math.exp(-e.deltaY * 0.0012), 0.35, 8);
      const z = camZ();
      state.cam.cx = wx - (mx - V.W / 2) / z;
      state.cam.cy = wy - (my - V.H / 2) / z;
      needsDraw = true;
    }, { passive: false });
    V.cv.addEventListener('contextmenu', e => e.preventDefault());
    V.cv.addEventListener('dblclick', e => {
      const p = evPos(e);
      const hit = pick(p.x, p.y);
      if (hit && hit.obj.type === 'bubble') openTextModal(hit.obj);
    });
  }

  /* ---------- zaznaczenie / pasek narzędzi ---------- */
  function select(o) {
    state.selId = o ? o.id : null;
    U.renderChips(state.scene, selObj());
    updateSelToolbar();
    needsDraw = true; needsTL = true;
  }
  function updateSelToolbar() {
    const o = selObj(), tb = $('selToolbar');
    tb.classList.toggle('hidden', !o);
    if (!o) return;
    $('tbName').textContent = o.name;
    const kind = C.RIGS[o.type].kind;
    const show = (id, on) => $(id).style.display = on ? '' : 'none';
    show('tbColor', kind !== 'bubble');
    show('tbPose', kind === 'char');
    show('tbText', o.type === 'bubble');
    show('tbFlip', kind === 'char');
    show('tbRotL', kind === 'ball' || kind === 'box');
    show('tbRotR', kind === 'ball' || kind === 'box');
  }
  function selRequired() {
    const o = selObj();
    if (!o) U.toast('Najpierw wybierz obiekt 🙂');
    return o;
  }

  /* ---------- operacje na obiektach ---------- */
  function autoName(type) {
    const base = C.RIGS[type].label;
    const same = state.scene.objects.filter(o => o.type === type).length;
    return same ? base + ' ' + (same + 1) : base;
  }
  function addObject(type) {
    act(() => {
      const kind = C.RIGS[type].kind;
      const pos = C.spawnPos(state.scene.objects.length, kind);
      const o = C.makeObject(type, pos.x, pos.y, autoName(type), state.scene.objects.length);
      if (type === 'bubble') { o.text = 'Cześć! 👋'; pos.y = 240; o.keys[0].pose.y = 240; }
      state.scene.objects.push(o);
      state.selId = o.id;
    });
    U.renderChips(state.scene, selObj());
    updateSelToolbar();
    needsDraw = needsTL = true;
    U.toast('Dodano: ' + selObj().name + ' — przeciągnij ✋ dłonie!');
  }
  function duplicateSel() {
    const o = selRequired(); if (!o) return;
    act(() => {
      const copy = JSON.parse(JSON.stringify(o));
      copy.id = 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      copy.name = o.name + ' 2';
      for (const k of copy.keys) k.pose.x += 70;
      const i = state.scene.objects.indexOf(o);
      state.scene.objects.splice(i + 1, 0, copy);
      state.selId = copy.id;
    });
    U.renderChips(state.scene, selObj());
    updateSelToolbar();
    needsDraw = needsTL = true;
  }
  function deleteSel() {
    const o = selRequired(); if (!o) return;
    const nm = o.name;
    act(() => {
      const i = state.scene.objects.indexOf(o);
      state.scene.objects.splice(i, 1);
      state.selId = null;
    });
    U.renderChips(state.scene, null);
    updateSelToolbar();
    needsDraw = needsTL = true;
    U.toast('Usunięto: ' + nm);
  }
  function zOrder(up) {
    const o = selRequired(); if (!o) return;
    const arr = state.scene.objects, i = arr.indexOf(o);
    const j = up ? i + 1 : i - 1;
    if (j < 0 || j >= arr.length) return;
    act(() => { arr[i] = arr[j]; arr[j] = o; });
    U.renderChips(state.scene, selObj());
    needsDraw = true;
  }

  /* ---------- modale: pozy / kolory / easing / dymek ---------- */
  function buildPoses() {
    const grid = $('posesGrid');
    grid.textContent = '';
    const reset = document.createElement('button');
    reset.className = 'opt'; reset.dataset.pose = '__reset';
    reset.innerHTML = '<span class="em">↺</span>Reset';
    grid.appendChild(reset);
    for (const p of C.POSE_PRESETS) {
      const b = document.createElement('button');
      b.className = 'opt'; b.dataset.pose = p.id;
      b.innerHTML = '<span class="em">' + (p.id === 'wave' ? '👋' : p.id.startsWith('dance') ? '🕺' : p.id === 'run' ? '🏃' : '🧍') + '</span>' + p.label;
      grid.appendChild(b);
    }
    grid.addEventListener('click', e => {
      const btn = e.target.closest('[data-pose]');
      if (!btn) return;
      const o = selRequired(); if (!o) return;
      if (C.RIGS[o.type].kind !== 'char') { U.toast('Pozycje dotyczą postaci 🧍'); return; }
      act(() => {
        const k = C.upsertKey(o, state.frame);
        k.pose.a = btn.dataset.pose === '__reset'
          ? [-90, -90, 100, 95, 80, 85, 95, 88, 85, 92].map(d => d * C.D2R)
          : C.presetPose(o.type, btn.dataset.pose).a;
      });
      needsDraw = needsTL = true;
      U.closeModal('m-poses');
    });
  }
  function buildColors() {
    const grid = $('colorsGrid');
    grid.textContent = '';
    for (const c of C.OBJ_COLORS) {
      const b = document.createElement('button');
      b.className = 'sw'; b.style.background = c; b.dataset.color = c;
      grid.appendChild(b);
    }
    grid.addEventListener('click', e => {
      const btn = e.target.closest('[data-color]');
      if (!btn) return;
      const o = selRequired(); if (!o) return;
      o.color = btn.dataset.color;
      U.renderChips(state.scene, selObj());
      needsDraw = true; scheduleSave();
      U.closeModal('m-colors');
    });
    $('colorCustom').addEventListener('input', e => {
      const o = selObj(); if (!o) return;
      o.color = e.target.value;
      U.renderChips(state.scene, selObj());
      needsDraw = true; scheduleSave();
    });
  }
  const EASE_LABELS = { linear: 'Liniowo', in: 'Rozpędzanie', out: 'Hamowanie', inout: 'Płynnie', hold: 'Zamrożone' };
  function applyEase(val) {
    const o = selRequired(); if (!o) return;
    act(() => {
      let k = C.keyAt(o, state.frame);
      if (!k) { for (const kk of o.keys) { if (kk.f < state.frame) k = kk; else break; } }
      if (!k) k = o.keys[0];
      k.ease = val;
    });
    needsTL = true;
    U.toast('Wygładzanie: ' + EASE_LABELS[val] + ' ⏱️');
    U.closeModal('m-easing');
  }
  function openTextModal(o) {
    if (!o) return;
    $('bubbleText').value = o.text || '';
    $('btnTextOk').onclick = () => {
      o.text = $('bubbleText').value.trim() || '…';
      needsDraw = true; scheduleSave();
      U.closeModal('m-text');
    };
    U.openModal('m-text');
    setTimeout(() => $('bubbleText').focus(), 60);
  }

  /* ---------- odtwarzanie ---------- */
  function setPlaying(v) {
    if (v && state.scene.duration < 2) return;
    state.playing = v;
    if (v) state.playT = state.frame;
    $('btnPlay').textContent = v ? '⏸' : '▶';
    if (v) needsDraw = true;
  }
  function setFrame(f) {
    state.frame = C.clamp(Math.round(f), 0, state.scene.duration - 1);
    state.playT = state.frame;
    needsDraw = needsTL = true;
    updateFrameLabel();
  }
  function updateFrameLabel() {
    const s = state.scene;
    $('frameLabel').textContent = (state.frame + 1) + ' / ' + s.duration + ' · ' + (state.frame / s.fps).toFixed(1) + 's';
  }
  function updateLoopUI() { $('btnLoop').classList.toggle('on', state.loop); }
  function updateOnionUI() {
    const b = $('btnOnion');
    b.classList.toggle('on', state.scene.onion > 0);
    $('onionBadge').textContent = state.scene.onion > 0 ? '±' + state.scene.onion : 'off';
  }

  let lastT = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const s = state.scene;
    if (state.playing) {
      state.playT += dt * s.fps;
      let f = Math.floor(state.playT);
      if (f >= s.duration) {
        if (state.loop) { state.playT %= s.duration; f = Math.floor(state.playT); }
        else { f = s.duration - 1; setPlaying(false); }
      }
      if (f !== state.frame) { state.frame = f; needsDraw = needsTL = true; updateFrameLabel(); }
    }
    if (needsDraw) { needsDraw = false; draw(); }
    if (needsTL) { needsTL = false; U.drawTimeline(s, state.frame, selObj()); }
    requestAnimationFrame(tick);
  }

  /* ---------- eksport ---------- */
  function pickMime() {
    const list = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'];
    if (typeof MediaRecorder === 'undefined') return null;
    for (const m of list) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
    return null;
  }
  let cancelExport = null;
  function setExpUI(on) {
    ['btnExpVideo', 'btnExpShare', 'btnExpPng', 'btnExpJson'].forEach(id => $(id).toggleAttribute('disabled', on));
    $('expNote').textContent = on
      ? 'Nagrywanie w toku… możesz je przerwać przyciskiem ✕.'
      : 'Wideo renderuje się w czasie rzeczywistym (1280×720) — dla 3-sekundowej animacji poczekasz ok. 3 s. Nie zamykaj karty podczas zapisu.';
  }
  function safeName(n) { return (n || 'animacja').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'animacja'; }
  function saveBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  }
  async function shareBlob(blob, filename) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: state.scene.name });
        return true;
      }
    } catch (e) {}
    return false;
  }

  async function exportVideo(share) {
    if (state.exporting) return;
    const mime = pickMime();
    if (!mime) { U.toast('Ta przeglądarka nie nagrywa wideo 😢'); return; }
    setPlaying(false);
    state.exporting = true;
    setExpUI(true);
    const s = state.scene;
    const dur = Math.min(s.duration, 900);
    const off = document.createElement('canvas');
    off.width = 1280; off.height = 720;
    const octx = off.getContext('2d');
    drawWorldTo(octx, dur - 1);
    let rec;
    try {
      rec = new MediaRecorder(off.captureStream(s.fps), { mimeType: mime, videoBitsPerSecond: 8000000 });
    } catch (err) {
      state.exporting = false; setExpUI(false);
      U.toast('Nie udało się rozpocząć nagrywania 😕');
      return;
    }
    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(res => { rec.onstop = res; });
    let cancelled = false;
    cancelExport = () => { cancelled = true; };
    rec.start(200);
    const t0 = performance.now();
    await new Promise(res => {
      const step = () => {
        const f = Math.floor((performance.now() - t0) / 1000 * s.fps);
        if (cancelled || f >= dur) { drawWorldTo(octx, Math.min(Math.max(f, 0), dur - 1)); res(); return; }
        drawWorldTo(octx, f);
        $('expProg').style.width = (f / dur * 100).toFixed(1) + '%';
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    try { rec.stop(); } catch (e) {}
    await stopped;
    cancelExport = null;
    state.exporting = false;
    setExpUI(false);
    $('expProg').style.width = '0%';
    if (cancelled) { U.toast('Eksport anulowany'); return; }
    const ext = mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    const fname = safeName(s.name) + '.' + ext;
    if (share) { const ok = await shareBlob(blob, fname); if (!ok) { saveBlob(blob, fname); U.toast('Brak udostępniania — zapisano plik 📥'); } }
    else saveBlob(blob, fname);
    U.toast('Gotowe! 🎉 ' + (blob.size / 1048576).toFixed(1) + ' MB');
  }
  function drawWorldTo(ctx, f) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawWorld(ctx, f, false);
  }
  function exportPNG() {
    const off = document.createElement('canvas');
    off.width = 1280; off.height = 720;
    drawWorldTo(off.getContext('2d'), state.frame);
    off.toBlob(b => {
      if (b) { saveBlob(b, safeName(state.scene.name) + '_k' + (state.frame + 1) + '.png'); U.toast('Zapisano klatkę PNG 🖼️'); }
    }, 'image/png');
  }
  function exportJSON() {
    const blob = new Blob([JSON.stringify(state.scene)], { type: 'application/json' });
    saveBlob(blob, safeName(state.scene.name) + '.json');
    U.toast('Zapisano projekt 💾');
  }

  /* ---------- projekty ---------- */
  function resetView() { select(null); rebuildBg(); fit(); needsTL = true; updateFrameLabel(); updateOnionUI(); U.renderChips(state.scene, null); }
  function setScene(s) {
    state.scene = s;
    state.frame = 0; state.playT = 0; setPlaying(false);
    undoStack.length = 0; redoStack.length = 0; updateUndoUI();
    $('projName').value = s.name;
    resetView();
    flushSave();
  }
  function openProject(name) {
    const s = C.loadProject(name);
    if (!s) { U.toast('Nie udało się otworzyć projektu 😕'); return; }
    setScene(s);
    U.closeModal('m-projects');
    U.toast('Otwarto: ' + name);
  }
  function newProject() {
    const all = C.getProjects();
    const s = C.makeScene();
    s.name = 'Projekt ' + (Object.keys(all).length + 1);
    setScene(s);
    U.closeModal('m-projects');
    U.toast('Nowy projekt — dodaj postać ＋');
  }
  function deleteProject(name) {
    C.deleteProject(name);
    U.renderProjects(state.scene.name);
    U.toast('Usunięto projekt 🗑️');
  }
  function importFile(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const s = C.validateScene(JSON.parse(rd.result));
        setScene(s);
        U.toast('Zaimportowano projekt 📂');
      } catch (e) { U.toast('To nie jest plik projektu 😕'); }
    };
    rd.readAsText(file);
  }

  /* ---------- ustawienia ---------- */
  function populateSettings() {
    const s = state.scene;
    const sel = $('setFps');
    if (![...sel.options].some(o => o.value === String(s.fps))) {
      const opt = document.createElement('option');
      opt.textContent = opt.value = String(s.fps);
      sel.appendChild(opt);
    }
    sel.value = String(s.fps);
    $('setDur').value = s.duration;
    $('setOnion').value = String(s.onion);
    $('bgCustom').value = /^#[0-9a-fA-F]{6}$/.test(s.bg.color) ? s.bg.color : '#aee3ff';
    document.querySelectorAll('#bgRow [data-bg]').forEach(b =>
      b.classList.toggle('sel', b.dataset.bg === s.bg.preset));
    $('setFloor').checked = s.floor;
    $('setGrid').checked = s.grid;
  }

  /* ---------- klawiatura ---------- */
  function wireKeys() {
    window.addEventListener('keydown', e => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
        else if (k === 'y') { e.preventDefault(); doRedo(); }
        return;
      }
      switch (k) {
        case ' ': e.preventDefault(); setPlaying(!state.playing); break;
        case 'arrowleft': setFrame(state.frame - (e.shiftKey ? 10 : 1)); break;
        case 'arrowright': setFrame(state.frame + (e.shiftKey ? 10 : 1)); break;
        case 'home': setFrame(0); break;
        case 'end': setFrame(state.scene.duration - 1); break;
        case 'delete': case 'backspace': deleteSel(); break;
        case 'k': e.shiftKey ? removeKey() : addKey(); break;
        case 'f': fit(); break;
        case 'o': cycleOnion(); break;
        case 'escape':
          if (U.anyModalOpen()) U.closeAllModals();
          else select(null);
          break;
      }
    });
  }

  /* ---------- cofanie ---------- */
  function afterHistoryJump() {
    if (!selObj()) state.selId = null;
    $('projName').value = state.scene.name;
    state.frame = Math.min(state.frame, state.scene.duration - 1);
    rebuildBg();
    U.renderChips(state.scene, selObj());
    updateSelToolbar();
    needsDraw = needsTL = true;
    updateFrameLabel();
    updateOnionUI();
    scheduleSave();
  }
  function doUndo() {
    if (!undoStack.length) return;
    redoStack.push(snap());
    state.scene = C.validateScene(JSON.parse(undoStack.pop()));
    afterHistoryJump();
    updateUndoUI();
  }
  function doRedo() {
    if (!redoStack.length) return;
    undoStack.push(snap());
    state.scene = C.validateScene(JSON.parse(redoStack.pop()));
    afterHistoryJump();
    updateUndoUI();
  }

  /* ---------- klucze ---------- */
  function addKey() {
    const o = selRequired(); if (!o) return;
    act(() => C.upsertKey(o, state.frame));
    needsTL = true;
    U.toast('Klucz ◆ w klatce ' + (state.frame + 1));
  }
  function removeKey() {
    const o = selRequired(); if (!o) return;
    let done = false;
    act(() => { done = C.removeKeyAt(o, state.frame); });
    if (!done) U.toast('Brak klucza w tej klatce');
    needsTL = true;
  }
  function cycleOnion() {
    state.scene.onion = (state.scene.onion + 1) % 3;
    updateOnionUI();
    needsDraw = true;
    scheduleSave();
  }

  /* ---------- inicjalizacja ---------- */
  function init() {
    V.cv = $('stage');
    V.ctx = V.cv.getContext('2d');
    U.tlInit();
    U.wireModals();

    state.scene = C.loadAutosave() || C.makeDemoScene();
    const fresh = C.isFresh();
    $('projName').value = state.scene.name;

    // górny pasek
    $('btnUndo').addEventListener('click', doUndo);
    $('btnRedo').addEventListener('click', doRedo);
    $('btnProjects').addEventListener('click', () => { U.renderProjects(state.scene.name); U.openModal('m-projects'); });
    $('btnSettings').addEventListener('click', () => { populateSettings(); U.openModal('m-settings'); });
    $('btnExport').addEventListener('click', () => U.openModal('m-export'));
    $('btnHelp').addEventListener('click', () => U.openModal('m-help'));
    $('projName').addEventListener('input', e => {
      state.scene.name = e.target.value.slice(0, 48) || 'Projekt';
      scheduleSave();
    });

    // dodawanie
    $('btnAdd').addEventListener('click', () => U.openModal('m-add'));
    document.querySelectorAll('[data-add]').forEach(b =>
      b.addEventListener('click', () => { U.closeModal('m-add'); addObject(b.dataset.add); }));

    // pasek narzędzi zaznaczenia
    $('tbKeyAdd').addEventListener('click', addKey);
    $('tbKeyDel').addEventListener('click', removeKey);
    $('tbEase').addEventListener('click', () => { if (selRequired()) U.openModal('m-easing'); });
    $('tbColor').addEventListener('click', () => { if (selRequired()) U.openModal('m-colors'); });
    $('tbPose').addEventListener('click', () => { if (selRequired()) U.openModal('m-poses'); });
    $('tbText').addEventListener('click', () => openTextModal(selObj()));
    $('tbFlip').addEventListener('click', () => {
      const o = selRequired(); if (!o) return;
      act(() => { const k = C.upsertKey(o, state.frame); k.pose.flip = !k.pose.flip; });
      needsDraw = needsTL = true;
    });
    const rotateBy = deg => {
      const o = selRequired(); if (!o) return;
      act(() => { const k = C.upsertKey(o, state.frame); k.pose.a[0] = (k.pose.a[0] || 0) + deg * C.D2R; });
      needsDraw = needsTL = true;
    };
    $('tbRotL').addEventListener('click', () => rotateBy(-15));
    $('tbRotR').addEventListener('click', () => rotateBy(15));
    $('tbDup').addEventListener('click', duplicateSel);
    $('tbScaleUp').addEventListener('click', () => scaleBy(1.1));
    $('tbScaleDown').addEventListener('click', () => scaleBy(1 / 1.1));
    $('tbUp').addEventListener('click', () => zOrder(true));
    $('tbDown').addEventListener('click', () => zOrder(false));
    $('tbDel').addEventListener('click', deleteSel);

    // sterowanie
    $('btnPlay').addEventListener('click', () => setPlaying(!state.playing));
    $('btnFirst').addEventListener('click', () => { setPlaying(false); setFrame(0); });
    $('btnPrev').addEventListener('click', () => { setPlaying(false); setFrame(state.frame - 1); });
    $('btnNext').addEventListener('click', () => { setPlaying(false); setFrame(state.frame + 1); });
    $('btnLast').addEventListener('click', () => { setPlaying(false); setFrame(state.scene.duration - 1); });
    $('btnLoop').addEventListener('click', () => { state.loop = !state.loop; updateLoopUI(); });
    $('btnOnion').addEventListener('click', cycleOnion);
    $('btnFit').addEventListener('click', fit);

    // oś czasu — scrubbing
    const tl = $('timeline');
    const scrub = e => {
      const r = tl.getBoundingClientRect();
      const f = Math.round((e.clientX - r.left - U.TL.padL) / Math.max(0.05, U.TL.ppf));
      setFrame(f);
    };
    let tlScrub = false;
    tl.addEventListener('pointerdown', e => {
      e.preventDefault();
      tl.setPointerCapture(e.pointerId);
      tlScrub = true;
      setPlaying(false);
      const r = tl.getBoundingClientRect();
      const y = e.clientY - r.top;
      if (!U.TL.narrow && y > U.TL.rulerH && state.scene.objects.length) {
        const idx = Math.floor((y - U.TL.rulerH) / U.TL.rowH);
        if (idx >= 0 && idx < Math.min(state.scene.objects.length, 12)) select(state.scene.objects[idx]);
      }
      scrub(e);
    });
    tl.addEventListener('pointermove', e => { if (tlScrub) scrub(e); });
    tl.addEventListener('pointerup', () => { tlScrub = false; });
    tl.addEventListener('pointercancel', () => { tlScrub = false; });

    // pozy / kolory / easing / dymek
    buildPoses();
    buildColors();
    document.querySelectorAll('[data-ease]').forEach(b =>
      b.addEventListener('click', () => applyEase(b.dataset.ease)));

    // ustawienia
    $('setFps').addEventListener('change', e => {
      state.scene.fps = C.clamp(parseInt(e.target.value, 10) || 24, 4, 60);
      updateFrameLabel(); scheduleSave();
    });
    const setDuration = v => {
      state.scene.duration = C.clamp(Math.round(v), 2, 900);
      state.frame = Math.min(state.frame, state.scene.duration - 1);
      state.playT = state.frame;
      needsTL = true; updateFrameLabel(); scheduleSave();
    };
    $('setDur').addEventListener('change', e => setDuration(parseInt(e.target.value, 10) || 72));
    $('durPlus').addEventListener('click', () => { setDuration(state.scene.duration + state.scene.fps); populateSettings(); });
    $('durMinus').addEventListener('click', () => { setDuration(state.scene.duration - state.scene.fps); populateSettings(); });
    $('setOnion').addEventListener('change', e => { state.scene.onion = C.clamp(parseInt(e.target.value, 10) || 0, 0, 2); updateOnionUI(); needsDraw = true; scheduleSave(); });
    document.querySelectorAll('#bgRow [data-bg]').forEach(b =>
      b.addEventListener('click', () => {
        state.scene.bg.preset = b.dataset.bg;
        populateSettings(); rebuildBg(); needsDraw = true; scheduleSave();
      }));
    $('bgCustom').addEventListener('input', e => {
      state.scene.bg.preset = 'custom';
      state.scene.bg.color = e.target.value;
      document.querySelectorAll('#bgRow [data-bg]').forEach(x => x.classList.remove('sel'));
      rebuildBg(); needsDraw = true; scheduleSave();
    });
    $('setFloor').addEventListener('change', e => { state.scene.floor = e.target.checked; rebuildBg(); needsDraw = true; scheduleSave(); });
    $('setGrid').addEventListener('change', e => { state.scene.grid = e.target.checked; rebuildBg(); needsDraw = true; scheduleSave(); });

    // projekty
    $('btnProjSave').addEventListener('click', () => {
      if (!state.scene.objects.length) { U.toast('Pusty projekt — dodaj coś najpierw 🙂'); return; }
      if (C.saveProject(state.scene)) { U.renderProjects(state.scene.name); U.toast('Zapisano projekt „' + state.scene.name + '” 💾'); }
      else U.toast('Brak miejsca w pamięci przeglądarki 😕');
    });
    $('btnProjNew').addEventListener('click', newProject);
    $('btnProjImport').addEventListener('click', () => $('fileImport').click());
    $('fileImport').addEventListener('change', e => {
      if (e.target.files && e.target.files[0]) importFile(e.target.files[0]);
      e.target.value = '';
    });

    // eksport
    $('btnExpVideo').addEventListener('click', () => exportVideo(false));
    $('btnExpShare').addEventListener('click', () => exportVideo(true));
    $('btnExpPng').addEventListener('click', exportPNG);
    $('btnExpJson').addEventListener('click', exportJSON);
    document.querySelector('#m-export .close').addEventListener('click', () => { if (cancelExport) cancelExport(); });
    if (!(navigator.share && navigator.canShare)) $('btnExpShare').style.display = 'none';

    // pomoc
    $('btnHelpOk').addEventListener('click', () => { U.closeModal('m-help'); U.toast('Przeciągnij 👋 dłoń Maxa, aby go powitać!'); });

    // scena / klawiatura / zmiany rozmiaru
    wireStage();
    wireKeys();
    window.addEventListener('resize', () => { setAppH(); resize(); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { setAppH(); resize(); });
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { setPlaying(false); flushSave(); }
    });
    window.addEventListener('pagehide', flushSave);

    // start
    setAppH();
    resize();
    rebuildBg();
    updateLoopUI();
    updateOnionUI();
    updateFrameLabel();
    U.renderChips(state.scene, null);
    updateSelToolbar();
    updateUndoUI();
    if (fresh && !C.helpSeen()) {
      C.markHelpSeen();
      U.openModal('m-help');
      setTimeout(() => setPlaying(true), 900);
    } else if (fresh) {
      setTimeout(() => setPlaying(true), 600);
    }
    requestAnimationFrame(tick);
  }

  function scaleBy(f) {
    const o = selRequired(); if (!o) return;
    act(() => {
      const k = C.upsertKey(o, state.frame);
      k.pose.s = C.clamp((k.pose.s || 1) * f, 0.3, 3);
    });
    needsDraw = needsTL = true;
  }

  AB.ed = {
    selectById: id => select(state.scene.objects.find(o => o.id === id) || null),
    openProject, deleteProject,
    get state() { return state; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
