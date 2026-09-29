Interactive SVG Course Toolkit: Complete Project Progress & Architecture Documentation1. Executive Architecture OverviewThe Interactive SVG Course Toolkit is a configuration-driven authoring system designed to convert static scientific vector illustrations into accessible, interactive learning activities for ebooks and learning management systems (LMS).   Decoupled Asset Architecture: SVG vector graphics live as standalone, clean files in assets/prepared/ rather than embedded in index.html or stored inside spreadsheet cells.   Single Front-End Engine Shell: A generic web shell (index.html + app.js) dynamically renders illustrations and interactive modes based on URL query parameters (e.g., index.html?diagram=heart&mode=layer-explorer&lang=es).   Centralized Google Sheets Database: A single Google Sheet (Astra_Github_SVG_V2) acts as the authoring database and API endpoint, storing metadata, localized labels, animation sequences, and step feedback linked by diagram_id.   WCAG 2.2 Level AA Compliance: All pointer/drag operations have full keyboard alternatives, screen reader announcements via live regions, high-contrast visual states, and reduced-motion overrides.   2. Directory & Repository LayoutThe local development directory and GitHub repository mirror the following layout:   Plaintextinteractive-course-toolkit/
├── .gitignore                         <-- Excludes OS files, node_modules, and logs
├── index.html                         <-- Reusable accessible HTML application shell
├── app.js                             <-- Interaction engine, template router & cache manager
├── assets/
│   ├── source/                        <-- Raw vector exports from Illustrator/Inkscape
│   ├── prepared/                      <-- Optimized SVG assets loaded at runtime
│   └── manifests/                     <-- Generated element JSON metadata manifests
├── backend/
│   └── Code.gs                        <-- Backup copy of Google Apps Script backend[cite: 1]
└── tools/
    └── prepare-svg/
        └── index.js                   <-- Node.js SVG cleaning & manifest extraction tool
3. Database & Google Sheet Schema (Astra_Github_SVG_V2)The Google Sheet acts as the content management system. Rows are filtered by diagram_id (e.g., heart).   Core Tabs & Column Headerslabels TabStores text callouts, tooltips, localized translations, and initial visibility states.   Columns: diagram_id | svg_id | en_text | es_text | visible_default | tooltip_en   diagram_meta TabStores localized titles and long accessible descriptions.   Columns: diagram_id | lang | title | desc   elements TabTracks animatable anatomical paths and structural SVG element groups.   Columns: asset_id | element_id | accessible_name | layer | interactive   animations TabDefines step-by-step keyframe actions, timings, and captions for the Animated Layer Explorer.   Columns: activity_id | step_id | order | element_id | action | duration | caption   sequences TabControls stage ordering and descriptive feedback for the Process Sequence Builder[cite: 2].Columns: activity_id | item_id | expected_order | caption | feedback[cite: 2]svg_raw & imported_labels TabsUtility tabs used by the Google Apps Script function importLabelsFromSvg() to extract group IDs and text directly from pasted raw SVG code.   4. Technical Artifacts & Source CodeA. Node.js SVG Optimizer (tools/prepare-svg/index.js)Strips editor metadata, validates viewBox attributes, flags inline <script> security risks or duplicate IDs, writes optimized vectors to assets/prepared/, and extracts structural manifests to assets/manifests/[cite: 2].JavaScriptconst fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.join(__dirname, '../../assets/source');
const PREPARED_DIR = path.join(__dirname, '../../assets/prepared');
const MANIFEST_DIR = path.join(__dirname, '../../assets/manifests');

[PREPARED_DIR, MANIFEST_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

function cleanAndOptimizeSvg(svgContent, assetId) {
  const issues = [];
  
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/i);
  if (!viewBoxMatch) {
    issues.push('WARNING: No viewBox attribute found on root <svg> element!');
  }
  const viewBoxValues = viewBoxMatch ? viewBoxMatch[1].split(' ').map(Number) : [0, 0, 800, 600];

  if (/<script/i.test(svgContent)) issues.push('SECURITY ALERT: Inline <script> tag detected!');
  if (/xlink:href="http/i.test(svgContent) || /href="http/i.test(svgContent)) {
    issues.push('WARNING: External HTTP resource link found.');
  }

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

  let cleaned = svgContent
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/xmlns:i="[^"]*"/g, '')
    .replace(/xmlns:graph="[^"]*"/g, '')
    .replace(/i:extruder="[^"]*"/g, '')
    .replace(/data-name="[^"]*"/g, '')
    .replace(/<metadata[\s\S]*?<\/metadata>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

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
    console.log(`Source directory '${SOURCE_DIR}' does not exist.`);
    return;
  }

  const files = fs.readdirSync(SOURCE_DIR).filter(f => f.endsWith('.svg'));
  if (files.length === 0) {
    console.log(`No .svg files found in '${SOURCE_DIR}'.`);
    return;
  }

  files.forEach((file) => {
    const assetId = path.basename(file, '.svg');
    const sourcePath = path.join(SOURCE_DIR, file);
    const preparedPath = path.join(PREPARED_DIR, `${assetId}.svg`);
    const manifestPath = path.join(MANIFEST_DIR, `${assetId}.json`);

    console.log(`Processing: ${file}...`);
    const rawSvg = fs.readFileSync(sourcePath, 'utf8');
    const { cleanedSvg, manifest, issues } = cleanAndOptimizeSvg(rawSvg, assetId);

    fs.writeFileSync(preparedPath, cleanedSvg, 'utf8');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    console.log(` Saved optimized SVG to: assets/prepared/${assetId}.svg`);
    console.log(` Saved element manifest to: assets/manifests/${assetId}.json`);
    
    if (issues.length > 0) {
      issues.forEach(i => console.log(`   - ${i}`));
    }
  });
}

processAllSvgs();
B. Application Web Shell (index.html)Provides accessible containers, landmark structures, toolbar wrappers, and an aria-live region[cite: 2, 3].HTML<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Interactive Scientific Illustration</title>
  <style>
    .toggles { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .toggle-btn { padding: 8px 12px; cursor: pointer; min-height: 44px; min-width: 44px; }
    .toggle-btn[aria-pressed="false"] { opacity: 0.5; text-decoration: line-through; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
    #svg-container svg { max-width: 100%; height: auto; display: block; }
  </style>
</head>
<body>

  <header>
    <h1 id="diagram-title">Loading illustration…</h1>
    <p id="diagram-desc"></p>
  </header>

  <p id="label-instructions">
    Use the controls below to interact with the anatomical illustration.
  </p>

  <!-- Parallel HTML Toolbar for Accessibility -->
  <div class="toggles" 
       role="toolbar" 
       aria-label="Illustration interactive controls" 
       aria-describedby="label-instructions" 
       id="toolbar-container">
    <span id="loading-message">Loading activity data…</span>
  </div>

  <!-- Dynamic SVG Target Container -->
  <main id="svg-container" aria-live="polite">
    <!-- SVG markup injected here at runtime -->
  </main>

  <!-- Screen Reader Live Region Announcements -->
  <div id="status-announcer" class="sr-only" aria-live="polite" aria-atomic="true"></div>

  <script src="app.js"></script>
</body>
</html>
```[cite: 2, 3]

---

### C. Interaction Engine & Front-End Router (`app.js`)

Manages dynamic asset loading, browser-level `localStorage` caching, template rendering, and accessibility controls.

```javascript
/**
 * Interactive SVG Course Engine & Activity Toolkit
 * Activity Modes: Label Studio, Animated Layer Explorer, Process Sequence Builder[cite: 2]
 * Performance: Stale-While-Revalidate Browser Caching (localStorage)
 * Standards Target: WCAG 2.2 Level AA Accessibility[cite: 2]
 */

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";

const urlParams = new URLSearchParams(window.location.search);
const diagramId = (urlParams.get("diagram") || "heart").toLowerCase();[cite: 1]
const activeMode = (urlParams.get("mode") || "layer-explorer").toLowerCase();[cite: 2]
const lang = (urlParams.get("lang") || "en").toLowerCase();[cite: 1]

const state = {
  config: null,
  svgElement: null,
  currentStepIndex: 0,
  isPlaying: false,
  playbackSpeed: 1.0,
  animationTimer: null,
  isReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,[cite: 2]
  userSequence: []
};

// Stale-While-Revalidate Caching Helper
async function fetchWithCache(url, cacheKey) {
  const cached = localStorage.getItem(cacheKey);
  const isSvg = url.endsWith(".svg");

  if (cached) {
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
      try { return JSON.parse(cached); } catch (e) { return cached; }
    }
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
  const data = isSvg ? await res.text() : await res.json();
  localStorage.setItem(cacheKey, isSvg ? data : JSON.stringify(data));
  return data;
}

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
    .svg-pulse { animation: svgPulseKeyframe 1.2s infinite ease-in-out; }
    @keyframes svgPulseKeyframe {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(1.03); }
      100% { opacity: 1; transform: scale(1); }
    }
    .svg-fade-transition { transition: opacity var(--anim-duration, 0.6s) ease-in-out; }
    .sequence-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; margin-bottom: 8px; background: #f4f6f8;
      border: 1px solid #ccc; border-radius: 4px;
    }
    .sequence-controls button, .playback-controls button {
      min-height: 44px; padding: 6px 12px; cursor: pointer;
    }
    .playback-controls { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .caption-box { padding: 12px 16px; background: #eef4fc; border-left: 4px solid #005fcc; margin-top: 12px; font-size: 1.05rem; }
  `;
  document.head.appendChild(style);
}

async function initInteractiveApp() {
  injectAnimationStyles();
  const toolbarContainer = document.getElementById("toolbar-container");[cite: 3]
  const svgContainer = document.getElementById("svg-container");[cite: 3]
  
  try {
    const svgKey = `cache_svg_${diagramId}`;
    const apiKey = `cache_api_${diagramId}_${lang}`;

    const [svgText, configData] = await Promise.all([
      fetchWithCache(`./assets/prepared/${diagramId}.svg`, svgKey),[cite: 2]
      fetchWithCache(`${APPS_SCRIPT_URL}?diagram=${diagramId}&lang=${lang}`, apiKey)[cite: 1]
    ]);

    state.config = configData;
    svgContainer.innerHTML = svgText;
    state.svgElement = svgContainer.querySelector("svg");

    if (state.config.meta) {
      if (state.config.meta.title) document.getElementById("diagram-title").textContent = state.config.meta.title;[cite: 1]
      if (state.config.meta.desc) document.getElementById("diagram-desc").textContent = state.config.meta.desc;[cite: 1]
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
  } catch (error) {
    console.error("Initialization Error:", error);
    if (toolbarContainer) {
      toolbarContainer.innerHTML = `<span style="color:#d32f2f;">Error loading activity: ${error.message}</span>`;
    }
  }
}

// Template 1: Label Studio[cite: 2]
function initLabelStudio(container) {
  const labels = state.config.labels || [];[cite: 1]
  if (labels.length === 0) {
    container.innerHTML = "<span>No label definitions found.</span>";
    return;
  }

  labels.forEach((label) => {
    const targetGroup = document.getElementById(label.id);[cite: 1, 3]
    const button = document.createElement("button");
    button.className = "toggle-btn";
    button.type = "button";
    button.textContent = label.text;[cite: 1]
    
    let isVisible = label.visible !== false;[cite: 1]
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

// Template 2: Animated Layer Explorer[cite: 2]
function initLayerExplorer(container) {
  const steps = state.config.animations || state.config.steps || [
    { step_id: "step-1", order: 1, element_id: "Label_Right_atrium", action: "highlight", duration: 800, caption: "Deoxygenated blood enters the Right Atrium." },[cite: 2, 4]
    { step_id: "step-2", order: 2, element_id: "Label_Right_ventricle", action: "pulse", duration: 1000, caption: "Blood flows down into the Right Ventricle." },[cite: 2, 4]
    { step_id: "step-3", order: 3, element_id: "Label_Pulmonary_artery", action: "fade-in", duration: 700, caption: "Blood is pumped to the lungs through the Pulmonary Artery." },[cite: 2, 4]
    { step_id: "step-4", order: 4, element_id: "Label_Aorta", action: "highlight", duration: 800, caption: "Oxygenated blood is distributed to the body via the Aorta." }[cite: 2, 4]
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
  `;[cite: 2]

  const captionBox = document.createElement("div");
  captionBox.className = "caption-box";
  captionBox.id = "step-caption";
  captionBox.setAttribute("aria-live", "polite");[cite: 2]

  container.appendChild(controlsDiv);
  container.appendChild(captionBox);

  const btnPlay = document.getElementById("btn-play");
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const btnRestart = document.getElementById("btn-restart");
  const chkMotion = document.getElementById("chk-reduced-motion");

  chkMotion.addEventListener("change", (e) => {
    state.isReducedMotion = e.target.checked;
    announceStatus(`Reduced motion ${state.isReducedMotion ? "enabled" : "disabled"}.`);[cite: 2]
  });

  btnPlay.addEventListener("click", () => {
    if (state.isPlaying) { pauseAnimation(btnPlay); } else { playAnimation(steps, btnPlay); }
  });

  btnPrev.addEventListener("click", () => {
    pauseAnimation(btnPlay);
    if (state.currentStepIndex > 0) { state.currentStepIndex--; applyAnimationStep(steps[state.currentStepIndex]); }
  });

  btnNext.addEventListener("click", () => {
    pauseAnimation(btnPlay);
    if (state.currentStepIndex < steps.length - 1) { state.currentStepIndex++; applyAnimationStep(steps[state.currentStepIndex]); }
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
  if (captionBox) captionBox.textContent = `Step ${stepData.order || state.currentStepIndex + 1}: ${stepData.caption}`;[cite: 2]

  const targetEl = document.getElementById(stepData.element_id);[cite: 2]
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

  const duration = (stepData.duration || 800) / state.playbackSpeed;[cite: 2]
  targetEl.style.setProperty("--anim-duration", `${duration}ms`);

  switch (stepData.action) {
    case "fade-in":[cite: 2]
      targetEl.style.display = ""; targetEl.style.opacity = "0"; targetEl.classList.add("svg-fade-transition");
      setTimeout(() => { targetEl.style.opacity = "1"; }, 20);
      break;
    case "pulse":[cite: 2]
      targetEl.style.display = ""; targetEl.classList.add("svg-pulse");
      break;
    case "highlight":[cite: 2]
    default:
      targetEl.style.display = ""; targetEl.classList.add("svg-highlight");
      break;
  }

  announceStatus(`Step ${stepData.order}: ${stepData.caption}`);
}

function playAnimation(steps, playButton) {
  state.isPlaying = true;
  playButton.textContent = "⏸ Pause";[cite: 2]

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
  if (playButton) playButton.textContent = "▶ Play";[cite: 2]
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

// Template 3: Process Sequence Builder[cite: 2]
function initSequenceBuilder(container) {
  const sequences = state.config.sequences || [
    { item_id: "seq-1", label: "Deoxygenated blood enters Right Atrium", expected_order: 1, feedback: "Blood enters the right atrium first." },[cite: 2]
    { item_id: "seq-2", label: "Blood flows through Tricuspid Valve to Right Ventricle", expected_order: 2, feedback: "Tricuspid valve leads into the right ventricle." },[cite: 2]
    { item_id: "seq-3", label: "Right Ventricle pumps blood to Pulmonary Artery", expected_order: 3, feedback: "Blood travels via pulmonary artery toward lungs." },[cite: 2]
    { item_id: "seq-4", label: "Oxygenated blood returns via Pulmonary Veins to Left Atrium", expected_order: 4, feedback: "Oxygenated blood returns to left atrium." }[cite: 2]
  ];

  state.userSequence = [...sequences].sort(() => Math.random() - 0.5);

  const wrapper = document.createElement("div");
  wrapper.id = "sequence-list-container";
  
  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.textContent = "Check Sequence Order";
  checkBtn.style.marginTop = "12px"; checkBtn.style.padding = "10px 16px"; checkBtn.style.minHeight = "44px";

  const feedbackBox = document.createElement("div");
  feedbackBox.className = "caption-box";
  feedbackBox.id = "sequence-feedback";
  feedbackBox.style.display = "none";

  container.appendChild(wrapper);
  container.appendChild(checkBtn);
  container.appendChild(feedbackBox);

  renderSequenceList(wrapper);

  checkBtn.addEventListener("click", () => {
    let feedbackText = "Great job! The sequence order is completely correct.";
    for (let i = 0; i < state.userSequence.length; i++) {
      if (state.userSequence[i].expected_order !== i + 1) {
        feedbackText = `Not quite. Examine step ${i + 1}: "${state.userSequence[i].label}". ${state.userSequence[i].feedback}`;[cite: 2]
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
    moveUpBtn.type = "button"; moveUpBtn.textContent = "▲ Move Up";[cite: 2]
    moveUpBtn.disabled = index === 0;
    moveUpBtn.setAttribute("aria-label", `Move ${item.label} up`);

    const moveDownBtn = document.createElement("button");
    moveDownBtn.type = "button"; moveDownBtn.textContent = "▼ Move Down";[cite: 2]
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

function announceStatus(message) {
  const announcer = document.getElementById("status-announcer");
  if (announcer) announcer.textContent = message;
}

document.addEventListener("DOMContentLoaded", initInteractiveApp);
```[cite: 1, 2, 3]

---

### D. Google Apps Script Backend (`Code.gs`)

Acts as the REST API with Google's `CacheService` to minimize latency[cite: 1].

```javascript
/******************************************************************************
 * Astra Interactive Course Toolkit - Backend API & Import Utilities
 * Google Apps Script for Google Sheet: Astra_Github_SVG_V2
 ******************************************************************************/

function doGet(e) {
  e = e || { parameter: {} };
  var lang = (e.parameter.lang || 'en').toLowerCase();
  var diagramId = (e.parameter.diagram || 'heart').toLowerCase();

  var cache = CacheService.getScriptCache();
  var cacheKey = "api_cache_" + diagramId + "_" + lang;
  var cachedResponse = cache.get(cacheKey);

  if (cachedResponse) {
    return ContentService.createTextOutput(cachedResponse)
      .setMimeType(ContentService.MimeType.JSON);
  }

  var ss = SpreadsheetApp.getActive();

  var labelSheet = ss.getSheetByName('labels');
  var labelRows = [];
  if (labelSheet) {
    var values = labelSheet.getDataRange().getValues();
    if (values.length > 1) {
      var header = values.shift();
      function idx(name) { return header.indexOf(name); }

      var idCol        = idx('svg_id');
      var enCol        = idx('en_text');
      var tooltipEnCol = idx('tooltip_en');
      var visibleCol   = idx('visible_default');
      var langCol      = idx(lang + '_text');
      var diagramCol   = idx('diagram_id');

      labelRows = values
        .filter(function (r) {
          if (idCol === -1 || !r[idCol]) return false;
          if (diagramCol === -1) return true;
          return String(r[diagramCol]).toLowerCase() === diagramId;
        })
        .map(function (r) {
          var en = enCol !== -1 ? r[enCol] : '';
          var localized = (langCol !== -1 && r[langCol]) ? r[langCol] : en;
          var tooltip = tooltipEnCol !== -1 ? (r[tooltipEnCol] || '') : '';
          var visRaw = visibleCol !== -1 ? String(r[visibleCol]) : 'TRUE';

          return {
            id: String(r[idCol]),
            text: String(localized || ''),
            tooltip: String(tooltip),
            visible: String(visRaw).toLowerCase() === 'true'
          };
        });
    }
  }

  var metaSheet = ss.getSheetByName('diagram_meta');
  var meta = { title: '', desc: '' };
  if (metaSheet) {
    var mValues = metaSheet.getDataRange().getValues();
    if (mValues.length > 1) {
      var mHeader = mValues.shift();
      function midx(name) { return mHeader.indexOf(name); }

      var dIdCol   = midx('diagram_id');
      var mLangCol = midx('lang');
      var titleCol = midx('title');
      var descCol  = midx('desc');

      var row = mValues.find(function (r) {
        var idMatch = (dIdCol !== -1) && String(r[dIdCol]).toLowerCase() === diagramId;
        var langMatch = (mLangCol === -1) || String(r[mLangCol]).toLowerCase() === lang;
        return idMatch && langMatch;
      });

      if (row) {
        meta.title = titleCol !== -1 ? String(row[titleCol] || '') : '';
        meta.desc  = descCol  !== -1 ? String(row[descCol]  || '') : '';
      }
    }
  }

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

      seqRows = sValues
        .filter(function (r) {
          if (itemIdCol === -1 || !r[itemIdCol]) return false;
          if (sActIdCol === -1) return true;
          return String(r[sActIdCol]).toLowerCase() === diagramId;
        })
        .map(function (r) {
          return {
            item_id: String(r[itemIdCol]),
            label: sCaptionCol !== -1 ? String(r[sCaptionCol]) : '',
            expected_order: expOrderCol !== -1 ? Number(r[expOrderCol]) || 1 : 1,
            feedback: feedbackCol !== -1 ? String(r[feedbackCol]) : ''
          };
        });
    }
  }

  var payload = {
    meta: meta,
    labels: labelRows,
    animations: animRows,
    sequences: seqRows
  };

  var jsonString = JSON.stringify(payload);
  cache.put(cacheKey, jsonString, 21600); // 6 hours

  return ContentService.createTextOutput(jsonString)
    .setMimeType(ContentService.MimeType.JSON);
}

function clearApiCache() {
  var cache = CacheService.getScriptCache();
  cache.remove("api_cache_heart_en");
  cache.remove("api_cache_heart_es");
  SpreadsheetApp.getUi().alert("API Cache cleared!");
}

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

  var re = /<g[^>]*id="(Label_[^"]+)"[^>]*>[\s\S]*?<text[^>]*>([\s\S]*?)<\/text>[\s\S]*?<\/g>/g;
  var rows = [["en_text", "svg_id", "visible_default"]];
  var match;

  while ((match = re.exec(svgText)) !== null) {
    var id  = match[1];
    var raw = match[2];
    raw = raw.replace(/<\/tspan>\s*<tspan[^>]*>/g, ' ');
    var text = raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    rows.push([text, id, true]);
  }

  outSh.clearContents();
  if (rows.length > 1) {
    outSh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  } else {
    outSh.getRange(1, 1).setValue('No Label_* groups found.');
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Labels')
    .addItem('Import labels from SVG', 'importLabelsFromSvg')
    .addItem('Clear API Cache', 'clearApiCache')
    .addToUi();
}
```[cite: 1, 4]

---

## 5. Summary of Workflow Steps & Git Commands

### Local Build & Processing Workflow
1. Place raw vector illustration exports in `assets/source/heart.svg`[cite: 2].
2. Run the Node.js preparation script:
   ```bash
   node tools/prepare-svg/index.js
   ```[cite: 2]
3. Verify output files generated in `assets/prepared/heart.svg` and `assets/manifests/heart.json`[cite: 2].

### Git Authentication & Sync Workflow
* Authenticate using GitHub CLI:
  ```bash
  gh auth login
   Push updates to GitHub repository:Bashgit add .
git commit -m "Complete interactive SVG engine implementation"
git push origin main
6. Ebook & LMS Production Packaging StrategyTo eliminate Google Apps Script API network latency in published ebooks or LMS courseware:Authoring Environment: Use Google Sheets + Google Apps Script during content creation and editing[cite: 1, 2].Production Packaging: Save a static snapshot of the Google Sheets API payload as a local JSON file at assets/manifests/heart.json[cite: 2].Runtime Deployment: Configure app.js to fetch directly from ./assets/manifests/${diagramId}.json, achieving instant offline performance[cite: 2].