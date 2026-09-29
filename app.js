/**
 * Interactive SVG Course Engine & Activity Toolkit
 * Activity Modes: Label Studio, Animated Layer Explorer, Process Sequence Builder
 * Performance: Stale-While-Revalidate Browser Caching (localStorage)
 * Standards Target: WCAG 2.2 Level AA Accessibility
 */

// 1. Configuration & URL Parameters
// Update this URL with your actual Google Apps Script Web App Deployment ID
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyiXN1jBX3VlhaOTY6RNDeadNPwKDWpQJw_2SXSmH2E-7CF--EoL5l8lbDzDdSni3LJ1g/exec";

const urlParams = new URLSearchParams(window.location.search);
const diagramId = (urlParams.get("diagram") || "heart").toLowerCase();
const activeMode = (urlParams.get("mode") || "layer-explorer").toLowerCase(); // 'label-studio' | 'layer-explorer' | 'sequence-builder'
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
  userSequence: []
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
    .sequence-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      margin-bottom: 8px;
      background: #f4f6f8;
      border: 1px solid #ccc;
      border-radius: 4px;
    }
    .sequence-controls button {
      margin-left: 4px;
      min-height: 44px;
      padding: 6px 12px;
      cursor: pointer;
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

    if (state.config && state.config.meta) {
      if (state.config.meta.title) document.getElementById("diagram-title").textContent = state.config.meta.title;
      if (state.config.meta.desc) document.getElementById("diagram-desc").textContent = state.config.meta.desc;
    }

    toolbarContainer.innerHTML = "";

    switch (activeMode) {
      case "label-studio":
        initLabelStudio(toolbarContainer);
        break;
      case "sequence-builder":
        initSequenceBuilder(toolbarContainer);
        break;
      case "layer-explorer":
      default:
        initLayerExplorer(toolbarContainer);
        break;
    }

  } catch (apiError) {
    console.warn("API Endpoint Warning (using default controls):", apiError);
    // Fallback config if Apps Script API endpoint times out or is offline
    state.config = state.config || {};
    toolbarContainer.innerHTML = "";
    initLayerExplorer(toolbarContainer);
  }
}

// TEMPLATE 1: SVG Label Studio
function initLabelStudio(container) {
  const labels = (state.config && state.config.labels) || [];
  if (labels.length === 0) {
    container.innerHTML = "<span>No label definitions found for this activity.</span>";
    return;
  }

  labels.forEach((label) => {
    const targetGroup = document.getElementById(label.id);
    const button = document.createElement("button");
    button.className = "toggle-btn";
    button.type = "button";
    button.textContent = label.text;
    
    let isVisible = label.visible !== false;
    button.setAttribute("aria-pressed", isVisible ? "true" : "false");
    
    if (targetGroup) targetGroup.style.display = isVisible ? "" : "none";

    button.addEventListener("click", () => {
      isVisible = !isVisible;
      button.setAttribute("aria-pressed", isVisible ? "true" : "false");
      if (targetGroup) targetGroup.style.display = isVisible ? "" : "none";
      announceStatus(`${label.text} label ${isVisible ? "shown" : "hidden"}.`);
    });

    container.appendChild(button);
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

// TEMPLATE 3: Process Sequence Builder
function initSequenceBuilder(container) {
  const sequences = (state.config && state.config.sequences) || [
    { item_id: "seq-1", label: "Deoxygenated blood enters Right Atrium", expected_order: 1, feedback: "Blood always enters the right atrium first from the vena cava." },
    { item_id: "seq-2", label: "Blood flows through Tricuspid Valve to Right Ventricle", expected_order: 2, feedback: "The tricuspid valve leads into the right ventricular chamber." },
    { item_id: "seq-3", label: "Right Ventricle pumps blood to Pulmonary Artery", expected_order: 3, feedback: "Deoxygenated blood travels via the pulmonary artery toward the lungs." },
    { item_id: "seq-4", label: "Oxygenated blood returns via Pulmonary Veins to Left Atrium", expected_order: 4, feedback: "Freshly oxygenated blood returns through pulmonary veins into the left atrium." }
  ];

  state.userSequence = [...sequences].sort(() => Math.random() - 0.5);

  const wrapper = document.createElement("div");
  wrapper.id = "sequence-list-container";
  
  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.textContent = "Check Sequence Order";
  checkBtn.style.marginTop = "12px";
  checkBtn.style.padding = "10px 16px";
  checkBtn.style.minHeight = "44px";

  const feedbackBox = document.createElement("div");
  feedbackBox.className = "caption-box";
  feedbackBox.id = "sequence-feedback";
  feedbackBox.style.display = "none";

  container.appendChild(wrapper);
  container.appendChild(checkBtn);
  container.appendChild(feedbackBox);

  renderSequenceList(wrapper);

  checkBtn.addEventListener("click", () => {
    let isCorrect = true;
    let feedbackText = "Great job! The sequence order is completely correct.";

    for (let i = 0; i < state.userSequence.length; i++) {
      if (state.userSequence[i].expected_order !== i + 1) {
        isCorrect = false;
        feedbackText = `Not quite. Examine step ${i + 1}: "${state.userSequence[i].label}". ${state.userSequence[i].feedback}`;
        break;
      }
    }

    feedbackBox.style.display = "block";
    feedbackBox.textContent = feedbackText;
    announceStatus(feedbackText);
  });
}

function renderSequenceList(container) {
  container.innerHTML = "";
  
  state.userSequence.forEach((item, index) => {
    const itemRow = document.createElement("div");
    itemRow.className = "sequence-item";
    
    const labelSpan = document.createElement("span");
    labelSpan.textContent = `${index + 1}. ${item.label}`;

    const controls = document.createElement("div");
    controls.className = "sequence-controls";

    const moveUpBtn = document.createElement("button");
    moveUpBtn.type = "button";
    moveUpBtn.textContent = "▲ Move Up";
    moveUpBtn.disabled = index === 0;
    moveUpBtn.setAttribute("aria-label", `Move ${item.label} up`);

    const moveDownBtn = document.createElement("button");
    moveDownBtn.type = "button";
    moveDownBtn.textContent = "▼ Move Down";
    moveDownBtn.disabled = index === state.userSequence.length - 1;
    moveDownBtn.setAttribute("aria-label", `Move ${item.label} down`);

    moveUpBtn.addEventListener("click", () => {
      [state.userSequence[index - 1], state.userSequence[index]] = [state.userSequence[index], state.userSequence[index - 1]];
      renderSequenceList(container);
      announceStatus(`Moved ${item.label} to position ${index}.`);
    });

    moveDownBtn.addEventListener("click", () => {
      [state.userSequence[index], state.userSequence[index + 1]] = [state.userSequence[index + 1], state.userSequence[index]];
      renderSequenceList(container);
      announceStatus(`Moved ${item.label} to position ${index + 2}.`);
    });

    controls.appendChild(moveUpBtn);
    controls.appendChild(moveDownBtn);
    itemRow.appendChild(labelSpan);
    itemRow.appendChild(controls);
    container.appendChild(itemRow);
  });
}

// 6. Utility: Screen Reader Announcements
function announceStatus(message) {
  const announcer = document.getElementById("status-announcer");
  if (announcer) {
    announcer.textContent = message;
  }
}

document.addEventListener("DOMContentLoaded", initInteractiveApp);