/**
 * Mirror — A1: Model Analyzer Process
 *
 * Searches Roblox catalog for popular models by keyword,
 * downloads them as temporary .rbxmx files, parses the XML
 * to find the most deeply nested element, then cleans up.
 */

const fs = require('fs');
const path = require('path');
const { loadAccounts } = require('./c1');

const TEMP_DIR = path.resolve(__dirname, '..', '..', 'data', 'temp_models');

// ── Roblox API Helpers ───────────────────────────────────────────────

const SEARCH_URL = 'https://apis.roblox.com/toolbox-service/v1/marketplace/10';
const ASSET_URL = 'https://assetdelivery.roblox.com/v1/asset';

/**
 * Search Roblox catalog for models matching a keyword.
 *
 * @param {string} keyword - Search term
 * @param {number} limit - Max results to fetch
 * @param {string} [cookie] - Optional .ROBLOSECURITY cookie for auth
 * @returns {Promise<Array<{id: number, name: string, creatorName: string}>>}
 */
async function searchModels(keyword, limit, cookie) {
  const results = [];
  let cursor = '';
  const pageSize = Math.min(limit, 50);

  while (results.length < limit) {
    const params = new URLSearchParams({
      keyword,
      sort: '5',
      limit: String(pageSize),
      includeOnlyVerifiedCreators: 'false',
    });
    if (cursor) params.set('cursor', cursor);

    const headers = { 'Accept': 'application/json' };
    if (cookie) headers['Cookie'] = `.ROBLOSECURITY=${cookie}`;

    const resp = await fetch(`${SEARCH_URL}?${params}`, { headers });

    if (!resp.ok) {
      // Fallback to catalog v1 search if toolbox endpoint fails
      return searchModelsFallback(keyword, limit, cookie);
    }

    const data = await resp.json();
    const items = data.data || data.results || [];

    for (const item of items) {
      if (results.length >= limit) break;
      results.push({
        id: item.asset?.id || item.id || item.assetId,
        name: item.asset?.name || item.name || `Model_${item.id}`,
        creatorName: item.creator?.name || item.creatorName || 'Unknown',
      });
    }

    cursor = data.nextPageCursor || '';
    if (!cursor || items.length === 0) break;
  }

  return results;
}

/**
 * Fallback search using the develop.roblox.com toolbox endpoint.
 */
async function searchModelsFallback(keyword, limit, cookie) {
  const params = new URLSearchParams({
    category: 'FreeModels',
    keyword,
    num: String(Math.min(limit, 30)),
    sortType: '2',
    sortAggregation: '5',
    includeOnlyVerifiedCreators: 'false',
  });

  const headers = { 'Accept': 'application/json' };
  if (cookie) headers['Cookie'] = `.ROBLOSECURITY=${cookie}`;

  const resp = await fetch(`https://develop.roblox.com/v1/toolbox/items?${params}`, { headers });

  if (!resp.ok) {
    // Last fallback: catalog v2
    return searchModelsCatalog(keyword, limit);
  }

  const data = await resp.json();
  const items = data.data || [];

  return items.slice(0, limit).map((item) => ({
    id: item.asset?.id || item.id,
    name: item.asset?.name || item.name || `Model_${item.id}`,
    creatorName: item.creator?.name || 'Unknown',
  }));
}

/**
 * Last-resort fallback: catalog v2 search.
 */
async function searchModelsCatalog(keyword, limit) {
  const params = new URLSearchParams({
    Category: '1',
    Keyword: keyword,
    SortType: '2',
    limit: String(Math.min(limit, 30)),
  });

  const resp = await fetch(`https://catalog.roblox.com/v1/search/items/details?${params}`);
  if (!resp.ok) return [];

  const data = await resp.json();
  const items = data.data || [];

  return items.slice(0, limit).map((item) => ({
    id: item.id,
    name: item.name || `Model_${item.id}`,
    creatorName: item.creatorName || 'Unknown',
  }));
}

/**
 * Download a model's .rbxmx content from Roblox.
 *
 * @param {number} assetId
 * @param {string} [cookie] - Optional auth cookie
 * @returns {Promise<string|null>} File path or null on failure
 */
async function downloadModel(assetId, cookie) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  const headers = {};
  if (cookie) headers['Cookie'] = `.ROBLOSECURITY=${cookie}`;

  const resp = await fetch(`${ASSET_URL}?id=${assetId}`, {
    headers,
    redirect: 'follow',
  });

  if (!resp.ok) {
    console.error(`[A1] Download failed for asset ${assetId}: HTTP ${resp.status}`);
    return null;
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  const filePath = path.join(TEMP_DIR, `${assetId}.rbxmx`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// ── XML Parsing ──────────────────────────────────────────────────────

/**
 * Parse .rbxmx XML and find the most deeply nested element.
 * Returns info about the deepest node: its tag, depth, and path.
 *
 * Uses a simple streaming approach — no heavy XML lib needed.
 *
 * @param {string} filePath - Path to the .rbxmx file
 * @returns {{depth: number, tag: string, path: string[], attributes: object}}
 */
function findDeepestElement(filePath) {
  const xml = fs.readFileSync(filePath, 'utf-8');

  let maxDepth = 0;
  let deepestTag = '';
  let deepestPath = [];
  let deepestAttributes = {};

  const stack = [];
  // Match opening tags, self-closing tags, and closing tags
  const tagRegex = /<\/?([a-zA-Z][\w.:_-]*)((?:\s+[a-zA-Z][\w.:_-]*\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let match;

  while ((match = tagRegex.exec(xml)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1];
    const attrString = match[2] || '';
    const selfClosing = match[3] === '/';

    // Skip closing tags
    if (fullMatch.startsWith('</')) {
      stack.pop();
      continue;
    }

    // Parse attributes
    const attrs = {};
    const attrRegex = /([a-zA-Z][\w.:_-]*)\s*=\s*"([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }

    stack.push(tagName);
    const currentDepth = stack.length;

    if (currentDepth > maxDepth) {
      maxDepth = currentDepth;
      deepestTag = tagName;
      deepestPath = [...stack];
      deepestAttributes = { ...attrs };
    }

    if (selfClosing) {
      stack.pop();
    }
  }

  return {
    depth: maxDepth,
    tag: deepestTag,
    path: deepestPath,
    attributes: deepestAttributes,
  };
}

/**
 * Clean up temporary model files.
 */
function cleanupTempModels() {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      const files = fs.readdirSync(TEMP_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(TEMP_DIR, file));
      }
      fs.rmdirSync(TEMP_DIR);
      console.log(`[A1] Cleaned up ${files.length} temp files`);
    }
  } catch (err) {
    console.error(`[A1] Cleanup error: ${err.message}`);
  }
}

// ── Main A1 Runner ───────────────────────────────────────────────────

/**
 * Run the A1 model analysis process.
 *
 * @param {object} options
 * @param {string} options.keyword - Search keyword
 * @param {number|'auto'} options.count - Number of models or 'auto'
 * @returns {Promise<Array>} Analysis results
 */
async function runA1(options) {
  const { keyword, count } = options;
  const limit = count === 'auto' ? 10 : parseInt(count, 10);

  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║           MIRROR — A1 PROCESS             ║');
  console.log('  ║      Roblox Model Analyzer                ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');
  console.log(`  Keyword:  "${keyword}"`);
  console.log(`  Count:    ${count === 'auto' ? 'Automatic (top 10)' : count}`);
  console.log('');

  // Use a saved account cookie if available (for auth'd requests)
  const accounts = loadAccounts();
  const cookie = null; // Models are public; cookie optional

  // ── Step 1: Search ─────────────────────────────────────────────────
  console.log(`[A1] Searching for "${keyword}" models...`);
  const models = await searchModels(keyword, limit, cookie);

  if (models.length === 0) {
    console.log('[A1] No models found for that keyword.');
    return [];
  }

  console.log(`[A1] Found ${models.length} model(s):`);
  console.log('');
  console.log('  ┌─────┬────────────────────────────────────┬──────────────────┐');
  console.log('  │  #  │ Name                               │ Creator          │');
  console.log('  ├─────┼────────────────────────────────────┼──────────────────┤');
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const name = (m.name || '').slice(0, 36).padEnd(36, ' ');
    const creator = (m.creatorName || '').slice(0, 16).padEnd(16, ' ');
    console.log(`  │ ${String(i + 1).padStart(3, ' ')} │ ${name} │ ${creator} │`);
  }
  console.log('  └─────┴────────────────────────────────────┴──────────────────┘');
  console.log('');

  // ── Step 2: Download + Analyze ─────────────────────────────────────
  const results = [];
  let overallDeepest = { depth: 0, model: null, analysis: null };

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    console.log(`[A1] (${i + 1}/${models.length}) Downloading: ${model.name} (${model.id})...`);

    const filePath = await downloadModel(model.id, cookie);
    if (!filePath) {
      results.push({ model, error: 'download_failed' });
      continue;
    }

    const fileSize = fs.statSync(filePath).size;
    console.log(`[A1]   Downloaded: ${(fileSize / 1024).toFixed(1)} KB`);

    // Parse XML for deepest nesting
    const analysis = findDeepestElement(filePath);
    console.log(`[A1]   Deepest element: <${analysis.tag}> at depth ${analysis.depth}`);
    console.log(`[A1]   Path: ${analysis.path.join(' > ')}`);

    results.push({ model, filePath, fileSize, analysis });

    if (analysis.depth > overallDeepest.depth) {
      overallDeepest = { depth: analysis.depth, model, analysis };
    }
  }

  // ── Step 3: Summary ────────────────────────────────────────────────
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════════════╗');
  console.log('  ║                    A1 ANALYSIS RESULTS                   ║');
  console.log('  ╠═══════════════════════════════════════════════════════════╣');
  console.log('');
  console.log('  ┌─────┬────────────────────────────────┬───────┬──────────────────────┐');
  console.log('  │  #  │ Model                          │ Depth │ Deepest Tag          │');
  console.log('  ├─────┼────────────────────────────────┼───────┼──────────────────────┤');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.error) {
      const name = (r.model.name || '').slice(0, 30).padEnd(30, ' ');
      console.log(`  │ ${String(i + 1).padStart(3, ' ')} │ ${name} │  ERR  │ ${r.error.padEnd(20, ' ')} │`);
    } else {
      const name = (r.model.name || '').slice(0, 30).padEnd(30, ' ');
      const depth = String(r.analysis.depth).padStart(5, ' ');
      const tag = (`<${r.analysis.tag}>`).slice(0, 20).padEnd(20, ' ');
      console.log(`  │ ${String(i + 1).padStart(3, ' ')} │ ${name} │${depth}  │ ${tag} │`);
    }
  }

  console.log('  └─────┴────────────────────────────────┴───────┴──────────────────────┘');
  console.log('');

  if (overallDeepest.model) {
    console.log('  ★ MOST DEEPLY NESTED:');
    console.log(`    Model:  ${overallDeepest.model.name} (ID: ${overallDeepest.model.id})`);
    console.log(`    Depth:  ${overallDeepest.depth} levels`);
    console.log(`    Tag:    <${overallDeepest.analysis.tag}>`);
    console.log(`    Path:   ${overallDeepest.analysis.path.join(' > ')}`);
    if (Object.keys(overallDeepest.analysis.attributes).length > 0) {
      console.log(`    Attrs:  ${JSON.stringify(overallDeepest.analysis.attributes)}`);
    }
    console.log('');
  }

  // ── Step 4: Cleanup temp files ─────────────────────────────────────
  cleanupTempModels();

  return results;
}

module.exports = { runA1, searchModels, downloadModel, findDeepestElement, cleanupTempModels, TEMP_DIR };
