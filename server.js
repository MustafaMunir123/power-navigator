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
const APP_ACCESS_KEY = (process.env.APP_ACCESS_KEY || '').trim();

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach((s) => {
    const eq = s.trim().indexOf('=');
    if (eq > 0) out[s.trim().slice(0, eq)] = s.trim().slice(eq + 1).trim();
  });
  return out;
}

function getAccessKey(req) {
  return req.headers['x-access-key'] ||
    (req.headers['authorization'] && req.headers['authorization'].startsWith('Bearer ')
      ? req.headers['authorization'].slice(7).trim()
      : null) ||
    parseCookies(req.headers.cookie).app_access ||
    (req.query && req.query.key);
}

app.use(express.json());

if (APP_ACCESS_KEY) {
  app.use((req, res, next) => {
    if (req.path === '/login' || (req.path === '/api/access' && req.method === 'POST')) return next();
    const key = getAccessKey(req);
    if (key === APP_ACCESS_KEY) {
      if (req.query && req.query.key && req.path === '/') {
        res.cookie('app_access', APP_ACCESS_KEY, { httpOnly: true, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 });
        return res.redirect('/');
      }
      return next();
    }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Access key required' });
    if (req.path === '/' || req.path === '') return res.redirect('/login');
    res.status(401).send('Access key required');
  });
}

app.get('/login', (req, res) => {
  res.type('html').send(`
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Power Navigator – Access</title></head>
<body style="font-family:system-ui;max-width:360px;margin:4rem auto;padding:1rem;">
  <h1 style="font-size:1.25rem;">Power Navigator</h1>
  <p style="color:#666;">Enter the access key to continue.</p>
  <form method="post" action="/api/access" style="display:flex;flex-direction:column;gap:0.75rem;">
    <input type="password" name="key" placeholder="Access key" required autofocus style="padding:0.5rem;font-size:1rem;">
    <button type="submit" style="padding:0.5rem 1rem;">Continue</button>
  </form>
</body></html>`);
});

app.post('/api/access', express.urlencoded({ extended: true }), (req, res) => {
  const key = (req.body && req.body.key) ? req.body.key.trim() : '';
  if (key !== APP_ACCESS_KEY) return res.status(401).json({ error: 'Invalid key' });
  res.cookie('app_access', APP_ACCESS_KEY, { httpOnly: true, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.redirect('/');
});

function buildPrompt(source, destination, userQuery) {
  return `source: ${source}
  destination: ${destination}

  USER_QUERY: ${userQuery}

Task: Identify stops (places) the user explicitly asks for in the USER_QUERY only. Return only what the user asked for—do not add or infer extra stops.
CRITICAL: Do NOT include the source or the destination in the stops list. The source and destination are the user's start and end points; they are never additional stops. Even if the destination (or source) is a place name or appears in the query, do not add it to stops. Only add places the user explicitly requests as stops (e.g. "grab KFC" → KFC; do not add the destination).
Use a generic type for categories (e.g. bookstore, atm, restaurant) or the place name when they mention a specific brand. Do not invent or echo misspelled words.
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

function buildCommonPatternsPrompt(simplifiedMap) {
  const lines = [];
  Object.keys(simplifiedMap || {}).sort().forEach((dayName) => {
    const dayData = simplifiedMap[dayName];
    if (!dayData || typeof dayData !== 'object') return;
    lines.push(`${dayName}:`);
    Object.keys(dayData).sort().forEach((dateStr) => {
      lines.push(`  ${dateStr}: ${dayData[dateStr]}`);
    });
  });
  const input = lines.join('\n');
  return `You are analyzing a user's location history grouped by day of week. Each day has one or more dates, and for each date an itinerary string of the form "Place A [partOfDay] -> Place B [partOfDay] -> ..." (chronological order; partOfDay is Morning, AFTERNOON, or EVENING).

INPUT (day -> date -> itinerary):
${input || '(none)'}

Task: Identify recurring patterns per day. Only state patterns that are clearly supported by the data. Be concise. Every pattern MUST include at least two different place names from the itineraries (e.g. a route from A to B, or on your way from A to B you visit C). Never use generic phrases like "a burger place", "a pharmacy", "Home", or "Office" without the real venue/location name.

Rules:
- Each pattern MUST involve at least 2 locations (e.g. "from Place A to Place B", or "on your way from A to B you usually visit C").
- Do NOT suggest patterns that describe only one location, e.g. "You usually end at X on Thursdays" or "You usually eat out at X on Sunday"—these are not valid; they have only one route/location.
- Prefer route-style patterns: "On Thursdays, on your way from Gulshan Park to Kaniz Fatima you usually visit City Pharmacy."

Example of valid patterns (always 2+ places):
- "On Thursdays, on your way from Gulshan Park to Kaniz Fatima you usually visit City Pharmacy."
- "You usually go from Paradise Bakery to Gulshan Park in the afternoon on Tuesdays."

Return ONLY valid JSON: an object with day-of-week keys (e.g. "sunday", "thursday") and values that are arrays of pattern strings. Include only days where you find at least one valid pattern (2+ locations). If there are no such patterns, return {}.

Example output (every pattern must name at least 2 locations):
{"thursday": ["On Thursdays, on your way from Gulshan Park to Prestige Trade Centre you usually visit City Pharmacy."], "tuesday": ["You usually go from Paradise Bakery to Gulshan Park in the afternoon on Tuesdays."]}

Now return your response in that exact JSON format. No other text, no markdown.`;
}

function isSingleLocationPattern(text) {
  if (!text || typeof text !== 'string') return true;
  const t = text.trim().toLowerCase();
  if (/you usually end at .+ on (sunday|monday|tuesday|wednesday|thursday|friday|saturday)/.test(t)) return true;
  if (/you usually eat out at .+ on (sunday|monday|tuesday|wednesday|thursday|friday|saturday)/.test(t)) return true;
  const hasFromTo = /\bfrom\b/.test(t) && /\bto\b/.test(t);
  return !hasFromTo;
}

function filterCommonPatterns(parsed) {
  const result = {};
  Object.keys(parsed || {}).forEach((day) => {
    const arr = Array.isArray(parsed[day]) ? parsed[day] : [];
    const kept = arr.filter((s) => typeof s === 'string' && !isSingleLocationPattern(s));
    if (kept.length) result[day] = kept;
  });
  return result;
}

const DETECT_COMMON_PATTERNS_MAX_RETRIES = 3; // 3 retries after first attempt = 4 total attempts

async function detectCommonPatterns(simplifiedMap) {
  if (!simplifiedMap || typeof simplifiedMap !== 'object') return {};
  const openai = new OpenAI({
    apiKey: NOVA_KEY,
    baseURL: 'https://api.nova.amazon.com/v1/',
  });
  const prompt = buildCommonPatternsPrompt(simplifiedMap);
  let lastContent = '';
  for (let attempt = 1; attempt <= DETECT_COMMON_PATTERNS_MAX_RETRIES + 1; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: 'nova-2-lite-v1',
        messages: [{ role: 'user', content: prompt }],
      });
      let content = (response.choices?.[0]?.message?.content || '').trim();
      lastContent = content;
      const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlock) content = codeBlock[1].trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const raw = {};
          Object.keys(parsed).forEach((k) => {
            if (Array.isArray(parsed[k])) raw[k] = parsed[k].filter((s) => typeof s === 'string');
            else if (typeof parsed[k] === 'string') raw[k] = [parsed[k]];
          });
          return filterCommonPatterns(raw);
        }
      }
    } catch (e) {
      console.log('[detect-common-patterns] attempt', attempt, 'failed:', e.message);
      if (attempt === DETECT_COMMON_PATTERNS_MAX_RETRIES + 1 && lastContent) {
        console.log('[detect-common-patterns] raw content:', lastContent.slice(0, 500));
      }
    }
    if (attempt < DETECT_COMMON_PATTERNS_MAX_RETRIES + 1) {
      console.log('[detect-common-patterns] retry ' + attempt + '/' + (DETECT_COMMON_PATTERNS_MAX_RETRIES + 1) + ' failed, retrying…');
    }
  }
  return {};
}

app.post('/api/detect-common-patterns', async (req, res) => {
  try {
    const { simplifiedMap } = req.body || {};
    if (!NOVA_KEY) {
      return res.status(503).json({ error: 'NOVA_API_KEY not set in .env' });
    }
    const commonPatterns = await detectCommonPatterns(simplifiedMap);
    return res.json({ commonPatterns });
  } catch (err) {
    console.error('[POST /api/detect-common-patterns] error:', err);
    return res.status(500).json({ error: err.message || 'Failed to detect patterns' });
  }
});

function placeNameOnly(fullAddress) {
  if (typeof fullAddress !== 'string' || !fullAddress.trim()) return fullAddress || '';
  const first = fullAddress.split(',')[0].trim();
  return first || fullAddress.trim();
}

function buildMatchPatternsPrompt(source, destination, currentDay, partOfDay, patternsMap) {
  const sourceName = placeNameOnly(source);
  const destName = placeNameOnly(destination);
  console.log('[match-patterns] place names only:', { sourceName, destName });
  const list = Object.keys(patternsMap || {})
    .sort((a, b) => Number(a) - Number(b))
    .map((i) => `${i}: ${patternsMap[i]}`)
    .join('\n');
  return `User is traveling from ${sourceName} to ${destName} on a ${currentDay} ${partOfDay}.
(Consider: source as "${sourceName}", destination as "${destName}", current day as "${currentDay}", part of day as "${partOfDay}".)

Below are some common patterns (index: pattern text):
${list || '(none)'}

If you see any common pattern that meaningfully matches this trip, return its index. A pattern matches if either the source (${sourceName}) OR the destination (${destName}) matches or relates to the pattern, along with part of day (${partOfDay})—either source or destination is enough.

Return format:
{"patterns": [0, 2]}

If no patterns match, return:
{"patterns": []}

Note: Only match meaningful patterns. Return ONLY valid JSON with a "patterns" array of index numbers, no other text, no markdown.`;
}

async function matchPatterns(source, destination, currentDay, partOfDay, patternsMap) {
  if (!patternsMap || typeof patternsMap !== 'object' || Object.keys(patternsMap).length === 0) {
    return [];
  }
  const openai = new OpenAI({
    apiKey: NOVA_KEY,
    baseURL: 'https://api.nova.amazon.com/v1/',
  });
  const prompt = buildMatchPatternsPrompt(source, destination, currentDay, partOfDay, patternsMap);
  console.log('[match-patterns] filled prompt:\n', prompt);
  const response = await openai.chat.completions.create({
    model: 'nova-2-lite-v1',
    messages: [{ role: 'user', content: prompt }],
  });
  const content = (response.choices?.[0]?.message?.content || '').trim();
  const jsonMatch = content.match(/\{[\s\S]*?"patterns"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const arr = parsed.patterns;
      return Array.isArray(arr) ? arr.filter((n) => Number.isInteger(n) && n >= 0) : [];
    } catch (_) {
      console.log('[match-patterns] JSON parse failed');
    }
  }
  return [];
}

app.post('/api/match-patterns', async (req, res) => {
  try {
    const { source, destination, currentDay, partOfDay, patternsMap } = req.body || {};
    if (!source || !destination || !currentDay || !partOfDay) {
      return res.status(400).json({ error: 'Missing source, destination, currentDay, or partOfDay' });
    }
    if (!NOVA_KEY) {
      return res.status(503).json({ error: 'NOVA_API_KEY not set in .env' });
    }
    const patterns = await matchPatterns(source, destination, currentDay, partOfDay, patternsMap);
    return res.json({ patterns }); // patterns: [0, 2, ...] index numbers only
  } catch (err) {
    console.error('[POST /api/match-patterns] error:', err);
    return res.status(500).json({ error: err.message || 'Failed to match patterns' });
  }
});

function buildExtractPlacesFromPatternPrompt(patternText) {
  return `From this pattern text, extract all place or location names mentioned. Return only a JSON object with key "places" and value an array of strings (each string is one place name). Like detecting stops from user queries: list only real place/location names, in the order they appear if there are multiple.

Pattern: "${(patternText || '').trim()}"

Example: For "you usually go from Prestige Trade Centre to Haji Rang Elahi Eye & General Hospital in the evening" return {"places": ["Prestige Trade Centre", "Haji Rang Elahi Eye & General Hospital"]}
Return ONLY valid JSON, no other text, no markdown.`;
}

async function extractPlacesFromPattern(patternText) {
  if (!patternText || typeof patternText !== 'string' || !patternText.trim()) return [];
  const openai = new OpenAI({
    apiKey: NOVA_KEY,
    baseURL: 'https://api.nova.amazon.com/v1/',
  });
  const prompt = buildExtractPlacesFromPatternPrompt(patternText);
  console.log('[extract-places-from-pattern] filled prompt:\n', prompt);
  const response = await openai.chat.completions.create({
    model: 'nova-2-lite-v1',
    messages: [{ role: 'user', content: prompt }],
  });
  const content = (response.choices?.[0]?.message?.content || '').trim();
  const jsonMatch = content.match(/\{[\s\S]*?"places"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const arr = parsed.places;
      return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [];
    } catch (_) {
      console.log('[extract-places-from-pattern] JSON parse failed');
    }
  }
  return [];
}

app.post('/api/extract-places-from-pattern', async (req, res) => {
  try {
    const { patternText } = req.body || {};
    if (!NOVA_KEY) {
      return res.status(503).json({ error: 'NOVA_API_KEY not set in .env' });
    }
    const places = await extractPlacesFromPattern(patternText);
    return res.json({ places });
  } catch (err) {
    console.error('[POST /api/extract-places-from-pattern] error:', err);
    return res.status(500).json({ error: err.message || 'Failed to extract places' });
  }
});

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
  console.log(`Power Navigator running at http://localhost:${PORT}`);
  if (!MAPS_KEY) console.warn('MAPS_API_KEY not set in .env — Maps autocomplete will be disabled.');
  if (!NOVA_KEY) console.warn('NOVA_API_KEY not set in .env — stop detection will be disabled.');
});
