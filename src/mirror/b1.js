/**
 * Mirror — B1: AI Marketplace Optimizer
 *
 * After A1 downloads and injects models, B1 uses Groq AI to:
 *   1. Generate a marketplace-ready title (emoji + keywords + stickwords)
 *   2. Create a standard promo description
 *   3. Generate a massive SEO tag list
 *   4. Rename the model file to the new title
 *
 * Title format: 🚗 Car Dealer Dealership Cars Shop Roleplay RP
 * Description: 💫✨ promo text + Tags (Ignore): keyword, keyword, ...
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const GROQ_API = config.groq.apiBase;
const GROQ_KEY = config.groq.apiKey;
const GROQ_MODEL = config.groq.model;

const PROMO_DESCRIPTION = `💫✨ Please Like, Favorite, and Leave a Comment if You Enjoyed Our Model! ✨💫


This asset was fully made in Roblox Studio. Thank you for the support <33!`;

/**
 * Call Groq chat completions API.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>} The assistant's response text
 */
async function groqChat(systemPrompt, userPrompt) {
  if (!GROQ_KEY) {
    throw new Error('GROQ_API_KEY not set');
  }

  const resp = await fetch(`${GROQ_API}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 800,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Groq API ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return (data.choices[0]?.message?.content || '').trim();
}

/**
 * Generate a marketplace-optimized title, emoji, description, and tags.
 *
 * @param {string} originalName - The original model name from Roblox
 * @param {string} modelXml - First ~500 chars of the model XML for context
 * @returns {Promise<{title: string, emoji: string, description: string, tags: string}>}
 */
async function generateListing(originalName, modelXml) {
  const xmlSnippet = (modelXml || '').substring(0, 500);

  const systemPrompt = `You are an expert Roblox marketplace listing optimizer. You create titles, emojis, and SEO tags that maximize visibility on the Roblox Creator Marketplace.

TITLE FORMAT:
- Start with ONE emoji that perfectly represents the model (use any emoji, be creative and specific)
- Follow with 5-8 keyword words/phrases that describe the model
- Always end with common stickwords like: RP, Roleplay, Kit, Pack, Build, etc.
- Example: "🚗 Car Dealer Dealership Cars Shop Roleplay RP"
- Example: "💡 Stage Lights Concert Theater Show Lighting RP"
- Example: "🐂 Taurus Judge Revolver Pistol Gun R6 Recoil ADS"
- Example: "🪑 Classic Table Furniture Kitchen Home Decor"
- Example: "🏚️ Abandoned House Haunted Mansion Scary Horror"
- Example: "📺 Working Television TV Screen Media Broadcast"

TAGS:
- Generate 30-50 relevant SEO tags, comma-separated
- Include: the main object, synonyms, related words, categories, styles, use cases
- Include variations like "City Lamp", "Lamp City", "Road Lamp", "Lamp Post"
- Always include generic tags: Game Asset, Roblox, Build, Building, Decoration, Prop
- Format: "Streetlight, Lamp Post, Street, Road, City, Roleplay, RP, ..."

Respond in EXACTLY this format:
EMOJI: <single emoji>
TITLE: <title without emoji>
TAGS: <comma-separated tags>`;

  const userPrompt = `Original model name: "${originalName}"
XML context: ${xmlSnippet}

Generate the marketplace listing.`;

  try {
    const response = await groqChat(systemPrompt, userPrompt);

    const emojiMatch = response.match(/EMOJI:\s*(.+)/);
    const titleMatch = response.match(/TITLE:\s*(.+)/);
    const tagsMatch = response.match(/TAGS:\s*(.+)/s);

    const emoji = emojiMatch ? emojiMatch[1].trim() : '🎮';
    const title = titleMatch ? titleMatch[1].trim() : originalName;
    const tags = tagsMatch ? tagsMatch[1].trim() : originalName;

    const fullTitle = `${emoji} ${title}`;
    const description = `${PROMO_DESCRIPTION}\n\n\nTags (Ignore): ${tags}`;

    return { title: fullTitle, emoji, description, tags };
  } catch (err) {
    console.error(`[B1] AI error: ${err.message}`);
    return {
      title: `🎮 ${originalName}`,
      emoji: '🎮',
      description: PROMO_DESCRIPTION,
      tags: originalName,
    };
  }
}

/**
 * Sanitize a string for use as a filename.
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
    .trim()
    .substring(0, 120);
}

/**
 * Rename a modified model file and save description alongside it.
 *
 * @param {string} modifiedPath - Path to the *_modified.rbxmx file
 * @param {string} title - Full title including emoji
 * @param {string} description - Full description with promo + tags
 * @returns {{modelPath: string, descPath: string}}
 */
function renameAndSaveDescription(modifiedPath, title, description) {
  const dir = path.dirname(modifiedPath);
  const safeName = sanitizeFilename(title);
  const newModelPath = path.join(dir, `${safeName}.rbxmx`);
  const descPath = path.join(dir, `${safeName}_desc.txt`);

  fs.renameSync(modifiedPath, newModelPath);
  fs.writeFileSync(descPath, description);

  return { modelPath: newModelPath, descPath };
}

/**
 * Run B1 on a list of A1 results.
 *
 * @param {Array} a1Results - Results from runA1 (each has .model, .modifiedPath, .filePath)
 * @returns {Promise<Array>} Results with added .listing fields
 */
async function runB1(a1Results) {
  if (!GROQ_KEY) {
    console.log('[B1] No GROQ_API_KEY set — skipping AI listing generation');
    return a1Results;
  }

  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║           MIRROR — B1 PROCESS             ║');
  console.log('  ║    AI Marketplace Optimizer (Groq)        ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');
  console.log(`  Model:    ${GROQ_MODEL}`);
  console.log(`  Assets:   ${a1Results.filter(r => r.modifiedPath).length}`);
  console.log('');

  const b1Results = [];

  for (let i = 0; i < a1Results.length; i++) {
    const result = a1Results[i];

    if (result.error || !result.modifiedPath) {
      b1Results.push({ ...result, listing: null });
      continue;
    }

    console.log(`[B1] (${i + 1}/${a1Results.length}) Generating listing for: ${result.model.name}`);

    // Read a snippet of the model XML for context
    let xmlSnippet = '';
    try {
      xmlSnippet = fs.readFileSync(result.modifiedPath, 'utf-8').substring(0, 500);
    } catch { /* ignore */ }

    const listing = await generateListing(result.model.name, xmlSnippet);
    console.log(`[B1]   Title → ${listing.title}`);

    // Rename the file and save description
    let modelPath = result.modifiedPath;
    let descPath = null;
    try {
      const paths = renameAndSaveDescription(result.modifiedPath, listing.title, listing.description);
      modelPath = paths.modelPath;
      descPath = paths.descPath;
      console.log(`[B1]   File  → ${path.basename(modelPath)}`);
      console.log(`[B1]   Desc  → ${path.basename(descPath)}`);
    } catch (err) {
      console.error(`[B1]   Rename failed: ${err.message}`);
    }

    b1Results.push({
      ...result,
      listing: {
        title: listing.title,
        emoji: listing.emoji,
        description: listing.description,
        tags: listing.tags,
        modelPath,
        descPath,
      },
    });
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('');
  console.log('  ╔════════════════════════════════════════════════════════════════════════╗');
  console.log('  ║                       B1 LISTING RESULTS                              ║');
  console.log('  ╠════════════════════════════════════════════════════════════════════════╣');
  console.log('');
  console.log('  ┌─────┬──────────────────────────────┬──────────────────────────────────────────────┐');
  console.log('  │  #  │ Original                     │ Marketplace Title                            │');
  console.log('  ├─────┼──────────────────────────────┼──────────────────────────────────────────────┤');

  for (let i = 0; i < b1Results.length; i++) {
    const r = b1Results[i];
    const orig = (r.model?.name || 'N/A').slice(0, 28).padEnd(28, ' ');
    const ai = r.listing
      ? r.listing.title.slice(0, 44).padEnd(44, ' ')
      : 'SKIPPED'.padEnd(44, ' ');
    console.log(`  │ ${String(i + 1).padStart(3, ' ')} │ ${orig} │ ${ai} │`);
  }

  console.log('  └─────┴──────────────────────────────┴──────────────────────────────────────────────┘');
  console.log('');

  return b1Results;
}

module.exports = { runB1, generateListing, renameAndSaveDescription, groqChat, PROMO_DESCRIPTION };
