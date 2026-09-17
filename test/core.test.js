'use strict';
/* Test rdzenia StickMotion (uruchamiać: node test/core.test.js) */
const C = require('../js/core.js');

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ✔ ' + msg);
  else { console.error('  ✘ ' + msg); fails++; }
}

console.log('— scena demo —');
const s = C.makeDemoScene();
ok(s.objects.length === 3, 'demo ma 3 obiekty');
ok(s.duration === 72 && s.fps === 24, '72 klatki @ 24 FPS');

console.log('— interpolacja —');
const out = { a: [] };
const man = s.objects[0];
let p = C.poseAt(man, 0, out);
ok(Math.abs(p.a[4] - 80 * C.D2R) < 1e-6, 'klatka 0 = spoczynek (ramię wzdłuż ciała)');
p = C.poseAt(man, 16, out);
ok(Math.abs(p.a[4] - (-55 * C.D2R)) < 1e-6, 'klatka 16 = "wave" (ramię podniesione)');
p = C.poseAt(man, 8, out);
ok(p.a[4] > -55 * C.D2R && p.a[4] < 80 * C.D2R, 'klatka 8: interpolacja między idle/wave');
p = C.poseAt(man, 34, out);
ok(Math.abs(p.a[4] - 80 * C.D2R) < 1e-6, 'klatka 34 = dokładnie klucz idle');
// easing "out" na 0..14 piłki: wartość w połowie powinna być > liniowej
const ball = s.objects[2];
p = C.poseAt(ball, 7, out);
ok(p.y < (526 + 336) / 2, 'easing out: wznoszenie hamuje (y powyżej środka)');
p = C.poseAt(ball, 70, out);
ok(p.x === 680, 'klucz końcowy zwracany 1:1');

console.log('— klucze —');
C.upsertKey(man, 10);
ok(C.keyAt(man, 10) !== null, 'upsertKey tworzy klucz');
ok(C.keyAt(man, 10).pose && isFinite(C.keyAt(man, 10).pose.x), 'nowy klucz ma poprawną pozę (nie null)');
const before = man.keys.length;
ok(C.removeKeyAt(man, 10) === true, 'removeKeyAt usuwa');
ok(man.keys.length === before - 1, 'liczba kluczy wróciła');

console.log('— IK: cel osiągnięty, strony zgięcia lustrzane —');
const JX = new Float64Array(11), JY = new Float64Array(11);
const pose = C.defaultPose('man');
C.computeJoints({ type: 'man' }, pose, JX, JY);
const IK = [0, 0];
const tx = JX[1] + 45, ty = JY[1] + 45;
C.solveIK(JX[1], JY[1], tx, ty, 38, 33, 1, IK);
const e1x = JX[1] + Math.cos(IK[0]) * 38, e1y = JY[1] + Math.sin(IK[0]) * 38;
const hx = e1x + Math.cos(IK[1]) * 33, hy = e1y + Math.sin(IK[1]) * 33;
ok(Math.hypot(tx - hx, ty - hy) < 0.01, 'IK końcówką trafia dokładnie w cel');
// cross(dir linii, łokieć) > 0 dla side=+1, < 0 dla side=-1 (lustrzane)
const cross1 = (tx - JX[1]) * (e1y - JY[1]) - (ty - JY[1]) * (e1x - JX[1]);
C.solveIK(JX[1], JY[1], tx, ty, 38, 33, -1, IK);
const e2x = JX[1] + Math.cos(IK[0]) * 38, e2y = JY[1] + Math.sin(IK[0]) * 38;
const cross2 = (tx - JX[1]) * (e2y - JY[1]) - (ty - JY[1]) * (e2x - JX[1]);
ok(cross1 > 0 && cross2 < 0, 'side=+1 i side=-1 dają lustrzane zgięcia łokcia');
// kolano: przy side=-1 wysuwa się w przód od linii biodro→stopa
C.solveIK(JX[0], JY[0], JX[0] + 30, JY[0] + 85, 50, 46, -1, IK);
const kx = JX[0] + Math.cos(IK[0]) * 50, ky = JY[0] + Math.sin(IK[0]) * 50;
const crossK = (30) * (ky - JY[0]) - (85) * (kx - JX[0]);
ok(crossK < 0 && kx > JX[0], 'kolano (side=-1) wysuwa się w przód');
// bendSide odczytuje stronę zgięcia z pozy (zachowanie przy przeciąganiu)
ok(C.bendSide(-55 * C.D2R, -70 * C.D2R, 1) === -1, 'bendSide: poza "wave" → -1');
ok(C.bendSide(pose.a[6], pose.a[7], -1) === -1, 'bendSide nogi ze spoczynku = -1');
ok(C.bendSide(1, 1, 7) === 7, 'bendSide: prostą kończynę zastępuje fallback');

console.log('— serializacja —');
const json = JSON.stringify(s);
const s2 = C.validateScene(JSON.parse(json));
ok(s2.objects.length === 3, 'round-trip zachowuje obiekty');
ok(s2.objects[0].keys.length === man.keys.length, 'round-trip zachowuje klucze');
const out2 = { a: [] };
const pa = C.poseAt(man, 8, { a: [] }), pb = C.poseAt(s2.objects[0], 8, out2);
ok(Math.abs(pa.a[4] - pb.a[4]) < 1e-9, 'pozy identyczne po round-trip');
ok(C.validateScene({ foo: 1 }).objects.length === 0, 'walidacja śmieci nie wywala się');
ok(C.validateScene(null).duration >= 2, 'null → domyślna scena');

console.log('— storage (mock localStorage brak) —');
ok(C.isFresh() === true || typeof localStorage === 'undefined' ? true : true, 'isFresh nie wywala się bez localStorage');

console.log(fails ? ('\n' + fails + ' TESTÓW PADŁO ❌') : '\nWSZYSTKIE TESTY OK ✅');
process.exit(fails ? 1 : 0);
