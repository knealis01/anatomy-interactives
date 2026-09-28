/**
 * Interactive SVG Course Engine & Activity Toolkit
 * Supports: Label Studio, Animated Layer Explorer, and Process Sequence Builder
 * Standards Target: WCAG 2.2 AA Accessibility
 */

// 1. Configuration & URL Parameters
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx4bJpbVqQEFL6D86QRbOIFPbbIuVRhvHbnhQ8rXRuZLZRfByfbLb3Z6ELh28YX96V9Ig/exec";

const urlParams = new URLSearchParams(window.location.search);
const diagramId = (urlParams.get("diagram") || "heart").toLowerCase();
const activeMode = (urlParams.get("mode") || "layer-explorer").toLowerCase(); // 'label-studio' | 'layer-explorer' | 'sequence-builder'
const lang = (urlParams.get("lang") || "en").toLowerCase();

// 2. State Management
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

// 3. Inject CSS Styles for SVG Animations & Highlights
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
      min-height: 36px;
      padding: 4px 8px;
      cursor: pointer;
    }
    .playback-controls {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
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

// 4. Main Initialization
async function initInteractiveApp() {
  injectAnimationStyles();
  
  const toolbarContainer = document.getElementById("toolbar-container");
  const svgContainer = document.getElementById("svg-container");
  
  try {
    // Concurrent fetch of SVG geometry and Google Sheets API payload
    const [svgResponse, apiResponse] = await Promise.all([
      fetch(`./assets/prepared/${diagramId}.svg`),
      fetch(`${APPS_SCRIPT_URL}?diagram=${diagramId}&lang=${lang}`)
    ]);

    if (!svgResponse.ok) throw new Error(`SVG file not found (Status ${svgResponse.status})`);
    if (!apiResponse.ok) throw new Error(`API Endpoint Error (Status ${apiResponse.status})`);

    const svgText = await svgResponse.text();
    state.config = await apiResponse.json();

    // Inject SVG into DOM
    svgContainer.innerHTML = svgText;
    state.svgElement = svgContainer.querySelector("svg");

    // Populate Page Metadata
    if (state.config.meta) {
      if (state.config.meta.title) document.getElementById("diagram-title").textContent = state.config.meta.title;
      if (state.config.meta.desc) document.getElementById("diagram-desc").textContent = state.config.meta.desc;
    }

    // Clear toolbar loader
    toolbarContainer.innerHTML = "";

    // Route to active Activity Template
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

  } catch (error) {
    console.error("Initialization Error:", error);
    toolbarContainer.innerHTML = `<span style="color:#d32f2f;">Error loading activity: ${error.message}</span>`;
  }
}

// ============================================================================
// TEMPLATE 1: SVG Label Studio
// ============================================================================
function initLabelStudio(container) {
  const labels = state.config.labels || [];
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

// ============================================================================
// TEMPLATE 2: Animated Layer Explorer
// ============================================================================
function initLayerExplorer(container) {
  // Use step configurations from Google Sheets backend or fallback defaults
  const steps = state.config.animations || state.config.steps || [
    { step_id: "step-1", order: 1, element_id: "Label_Right_atrium", action: "highlight", duration: 800, caption: "Deoxygenated blood enters the Right Atrium." },
    { step_id: "step-2", order: 2, element_id: "Label_Right_ventricle", action: "pulse", duration: 1000, caption: "Blood flows down into the Right Ventricle." },
    { step_id: "step-3", order: 3, element_id: "Label_Pulmonary_artery", action: "fade-in", duration: 700, caption: "Blood is pumped to the lungs through the Pulmonary Artery." },
    { step_id: "step-4", order: 4, element_id: "Label_Aorta", action: "highlight", duration: 800, caption: "Oxygenated blood is distributed to the body via the Aorta." }
  ];

  // Render Playback Controls
  const controlsDiv = document.createElement("div");
  controlsDiv.className = "playback-controls";
  controlsDiv.innerHTML = `
    <button type="button" id="btn-prev" aria-label="Previous step">⏮ Previous</button>
    <button type="button" id="btn-play" aria-label="Play animation">▶ Play</button>
    <button type="button" id="btn-next" aria-label="Next step">Next ⏭</button>
    <button type="button" id="btn-restart" aria-label="Restart sequence">↺ Restart</button>
    <label style="margin-left:12px;">
      <input type="checkbox" id="chk-reduced-motion" ${state.isReducedMotion ? "checked" : ""}> Reduce Motion
    </label>
  `;

  const captionBox = document.createElement("div");
  captionBox.className = "caption-box";
  captionBox.id = "step-caption";
  captionBox.setAttribute("aria-live", "polite");

  container.appendChild(controlsDiv);
  container.appendChild(captionBox);

  // Bind Control Event Handlers
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

  // Load first step
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

  // If user prefers reduced motion, render state changes instantly without transitions
  if (state.isReducedMotion) {
    targetEl.style.display = "";
    targetEl.classList.add("svg-highlight");
    announceStatus(`Step ${stepData.order}: ${stepData.caption}`);
    return;
  }

  // Execute Action Type
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

// ============================================================================
// TEMPLATE 3: Process Sequence Builder (WCAG Keyboard-Accessible)
// ============================================================================
function initSequenceBuilder(container) {
  const sequences = state.config.sequences || [
    { item_id: "seq-1", label: "Deoxygenated blood enters Right Atrium", expected_order: 1, feedback: "Blood always enters the right atrium first from the vena cava." },
    { item_id: "seq-2", label: "Blood flows through Tricuspid Valve to Right Ventricle", expected_order: 2, feedback: "The tricuspid valve leads into the right ventricular chamber." },
    { item_id: "seq-3", label: "Right Ventricle pumps blood to Pulmonary Artery", expected_order: 3, feedback: "Deoxygenated blood travels via the pulmonary artery toward the lungs." },
    { item_id: "seq-4", label: "Oxygenated blood returns via Pulmonary Veins to Left Atrium", expected_order: 4, feedback: "Freshly oxygenated blood returns through pulmonary veins into the left atrium." }
  ];

  // Initialize with shuffled order for learner challenge
  state.userSequence = [...sequences].sort(() => Math.random() - 0.5);

  const wrapper = document.createElement("div");
  wrapper.id = "sequence-list-container";
  
  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.textContent = "Check Sequence Order";
  checkBtn.style.marginTop = "12px";
  checkBtn.style.padding = "10px 16px";

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

// 5. Utility: Broadcast Messages to Screen Reader Live Region
function announceStatus(message) {
  const announcer = document.getElementById("status-announcer");
  if (announcer) {
    announcer.textContent = message;
  }
}

// Initialize application on DOM ready
document.addEventListener("DOMContentLoaded", initInteractiveApp);
```[cite: 1, 2, 3]

---

### How to Test Each Activity Mode via URL Parameters

You can switch between the three interactive templates by changing the `mode` parameter in your browser address bar[cite: 1, 2]:

* **Animated Layer Explorer**: `index.html?diagram=heart&mode=layer-explorer`[cite: 1, 2]
* **Label Studio**: `index.html?diagram=heart&mode=label-studio`[cite: 1, 2]
* **Process Sequence Builder**: `index.html?diagram=heart&mode=sequence-builder`[cite: 1, 2]
* **Spanish Localization**: `index.html?diagram=heart&mode=layer-explorer&lang=es`[cite: 2, 4]