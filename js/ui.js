'use strict';
/* =====================================================================
   StickMotion Studio — ui.js
   DOM: toasty, modale, oś czasu (canvas), lista obiektów. Bez logiki scen.
   ===================================================================== */
(function () {
  const AB = window.AB = window.AB || {};
  const C = AB.core;

  const $ = id => document.getElementById(id);

  /* ---------- toasty ---------- */
  let lastToast = 0;
  function toast(msg, ms) {
    const box = $('toasts');
    while (box.children.length >= 2) box.removeChild(box.firstChild);
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    box.appendChild(el);
    lastToast++;
    const life = ms || 1900;
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, life);
  }

  /* ---------- modale ---------- */
  function openModal(id) { $(id).classList.add('open'); }
  function closeModal(id) { $(id).classList.remove('open'); }
  function anyModalOpen() { return !!document.querySelector('.modal.open'); }
  function closeAllModals() { document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); }
  function wireModals() {
    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => {
        const m = el.closest('.modal'); if (m) m.classList.remove('open');
      });
    });
  }

  /* ---------- oś czasu (canvas) ---------- */
  const TL = {
    cv: null, ctx: null, dpr: 1, w: 0, h: 0,
    padL: 10, ppf: 3, narrow: true, rulerH: 18, rowH: 19,
  };

  function tlInit() {
    TL.cv = $('timeline');
    TL.ctx = TL.cv.getContext('2d');
  }

  function tlLayout(scene, selObj) {
    const w = TL.cv.parentElement.clientWidth || 300;
    TL.narrow = w < 620;
    const rows = scene.objects.length === 0 ? 0 : (TL.narrow ? 1 : Math.min(scene.objects.length, 12));
    const h = TL.rulerH + rows * TL.rowH + 10;
    TL.dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (TL.w !== w || TL.h !== h) {
      TL.w = w; TL.h = h;
      TL.cv.width = Math.round(w * TL.dpr);
      TL.cv.height = Math.round(h * TL.dpr);
      TL.cv.style.height = h + 'px';
    }
    TL.ppf = (w - TL.padL * 2) / scene.duration;
  }

  function drawDiamond(ctx, x, y, r, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
    ctx.closePath(); ctx.fill();
  }

  function drawTimeline(scene, frame, selObj) {
    tlLayout(scene, selObj);
    const ctx = TL.ctx, w = TL.w, h = TL.h;
    ctx.setTransform(TL.dpr, 0, 0, TL.dpr, 0, 0);
    ctx.fillStyle = '#10131b';
    ctx.fillRect(0, 0, w, h);
    const { padL, ppf, rulerH, rowH } = TL;

    // linijka
    ctx.strokeStyle = '#262c3d';
    ctx.beginPath(); ctx.moveTo(padL, rulerH - 2.5); ctx.lineTo(w - padL, rulerH - 2.5); ctx.stroke();
    const step = ppf >= 5 ? 1 : (ppf >= 2 ? 5 : (ppf >= 1 ? 10 : 30));
    const lblStep = ppf >= 5 ? 10 : (ppf >= 2 ? 20 : (ppf >= 1 ? 50 : 100));
    ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let f = 0; f <= scene.duration; f += step) {
      const x = padL + f * ppf;
      ctx.strokeStyle = '#2b3247';
      ctx.beginPath(); ctx.moveTo(x, (f % lblStep === 0) ? rulerH - 8 : rulerH - 4.5);
      ctx.lineTo(x, rulerH - 2.5); ctx.stroke();
      if (f % lblStep === 0 && f > 0 && x < w - 14) {
        ctx.fillStyle = '#5d6579';
        ctx.fillText(String(f + 1), x, 2);
      }
    }

    // wiersze obiektów
    const objs = scene.objects;
    if (!objs.length) {
      ctx.fillStyle = '#5d6579'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Dodaj postać „＋ Postać”, aby zacząć 🎬', w / 2, rulerH + 12);
    } else if (TL.narrow) {
      const o = selObj || objs[objs.length - 1];
      const y = rulerH + rowH * 0.5 + 4;
      ctx.fillStyle = 'rgba(139,124,246,.10)';
      ctx.fillRect(padL - 4, y - rowH * 0.5, w - padL * 2 + 8, rowH);
      for (const k of o.keys) drawDiamond(ctx, padL + k.f * ppf, y, 4.5, '#a99cff');
      ctx.fillStyle = '#98a1b8'; ctx.font = '10px system-ui'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(o.name, w - padL - 2, y);
    } else {
      const n = Math.min(objs.length, 12);
      for (let i = 0; i < n; i++) {
        const o = objs[i];
        const yTop = rulerH + i * rowH, yc = yTop + rowH * 0.5 + 2;
        if (o === selObj) {
          ctx.fillStyle = 'rgba(139,124,246,.12)';
          ctx.fillRect(padL - 4, yTop + 1, w - padL * 2 + 8, rowH - 2);
        }
        for (const k of o.keys) drawDiamond(ctx, padL + k.f * ppf, yc, 4, o === selObj ? '#a99cff' : '#4a5164');
      }
    }

    // wskaźnik klatki
    const px = padL + frame * ppf;
    ctx.strokeStyle = '#ff6b81'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, 3); ctx.lineTo(px, h - 3); ctx.stroke();
    ctx.lineWidth = 1;
    const label = String(frame + 1);
    ctx.font = 'bold 10px system-ui';
    const tw = ctx.measureText(label).width + 10;
    const bx = clampN(px - tw / 2, 1, w - tw - 1);
    ctx.fillStyle = '#ff6b81';
    rr(ctx, bx, 1, tw, 13, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + tw / 2, 8);
  }
  function clampN(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- chips (lista obiektów) ---------- */
  function renderChips(scene, selObj) {
    const box = $('chips');
    box.textContent = '';
    for (const o of scene.objects) {
      const b = document.createElement('button');
      b.className = 'chip' + (o === selObj ? ' sel' : '');
      b.dataset.id = o.id;
      const dot = document.createElement('span');
      dot.className = 'dot'; dot.style.background = o.color;
      b.appendChild(dot);
      b.appendChild(document.createTextNode(o.name));
      b.addEventListener('click', () => { if (AB.ed) AB.ed.selectById(o.id); });
      box.appendChild(b);
    }
  }

  /* ---------- lista projektów ---------- */
  function renderProjects(currentName) {
    const box = $('projList');
    box.textContent = '';
    const all = C.getProjects();
    const names = Object.keys(all).sort((a, b) => (all[b].ts || 0) - (all[a].ts || 0));
    if (!names.length) {
      const p = document.createElement('p');
      p.className = 'note'; p.textContent = 'Brak zapisanych projektów — użyj „💾 Zapisz obecny”.';
      box.appendChild(p);
      return;
    }
    for (const name of names) {
      const rec = all[name];
      const row = document.createElement('div');
      row.className = 'prow';
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      const nm = document.createElement('div');
      nm.className = 'p-name'; nm.textContent = name + (name === currentName ? ' (obecny)' : '');
      const meta = document.createElement('div');
      meta.className = 'p-meta';
      let objCount = 0;
      try { objCount = JSON.parse(rec.data).objects.length; } catch (e) {}
      meta.textContent = new Date(rec.ts).toLocaleString('pl-PL') + ' · ' + objCount + ' obiektów';
      info.appendChild(nm); info.appendChild(meta);
      const open = document.createElement('button');
      open.className = 'icon-btn'; open.textContent = '📂'; open.title = 'Otwórz';
      open.addEventListener('click', () => { if (AB.ed) AB.ed.openProject(name); });
      const del = document.createElement('button');
      del.className = 'icon-btn warn'; del.textContent = '🗑️'; del.title = 'Usuń';
      del.addEventListener('click', () => { if (AB.ed) AB.ed.deleteProject(name); });
      row.appendChild(info); row.appendChild(open); row.appendChild(del);
      box.appendChild(row);
    }
  }

  AB.ui = {
    $, toast, openModal, closeModal, closeAllModals, anyModalOpen, wireModals,
    tlInit, drawTimeline, tlLayout, TL, rr,
    renderChips, renderProjects,
  };
})();
