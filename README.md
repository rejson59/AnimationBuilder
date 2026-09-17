# 🎬 StickMotion Studio

Prosty, ale rozbudowany **edytor animacji postaci w przeglądarce** — w stylu popularnych animacji stickman z YouTube. W 100% statyczna strona (zero zależności, zero builda), gotowa na **GitHub Pages**, zoptymalizowana pod słabsze telefony (od ~3 GB RAM).

## ✨ Funkcje

- 🧍 **Postacie i rekwizyty** — stickman, dziewczyna (z kucykiem), dziecko, piłka, skrzynka, dymek z tekstem
- 🤏 **Pozowanie palcem / myszą** — przeciągaj dłonie, stopy i głowę; nogi i ręce uginają się naturalnie (**2-bone IK**)
- ◆ **Klatki kluczowe + tweening** — każda zmiana tworzy klucz na osi czasu, ruch między kluczami wypełnia się płynnie
- ⏱️ **Wygładzanie ruchu (easing)** — liniowo, rozpędzanie, hamowanie, płynnie, zamrożone
- 🧅 **Onion skin** — duchy sąsiednich klatek (±1 / ±2), jak w prawdziwym studio animacji
- 🧘 **Gotowe pozy** — 12 pozycji startowych (bieg, skok, kopniak, taniec…)
- 🎞️ **Oś czasu** — scrubbing palcem, klucze per obiekt, pętla, 8–30 FPS
- 🎨 **Tła i sceneria** — 6 gradientów + własny kolor, podłoga, siatka, gwiazdy na nocnym niebie
- ↩️ **Cofnij / ponów** (60 kroków), 💾 **autosave** w przeglądarce + menedżer projektów
- 📤 **Eksport**: wideo **WebM/MP4 1280×720** (MediaRecorder), klatka **PNG**, projekt **.json** (+ import); udostępnianie przez systemowy arkusz (Web Share API) na telefonach
- 📱 **Mobile-first**: gesty dwoma palcami (pan/zoom), bottom-sheet UI, safe-area, PWA (dodaj do ekranu domowego)

## 🚀 Uruchomienie na GitHub Pages

1. Wgraj pliki do repozytorium (repo root zawiera `index.html`).
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Wybierz gałąź `main` i katalog `/ (root)` → Save.
4. Strona będzie dostępna pod `https://<login>.github.io/<nazwa-repo>/`.

Lokalnie: `python3 -m http.server 8000` i otwórz `http://localhost:8000`.

## 🧪 Testy

```
npm install jsdom     # tylko raz, do testu dymnego (dev-dependency)
npm test
```

- `test/core.test.js` — model sceny: interpolacja, easing, klucze ◆, IK, serializacja
- `test/smoke.test.js` — start aplikacji w jsdom: zaznaczanie, scrubbing, przeciąganie dłoni (IK), undo/redo, dodawanie obiektów, autosave

## ⚡ Wydajność (telefony z 3 GB RAM)

- Zero frameworków i zależności (~30 KB kodu), brak build-stepu
- Renderer z **dirty-flag** — rysuje tylko gdy trzeba (`requestAnimationFrame`)
- **Cache tła** na offscreen canvasie (gradient/gwiazdy/siatka renderują się raz)
- Limit DPR (≤2) i limit pikseli canvasa (~3,2 Mpx) — stałe obciążenie GPU
- Brak alokacji w pętli renderowania (pule pozycji/stawów), brak shadowBlur/filtrów
- Cebulka wyłączana automatycznie podczas odtwarzania; pauza w tle karty (oszczędzanie baterii)

## ⌨️ Skróty (komputer)

`Space` odtwarzanie · `←/→` klatki (`Shift` = ×10) · `Home/End` pierwsza/ostatnia · `K` klucz ◆ · `Shift+K` usuń klucz · `Ctrl+Z / Ctrl+Y` cofnij/ponów · `Delete` usuń obiekt · `F` wyśrodkuj · `O` cebulka · `Esc` odznacz/zamknij

## 🗂️ Struktura

```
index.html            — markup + modale
css/style.css         — cały wygląd (mobile-first, dark theme)
js/core.js            — model sceny, szkielety, interpolacja, IK, storage
js/ui.js              — oś czasu (canvas), toasty, modale, lista obiektów
js/editor.js          — rendering, gesty, odtwarzanie, eksport, start
assets/icon.svg       — ikona PWA/favicon
manifest.webmanifest  — PWA
```
