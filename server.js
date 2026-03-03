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
  destination: ${destination}

  USER_QUERY: ${userQuery}


Task: Identify any stops (places) the user explicitly asks for in the USER_QUERY. Return only what the user asked for—do not add or infer extra stops.
Use a generic type for categories (e.g. bookstore, atm, restaurant) or the place name when they mention a specific brand 9. Do not invent or echo misspelled words (e.g. KFC) "grab some books" or "rab some books" → return "bookstore" or "books", not "raban books").
Return ONLY a single JSON object, nothing else. No markdown, no explanation.
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

function buildAddressDuplicatePrompt(selectedName, selectedAddress, routePlaces) {
  const list = (routePlaces || [])
    .filter((p) => p && (p.address || p.name))
    .map((p, i) => `${i + 1}. Name: ${p.name || '(none)'}, Address: ${p.address || '(none)'}`)
    .join('\n');
  return `Given one selected place (name + address) and a list of route places (origin, destination, or already added stops; each with name + address), determine if the selected place is the SAME venue as any in the list. Ignore minor formatting differences in addresses.
Important: Two different shops at the same address (different names) are NOT duplicates—only treat as duplicate if it is the same business/place.

Selected place:
Name: ${selectedName || '(none)'}
Address: ${selectedAddress || ''}

Route places:
${list || '(none)'}

Return ONLY a JSON object, no other text. Format: {"duplicate": true} or {"duplicate": false}`;
}

async function checkAddressDuplicate(selectedName, selectedAddress, routePlaces) {
  if (!selectedAddress || !routePlaces || routePlaces.length === 0) return false;
  const openai = new OpenAI({
    apiKey: NOVA_KEY,
    baseURL: 'https://api.nova.amazon.com/v1/',
  });
  const prompt = buildAddressDuplicatePrompt(selectedName, selectedAddress, routePlaces);
  const response = await openai.chat.completions.create({
    model: 'nova-2-lite-v1',
    messages: [{ role: 'user', content: prompt }],
  });
  const content = response.choices?.[0]?.message?.content?.trim() || '';
  const jsonMatch = content.match(/\{[\s\S]*?"duplicate"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.duplicate === true;
    } catch (_) {
      console.log('[check-address-duplicate] Fallback to default duplicate=false (JSON parse failed)');
      return false;
    }
  }
  console.log('[check-address-duplicate] Fallback to default duplicate=false (no valid response from Nova)');
  return false;
}

app.post('/api/check-address-duplicate', async (req, res) => {
  try {
    const { name, address, routePlaces, routeAddresses } = req.body || {};
    const places = routePlaces && Array.isArray(routePlaces)
      ? routePlaces
      : Array.isArray(routeAddresses)
        ? routeAddresses.map((addr) => ({ name: '', address: addr || '' }))
        : null;
    if (!address || !places || places.length === 0) {
      return res.status(400).json({ error: 'Missing address or routePlaces/routeAddresses array' });
    }
    if (!NOVA_KEY) {
      return res.status(503).json({ error: 'NOVA_API_KEY not set in .env' });
    }
    const duplicate = await checkAddressDuplicate(name || '', address, places);
    return res.json({ duplicate });
  } catch (err) {
    console.error('[POST /api/check-address-duplicate] error:', err);
    console.log('[check-address-duplicate] Fallback to default duplicate=false (exception)');
    return res.json({ duplicate: false });
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

// Find Place (Legacy): only request place_id to minimize cost; then use Place Details (ID) for full info.
// radius: optional, in meters. Default 1000. Client can pass 10% of route distance, capped at 1000.
app.get('/api/find-place', async (req, res) => {
  const input = (req.query.input || '').trim();
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  let radius = parseInt(req.query.radius, 10);
  if (!Number.isInteger(radius) || radius < 1) radius = 1000;
  if (radius > 1000) radius = 1000;
  if (!input || Number.isNaN(lat) || Number.isNaN(lng) || !MAPS_KEY) {
    return res.status(400).json({ error: 'Missing input, lat, lng, or MAPS_API_KEY' });
  }
  const locationbias = `circle:${radius}@${lat},${lng}`;
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(input)}&inputtype=textquery&fields=place_id&locationbias=${encodeURIComponent(locationbias)}&key=${MAPS_KEY}`;
  try {
    console.log('[find-place] request:', { input, lat, lng, radius });
    const r = await fetch(url);
    const data = await r.json();
    console.log('[find-place] response:', data.status, (data.candidates || []).length, 'candidates', data);
    const placeIds = (data.candidates || []).map((c) => c.place_id).filter(Boolean);
    return res.json({ place_ids: placeIds });
  } catch (err) {
    console.error('[find-place] error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Place Details by place_id only (ID-only = lower-cost / unlimited tier when applicable).
app.get('/api/place-details', async (req, res) => {
  const placeId = (req.query.place_id || '').trim();
  if (!placeId || !MAPS_KEY) {
    return res.status(400).json({ error: 'Missing place_id or MAPS_API_KEY' });
  }
  const fields = 'place_id,name,formatted_address,geometry,opening_hours';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${encodeURIComponent(fields)}&key=${MAPS_KEY}`;
  try {
    const r = await fetch(url);
    const data = await r.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return res.status(400).json({ error: data.error_message || data.status });
    }
    return res.json(data.result || {});
  } catch (err) {
    console.error('[place-details] error:', err);
    return res.status(500).json({ error: err.message });
  }
});

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
