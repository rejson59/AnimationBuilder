'use strict';
/* =====================================================================
   StickMotion Studio — core.js
   Model danych, szkielety postaci, interpolacja, IK, storage. Bez DOM.
   ===================================================================== */
(function () {
  const AB = (typeof window !== 'undefined') ? (window.AB = window.AB || {}) : {};

  /* ---------- narzędzia ---------- */
  const TAU = Math.PI * 2, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  function normDelta(a) { let d = a % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; }
  function angLerp(a, b, t) { return a + normDelta(b - a) * t; }

  function easeT(kind, t) {
    switch (kind) {
      case 'in': return t * t;
      case 'out': return 1 - (1 - t) * (1 - t);
      case 'inout': return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      case 'hold': return 0;
      default: return t; // linear
    }
  }

  let _uid = 0;
  const uid = () => 'o' + (++_uid) + Math.random().toString(36).slice(2, 6);

  /* ---------- szkielety ---------- */
  // Kąty (radiany, układ ekranu: 0 = w prawo, PI/2 = w dół):
  // 0 tułów, 1 głowa, 2 lewe ramię(górne), 3 lewe ramię(dolne),
  // 4 prawe ramię(górne), 5 prawe ramię(dolne), 6 lewe udo, 7 lewy podudzie,
  // 8 prawe udo, 9 prawe podudzie.  "L" = kończyna dalsza (rysowana ciemniej).
  const DEF_A = [-90, -90, 100, 95, 80, 85, 95, 88, 85, 92].map(d => d * D2R);

  const RIGS = {
    man:    { kind: 'char', label: 'Stickman',  emoji: '🧍', headR: 17,  headOff: 20, torso: 60, armU: 38, armL: 33, legU: 50, legL: 46, width: 7.5, ponytail: false },
    girl:   { kind: 'char', label: 'Dziewczyna', emoji: '👧', headR: 17,  headOff: 20, torso: 60, armU: 38, armL: 33, legU: 50, legL: 46, width: 7.5, ponytail: true },
    kid:    { kind: 'char', label: 'Dziecko',   emoji: '🧒', headR: 16.5, headOff: 14, torso: 46, armU: 28, armL: 25, legU: 37, legL: 34, width: 7,   ponytail: false },
    ball:   { kind: 'ball',   label: 'Piłka',    emoji: '🏀', r: 34 },
    box:    { kind: 'box',    label: 'Skrzynka', emoji: '📦', w: 84, h: 60 },
    bubble: { kind: 'bubble', label: 'Dymek',    emoji: '💬' },
  };

  const OBJ_COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#51cf66', '#e599f7', '#ff922b', '#22b8cf', '#f783ac', '#a9e34b', '#ffc9c9', '#748ffc', '#63e6be'];

  const WORLD = { w: 1280, h: 720, floorY: 560 };

  const BG_PRESETS = {
    day:    { a: '#aee3ff', b: '#eaf6ff', ink: '#3a4351', dark: false, stars: false },
    sunset: { a: '#ffd3a5', b: '#ff8f70', ink: '#5b3a34', dark: false, stars: false },
    night:  { a: '#28305c', b: '#141a36', ink: '#c9d4ff', dark: true,  stars: true },
    space:  { a: '#101438', b: '#2a1650', ink: '#d5c9ff', dark: true,  stars: true },
    mint:   { a: '#c9f2e4', b: '#f0fff8', ink: '#37544a', dark: false, stars: false },
    rose:   { a: '#ffd9e6', b: '#fff6fa', ink: '#5c3a4a', dark: false, stars: false },
  };

  /* ---------- pozy startowe (stopnie) ---------- */
  const POSE_PRESETS = [
    { id: 'idle',   label: 'Spoczynek', deg: [-90, -90, 100, 95, 80, 85, 95, 88, 85, 92] },
    { id: 'wave',   label: 'Cześć! 👋', deg: [-92, -88, 100, 95, -55, -70, 95, 88, 85, 92] },
    { id: 'walkA',  label: 'Krok A',    deg: [-87, -90, 125, 145, 55, 35, -25, 85, 115, 135] },
    { id: 'walkB',  label: 'Krok B',    deg: [-87, -90, 55, 35, 125, 145, 115, 135, -25, 85] },
    { id: 'run',    label: 'Bieg 🏃',   deg: [-74, -84, 135, 175, 25, -15, -40, 15, 105, 140] },
    { id: 'jump',   label: 'Skok',      deg: [-82, -88, -115, -95, -65, -85, -30, 35, 5, 60] },
    { id: 'punch',  label: 'Cios 🥊',   deg: [-85, -88, 150, 175, 8, -2, -28, 80, 108, 122] },
    { id: 'kick',   label: 'Kopniak',   deg: [-96, -90, 155, 168, 35, 45, -65, -70, 88, 86] },
    { id: 'sit',    label: 'Siad',      deg: [-96, -92, 28, 58, -18, 12, -6, 86, 6, 88] },
    { id: 'tpose',  label: 'T-pozycja', deg: [-90, -90, 178, 178, 2, 2, 95, 88, 85, 92] },
    { id: 'dance1', label: 'Taniec 1 💃', deg: [-102, -94, -140, -165, 62, 30, 72, 98, 102, 78] },
    { id: 'dance2', label: 'Taniec 2 🕺', deg: [-78, -86, 62, 30, -140, -165, 102, 78, 72, 98] },
  ];
  function presetAngles(id) { const p = POSE_PRESETS.find(p => p.id === id); return p ? p.deg.map(d => d * D2R) : DEF_A.slice(); }

  /* ---------- pozy ---------- */
  function defaultPose(type) {
    if (RIGS[type] && RIGS[type].kind === 'char') return { x: 640, y: 464, s: 1, flip: false, a: DEF_A.slice() };
    return { x: 640, y: 500, s: 1, flip: false, a: [0] };
  }
  function copyPose(out, p) {
    out.x = p.x; out.y = p.y; out.s = p.s; out.flip = p.flip;
    out.a = p.a.slice(); return out;
  }
  function lerpPoseInto(out, p0, p1, t) {
    out.x = lerp(p0.x, p1.x, t);
    out.y = lerp(p0.y, p1.y, t);
    out.s = lerp(p0.s, p1.s, t);
    out.flip = t < 0.5 ? p0.flip : p1.flip;
    const a0 = p0.a, a1 = p1.a, n = a0.length, oa = new Array(n);
    for (let i = 0; i < n; i++) oa[i] = angLerp(a0[i], a1[i], t);
    out.a = oa; return out;
  }

  /* ---------- obiekty / scena ---------- */
  function makeObject(type, x, y, name, colorIdx) {
    const rig = RIGS[type];
    const pose = defaultPose(type);
    if (x != null) pose.x = x;
    if (y != null) pose.y = y;
    return {
      id: uid(), type,
      name: name || rig.label,
      color: OBJ_COLORS[(colorIdx || 0) % OBJ_COLORS.length],
      face: true, text: 'Cześć! 👋',
      keys: [{ f: 0, ease: 'inout', pose }],
    };
  }
  function makeScene() {
    return {
      v: 1, name: 'Nowy projekt', fps: 24, duration: 72, onion: 1,
      bg: { preset: 'day', color: '#aee3ff' }, floor: true, grid: false,
      objects: [],
    };
  }
  function spawnPos(count, kind) {
    const xs = [430, 640, 850, 540, 740, 340, 950];
    const x = xs[count % xs.length] + (count > 6 ? (count * 37) % 200 - 100 : 0);
    let y;
    if (kind === 'char') y = 464;
    else if (kind === 'ball') y = WORLD.floorY - RIGS.ball.r;
    else if (kind === 'box') y = WORLD.floorY - RIGS.box.h / 2;
    else y = 240;
    return { x, y };
  }

  /* ---------- klucze i interpolacja ---------- */
  function sortKeys(o) { o.keys.sort((a, b) => a.f - b.f); }

  function poseAt(o, f, out) {
    const ks = o.keys, n = ks.length;
    if (n === 0) return copyPose(out, defaultPose(o.type));
    if (n === 1 || f <= ks[0].f) return copyPose(out, ks[0].pose);
    const last = ks[n - 1];
    if (f >= last.f) return copyPose(out, last.pose);
    let i = 0;
    while (i < n - 2 && ks[i + 1].f <= f) i++;
    const k0 = ks[i], k1 = ks[i + 1];
    const span = Math.max(1e-6, k1.f - k0.f);
    const t = easeT(k0.ease || 'linear', clamp((f - k0.f) / span, 0, 1));
    return lerpPoseInto(out, k0.pose, k1.pose, t);
  }

  function upsertKey(o, f) {
    let k = keyAt(o, f);
    if (!k) {
      const pose = poseAt(o, f, { a: [] }); // oceń pozę PRZED wstawieniem pustego klucza
      k = { f, ease: 'inout', pose };
      o.keys.push(k);
      sortKeys(o);
    }
    return k;
  }
  function keyAt(o, f) { for (const k of o.keys) if (k.f === f) return k; return null; }
  function removeKeyAt(o, f) {
    if (o.keys.length <= 1) return false;
    const i = o.keys.findIndex(k => k.f === f);
    if (i < 0) return false;
    o.keys.splice(i, 1); return true;
  }

  /* ---------- stawy / geometria szkieletu ---------- */
  const J = { HIP: 0, NECK: 1, HEAD: 2, ELB_L: 3, HAN_L: 4, ELB_R: 5, HAN_R: 6, KNE_L: 7, FOO_L: 8, KNE_R: 9, FOO_R: 10 };

  // wypełnia JX/JY (11 par) — pozycje stawów w świecie
  function computeJoints(o, pose, JX, JY) {
    const rig = RIGS[o.type], s = pose.s, a = pose.a, fl = pose.flip;
    const A = i => fl ? Math.PI - a[i] : a[i];
    const hx = pose.x, hy = pose.y;
    JX[0] = hx; JY[0] = hy;
    const tA = A(0), cT = Math.cos(tA), sT = Math.sin(tA);
    const nx = hx + cT * rig.torso * s, ny = hy + sT * rig.torso * s;
    JX[1] = nx; JY[1] = ny;
    const hA = A(1);
    const hcx = nx + Math.cos(hA) * rig.headOff * s, hcy = ny + Math.sin(hA) * rig.headOff * s;
    JX[2] = hcx; JY[2] = hcy;
    const au = rig.armU * s, al = rig.armL * s;
    let ex = nx + Math.cos(A(2)) * au, ey = ny + Math.sin(A(2)) * au;
    JX[3] = ex; JY[3] = ey; JX[4] = ex + Math.cos(A(3)) * al; JY[4] = ey + Math.sin(A(3)) * al;
    ex = nx + Math.cos(A(4)) * au; ey = ny + Math.sin(A(4)) * au;
    JX[5] = ex; JY[5] = ey; JX[6] = ex + Math.cos(A(5)) * al; JY[6] = ey + Math.sin(A(5)) * al;
    const lu = rig.legU * s, ll = rig.legL * s;
    let kx = hx + Math.cos(A(6)) * lu, ky = hy + Math.sin(A(6)) * lu;
    JX[7] = kx; JY[7] = ky; JX[8] = kx + Math.cos(A(7)) * ll; JY[8] = ky + Math.sin(A(7)) * ll;
    kx = hx + Math.cos(A(8)) * lu; ky = hy + Math.sin(A(8)) * lu;
    JX[9] = kx; JY[9] = ky; JX[10] = kx + Math.cos(A(9)) * ll; JY[10] = ky + Math.sin(A(9)) * ll;
  }

  /* ---------- IK dwukończynowe ---------- */
  // Zwraca kąty [górny, dolny] tak, aby kończyna sięgnęła celu. side: +1/-1 strona zgięcia.
  function solveIK(sx, sy, tx, ty, u, l, side, out) {
    let dx = tx - sx, dy = ty - sy;
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-4) { d = 1e-4; dx = d; dy = 0; }
    d = clamp(d, Math.abs(u - l) + 0.01, u + l - 0.01);
    const base = Math.atan2(dy, dx);
    const cosA = clamp((u * u + d * d - l * l) / (2 * u * d), -1, 1);
    const alpha = Math.acos(cosA) * side;
    const angU = base + alpha;
    const mx = sx + Math.cos(angU) * u, my = sy + Math.sin(angU) * u;
    out[0] = angU;
    out[1] = Math.atan2(ty - my, tx - mx);
    return out;
  }
  function bendSide(aU, aL, fallback) {
    const s = Math.sign(normDelta(aL - aU));
    return s === 0 ? fallback : s;
  }

  /* ---------- walidacja / serializacja ---------- */
  function sanitizePose(p, type) {
    const def = defaultPose(type);
    if (!p || typeof p !== 'object') return def;
    const out = {
      x: +p.x || 0, y: +p.y || 0,
      s: clamp(+p.s || 1, 0.05, 10),
      flip: !!p.flip,
      a: Array.isArray(p.a) ? p.a.map(v => +v || 0) : def.a.slice(),
    };
    return out;
  }
  function validateScene(raw) {
    const s = makeScene();
    if (!raw || typeof raw !== 'object') return s;
    if (typeof raw.name === 'string') s.name = raw.name.slice(0, 80);
    s.fps = clamp(Math.round(+raw.fps) || 24, 4, 60);
    s.duration = clamp(Math.round(+raw.duration) || 72, 2, 900);
    s.onion = clamp(Math.round(+raw.onion) || 0, 0, 2);
    if (raw.bg && typeof raw.bg === 'object') {
      s.bg.preset = BG_PRESETS[raw.bg.preset] ? raw.bg.preset : 'custom';
      if (typeof raw.bg.color === 'string') s.bg.color = raw.bg.color;
    }
    s.floor = raw.floor !== false;
    s.grid = !!raw.grid;
    if (Array.isArray(raw.objects)) {
      for (const ro of raw.objects) {
        if (!ro || !RIGS[ro.type]) continue;
        const o = {
          id: typeof ro.id === 'string' ? ro.id : uid(),
          type: ro.type,
          name: typeof ro.name === 'string' ? ro.name : RIGS[ro.type].label,
          color: typeof ro.color === 'string' ? ro.color : OBJ_COLORS[0],
          face: ro.face !== false,
          text: typeof ro.text === 'string' ? ro.text : 'Cześć! 👋',
          keys: [],
        };
        if (Array.isArray(ro.keys)) {
          for (const k of ro.keys) {
            if (!k || !isFinite(k.f)) continue;
            const ease = (k.ease === 'in' || k.ease === 'out' || k.ease === 'inout' || k.ease === 'hold') ? k.ease : 'linear';
            o.keys.push({ f: clamp(Math.round(k.f), 0, 8999), ease, pose: sanitizePose(k.pose, o.type) });
          }
        }
        if (!o.keys.length) o.keys.push({ f: 0, ease: 'inout', pose: sanitizePose(null, o.type) });
        sortKeys(o);
        s.objects.push(o);
      }
    }
    return s;
  }

  /* ---------- storage ---------- */
  const LS = { auto: 'sm_autosave_v1', projects: 'sm_projects_v1', help: 'sm_help_seen_v1' };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  function saveAutosave(scene) { return lsSet(LS.auto, JSON.stringify(scene)); }
  function loadAutosave() {
    const s = lsGet(LS.auto);
    if (!s) return null;
    try { return validateScene(JSON.parse(s)); } catch (e) { return null; }
  }
  function isFresh() { return !lsGet(LS.auto); }
  function helpSeen() { return !!lsGet(LS.help); }
  function markHelpSeen() { lsSet(LS.help, '1'); }

  function getProjects() {
    try { const p = JSON.parse(lsGet(LS.projects) || '{}'); return (p && typeof p === 'object') ? p : {}; } catch (e) { return {}; }
  }
  function saveProject(scene) {
    const all = getProjects();
    all[scene.name] = { ts: Date.now(), data: JSON.stringify(scene) };
    return lsSet(LS.projects, JSON.stringify(all));
  }
  function deleteProject(name) { const all = getProjects(); delete all[name]; return lsSet(LS.projects, JSON.stringify(all)); }
  function loadProject(name) { const p = getProjects()[name]; if (!p) return null; try { return validateScene(JSON.parse(p.data)); } catch (e) { return null; } }

  /* ---------- scena demo ---------- */
  function makeDemoScene() {
    const s = makeScene();
    s.name = 'Witaj w StickMotion! 👋';

    const ball = makeObject('ball', 240, 526, 'Piłka', 2); ball.color = '#ffd43b';
    ball.keys = [
      { f: 0,  ease: 'out', pose: { x: 240, y: 526, s: 1, flip: false, a: [0] } },
      { f: 14, ease: 'in',  pose: { x: 330, y: 336, s: 1, flip: false, a: [1.1] } },
      { f: 28, ease: 'out', pose: { x: 420, y: 526, s: 1, flip: false, a: [2.2] } },
      { f: 42, ease: 'in',  pose: { x: 510, y: 346, s: 1, flip: false, a: [3.3] } },
      { f: 56, ease: 'out', pose: { x: 600, y: 526, s: 1, flip: false, a: [4.4] } },
      { f: 70, ease: 'in',  pose: { x: 680, y: 526, s: 1, flip: false, a: [5.2] } },
    ];

    const man = makeObject('man', 470, 464, 'Max', 0); man.color = '#ff6b6b';
    const mk = (f, poseId, flip) => ({ f, ease: 'inout', pose: presetPose('man', poseId, 470, 464, flip || false) });
    man.keys = [mk(0, 'idle'), mk(16, 'wave'), mk(34, 'idle'), mk(50, 'wave'), mk(70, 'idle')];

    const girl = makeObject('girl', 850, 464, 'Ola', 7); girl.color = '#f783ac';
    const gk = (f, poseId) => ({ f, ease: 'inout', pose: presetPose('girl', poseId, 850, 464, true) });
    girl.keys = [gk(0, 'idle'), gk(44, 'idle'), gk(56, 'wave'), gk(70, 'idle')];

    s.objects = [man, girl, ball];
    return s;
  }
  function presetPose(type, poseId, x, y, flip) {
    const p = defaultPose(type);
    p.a = presetAngles(poseId);
    if (x != null) p.x = x;
    if (y != null) p.y = y;
    p.flip = !!flip;
    return p;
  }

  /* ---------- API ---------- */
  AB.core = {
    TAU, D2R, R2D, clamp, lerp, normDelta, angLerp, easeT,
    RIGS, OBJ_COLORS, BG_PRESETS, POSE_PRESETS, WORLD, J,
    defaultPose, presetPose, copyPose, lerpPoseInto,
    makeObject, makeScene, spawnPos, makeDemoScene,
    poseAt, upsertKey, keyAt, removeKeyAt, sortKeys,
    computeJoints, solveIK, bendSide,
    validateScene, sanitizePose,
    saveAutosave, loadAutosave, isFresh,
    helpSeen, markHelpSeen,
    getProjects, saveProject, deleteProject, loadProject,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = AB.core;
})();
