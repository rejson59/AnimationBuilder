'use strict';
/* Test dymny całej aplikacji w jsdom (stub canvas 2D).
   Uruchamiać: node test/smoke.test.js  (wymaga: npm i --no-save jsdom) */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let fails = 0;
const ok = (c, m) => { if (c) console.log('  ✔ ' + m); else { console.error('  ✘ ' + m); fails++; } };

const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script[^>]*src=[^>]*><\/script>/g, '');

const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const { document } = window;

/* --- stuby środowiska --- */
const special = {
  measureText: () => ({ width: 42 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  canvas: null,
};
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k in special) return special[k];
    if (k === 'canvas') return null;
    return () => {};
  },
  set() { return true; },
});
window.HTMLCanvasElement.prototype.getContext = function () { return ctxStub; };
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500 };
};
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 800; }, configurable: true });
window.HTMLElement.prototype.setPointerCapture = function () {};
window.HTMLElement.prototype.releasePointerCapture = function () {};
Object.defineProperty(window, 'devicePixelRatio', { get() { return 1; }, configurable: true });

/* --- ładowanie skryptów --- */
try {
  window.eval(fs.readFileSync(path.join(root, 'js/core.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'js/editor.js'), 'utf8'));
  ok(true, 'skrypty wczytane bez wyjątków');
} catch (e) {
  ok(false, 'skrypty: ' + e.message);
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fire = (el, type, x, y) => {
  const e = new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
};

(async () => {
  await sleep(120); // rAF / init

  const AB = window.AB;
  ok(!!AB && !!AB.state && !!AB.state.scene, 'stan aplikacji istnieje');
  ok(AB.state.scene.objects.length === 3, 'świeży start → scena demo (3 obiekty)');

  // rAF zdążył narysować?
  ok(window.document.querySelectorAll('.chip').length === 4, 'chipsy wyrenderowane (＋ + 3 obiekty)');

  // zaznaczenie stickmana
  const man = AB.state.scene.objects[0];
  AB.ed.selectById(man.id);
  ok(!document.getElementById('selToolbar').classList.contains('hidden'), 'pasek narzędzi widoczny po zaznaczeniu');
  ok(document.getElementById('tbName').textContent === 'Max', 'nazwa obiektu na pasku');
  ok(document.getElementById('tbPose').style.display !== 'none', 'przycisk pozy widoczny dla postaci');
  ok(document.getElementById('tbText').style.display === 'none', 'przycisk dymka ukryty dla postaci');

  // scrubbing osi czasu do klatki 16 (padL=10, ppf=(800-20)/72)
  const tl = document.getElementById('timeline');
  const ppf = (800 - 20) / AB.state.scene.duration;
  fire(tl, 'pointerdown', 10 + 16 * ppf, 8);
  fire(tl, 'pointerup', 10 + 16 * ppf, 8);
  ok(AB.state.frame === 16, 'scrub osi czasu → klatka 16');

  // przeciągnięcie dłoni (IK) — klatka 16 = poza "wave", prawa dłoń uniesiona
  const C = AB.core;
  const JX = new Float64Array(11), JY = new Float64Array(11);
  const p16 = C.poseAt(man, 16, { a: [] });
  C.computeJoints(man, p16, JX, JY);
  const z = Math.min(800 / 1280, 500 / 720) * 0.97;
  const hx = (JX[6] - 640) * z + 400, hy = (JY[6] - 360) * z + 250;
  const stage = document.getElementById('stage');
  const a5before = C.poseAt(man, 16, { a: [] }).a[5];
  fire(stage, 'pointerdown', hx, hy);
  fire(stage, 'pointermove', hx + 60, hy + 30);
  fire(stage, 'pointermove', hx + 90, hy + 50);
  fire(stage, 'pointerup', hx + 90, hy + 50);
  const a5after = C.poseAt(man, 16, { a: [] }).a[5];
  ok(Math.abs(a5after - a5before) > 0.05, 'przeciągnięcie dłoni zmieniło pozę (IK)');

  // undo/redo — po operacjach scena jest nowym drzewem, pobieraj świeże referencje
  document.getElementById('btnUndo').click();
  const manU = AB.state.scene.objects[0];
  ok(Math.abs(C.poseAt(manU, 16, { a: [] }).a[5] - a5before) < 1e-6, 'cofnij przywraca oryginalną pozę');
  document.getElementById('btnRedo').click();
  const manR = AB.state.scene.objects[0];
  ok(Math.abs(C.poseAt(manR, 16, { a: [] }).a[5] - a5after) < 1e-6, 'ponów wraca do nowej pozy');

  // odtwarzanie
  document.getElementById('btnPlay').click();
  ok(AB.state.playing === true, '▶ start odtwarzania');
  await sleep(150);
  document.getElementById('btnPlay').click();
  ok(AB.state.playing === false, '⏸ pauza');

  // dodanie piłki przez modal
  document.getElementById('btnAdd').click();
  ok(document.getElementById('m-add').classList.contains('open'), 'modal „Dodaj” otwarty');
  document.querySelector('[data-add="ball"]').click();
  ok(AB.state.scene.objects.length === 4, 'piłka dodana');
  ok(!document.getElementById('m-add').classList.contains('open'), 'modal zamknięty po dodaniu');
  ok(document.getElementById('tbRotL').style.display !== 'none', 'obrót widoczny dla piłki');

  // klawisz ◆ w aktualnej klatce + usuwanie
  AB.ed.selectById(AB.state.scene.objects[3].id);
  const keysBefore = AB.state.scene.objects[3].keys.length;
  fire(tl, 'pointerdown', 10 + 30 * ppf, 8); fire(tl, 'pointerup', 0, 0);
  document.getElementById('selToolbar').style.display = ''; // pewność
  // tbKeyAdd przez klik
  document.getElementById('tbKeyAdd').click();
  ok(AB.state.scene.objects[3].keys.length === keysBefore + 1, '◆＋ dodaje klucz w klatce 30');

  // rekwizyt: przeciągnięcie piłki za uchwyt = przesuw (bez NaN!)
  const ballO = AB.state.scene.objects[2];
  AB.ed.selectById(ballO.id);
  const bp = C.poseAt(ballO, AB.state.frame, { a: [] });
  const bx = (bp.x - 640) * z + 400, by = (bp.y - 360) * z + 250;
  fire(stage, 'pointerdown', bx, by);
  fire(stage, 'pointermove', bx + 50, by - 20);
  fire(stage, 'pointerup', bx + 50, by - 20);
  const bp2 = C.poseAt(AB.state.scene.objects[2], AB.state.frame, { a: [] });
  ok(Math.abs(bp2.x - bp.x) > 20 && isFinite(bp2.a[0]), 'rekwizyt przesuwa się za uchwyt (part=root, bez NaN)');

  // zmiana FPS w ustawieniach
  const fpsSel = document.getElementById('setFps');
  fpsSel.value = '12';
  fpsSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  ok(AB.state.scene.fps === 12, 'ustawienie FPS działa');

  // eksport JSON (stringification bez DOM)
  ok(JSON.parse(JSON.stringify(AB.state.scene)).objects.length === 4, 'serializacja sceny OK');

  // walidacja autosave (debounce 700 ms)
  await sleep(1000);
  const raw = window.localStorage.getItem('sm_autosave_v1');
  ok(!!raw && JSON.parse(raw).objects.length === 4, 'autosave zapisany w localStorage');

  console.log(fails ? '\n' + fails + ' TESTÓW PADŁO ❌' : '\nSMOKE OK ✅');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
