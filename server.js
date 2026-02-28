require('dotenv').config();
// Work around "unable to get local issuer certificate" when calling Nova API (common on Mac/corporate networks).
// Set ALLOW_INSECURE_TLS=1 in .env or when running if you see that error.
if (process.env.ALLOW_INSECURE_TLS === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
const OpenAI = require('openai').default;
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MAPS_KEY = (process.env.MAPS_API_KEY || '').trim();
const NOVA_KEY = (process.env.NOVA_API_KEY || '').trim();

app.use(express.json());

function buildPrompt(source, destination, userQuery) {
  return `source: ${source}
user query: ${userQuery}
destination: ${destination}

Task: Identify any stops (places) in the user's query. If there are stops, return ONLY a single JSON object, nothing else. No markdown, no explanation, no other text.
Format: {"stops": ["place1", "place2"]}
If no stops: {"stops": []}`;
}

async function detectStops(source, destination, userQuery) {
  const openai = new OpenAI({
    apiKey: NOVA_KEY,
    baseURL: 'https://api.nova.amazon.com/v1/',
  });
  const prompt = buildPrompt(source, destination, userQuery);
  const response = await openai.chat.completions.create({
    model: 'nova-2-lite-v1',
    messages: [{ role: 'user', content: prompt }],
  });
  console.log('[Nova API] full response:', JSON.stringify(response, null, 2));
  const content = response.choices?.[0]?.message?.content?.trim() || '';
  console.log('[Nova API] message content:', content);
  const jsonMatch = content.match(/\{[\s\S]*?"stops"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return Array.isArray(parsed.stops) ? parsed.stops : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

async function runStopDetection(source, destination, userQuery) {
  const params = { source, destination, userQuery };
  return detectStops(params.source, params.destination, params.userQuery);
}

app.post('/api/detect-stops', async (req, res) => {
  console.log('[POST /api/detect-stops] received', JSON.stringify(req.body, null, 2));
  try {
    const { source, destination, userQuery } = req.body || {};
    if (!source || !destination || !userQuery) {
      return res.status(400).json({ error: 'Missing source, destination, or userQuery' });
    }
    if (!NOVA_KEY) {
      return res.status(503).json({ error: 'NOVA_API_KEY not set in .env' });
    }
    const stops = await runStopDetection(source, destination, userQuery);
    console.log('[POST /api/detect-stops] returning stops:', stops);
    return res.json({ stops });
  } catch (err) {
    console.error('[POST /api/detect-stops] error:', err);
    return res.status(500).json({ error: err.message || 'Failed to detect stops' });
  }
});

function buildExtractLocationsPrompt(instructions) {
  const list = instructions.map((s, i) => `Step ${i + 1}: ${s}`).join('\n\n');
  return `Route step instructions (plain text). For each step extract one item: ROAD/STREET name if present, otherwise one PLACE name. Return ONLY valid JSON, no other text, no markdown.
Format: {"locations": ["name1", "name2", ...]} in step order.

Instructions:
${list}`;
}

async function extractLocations(instructions) {
  if (!instructions || instructions.length === 0) return [];
  const openai = new OpenAI({
    apiKey: NOVA_KEY,
    baseURL: 'https://api.nova.amazon.com/v1/',
  });
  const prompt = buildExtractLocationsPrompt(instructions);
  const response = await openai.chat.completions.create({
    model: 'nova-2-lite-v1',
    messages: [{ role: 'user', content: prompt }],
  });
  console.log('[Nova API extract-locations] full response:', JSON.stringify(response, null, 2));
  const content = response.choices?.[0]?.message?.content?.trim() || '';
  console.log('[Nova API extract-locations] message content:', content);
  const jsonMatch = content.match(/\{[\s\S]*?"locations"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return Array.isArray(parsed.locations) ? parsed.locations : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

app.post('/api/extract-locations', async (req, res) => {
  const instructions = req.body?.instructions || [];
  console.log('[POST /api/extract-locations] received, instructions count:', instructions.length);
  if (instructions.length) console.log('[POST /api/extract-locations] first instruction:', instructions[0]);
  try {
    if (!Array.isArray(instructions)) {
      return res.status(400).json({ error: 'instructions must be an array' });
    }
    if (instructions.length === 0) {
      console.log('[POST /api/extract-locations] empty instructions, returning []');
      return res.json({ locations: [] });
    }
    if (!NOVA_KEY) {
      return res.status(503).json({ error: 'NOVA_API_KEY not set in .env' });
    }
    const locations = await extractLocations(instructions);
    console.log('[POST /api/extract-locations] returning locations:', locations);
    return res.json({ locations });
  } catch (err) {
    console.error('[POST /api/extract-locations] error:', err);
    return res.status(500).json({ error: err.message || 'Failed to extract locations' });
  }
});

// Serve index.html with MAPS_API_KEY injected from .env (must be before static so / gets this)
app.get('/', (req, res) => {
  const file = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  const key = MAPS_KEY.replace(/'/g, "\\'");
  html = html.replace(/__MAPS_API_KEY__/g, key);
  res.type('html').send(html);
});

// Serve static files (css, js, etc.)
app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`AI Navigator running at http://localhost:${PORT}`);
  if (!MAPS_KEY) console.warn('MAPS_API_KEY not set in .env — Maps autocomplete will be disabled.');
  if (!NOVA_KEY) console.warn('NOVA_API_KEY not set in .env — stop detection will be disabled.');
});
