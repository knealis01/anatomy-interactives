/**
 * Interactive SVG Course Engine & Activity Toolkit
 * Activity Modes: Label Studio, Animated Layer Explorer, Process Sequence Builder
 * Performance: Stale-While-Revalidate Browser Caching (localStorage)
 * Standards Target: WCAG 2.2 Level AA Accessibility
 */

// 1. Configuration & URL Parameters
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyTMCVI_Kf1YP354ZqBTN0InblHOPQGtOV8HNdKV4Zr0SHobq9lTPlaJznQemHy8iWc/exec";

const urlParams = new URLSearchParams(window.location.search);
const diagramId = (urlParams.get("diagram") || "heart").toLowerCase();
const activeMode = (urlParams.get("mode") || "label-studio").toLowerCase(); // 'label-studio' | 'layer-explorer' | 'sequence-builder'
const lang = (urlParams.get("lang") || "en").toLowerCase();

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
  sequenceSteps: []
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

// 5. Main Application Initialization (Fault-Tolerant)
async function initInteractiveApp() {
  injectAnimationStyles();

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
    applyDiagramMeta(state.config.meta);

    toolbarContainer.innerHTML = "";

    switch (activeMode) {
      case "sequence-builder":
        initSequenceBuilder(toolbarContainer);
        break;
      case "layer-explorer":
        initLayerExplorer(toolbarContainer);
        break;
      case "label-studio":
      default:
        initLabelStudio(toolbarContainer);
        break;
    }

    announceStatus("Activity data loaded and ready.");
  } catch (apiError) {
    console.warn("API Endpoint Warning (using default controls):", apiError);
    // Fallback config if Apps Script API endpoint times out or is offline
    state.config = state.config || {};
    if (errorBox) errorBox.hidden = false;
    announceStatus("Activity data unavailable; showing default content.");

    toolbarContainer.innerHTML = "";
    switch (activeMode) {
      case "sequence-builder":
        initSequenceBuilder(toolbarContainer);
        break;
      case "label-studio":
        initLabelStudio(toolbarContainer);
        break;
      case "layer-explorer":
      default:
        initLayerExplorer(toolbarContainer);
        break;
    }
  }
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

    el.classList.toggle("is-hidden", !isVisible);
    if (info && info.tooltip) {
      el.setAttribute("aria-label", info.tooltip);
      el.setAttribute("title", info.tooltip);
    }
    patchLabelText(el, info);

    button.addEventListener("click", () => {
      const hidden = el.classList.toggle("is-hidden");
      button.setAttribute("aria-pressed", hidden ? "false" : "true");
      announceStatus(`${button.textContent} label ${hidden ? "hidden" : "shown"}.`);
    });

    container.appendChild(button);
    buttons.push(button);
  });

  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.id = "toggle-all";
  allButton.textContent = "Toggle All";
  allButton.setAttribute("aria-pressed", "false");
  allButton.addEventListener("click", () => {
    const anyVisible = labelEls.some((el) => !el.classList.contains("is-hidden"));
    labelEls.forEach((el) => el.classList.toggle("is-hidden", anyVisible));
    buttons.forEach((b) => b.setAttribute("aria-pressed", anyVisible ? "false" : "true"));
    allButton.setAttribute("aria-pressed", anyVisible ? "false" : "true");
    announceStatus(anyVisible ? "All labels hidden." : "All labels shown.");
  });
  container.appendChild(allButton);
}

// Replaces a label group's <text> content with Sheet-provided text, wrapping
// multi-line entries in <tspan>s anchored to the original x/y position.
function patchLabelText(el, info) {
  if (!info || !info.text) return;
  const textNode = el.querySelector("text");
  if (!textNode) return;

  while (textNode.firstChild) textNode.removeChild(textNode.firstChild);

  String(info.text).split(/\r?\n/).forEach((line, index) => {
    const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    tspan.textContent = line;
    tspan.setAttribute("x", textNode.getAttribute("x") || "0");
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
    <button type="button" id="btn-prev" aria-label="Previous step">⏮ Previous</button>
    <button type="button" id="btn-play" aria-label="Play animation">▶ Play</button>
    <button type="button" id="btn-next" aria-label="Next step">Next ⏭</button>
    <button type="button" id="btn-restart" aria-label="Restart sequence">↺ Restart</button>
    <label style="margin-left:12px; cursor:pointer;">
      <input type="checkbox" id="chk-reduced-motion" ${state.isReducedMotion ? "checked" : ""}> Reduce Motion
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
    announceStatus(`Reduced motion ${state.isReducedMotion ? "enabled" : "disabled"}.`);
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
  if (!targetEl) {
    announceStatus(`Step ${stepData.order}: ${stepData.caption}`);
    return;
  }

  if (state.isReducedMotion) {
    targetEl.style.display = "";
    targetEl.classList.add("svg-highlight");
    announceStatus(`Step ${stepData.order}: ${stepData.caption}`);
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

  announceStatus(`Step ${stepData.order}: ${stepData.caption}`);
}

function playAnimation(steps, playButton) {
  state.isPlaying = true;
  playButton.textContent = "⏸ Pause";

  const advance = () => {
    if (!state.isPlaying) return;

    applyAnimationStep(steps[state.currentStepIndex]);

    if (state.currentStepIndex < steps.length - 1) {
      state.currentStepIndex++;
      const currentDuration = (steps[state.currentStepIndex].duration || 1000) + 1200;
      state.animationTimer = setTimeout(advance, currentDuration);
    } else {
      pauseAnimation(playButton);
      announceStatus("Sequence playback completed.");
    }
  };

  advance();
}

function pauseAnimation(playButton) {
  state.isPlaying = false;
  if (playButton) playButton.textContent = "▶ Play";
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
// fixed order, advancing only on explicit button click (no autoplay timer),
// and stopping for good once the last step has been revealed.
function initSequenceBuilder(container) {
  const rows = (state.config && state.config.sequences) || [
    { item_id: "seq-1", element_id: "Label_Right_atrium", order: 1, caption: "Deoxygenated blood enters the Right Atrium." },
    { item_id: "seq-2", element_id: "Label_Right_ventricle", order: 2, caption: "Blood flows through the Tricuspid Valve into the Right Ventricle." },
    { item_id: "seq-3", element_id: "Label_Pulmonary_artery", order: 3, caption: "Blood is pumped to the lungs via the Pulmonary Artery." },
    { item_id: "seq-4", element_id: "Label_Left_atrium", order: 4, caption: "Oxygenated blood returns to the Left Atrium via the Pulmonary Veins." }
  ];

  // Accept either `element_id` (matches the `animations` tab convention) or
  // a bare `item_id` for sheets that reuse it as the SVG id, and sort by
  // `order`/`expected_order` since Sheet rows aren't guaranteed pre-sorted.
  const sequence = rows
    .map((row, i) => ({
      elementId: row.element_id || row.item_id,
      order: Number(row.order || row.expected_order) || i + 1,
      caption: row.caption || row.label || ""
    }))
    .sort((a, b) => a.order - b.order);

  state.sequenceSteps = sequence;
  state.currentStepIndex = -1; // nothing revealed yet

  // Hide every target layer up front so "Reveal Next" builds the
  // illustration up in order rather than starting fully visible.
  sequence.forEach((step) => {
    const el = document.getElementById(step.elementId);
    if (el) el.classList.add("is-hidden");
  });

  const controlsDiv = document.createElement("div");
  controlsDiv.className = "playback-controls";
  controlsDiv.innerHTML = `
    <button type="button" id="btn-reveal-next">Reveal Next ⏭</button>
    <button type="button" id="btn-sequence-restart" aria-label="Restart sequence">↺ Restart</button>
    <label style="margin-left:12px; cursor:pointer;">
      <input type="checkbox" id="chk-reduced-motion-seq" ${state.isReducedMotion ? "checked" : ""}> Reduce Motion
    </label>
  `;

  const captionBox = document.createElement("div");
  captionBox.className = "caption-box";
  captionBox.id = "sequence-caption";
  captionBox.setAttribute("aria-live", "polite");
  captionBox.textContent = `Ready — ${sequence.length} steps. Click "Reveal Next" to begin.`;

  container.appendChild(controlsDiv);
  container.appendChild(captionBox);

  const btnNext = document.getElementById("btn-reveal-next");
  const btnRestart = document.getElementById("btn-sequence-restart");
  const chkMotion = document.getElementById("chk-reduced-motion-seq");

  chkMotion.addEventListener("change", (e) => {
    state.isReducedMotion = e.target.checked;
    announceStatus(`Reduced motion ${state.isReducedMotion ? "enabled" : "disabled"}.`);
  });

  btnNext.addEventListener("click", () => revealNextInSequence(btnNext, captionBox));
  btnRestart.addEventListener("click", () => restartSequence(btnNext, captionBox));
}

function revealNextInSequence(btnNext, captionBox) {
  const sequence = state.sequenceSteps;
  if (state.currentStepIndex >= sequence.length - 1) return; // already played through once

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

  const stepLabel = `Step ${state.currentStepIndex + 1} of ${sequence.length}: ${step.caption}`;
  captionBox.textContent = stepLabel;
  announceStatus(stepLabel);

  if (state.currentStepIndex >= sequence.length - 1) {
    btnNext.disabled = true;
    btnNext.textContent = "Sequence Complete";
    announceStatus("Sequence complete.");
  }
}

function restartSequence(btnNext, captionBox) {
  state.sequenceSteps.forEach((step) => {
    const el = document.getElementById(step.elementId);
    if (el) {
      el.classList.add("is-hidden");
      el.classList.remove("svg-fade-transition");
      el.style.opacity = "";
    }
  });

  state.currentStepIndex = -1;
  btnNext.disabled = false;
  btnNext.textContent = "Reveal Next ⏭";
  captionBox.textContent = `Ready — ${state.sequenceSteps.length} steps. Click "Reveal Next" to begin.`;
  announceStatus("Sequence reset.");
}

// 6. Utility: Screen Reader Announcements
function announceStatus(message) {
  const announcer = document.getElementById("status-announcer");
  if (announcer) {
    announcer.textContent = message;
  }
}

document.addEventListener("DOMContentLoaded", initInteractiveApp);