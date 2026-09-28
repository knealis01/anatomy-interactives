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