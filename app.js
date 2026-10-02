/**
 * Interactive SVG Course Engine & Activity Toolkit
 * Activity Modes: Label Studio, Animated Layer Explorer, Process Sequence Builder
 * Performance: Stale-While-Revalidate Browser Caching (localStorage)
 * Standards Target: WCAG 2.2 Level AA Accessibility
 */

// 1. Configuration & URL Parameters
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzUJqCg1olF5dEWwskggKmBnYWFqYU5FRUyJL3Wfll8okSKOdbaN2TPdy9eg-hlb5no/exec";

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