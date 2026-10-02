# Interactive SVG Course Toolkit — Architecture & Progress

## 1. Executive Overview

A configuration-driven authoring system that turns static scientific vector illustrations into accessible, interactive learning activities.

- **Decoupled asset architecture** — SVGs live as standalone files in `assets/prepared/`, not embedded in `index.html` or stored in spreadsheet cells.
- **Single front-end engine shell** — `index.html` + `app.js` dynamically render any illustration and any interactive mode based on URL query parameters (e.g. `index.html?diagram=heart&mode=layer-explorer&lang=es`).
- **Centralized Google Sheet** acts as the authoring database and API endpoint (via an Apps Script web app), storing metadata, localized labels, animation/reveal sequences, all keyed by `diagram_id`.
- **Bilingual (EN/ES)** — a Language toggle in the page itself re-fetches Sheet data and rebuilds the active activity in place, no reload. The toggle only appears for diagrams that actually have Spanish content in the Sheet (any `es_text` in `labels`, or an `es` row in `diagram_meta`) — the API reports this as `languages`. Sheet-authored content (labels, diagram title/description) is looked up per-language from the Sheet; fixed UI chrome (button labels, instructions, banners) is localized via a small in-code dictionary, since it isn't spreadsheet content.
- **WCAG 2.2 AA-oriented** — every pointer-driven interaction has a keyboard-operable HTML control, `aria-live` announcements, visible focus states, and a Reduce Motion toggle.

## 2. Directory & Repository Layout

```
anatomy-interactives/
├── index.html                # Generic, reusable HTML shell — no diagram-specific markup
├── app.js                    # Interaction engine: diagram/mode router, activities, i18n, cache
├── assets/
│   ├── source/                # Raw SVG exports from Illustrator (input to the pipeline)
│   ├── prepared/               # Cleaned/optimized SVGs actually fetched at runtime
│   └── manifests/              # Generated per-diagram element-id JSON (diagnostic/reference)
└── tools/
    └── prepare-svg/
        └── index.js            # Node.js SVG cleaner + manifest extractor
```

**Note on the Apps Script backend:** the Google Apps Script project (`Code.gs`) that serves the Sheet as a JSON API is **not stored in this repository** — it's a separate deployment bound to the Google Sheet itself. A working copy is kept locally at `~/Desktop/code.gs` for editing; see Section 4D for its current content and the deploy workflow in Section 6.

## 3. Google Sheet Schema

Every tab is filtered by `diagram_id` (e.g. `heart`) so one Sheet can drive multiple illustrations.

### `labels` tab — Label Studio (show/hide + text)
| Column | Notes |
|---|---|
| `diagram_id` | e.g. `heart` |
| `svg_id` | must exactly match an SVG element id, e.g. `Label_Aorta` |
| `en_text` | English caption |
| `es_text` | Spanish caption (falls back to `en_text` if blank) |
| `visible_default` | `TRUE`/`FALSE` |
| `tooltip_en` | optional hover/aria tooltip |
| `text_align` | optional; `right` for labels whose leader line sits to their right — see Section 4C, `patchLabelText()` |

### `diagram_meta` tab — page title/description
| Column | Notes |
|---|---|
| `diagram_id` | e.g. `heart` |
| `lang` | `en` / `es` — one row per language per diagram |
| `title` | shown in the page `<h1>` |
| `desc` | shown under the title, also read by screen readers via `aria-labelledby` on the SVG |

### `animations` tab — Layer Explorer (Play/Pause/Prev/Next scrubber)
| Column | Notes |
|---|---|
| `activity_id` | `diagram_id` (falls back to `diagram_id` column if `activity_id` is absent) |
| `step_id` | any unique label |
| `order` | 1, 2, 3… playback order |
| `element_id` | must exactly match an SVG element id |
| `action` | `highlight` \| `pulse` \| `fade-in` |
| `duration` | milliseconds |
| `caption` | narration shown/announced for that step |

### `sequences` tab — Sequence Builder (one-pass layer reveal, manual or timed)
| Column | Notes |
|---|---|
| `activity_id` | `diagram_id` |
| `item_id` | **must hold the real SVG element id** (e.g. `Label_Right_atrium`) — this tab has no dedicated `element_id` column, so `item_id` doubles as the target |
| `expected_order` | 1, 2, 3… reveal order |
| `caption` | narration shown/announced when that layer is revealed |
| `delay_ms` | optional; milliseconds to wait **before** this step appears when the viewer presses Play (e.g. `3000`). Blank → `0` for the first step, `3000` for the rest. Ignored by Reveal Next, which always reveals immediately |
| `feedback` | unused by the current (v2) reveal activity; safe to leave blank |

### `svg_raw` / `imported_labels` / `svg_element_ids` — authoring helper tabs
Used by two Apps Script menu functions (Section 4D):
- **Import labels from SVG** — paste raw SVG into `svg_raw!A1`, run the menu item, get `en_text | svg_id | visible_default` rows dumped into `imported_labels` to copy into `labels` (review manually — `diagram_id`/`es_text`/`tooltip_en`/`text_align` can't be scraped from the SVG and must be filled in by hand).
- **List all element ids from SVG** — same `svg_raw` source, dumps every element id found (not just `Label_*`) into `svg_element_ids` as a copy-paste reference when filling in `element_id`/`item_id` for `animations`/`sequences`, to avoid typos.

## 4. Technical Artifacts & Source Code

### A. SVG Optimizer (`tools/prepare-svg/index.js`)

Strips editor cruft, validates `viewBox`, flags inline `<script>`/duplicate-id/external-resource risks, and — importantly — **auto-repairs missing generic font-family fallbacks**. Illustrator exports name an exact (often subsetted/licensed) font with no generic fallback; when that exact font isn't installed in a visitor's browser, the browser silently falls through to its own default font (serif, in most browsers) regardless of what the artwork intended. `ensureGenericFontFallback()` detects any `font-family` rule missing a generic keyword and appends a matching one (`serif`/`sans-serif`/`monospace`, inferred from the named font), so a missing exact font degrades to something that still resembles the original design.

```javascript
const fs = require('fs');
const path = require('path');

// Folder Paths
const SOURCE_DIR = path.join(__dirname, '../../assets/source');
const PREPARED_DIR = path.join(__dirname, '../../assets/prepared');
const MANIFEST_DIR = path.join(__dirname, '../../assets/manifests');

// Ensure output directories exist automatically
[PREPARED_DIR, MANIFEST_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Illustrator export bakes in the exact (often subsetted/licensed) font name
// with no generic fallback. When that exact font isn't installed in a
// visitor's browser, CSS falls through to the browser's own default font —
// serif in most browsers — silently overriding whatever the artwork actually
// intended. This appends a matching generic family (serif/sans-serif/
// monospace) to any font-family rule that doesn't already declare one, so
// the fallback still resembles the original design instead of the browser's
// arbitrary default.
function ensureGenericFontFallback(svgContent, issues) {
  const genericKeywordPattern = /\b(serif|sans-serif|monospace|cursive|fantasy|system-ui)\b/i;

  return svgContent.replace(/font-family:\s*([^;]+);/g, (match, familyList) => {
    if (genericKeywordPattern.test(familyList)) return match; // already has a fallback

    const lower = familyList.toLowerCase();
    let generic = 'sans-serif';
    if (/times|georgia|garamond|palatino|cambria|book antiqua|serif/.test(lower)) {
      generic = 'serif';
    } else if (/courier|consolas|monospace|\bmono\b/.test(lower)) {
      generic = 'monospace';
    }

    if (issues) issues.push(`INFO: Added missing generic font fallback (${generic}) to: ${familyList.trim()}`);
    return `font-family: ${familyList.trim()}, ${generic};`;
  });
}

function cleanAndOptimizeSvg(svgContent, assetId) {
  const issues = [];

  // 1. Check and preserve viewBox
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/i);
  if (!viewBoxMatch) {
    issues.push('WARNING: No viewBox attribute found on root <svg> element!');
  }
  const viewBoxValues = viewBoxMatch ? viewBoxMatch[1].split(' ').map(Number) : [0, 0, 800, 600];

  // 2. Flag inline scripts or external resource references
  if (/<script/i.test(svgContent)) issues.push('SECURITY ALERT: Inline <script> tag detected!');
  if (/xlink:href="http/i.test(svgContent) || /href="http/i.test(svgContent)) {
    issues.push('WARNING: External HTTP resource link found.');
  }

  // 3. Extract and check element IDs
  const idRegex = /id="([^"]+)"/g;
  const foundIds = new Set();
  const duplicateIds = new Set();
  let match;

  while ((match = idRegex.exec(svgContent)) !== null) {
    const id = match[1];
    if (foundIds.has(id)) {
      duplicateIds.add(id);
    } else {
      foundIds.add(id);
    }
  }

  if (duplicateIds.size > 0) {
    issues.push(`ERROR: Duplicate IDs found: ${Array.from(duplicateIds).join(', ')}`);
  }

  // 4. Perform SVG cleaning
  let cleaned = svgContent
    .replace(/<!--[\s\S]*?-->/g, '') // remove XML comments
    .replace(/xmlns:i="[^"]*"/g, '')
    .replace(/xmlns:graph="[^"]*"/g, '')
    .replace(/i:extruder="[^"]*"/g, '')
    .replace(/data-name="[^"]*"/g, '') // remove Adobe data-name tags
    .replace(/<metadata[\s\S]*?<\/metadata>/gi, '') // remove metadata elements
    .replace(/\s+/g, ' ') // normalize whitespace
    .trim();

  cleaned = ensureGenericFontFallback(cleaned, issues);

  // 5. Build Compact Element Manifest
  const elements = [];
  foundIds.forEach((id) => {
    let type = 'generic';
    if (id.startsWith('Label_')) type = 'label';
    if (id.startsWith('structure-')) type = 'structure';
    if (id.startsWith('layer-')) type = 'layer';

    if (type !== 'generic') {
      elements.push({
        id: id,
        type: type,
        accessibleName: id.replace(/^(Label_|structure-|layer-)/, '').replace(/_/g, ' ')
      });
    }
  });

  const manifest = {
    assetId: assetId,
    viewBox: viewBoxValues,
    elementCount: foundIds.size,
    issues: issues,
    elements: elements
  };

  return { cleanedSvg: cleaned, manifest: manifest, issues: issues };
}

function processAllSvgs() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.log(`Source directory '${SOURCE_DIR}' does not exist. Please create it and add raw SVG files.`);
    return;
  }

  const files = fs.readdirSync(SOURCE_DIR).filter(f => f.endsWith('.svg'));
  if (files.length === 0) {
    console.log(`No .svg files found in '${SOURCE_DIR}'. Place your raw heart.svg inside 'assets/source/'.`);
    return;
  }

  files.forEach((file) => {
    const assetId = path.basename(file, '.svg');
    const sourcePath = path.join(SOURCE_DIR, file);
    const preparedPath = path.join(PREPARED_DIR, `${assetId}.svg`);
    const manifestPath = path.join(MANIFEST_DIR, `${assetId}.json`);

    console.log(`\nProcessing: ${file}...`);
    const rawSvg = fs.readFileSync(sourcePath, 'utf8');
    const { cleanedSvg, manifest, issues } = cleanAndOptimizeSvg(rawSvg, assetId);

    // Save cleaned file and manifest
    fs.writeFileSync(preparedPath, cleanedSvg, 'utf8');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    console.log(` Saved optimized SVG to: assets/prepared/${assetId}.svg`);
    console.log(` Saved element manifest to: assets/manifests/${assetId}.json`);

    if (issues.length > 0) {
      console.log(' Diagnostics:');
      issues.forEach(i => console.log(`   - ${i}`));
    }
  });
}

processAllSvgs();
```

**Illustrator export settings** that pair with this pipeline (see Section 6 for the full checklist): Styling → Internal CSS ("Style Elements"); Font → SVG (not "Convert to Outlines" — label captions must stay real `<text>` for the patching logic below to work); Object IDs → Layer Names; Responsive → on.

### B. Application Shell (`index.html`)

Purely structural — no diagram-specific markup, no embedded SVG. `app.js` injects the SVG into `#svg-container` and builds the toolbar into `#toolbar-container` at runtime based on `?diagram=` and `?mode=`.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <!-- PERFORMANCE HINTS -->
  <link rel="preconnect" href="https://script.google.com">
  <link rel="dns-prefetch" href="https://script.google.com">
  <title>Interactive Scientific Illustration</title>

  <style>
    body {
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      margin: 1.5rem;
      background: #ffffff;
    }

    .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
    border: 0;
    }


    .diagram-wrap {
      border: 1px solid #ccc;
      padding: 1rem;
      border-radius: .75rem;
      background: #fafafa;
      max-width: 900px;
      margin: 0 auto;
    }

    h1 {
      font-size: 1.25rem;
      margin-top: 0;
    }

    #label-instructions {
      font-size: 0.95rem;
      color: #374151;
      margin-bottom: 0.75rem;
    }

    .lang-toggle {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }

    .lang-toggle[hidden] {
      display: none;
    }

    .lang-toggle button {
      padding: 0.3rem 0.6rem;
      border-radius: 0.4rem;
      border: 1px solid #bbb;
      background: #ffffff;
      cursor: pointer;
      font-size: 0.85rem;
      min-height: 36px;
    }

    .lang-toggle button[aria-pressed="true"] {
      background: #e8e8e8;
      font-weight: 600;
    }

    .toggles {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .toggles button {
      padding: 0.4rem 0.6rem;
      border-radius: 0.4rem;
      border: 1px solid #bbb;
      background: #ffffff;
      cursor: pointer;
      font-size: 0.9rem;
      min-height: 44px;
      min-width: 44px;
    }

    .toggles button[aria-pressed="true"] {
      background: #e8e8e8;
      font-weight: 600;
    }

    .toggles button[aria-pressed="false"] {
      opacity: 0.6;
    }

    .toggles button:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }

    svg {
      width: 100%;
      height: auto;
      display: block;
    }

    .is-hidden {
      display: none;
    }

    .label-bg {
      fill: white;
      stroke: #000;
      stroke-width: 1;
    }

    .label {
      font-family: system-ui, sans-serif;
      font-weight: 600;
    }

    #loading-message {
    font-size: 0.9rem;
    color: #6b7280; /* subtle gray */
    animation: pulse 1.2s ease-in-out infinite;
    }

    @keyframes pulse {
    0%   { opacity: 0.4; }
    50%  { opacity: 1; }
    100% { opacity: 0.4; }
    }

    .load-error {
      font-size: 0.9rem;
      color: #7a2e00;
      background: #fff3e0;
      border: 1px solid #f0c38a;
      border-radius: 0.5rem;
      padding: 0.5rem 0.75rem;
      margin-bottom: 0.75rem;
      align-items: center;
      gap: 0.75rem;
    }

    .load-error:not([hidden]) {
      display: flex;
    }

    .load-error button {
      border: 1px solid #b06a1a;
      background: #fff;
      border-radius: 0.4rem;
      padding: 0.25rem 0.6rem;
      cursor: pointer;
      min-height: 32px;
    }

  </style>
</head>
<body>
  <div id="sr-status" aria-live="polite" class="sr-only"></div>

  <div class="diagram-wrap">
    <div class="lang-toggle" role="group" aria-label="Language" id="lang-toggle" hidden></div>

    <header>
      <h1 id="diagram-title">Loading illustration…</h1>
      <p id="diagram-desc"></p>
    </header>

    <p id="label-instructions">
      Use the controls below to interact with the anatomical illustration.
    </p>

    <p id="load-error" class="load-error" hidden>
      <span id="load-error-message">Couldn't load the latest activity data from the Sheet. Showing default content instead.</span>
      <button type="button" id="retry-load">Retry</button>
    </p>

    <!-- Parallel HTML toolbar for accessibility; populated by app.js based on ?mode= -->
    <div class="toggles"
         role="toolbar"
         aria-label="Illustration interactive controls"
         aria-describedby="label-instructions"
         id="toolbar-container">
      <span id="loading-message">Loading activity data…</span>
    </div>

    <!-- Dynamic SVG target; app.js injects ./assets/prepared/{diagram}.svg here at runtime -->
    <main id="svg-container" aria-live="polite"></main>
  </div>

  <script src="app.js"></script>
</body>
</html>
```

Note on the `.load-error:not([hidden])` rule: a plain `.load-error { display: flex; }` rule always beats the browser's built-in `[hidden] { display: none; }` regardless of the `hidden` attribute, because author-stylesheet rules always win over user-agent rules at equal specificity. Scoping the `display: flex` to `:not([hidden])` was the fix for a bug where the error banner stayed visible on every successful load.

### C. Interaction Engine (`app.js`)

Three activity modes, chosen via `?mode=`:
- **`label-studio`** (default) — per-label show/hide toggle buttons, built from live `[id^="Label_"]` elements in the SVG, patched with Sheet-provided text/tooltip/visibility. Includes a "Toggle All" button.
- **`layer-explorer`** — Play/Pause/Prev/Next scrubber through `animations` tab steps, each step running a `highlight`/`pulse`/`fade-in` action on one SVG element. Supports Reduce Motion.
- **`sequence-builder`** — one-pass reveal through `sequences` tab steps: every target layer starts hidden. **Play/Pause** auto-advances, waiting each step's `delay_ms` before revealing it; **Reveal Next** reveals the next step immediately (and, while playing, restarts the wait for the one after). It stops for good (Play and Reveal Next disable) once the last step is revealed; Restart is the only way back to the start. If the Sheet returns no rows for the diagram, the caption says so and the buttons are disabled.

```javascript
/**
 * Interactive SVG Course Engine & Activity Toolkit
 * Activity Modes: Label Studio, Animated Layer Explorer, Process Sequence Builder
 * Performance: Stale-While-Revalidate Browser Caching (localStorage)
 * Standards Target: WCAG 2.2 Level AA Accessibility
 */

// 1. Configuration & URL Parameters
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx_pM89Kk0Px4F1xfUgB_yg7POh5sN51b1p8xkSdMFh60lxXIg1jxgYUwv9uIFJdHPz/exec";

const urlParams = new URLSearchParams(window.location.search);
const diagramId = (urlParams.get("diagram") || "heart").toLowerCase();
const activeMode = (urlParams.get("mode") || "label-studio").toLowerCase(); // 'label-studio' | 'layer-explorer' | 'sequence-builder'
let lang = (urlParams.get("lang") || "en").toLowerCase(); // mutable — the language toggle reassigns this

// Fixed UI chrome text (buttons, instructions, banners) isn't Sheet-authored
// content, so it lives here rather than in a spreadsheet column. Diagram
// titles/descriptions (diagram_meta) and label text (labels) still come
// from the Sheet per-language, same as before.
const UI_STRINGS = {
  en: {
    instructions: "Use the controls below to interact with the anatomical illustration.",
    loading: "Loading activity data…",
    loadError: "Couldn't load the latest activity data from the Sheet. Showing default content instead.",
    retry: "Retry",
    toggleAll: "Toggle All",
    labelShown: (name) => `${name} label shown.`,
    labelHidden: (name) => `${name} label hidden.`,
    allShown: "All labels shown.",
    allHidden: "All labels hidden.",
    reduceMotion: "Reduce Motion",
    motionEnabled: "Reduced motion enabled.",
    motionDisabled: "Reduced motion disabled.",
    prev: "⏮ Previous",
    play: "▶ Play",
    pause: "⏸ Pause",
    next: "Next ⏭",
    restart: "↺ Restart",
    playbackComplete: "Sequence playback completed.",
    revealNext: "Reveal Next ⏭",
    sequenceComplete: "Sequence Complete",
    sequenceCompleteAnnounce: "Sequence complete.",
    sequenceReset: "Sequence reset.",
    sequenceReady: (n) => `Ready — ${n} steps. Press "Play" or "Reveal Next" to begin.`,
    sequencePlaying: "Sequence playing.",
    sequencePaused: "Sequence paused.",
    noSequenceSteps: "No sequence steps were found for this illustration.",
    langEnglish: "English",
    langSpanish: "Español",
    langSwitched: "Switched to English.",
    langSwitchFailed: "Could not load that language right now."
  },
  es: {
    instructions: "Usa los controles a continuación para interactuar con la ilustración anatómica.",
    loading: "Cargando datos de la actividad…",
    loadError: "No se pudieron cargar los datos más recientes de la hoja de cálculo. Mostrando contenido predeterminado.",
    retry: "Reintentar",
    toggleAll: "Alternar todo",
    labelShown: (name) => `Etiqueta ${name} mostrada.`,
    labelHidden: (name) => `Etiqueta ${name} ocultada.`,
    allShown: "Todas las etiquetas mostradas.",
    allHidden: "Todas las etiquetas ocultadas.",
    reduceMotion: "Reducir movimiento",
    motionEnabled: "Movimiento reducido activado.",
    motionDisabled: "Movimiento reducido desactivado.",
    prev: "⏮ Anterior",
    play: "▶ Reproducir",
    pause: "⏸ Pausar",
    next: "Siguiente ⏭",
    restart: "↺ Reiniciar",
    playbackComplete: "Reproducción de la secuencia completada.",
    revealNext: "Mostrar siguiente ⏭",
    sequenceComplete: "Secuencia completa",
    sequenceCompleteAnnounce: "Secuencia completa.",
    sequenceReset: "Secuencia reiniciada.",
    sequenceReady: (n) => `Listo — ${n} pasos. Pulsa "Reproducir" o "Mostrar siguiente" para comenzar.`,
    sequencePlaying: "Secuencia en reproducción.",
    sequencePaused: "Secuencia en pausa.",
    noSequenceSteps: "No se encontraron pasos de secuencia para esta ilustración.",
    langEnglish: "English",
    langSpanish: "Español",
    langSwitched: "Cambiado a español.",
    langSwitchFailed: "No se pudo cargar ese idioma en este momento."
  }
};

function t(key) {
  const dict = UI_STRINGS[lang] || UI_STRINGS.en;
  return dict[key] !== undefined ? dict[key] : UI_STRINGS.en[key];
}

// 2. Application State Management
const state = {
  config: null,
  svgElement: null,
  // Layer Explorer State
  currentStepIndex: 0,
  isPlaying: false,
  playbackSpeed: 1.0,
  animationTimer: null,
  isReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  // Sequence Builder State
  sequenceSteps: [],
  isSequencePlaying: false,
  sequenceTimer: null,
  // Language Toggle State
  isSwitchingLanguage: false
};

// 3. Stale-While-Revalidate Caching Helper
async function fetchWithCache(url, cacheKey) {
  const cached = localStorage.getItem(cacheKey);
  const isSvg = url.endsWith(".svg");

  if (cached) {
    // Revalidate in background to keep data fresh without blocking UI
    fetch(url)
      .then((res) => (res.ok ? (isSvg ? res.text() : res.json()) : null))
      .then((freshData) => {
        if (freshData !== null) {
          const dataToStore = isSvg ? freshData : JSON.stringify(freshData);
          localStorage.setItem(cacheKey, dataToStore);
        }
      })
      .catch(() => {});

    if (isSvg) {
      return cached;
    } else {
      try {
        return JSON.parse(cached);
      } catch (e) {
        return cached;
      }
    }
  }

  // Network fetch if not cached
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
  const data = isSvg ? await res.text() : await res.json();
  localStorage.setItem(cacheKey, isSvg ? data : JSON.stringify(data));
  return data;
}

// 4. Dynamic CSS Injection for SVG Animation & Focus States
function injectAnimationStyles() {
  if (document.getElementById("svg-engine-styles")) return;
  const style = document.createElement("style");
  style.id = "svg-engine-styles";
  style.textContent = `
    .svg-highlight {
      outline: 3px solid #005fcc !important;
      filter: drop-shadow(0px 0px 8px rgba(0, 95, 204, 0.8));
      transition: filter 0.3s ease, stroke 0.3s ease;
    }
    .svg-pulse {
      animation: svgPulseKeyframe 1.2s infinite ease-in-out;
    }
    @keyframes svgPulseKeyframe {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(1.03); }
      100% { opacity: 1; transform: scale(1); }
    }
    .svg-fade-transition {
      transition: opacity var(--anim-duration, 0.6s) ease-in-out;
    }
    .playback-controls {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .playback-controls button {
      min-height: 44px;
      padding: 8px 14px;
      cursor: pointer;
    }
    .caption-box {
      padding: 12px 16px;
      background: #eef4fc;
      border-left: 4px solid #005fcc;
      margin-top: 12px;
      font-size: 1.05rem;
    }
  `;
  document.head.appendChild(style);
}

// Applies the fixed UI chrome text (instructions, loading/error banners,
// retry button) for the current `lang`. Sheet-authored content (labels,
// diagram title/desc) is handled separately by applyDiagramMeta/patchLabelText.
function applyStaticUiText() {
  const instructions = document.getElementById("label-instructions");
  if (instructions) instructions.textContent = t("instructions");

  const loadingMsg = document.getElementById("loading-message");
  if (loadingMsg) loadingMsg.textContent = t("loading");

  const errorMsg = document.getElementById("load-error-message");
  if (errorMsg) errorMsg.textContent = t("loadError");

  const retryBtn = document.getElementById("retry-load");
  if (retryBtn) retryBtn.textContent = t("retry");
}

// Clears and rebuilds the toolbar for the currently active mode, using
// whatever's in state.config. Shared by initial load, the error fallback,
// and language switches so the three don't drift out of sync.
function renderActiveMode(container) {
  container.innerHTML = "";
  switch (activeMode) {
    case "sequence-builder":
      initSequenceBuilder(container);
      break;
    case "layer-explorer":
      initLayerExplorer(container);
      break;
    case "label-studio":
    default:
      initLabelStudio(container);
      break;
  }
}

// 5. Main Application Initialization (Fault-Tolerant)
async function initInteractiveApp() {
  injectAnimationStyles();
  applyStaticUiText();

  const toolbarContainer = document.getElementById("toolbar-container");
  const svgContainer = document.getElementById("svg-container");
  const errorBox = document.getElementById("load-error");
  const retryBtn = document.getElementById("retry-load");

  if (errorBox) errorBox.hidden = true;
  if (retryBtn && !retryBtn.dataset.wired) {
    retryBtn.dataset.wired = "true";
    retryBtn.addEventListener("click", initInteractiveApp);
  }

  const svgKey = `cache_svg_${diagramId}`;
  const apiKey = `cache_api_${diagramId}_${lang}`;

  // Step A: Load SVG Graphic independently so illustration renders immediately
  try {
    const svgText = await fetchWithCache(`./assets/prepared/${diagramId}.svg`, svgKey);
    svgContainer.innerHTML = svgText;
    state.svgElement = svgContainer.querySelector("svg");
  } catch (svgError) {
    console.error("SVG Asset Loading Error:", svgError);
    svgContainer.innerHTML = `<p style="color:#d32f2f;">Failed to load illustration asset: assets/prepared/${diagramId}.svg</p>`;
    return;
  }

  // Step B: Load API Metadata concurrently with fallback handling
  try {
    const configData = await fetchWithCache(`${APPS_SCRIPT_URL}?diagram=${diagramId}&lang=${lang}`, apiKey);
    state.config = configData;
    initLanguageToggle(state.config.languages);
    applyDiagramMeta(state.config.meta);
    renderActiveMode(toolbarContainer);
    announceStatus("Activity data loaded and ready.");
  } catch (apiError) {
    console.warn("API Endpoint Warning (using default controls):", apiError);
    // Fallback config if Apps Script API endpoint times out or is offline
    state.config = state.config || {};
    if (errorBox) errorBox.hidden = false;
    announceStatus("Activity data unavailable; showing default content.");
    renderActiveMode(toolbarContainer);
  }
}

// 5b. Language Toggle (EN/ES) — refetches Sheet data for the new language
// and rebuilds the active activity in place, no full page reload.
async function setLanguage(newLang) {
  if (newLang === lang || state.isSwitchingLanguage) return;
  state.isSwitchingLanguage = true;

  const toolbarContainer = document.getElementById("toolbar-container");

  try {
    lang = newLang;
    applyStaticUiText();

    const apiKey = `cache_api_${diagramId}_${lang}`;
    const configData = await fetchWithCache(`${APPS_SCRIPT_URL}?diagram=${diagramId}&lang=${lang}`, apiKey);
    state.config = configData;
    applyDiagramMeta(state.config.meta);
    renderActiveMode(toolbarContainer);
    announceStatus(t("langSwitched"));

    const url = new URL(window.location.href);
    url.searchParams.set("lang", lang);
    window.history.replaceState({}, "", url);
  } catch (err) {
    console.warn("Language switch failed:", err);
    announceStatus(t("langSwitchFailed"));
  } finally {
    state.isSwitchingLanguage = false;
    document.querySelectorAll("#lang-toggle button").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.lang === lang ? "true" : "false");
    });
  }
}

const LANGUAGE_OPTIONS = [
  { code: "en", label: () => UI_STRINGS.en.langEnglish },
  { code: "es", label: () => UI_STRINGS.es.langSpanish }
];

// Shows a button per language the Sheet actually has content for (the API's
// `languages` list), and hides the toggle entirely when there's only one —
// e.g. a diagram with no Spanish labels or title gets no EN/ES buttons.
function initLanguageToggle(availableLanguages) {
  const host = document.getElementById("lang-toggle");
  if (!host) return;

  host.innerHTML = "";
  const options = LANGUAGE_OPTIONS.filter(({ code }) => (availableLanguages || []).includes(code));
  host.hidden = options.length < 2;
  if (host.hidden) return;

  options.forEach(({ code, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label();
    btn.dataset.lang = code;
    btn.setAttribute("aria-pressed", code === lang ? "true" : "false");
    btn.addEventListener("click", () => setLanguage(code));
    host.appendChild(btn);
  });
}

// Applies Sheet-provided title/description to both the HTML header and the
// SVG's own <title>/<desc> so screen readers announce it via aria-labelledby.
function applyDiagramMeta(meta) {
  if (!meta) return;

  if (meta.title) {
    const titleHeader = document.getElementById("diagram-title");
    if (titleHeader) titleHeader.textContent = meta.title;
  }
  if (meta.desc) {
    const descHeader = document.getElementById("diagram-desc");
    if (descHeader) descHeader.textContent = meta.desc;
  }

  const svg = state.svgElement;
  if (!svg) return;

  svg.setAttribute("role", "img");

  let titleEl = svg.querySelector("title");
  let descEl = svg.querySelector("desc");

  if (!titleEl) {
    titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
    titleEl.id = "svg-title";
    svg.insertBefore(titleEl, svg.firstChild);
  } else if (!titleEl.id) {
    titleEl.id = "svg-title";
  }

  if (!descEl) {
    descEl = document.createElementNS("http://www.w3.org/2000/svg", "desc");
    descEl.id = "svg-desc";
    svg.insertBefore(descEl, titleEl.nextSibling);
  } else if (!descEl.id) {
    descEl.id = "svg-desc";
  }

  if (meta.title) titleEl.textContent = meta.title;
  if (meta.desc) descEl.textContent = meta.desc;

  svg.setAttribute("aria-labelledby", `${titleEl.id} ${descEl.id}`);
}

// TEMPLATE 1: SVG Label Studio
function initLabelStudio(container) {
  const svg = state.svgElement;
  const labelEls = svg ? Array.from(svg.querySelectorAll('[id^="Label_"]')) : [];

  if (labelEls.length === 0) {
    container.innerHTML = "<span>No Label_* groups found in this illustration.</span>";
    return;
  }

  // Index Sheet-provided label data (text, tooltip, default visibility) by svg id.
  const dataById = {};
  ((state.config && state.config.labels) || []).forEach((item) => {
    if (item.id) dataById[item.id] = item;
  });

  // Build buttons in randomized order so the toolbar doubles as a light
  // "name the structure" quiz rather than mirroring the SVG's draw order.
  const shuffled = [...labelEls];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const buttons = [];

  shuffled.forEach((el) => {
    const info = dataById[el.id];
    const fallbackName = el.id.replace(/^Label_/, "").replace(/_/g, " ");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "toggle-btn";
    button.dataset.target = el.id;
    button.setAttribute("aria-controls", el.id);

    const isVisible = info ? info.visible !== false : !el.classList.contains("is-hidden");
    button.setAttribute("aria-pressed", isVisible ? "true" : "false");
    button.textContent = info && info.text ? info.text.replace(/\r?\n/g, " ") : fallbackName;

    // Measure/patch text before toggling visibility — getBBox() (used for
    // right-aligned labels below) returns a zeroed box on a hidden element.
    patchLabelText(el, info);
    el.classList.toggle("is-hidden", !isVisible);
    if (info && info.tooltip) {
      el.setAttribute("aria-label", info.tooltip);
      el.setAttribute("title", info.tooltip);
    }

    button.addEventListener("click", () => {
      const hidden = el.classList.toggle("is-hidden");
      button.setAttribute("aria-pressed", hidden ? "false" : "true");
      announceStatus(hidden ? t("labelHidden")(button.textContent) : t("labelShown")(button.textContent));
    });

    container.appendChild(button);
    buttons.push(button);
  });

  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.id = "toggle-all";
  allButton.textContent = t("toggleAll");
  allButton.setAttribute("aria-pressed", "false");
  allButton.addEventListener("click", () => {
    const anyVisible = labelEls.some((el) => !el.classList.contains("is-hidden"));
    labelEls.forEach((el) => el.classList.toggle("is-hidden", anyVisible));
    buttons.forEach((b) => b.setAttribute("aria-pressed", anyVisible ? "false" : "true"));
    allButton.setAttribute("aria-pressed", anyVisible ? "false" : "true");
    announceStatus(anyVisible ? t("allHidden") : t("allShown"));
  });
  container.appendChild(allButton);
}

// Replaces a label group's <text> content with Sheet-provided text, wrapping
// multi-line entries in <tspan>s. Labels flagged align:"right" (Sheet column
// `text_align`) measure their original, as-drawn right edge via getBBox()
// before the swap and re-anchor there with text-anchor:end, so replacement
// text of any length grows leftward — away from a leader line on the right —
// instead of growing rightward over it.
function patchLabelText(el, info) {
  if (!info || !info.text) return;
  const textNode = el.querySelector("text");
  if (!textNode) return;

  const alignEnd = info.align === "right";
  let anchorX = textNode.getAttribute("x") || "0";

  if (alignEnd) {
    const bbox = textNode.getBBox();
    anchorX = bbox.x + bbox.width;
    textNode.setAttribute("text-anchor", "end");
  }

  while (textNode.firstChild) textNode.removeChild(textNode.firstChild);

  String(info.text).split(/\r?\n/).forEach((line, index) => {
    const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    tspan.textContent = line;
    tspan.setAttribute("x", anchorX);
    if (index === 0) {
      tspan.setAttribute("y", textNode.getAttribute("y") || "0");
    } else {
      tspan.setAttribute("dy", "1em");
    }
    textNode.appendChild(tspan);
  });
}

// TEMPLATE 2: Animated Layer Explorer
function initLayerExplorer(container) {
  const steps = (state.config && (state.config.animations || state.config.steps)) || [
    { step_id: "step-1", order: 1, element_id: "Label_Right_atrium", action: "highlight", duration: 800, caption: "Deoxygenated blood enters the Right Atrium." },
    { step_id: "step-2", order: 2, element_id: "Label_Right_ventricle", action: "pulse", duration: 1000, caption: "Blood flows down into the Right Ventricle." },
    { step_id: "step-3", order: 3, element_id: "Label_Pulmonary_artery", action: "fade-in", duration: 700, caption: "Blood is pumped to the lungs through the Pulmonary Artery." },
    { step_id: "step-4", order: 4, element_id: "Label_Aorta", action: "highlight", duration: 800, caption: "Oxygenated blood is distributed to the body via the Aorta." }
  ];

  const controlsDiv = document.createElement("div");
  controlsDiv.className = "playback-controls";
  controlsDiv.innerHTML = `
    <button type="button" id="btn-prev">${t("prev")}</button>
    <button type="button" id="btn-play">${t("play")}</button>
    <button type="button" id="btn-next">${t("next")}</button>
    <button type="button" id="btn-restart">${t("restart")}</button>
    <label style="margin-left:12px; cursor:pointer;">
      <input type="checkbox" id="chk-reduced-motion" ${state.isReducedMotion ? "checked" : ""}> ${t("reduceMotion")}
    </label>
  `;

  const captionBox = document.createElement("div");
  captionBox.className = "caption-box";
  captionBox.id = "step-caption";
  captionBox.setAttribute("aria-live", "polite");

  container.appendChild(controlsDiv);
  container.appendChild(captionBox);

  const btnPlay = document.getElementById("btn-play");
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const btnRestart = document.getElementById("btn-restart");
  const chkMotion = document.getElementById("chk-reduced-motion");

  chkMotion.addEventListener("change", (e) => {
    state.isReducedMotion = e.target.checked;
    announceStatus(state.isReducedMotion ? t("motionEnabled") : t("motionDisabled"));
  });

  btnPlay.addEventListener("click", () => {
    if (state.isPlaying) {
      pauseAnimation(btnPlay);
    } else {
      playAnimation(steps, btnPlay);
    }
  });

  btnPrev.addEventListener("click", () => {
    pauseAnimation(btnPlay);
    if (state.currentStepIndex > 0) {
      state.currentStepIndex--;
      applyAnimationStep(steps[state.currentStepIndex]);
    }
  });

  btnNext.addEventListener("click", () => {
    pauseAnimation(btnPlay);
    if (state.currentStepIndex < steps.length - 1) {
      state.currentStepIndex++;
      applyAnimationStep(steps[state.currentStepIndex]);
    }
  });

  btnRestart.addEventListener("click", () => {
    pauseAnimation(btnPlay);
    state.currentStepIndex = 0;
    clearSvgEffects();
    applyAnimationStep(steps[0]);
  });

  applyAnimationStep(steps[0]);
}

function applyAnimationStep(stepData) {
  if (!stepData) return;

  clearSvgEffects();
  const captionBox = document.getElementById("step-caption");
  if (captionBox) captionBox.textContent = `Step ${stepData.order || state.currentStepIndex + 1}: ${stepData.caption}`;

  const targetEl = document.getElementById(stepData.element_id);
  if (!targetEl) return;

  if (state.isReducedMotion) {
    targetEl.style.display = "";
    targetEl.classList.add("svg-highlight");
    return;
  }

  const duration = (stepData.duration || 800) / state.playbackSpeed;
  targetEl.style.setProperty("--anim-duration", `${duration}ms`);

  switch (stepData.action) {
    case "fade-in":
      targetEl.style.display = "";
      targetEl.style.opacity = "0";
      targetEl.classList.add("svg-fade-transition");
      setTimeout(() => { targetEl.style.opacity = "1"; }, 20);
      break;

    case "pulse":
      targetEl.style.display = "";
      targetEl.classList.add("svg-pulse");
      break;

    case "highlight":
    default:
      targetEl.style.display = "";
      targetEl.classList.add("svg-highlight");
      break;
  }
}

function playAnimation(steps, playButton) {
  state.isPlaying = true;
  playButton.textContent = t("pause");

  const advance = () => {
    if (!state.isPlaying) return;

    applyAnimationStep(steps[state.currentStepIndex]);

    if (state.currentStepIndex < steps.length - 1) {
      state.currentStepIndex++;
      const currentDuration = (steps[state.currentStepIndex].duration || 1000) + 1200;
      state.animationTimer = setTimeout(advance, currentDuration);
    } else {
      pauseAnimation(playButton);
      announceStatus(t("playbackComplete"));
    }
  };

  advance();
}

function pauseAnimation(playButton) {
  state.isPlaying = false;
  if (playButton) playButton.textContent = t("play");
  if (state.animationTimer) clearTimeout(state.animationTimer);
}

function clearSvgEffects() {
  if (!state.svgElement) return;
  const elements = state.svgElement.querySelectorAll(".svg-highlight, .svg-pulse, .svg-fade-transition");
  elements.forEach((el) => {
    el.classList.remove("svg-highlight", "svg-pulse", "svg-fade-transition");
    el.style.opacity = "";
  });
}

// TEMPLATE 3: Sequence Builder — reveals SVG layers one at a time, in a
// fixed order. Viewers can step manually with "Reveal Next" or press Play to
// auto-advance using each step's Sheet-authored `delay_ms`; either way it
// stops for good once the last step has been revealed.
const DEFAULT_SEQUENCE_DELAY_MS = 3000;

function initSequenceBuilder(container) {
  const rows = (state.config && state.config.sequences) || [
    { item_id: "seq-1", element_id: "Label_Right_atrium", order: 1, caption: "Deoxygenated blood enters the Right Atrium." },
    { item_id: "seq-2", element_id: "Label_Right_ventricle", order: 2, caption: "Blood flows through the Tricuspid Valve into the Right Ventricle." },
    { item_id: "seq-3", element_id: "Label_Pulmonary_artery", order: 3, caption: "Blood is pumped to the lungs via the Pulmonary Artery." },
    { item_id: "seq-4", element_id: "Label_Left_atrium", order: 4, caption: "Oxygenated blood returns to the Left Atrium via the Pulmonary Veins." }
  ];

  const sequence = toSequenceSteps(rows);

  stopSequenceTimer();
  state.isSequencePlaying = false;
  state.sequenceSteps = sequence;
  state.currentStepIndex = -1; // nothing revealed yet

  // Hide every target layer up front so the illustration builds up in order
  // rather than starting fully visible.
  sequence.forEach((step) => {
    const el = document.getElementById(step.elementId);
    if (el) el.classList.add("is-hidden");
  });

  const controlsDiv = document.createElement("div");
  controlsDiv.className = "playback-controls";
  controlsDiv.innerHTML = `
    <button type="button" id="btn-sequence-play">${t("play")}</button>
    <button type="button" id="btn-reveal-next">${t("revealNext")}</button>
    <button type="button" id="btn-sequence-restart">${t("restart")}</button>
    <label style="margin-left:12px; cursor:pointer;">
      <input type="checkbox" id="chk-reduced-motion-seq" ${state.isReducedMotion ? "checked" : ""}> ${t("reduceMotion")}
    </label>
  `;

  const captionBox = document.createElement("div");
  captionBox.className = "caption-box";
  captionBox.id = "sequence-caption";
  captionBox.setAttribute("aria-live", "polite");

  container.appendChild(controlsDiv);
  container.appendChild(captionBox);

  const controls = {
    btnPlay: document.getElementById("btn-sequence-play"),
    btnNext: document.getElementById("btn-reveal-next"),
    captionBox
  };
  const btnRestart = document.getElementById("btn-sequence-restart");
  const chkMotion = document.getElementById("chk-reduced-motion-seq");

  // An empty `sequences` result means no Sheet rows matched this diagram —
  // say so instead of leaving buttons that silently do nothing.
  if (sequence.length === 0) {
    captionBox.textContent = t("noSequenceSteps");
    controls.btnPlay.disabled = true;
    controls.btnNext.disabled = true;
    btnRestart.disabled = true;
    return;
  }

  captionBox.textContent = t("sequenceReady")(sequence.length);

  chkMotion.addEventListener("change", (e) => {
    state.isReducedMotion = e.target.checked;
    announceStatus(state.isReducedMotion ? t("motionEnabled") : t("motionDisabled"));
  });

  controls.btnPlay.addEventListener("click", () => toggleSequencePlayback(controls));
  controls.btnNext.addEventListener("click", () => {
    revealNextInSequence(controls);
    if (state.isSequencePlaying) scheduleNextReveal(controls);
  });
  btnRestart.addEventListener("click", () => restartSequence(controls));
}

// Normalizes Sheet rows into ordered steps. Accepts either `element_id`
// (matches the `animations` tab convention) or a bare `item_id` for sheets
// that reuse it as the SVG id, and sorts by `order`/`expected_order` since
// Sheet rows aren't guaranteed pre-sorted.
function toSequenceSteps(rows) {
  return rows
    .map((row, i) => ({
      elementId: row.element_id || row.item_id,
      order: Number(row.order || row.expected_order) || i + 1,
      caption: row.caption || row.label || "",
      delayMs: row.delay_ms
    }))
    .sort((a, b) => a.order - b.order)
    .map((step, i) => ({ ...step, delayMs: resolveDelayMs(step.delayMs, i) }));
}

// Blank/invalid delay: start the first step right away, wait the default
// between the rest.
function resolveDelayMs(raw, index) {
  const ms = Number(raw);
  if (raw === "" || raw == null || !Number.isFinite(ms)) {
    return index === 0 ? 0 : DEFAULT_SEQUENCE_DELAY_MS;
  }
  return Math.max(0, ms);
}

function isSequenceComplete() {
  return state.currentStepIndex >= state.sequenceSteps.length - 1;
}

function revealNextInSequence(controls) {
  const sequence = state.sequenceSteps;
  if (isSequenceComplete()) return; // already played through once

  state.currentStepIndex++;
  const step = sequence[state.currentStepIndex];
  const el = document.getElementById(step.elementId);

  if (el) {
    el.classList.remove("is-hidden");
    if (!state.isReducedMotion) {
      el.style.setProperty("--anim-duration", "600ms");
      el.style.opacity = "0";
      el.classList.add("svg-fade-transition");
      requestAnimationFrame(() => { el.style.opacity = "1"; });
    }
  }

  controls.captionBox.textContent = `Step ${state.currentStepIndex + 1} of ${sequence.length}: ${step.caption}`;

  if (isSequenceComplete()) {
    stopSequenceTimer();
    state.isSequencePlaying = false;
    controls.btnPlay.textContent = t("play");
    controls.btnPlay.disabled = true;
    controls.btnNext.disabled = true;
    controls.btnNext.textContent = t("sequenceComplete");
    announceStatus(t("sequenceCompleteAnnounce"));
  }
}

// Waits the upcoming step's `delay_ms`, reveals it, and chains to the next
// until the sequence ends or playback is paused.
function scheduleNextReveal(controls) {
  stopSequenceTimer();
  if (isSequenceComplete()) return;

  const upcoming = state.sequenceSteps[state.currentStepIndex + 1];
  state.sequenceTimer = setTimeout(() => {
    revealNextInSequence(controls);
    if (state.isSequencePlaying) scheduleNextReveal(controls);
  }, upcoming.delayMs);
}

function toggleSequencePlayback(controls) {
  if (state.isSequencePlaying) {
    state.isSequencePlaying = false;
    stopSequenceTimer();
    controls.btnPlay.textContent = t("play");
    announceStatus(t("sequencePaused"));
  } else {
    state.isSequencePlaying = true;
    controls.btnPlay.textContent = t("pause");
    announceStatus(t("sequencePlaying"));
    scheduleNextReveal(controls);
  }
}

function stopSequenceTimer() {
  clearTimeout(state.sequenceTimer);
  state.sequenceTimer = null;
}

function restartSequence(controls) {
  stopSequenceTimer();
  state.isSequencePlaying = false;

  state.sequenceSteps.forEach((step) => {
    const el = document.getElementById(step.elementId);
    if (el) {
      el.classList.add("is-hidden");
      el.classList.remove("svg-fade-transition");
      el.style.opacity = "";
    }
  });

  state.currentStepIndex = -1;
  controls.btnPlay.disabled = false;
  controls.btnPlay.textContent = t("play");
  controls.btnNext.disabled = false;
  controls.btnNext.textContent = t("revealNext");
  controls.captionBox.textContent = t("sequenceReady")(state.sequenceSteps.length);
  announceStatus(t("sequenceReset"));
}

// 6. Utility: Screen Reader Announcements
function announceStatus(message) {
  const announcer = document.getElementById("sr-status");
  if (announcer) {
    announcer.textContent = message;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initInteractiveApp();
});
```

### D. Google Apps Script Backend (`Code.gs`)

**Lives outside this repository** — deployed directly from the Google Apps Script editor bound to the Sheet. A working copy is kept at `~/Desktop/code.gs`; after any edit here, it must be re-deployed (**Deploy → Manage deployments → Edit → New version**) for the live `/exec` URL to pick up the change, and `APPS_SCRIPT_URL` in `app.js` updated if the deployment URL changes.

```javascript
/***********************
 * 1) JSON API for labels
 *    /exec?lang=en
 ***********************/
function doGet(e) {
  var lang = (e.parameter.lang || 'en').toLowerCase(); // e.g., en, es
  var diagramId = (e.parameter.diagram || 'heart').toLowerCase();

  var ss = SpreadsheetApp.getActive();

  // ----- 1) LABELS -----
  var labelSheet = ss.getSheetByName('labels');
  var labelRows = [];
  var languages = { en: true }; // every diagram has English; others added when the Sheet has content for them
  if (labelSheet) {
    var values = labelSheet.getDataRange().getValues();
    if (values.length > 1) {
      var header = values.shift();

      function idx(name) { return header.indexOf(name); }

      var idCol        = idx('svg_id');
      var enCol        = idx('en_text');
      var tooltipEnCol = idx('tooltip_en');
      var visibleCol   = idx('visible_default');
      var alignCol     = idx('text_align');   // optional; 'right' for labels that must grow away from a leader line on their right
      var langCol      = idx(lang + '_text'); // e.g. "es_text"
      var diagramCol   = idx('diagram_id');   // optional; if missing, all rows assumed for this diagram

      var diagramLabelRows = values.filter(function (r) {
        if (idCol === -1 || !r[idCol]) return false; // need svg_id
        if (diagramCol === -1) return true;          // no diagram_id column yet -> include all
        return String(r[diagramCol]).toLowerCase() === diagramId;
      });

      // A "<code>_text" column (e.g. es_text) with any text for this diagram
      // makes that language available in the page's language toggle.
      header.forEach(function (name, col) {
        var m = /^([a-z]{2})_text$/.exec(String(name));
        if (!m) return;
        var hasText = diagramLabelRows.some(function (r) { return String(r[col] || '').trim() !== ''; });
        if (hasText) languages[m[1]] = true;
      });

      labelRows = diagramLabelRows
        .map(function (r) {
          var en = enCol !== -1 ? r[enCol] : '';
          var localized = (langCol !== -1 && r[langCol]) ? r[langCol] : en;
          var tooltip = tooltipEnCol !== -1 ? (r[tooltipEnCol] || '') : '';
          var visRaw = visibleCol !== -1 ? String(r[visibleCol]) : 'TRUE';
          var alignRaw = alignCol !== -1 ? String(r[alignCol] || '').toLowerCase() : 'left';

          return {
            id: r[idCol],
            text: localized || '',
            tooltip: tooltip,
            visible: visRaw.toLowerCase() === 'true',
            align: alignRaw === 'right' ? 'right' : 'left'
          };
        });
    }
  }

  // ----- 2) DIAGRAM META (title + desc) -----
  var metaSheet = ss.getSheetByName('diagram_meta');
  var meta = { title: '', desc: '' };

  if (metaSheet) {
    var mValues = metaSheet.getDataRange().getValues();
    if (mValues.length > 1) {
      var mHeader = mValues.shift();
      function midx(name) { return mHeader.indexOf(name); }

      var dIdCol  = midx('diagram_id');
      var langCol = midx('lang');
      var titleCol= midx('title');
      var descCol = midx('desc');

      // A diagram_meta row in a language also makes that language available.
      mValues.forEach(function (r) {
        if (dIdCol === -1 || langCol === -1) return;
        if (String(r[dIdCol]).toLowerCase() !== diagramId) return;
        var rowLang = String(r[langCol]).toLowerCase().trim();
        if (rowLang && (r[titleCol] || r[descCol])) languages[rowLang] = true;
      });

      var row = mValues.find(function (r) {
        var idMatch = (dIdCol !== -1) && String(r[dIdCol]).toLowerCase() === diagramId;
        var langMatch = (langCol === -1) || String(r[langCol]).toLowerCase() === lang;
        return idMatch && langMatch;
      });

      if (row) {
        meta.title = titleCol !== -1 ? (row[titleCol] || '') : '';
        meta.desc  = descCol  !== -1 ? (row[descCol]  || '') : '';
      }
    }
  }

  // ----- 3) ANIMATIONS (Layer Explorer steps) -----
  var animSheet = ss.getSheetByName('animations');
  var animRows = [];
  if (animSheet) {
    var aValues = animSheet.getDataRange().getValues();
    if (aValues.length > 1) {
      var aHeader = aValues.shift();
      function aidx(name) { return aHeader.indexOf(name); }

      var actIdCol   = aidx('activity_id') !== -1 ? aidx('activity_id') : aidx('diagram_id');
      var stepIdCol  = aidx('step_id');
      var orderCol   = aidx('order');
      var elemIdCol  = aidx('element_id');
      var actionCol  = aidx('action');
      var durCol     = aidx('duration');
      var captionCol = aidx('caption');

      animRows = aValues
        .filter(function (r) {
          if (elemIdCol === -1 || !r[elemIdCol]) return false;
          if (actIdCol === -1) return true;
          return String(r[actIdCol]).toLowerCase() === diagramId;
        })
        .map(function (r) {
          return {
            step_id: stepIdCol !== -1 ? String(r[stepIdCol]) : '',
            order: orderCol !== -1 ? Number(r[orderCol]) || 1 : 1,
            element_id: String(r[elemIdCol]),
            action: actionCol !== -1 ? String(r[actionCol]) : 'highlight',
            duration: durCol !== -1 ? Number(r[durCol]) || 800 : 800,
            caption: captionCol !== -1 ? String(r[captionCol]) : ''
          };
        });
    }
  }

  // ----- 4) SEQUENCES (Sequence Builder steps) -----
  var seqSheet = ss.getSheetByName('sequences');
  var seqRows = [];
  if (seqSheet) {
    var sValues = seqSheet.getDataRange().getValues();
    if (sValues.length > 1) {
      var sHeader = sValues.shift();
      function sidx(name) { return sHeader.indexOf(name); }

      var sActIdCol   = sidx('activity_id') !== -1 ? sidx('activity_id') : sidx('diagram_id');
      var itemIdCol   = sidx('item_id');
      var expOrderCol = sidx('expected_order');
      var sCaptionCol = sidx('caption');
      var feedbackCol = sidx('feedback');
      var delayCol    = sidx('delay_ms');    // optional; ms to wait before this step appears during Play

      seqRows = sValues
        .filter(function (r) {
          if (itemIdCol === -1 || !r[itemIdCol]) return false;
          if (sActIdCol === -1) return true;
          return String(r[sActIdCol]).toLowerCase() === diagramId;
        })
        .map(function (r) {
          return {
            item_id: String(r[itemIdCol]),
            expected_order: expOrderCol !== -1 ? Number(r[expOrderCol]) || 1 : 1,
            caption: sCaptionCol !== -1 ? String(r[sCaptionCol]) : '',
            feedback: feedbackCol !== -1 ? String(r[feedbackCol]) : '',
            // null when blank so the page applies its own default delay
            delay_ms: (delayCol !== -1 && r[delayCol] !== '') ? Number(r[delayCol]) : null
          };
        });
    }
  }

  var payload = {
    meta: meta,
    labels: labelRows,
    animations: animRows,
    sequences: seqRows,
    languages: Object.keys(languages)
  };

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}


/**************************************
 * 2) Import label text + ids from SVG
 *
 * Usage:
 * - Sheet "svg_raw": paste SVG (or label chunk) into A1
 * - Sheet "imported_labels": will be filled with en_text, svg_id, visible_default
 **************************************/
function importLabelsFromSvg() {
  var ss    = SpreadsheetApp.getActive();
  var rawSh = ss.getSheetByName('svg_raw');
  var outSh = ss.getSheetByName('imported_labels');

  if (!rawSh || !outSh) {
    SpreadsheetApp.getUi().alert('Need sheets named "svg_raw" and "imported_labels".');
    return;
  }

  var svgText = rawSh.getRange('A1').getValue();
  if (!svgText) {
    SpreadsheetApp.getUi().alert('Cell A1 of "svg_raw" is empty.');
    return;
  }

  // Regex to capture:
  //   1) group id="Label_*"
  //   2) the inner <text>...</text> content (including tspans)
  var re = /<g[^>]*id="(Label_[^"]+)"[^>]*>[\s\S]*?<text[^>]*>([\s\S]*?)<\/text>[\s\S]*?<\/g>/g;

  var rows = [["en_text", "svg_id", "visible_default"]]; // header row
  var match;

  while ((match = re.exec(svgText)) !== null) {
    var id  = match[1];
    var raw = match[2];

    // 1) Insert a space between consecutive tspan blocks
    raw = raw.replace(/<\/tspan>\s*<tspan[^>]*>/g, ' ');

    // 2) Strip remaining tags & normalize whitespace
    var text = raw
      .replace(/<[^>]+>/g, "")  // remove tags
      .replace(/\s+/g, " ")     // collapse whitespace
      .trim();

    // Default visibility = TRUE for every imported label
    rows.push([text, id, true]);
  }

  outSh.clearContents();
  if (rows.length > 1) {
    outSh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  } else {
    outSh.getRange(1, 1).setValue('No Label_* groups found.');
  }
}

/**************************************
 * 3) List every element id in svg_raw (helper for animations/sequences)
 *
 * Usage:
 * - Sheet "svg_raw": same source used by the label import above
 * - Sheet "svg_element_ids": will be filled with every id found + a naive type guess
 **************************************/
function listElementIdsFromSvg() {
  var ss    = SpreadsheetApp.getActive();
  var rawSh = ss.getSheetByName('svg_raw');
  var outSh = ss.getSheetByName('svg_element_ids');

  if (!rawSh || !outSh) {
    SpreadsheetApp.getUi().alert('Need sheets named "svg_raw" and "svg_element_ids".');
    return;
  }

  var svgText = rawSh.getRange('A1').getValue();
  if (!svgText) {
    SpreadsheetApp.getUi().alert('Cell A1 of "svg_raw" is empty.');
    return;
  }

  var idRe = /id="([^"]+)"/g;
  var seen = {};
  var rows = [["element_id", "id_type"]];
  var match;

  while ((match = idRe.exec(svgText)) !== null) {
    var id = match[1];
    if (seen[id]) continue;
    seen[id] = true;

    var guess = id.indexOf('Label_') === 0 ? 'label'
              : id.indexOf('structure-') === 0 ? 'structure'
              : id.indexOf('layer-') === 0 ? 'layer'
              : 'other';

    rows.push([id, guess]);
  }

  outSh.clearContents();
  outSh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
}

/**************************************
 * 4) Custom menu: "Labels" → import/list helpers
 **************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Labels')
    .addItem('Import labels from SVG', 'importLabelsFromSvg')
    .addItem('List all element ids from SVG', 'listElementIdsFromSvg')
    .addToUi();
}
```

Note: this `doGet()` has no server-side `CacheService` layer (unlike an earlier draft of this backend) — the only caching is client-side, in `app.js`'s `fetchWithCache()` (Section 4C), keyed separately for the SVG (`cache_svg_{diagram}`) and the API payload (`cache_api_{diagram}_{lang}`). Both use stale-while-revalidate: a cached value is shown immediately while a fresh copy is fetched in the background for *next* load — meaning a plain reload after editing the Sheet can still show stale data. To force a fresh load: `localStorage.clear()` in the browser console, then reload.

## 5. Known Gaps / Deliberate Non-Goals

- **Animation/sequence captions are English-only.** The `animations` and `sequences` tabs each have a single `caption` column, no `caption_es` equivalent — switching to Spanish only re-localizes labels, the diagram title/description, and the fixed UI chrome, not step narration. Extending this would mean adding `caption_es` columns and reading them the same way `labels.es_text` is read.
- **`text_align` only supports `left`/`right`**, not vertical (`top`/`bottom`) growth direction — fine for this two-column layout (labels flanking the illustration left/right), but would need a different anchor axis for a diagram with labels above/below.
- Diagram/label data for a new illustration is entirely manual to author (no bulk-import beyond id/caption scraping) — `feedback` in `sequences` is unused by the current activity and safe to ignore, kept only because Apps Script code once used it.

## 6. Workflow

### Adding a new illustration
1. Export from Illustrator via **File → Export → Export As… → SVG** (Styling: Internal CSS; Font: SVG for Label Studio diagrams, since label text is patched from the Sheet — Convert to Outlines is fine for sequence-builder/layer-explorer diagrams; Images: Embed; Object IDs: Layer Names; Minify off; Responsive on). Use a lowercase filename — `?diagram=` is lowercased before fetching.
2. Drop the file in `assets/source/` — any number of SVGs can go here.
3. Run `node tools/prepare-svg/index.js` — batch-processes every `.svg` in `assets/source/` into `assets/prepared/` + `assets/manifests/`, auto-repairing missing font fallbacks and flagging duplicate ids / missing viewBox / inline scripts along the way.
4. Add Sheet rows for the new `diagram_id` across whichever of `labels` / `diagram_meta` / `animations` / `sequences` tabs the new illustration needs, using `svg_element_ids` (via the "List all element ids from SVG" menu item) to avoid id typos.
5. Load it with `index.html?diagram=<id>&mode=<mode>`.

### Testing a Sheet/backend change
1. Edit `~/Desktop/code.gs`, paste into the Apps Script editor.
2. **Deploy → Manage deployments → Edit (pencil icon) → New version** — editing alone does not update the live `/exec` URL.
3. If the deployment URL changed, update `APPS_SCRIPT_URL` in `app.js` and push.
4. In the browser: `localStorage.clear(); location.reload();` to bypass the client-side cache. If a change still doesn't appear, also check for a stale browser *HTTP* cache (separate from `localStorage`) — a true hard reload (DevTools → right-click reload → "Empty Cache and Hard Reload") or an Incognito window rules that out definitively.

### Git sync
```bash
git add .
git commit -m "..."
git push origin main
```

### Production packaging (future option, not yet in use)
To eliminate Apps Script network latency for a published/offline build: keep the Sheet + Apps Script as the authoring environment, but save a static snapshot of its JSON payload to `assets/manifests/{diagram}.json` and point `app.js` at that local file instead of `APPS_SCRIPT_URL` for a given release.
