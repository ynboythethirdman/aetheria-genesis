/**
 * Mirror — B1: AI Title Generator
 *
 * After A1 downloads and injects models, B1 uses Groq AI to:
 *   1. Generate a catchy title that fits each model
 *   2. Choose 1 of 8 emojis that matches the title
 *   3. Rename the modified model file with emoji + AI title
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const GROQ_API = config.groq.apiBase;
const GROQ_KEY = config.groq.apiKey;
const GROQ_MODEL = config.groq.model;

const EMOJIS = ['🏠', '⚔️', '🚗', '🌟', '🎮', '🏰', '🔥', '🌿'];

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
      temperature: 0.8,
      max_tokens: 200,
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
 * Generate a catchy title + emoji for a Roblox model.
 *
 * @param {string} originalName - The original model name from Roblox
 * @param {string} modelXml - First ~500 chars of the model XML for context
 * @returns {Promise<{title: string, emoji: string}>}
 */
async function generateTitle(originalName, modelXml) {
  const emojiList = EMOJIS.join(' ');
  const xmlSnippet = (modelXml || '').substring(0, 500);

  const systemPrompt = `You are a creative Roblox model title generator. You create short, catchy titles for Roblox models that would stand out on the marketplace. The title should:
- Be 2-5 words max
- Sound appealing and professional
- Relate to what the model actually is
- Use words that fit the model's theme

You must also pick exactly 1 emoji from this list that best fits the title: ${emojiList}

Respond in EXACTLY this format (nothing else):
EMOJI: <emoji>
TITLE: <title>`;

  const userPrompt = `Original model name: "${originalName}"
XML snippet for context: ${xmlSnippet}

Generate a catchy new title and pick the best fitting emoji.`;

  try {
    const response = await groqChat(systemPrompt, userPrompt);

    const emojiMatch = response.match(/EMOJI:\s*(.+)/);
    const titleMatch = response.match(/TITLE:\s*(.+)/);

    const emoji = emojiMatch ? emojiMatch[1].trim() : EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    const title = titleMatch ? titleMatch[1].trim() : originalName;

    // Validate emoji is from our list
    const validEmoji = EMOJIS.includes(emoji) ? emoji : EMOJIS[Math.floor(Math.random() * EMOJIS.length)];

    return { title, emoji: validEmoji };
  } catch (err) {
    console.error(`[B1] AI error: ${err.message}`);
    return {
      title: originalName,
      emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
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
    .substring(0, 80);
}

/**
 * Rename a modified model file with the AI-generated title + emoji.
 *
 * @param {string} modifiedPath - Path to the *_modified.rbxmx file
 * @param {string} emoji - Selected emoji
 * @param {string} title - AI-generated title
 * @returns {string} New file path
 */
function renameModel(modifiedPath, emoji, title) {
  const dir = path.dirname(modifiedPath);
  const safeName = sanitizeFilename(`${emoji} ${title}`);
  const newPath = path.join(dir, `${safeName}.rbxmx`);

  fs.renameSync(modifiedPath, newPath);
  return newPath;
}

/**
 * Run B1 on a list of A1 results.
 *
 * @param {Array} a1Results - Results from runA1 (each has .model, .modifiedPath, .filePath)
 * @returns {Promise<Array>} Results with added .aiTitle, .aiEmoji, .renamedPath
 */
async function runB1(a1Results) {
  if (!GROQ_KEY) {
    console.log('[B1] No GROQ_API_KEY set — skipping AI title generation');
    return a1Results;
  }

  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║           MIRROR — B1 PROCESS             ║');
  console.log('  ║      AI Title Generator (Groq)            ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');
  console.log(`  Model:    ${GROQ_MODEL}`);
  console.log(`  Emojis:   ${EMOJIS.join(' ')}`);
  console.log(`  Models:   ${a1Results.filter(r => r.modifiedPath).length}`);
  console.log('');

  const b1Results = [];

  for (let i = 0; i < a1Results.length; i++) {
    const result = a1Results[i];

    if (result.error || !result.modifiedPath) {
      b1Results.push({ ...result, aiTitle: null, aiEmoji: null, renamedPath: null });
      continue;
    }

    console.log(`[B1] (${i + 1}/${a1Results.length}) Generating title for: ${result.model.name}`);

    // Read a snippet of the model XML for context
    let xmlSnippet = '';
    try {
      xmlSnippet = fs.readFileSync(result.modifiedPath, 'utf-8').substring(0, 500);
    } catch { /* ignore */ }

    const { title, emoji } = await generateTitle(result.model.name, xmlSnippet);
    console.log(`[B1]   → ${emoji} ${title}`);

    // Rename the file
    let renamedPath = result.modifiedPath;
    try {
      renamedPath = renameModel(result.modifiedPath, emoji, title);
      console.log(`[B1]   Renamed → ${path.basename(renamedPath)}`);
    } catch (err) {
      console.error(`[B1]   Rename failed: ${err.message}`);
    }

    b1Results.push({
      ...result,
      aiTitle: title,
      aiEmoji: emoji,
      renamedPath,
    });
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════════════╗');
  console.log('  ║                    B1 TITLE RESULTS                      ║');
  console.log('  ╠═══════════════════════════════════════════════════════════╣');
  console.log('');
  console.log('  ┌─────┬──────────────────────────────┬──────────────────────────────┐');
  console.log('  │  #  │ Original                     │ AI Title                     │');
  console.log('  ├─────┼──────────────────────────────┼──────────────────────────────┤');

  for (let i = 0; i < b1Results.length; i++) {
    const r = b1Results[i];
    const orig = (r.model?.name || 'N/A').slice(0, 28).padEnd(28, ' ');
    const ai = r.aiTitle
      ? `${r.aiEmoji} ${r.aiTitle}`.slice(0, 28).padEnd(28, ' ')
      : 'SKIPPED'.padEnd(28, ' ');
    console.log(`  │ ${String(i + 1).padStart(3, ' ')} │ ${orig} │ ${ai} │`);
  }

  console.log('  └─────┴──────────────────────────────┴──────────────────────────────┘');
  console.log('');

  return b1Results;
}

module.exports = { runB1, generateTitle, renameModel, groqChat, EMOJIS };
