const express = require('express');
const cors = require('cors');
const multer = require('multer');
const webpush = require('web-push');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { chat, chatWithTools } = require('./llm');

const app = express();

// ---------------------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------------------

// CORS — restrict to same-origin in production
if (process.env.NODE_ENV === 'production') {
  app.use(cors({ origin: false })); // disallow cross-origin; frontend is served from same origin
} else {
  app.use(cors());
}

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'");
  }
  next();
});

// JSON body size limit
app.use(express.json({ limit: '1mb' }));

// Rate limiting for expensive LLM endpoints
const llmLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many AI requests. Please wait a moment and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

const DB_PATH = process.env.DB_PATH || './data/garden.db';
const DATA_DIR = path.resolve(path.dirname(DB_PATH));
const IMAGES_DIR = path.join(DATA_DIR, 'images');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });
const db = new Database(DB_PATH);

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function safeFilename(filename) {
  const base = path.basename(filename);
  if (base !== filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return null;
  }
  return base;
}

function sanitizeCropName(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) return null;
  return trimmed;
}

function sanitizeString(str, maxLen = 500) {
  if (str == null) return null;
  if (typeof str !== 'string') return String(str).slice(0, maxLen);
  return str.trim().slice(0, maxLen);
}

function validateNumeric(val, min, max, fallback) {
  const num = Number(val);
  if (isNaN(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function safeErrorMessage(e) {
  if (!e) return 'Unknown error';
  const msg = e.message || String(e);
  // Strip stack traces and internal paths
  if (msg.includes('/') || msg.includes('\\') || msg.length > 200) {
    // Check for known user-facing error patterns
    if (/no api key/i.test(msg)) return msg;
    if (/invalid json/i.test(msg)) return 'AI returned an invalid response. Please try again.';
    if (/rate|limit|429/i.test(msg)) return 'Rate limited. Please wait a moment and try again.';
    if (/timeout|ETIMEDOUT/i.test(msg)) return 'Request timed out. Please try again.';
    if (/ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(msg)) return 'Connection error. Check your network and API configuration.';
    return 'An internal error occurred. Please try again.';
  }
  return msg;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, IMAGES_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are accepted'));
  },
});

app.use('/uploads', express.static(IMAGES_DIR, { dotfiles: 'deny' }));

db.exec(`
  CREATE TABLE IF NOT EXISTS gardens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    zone TEXT,
    zipcode TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS beds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    garden_id INTEGER REFERENCES gardens(id),
    name TEXT NOT NULL,
    width_ft REAL,
    length_ft REAL
  );
  CREATE TABLE IF NOT EXISTS plantings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    garden_id INTEGER REFERENCES gardens(id),
    bed_id INTEGER REFERENCES beds(id),
    crop TEXT NOT NULL,
    sow_indoors TEXT,
    transplant_or_direct_sow TEXT,
    harvest TEXT,
    tip TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS plant_info_cache (
    crop TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    planting_id INTEGER REFERENCES plantings(id),
    note TEXT,
    label TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS journal_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journal_entry_id INTEGER REFERENCES journal_entries(id),
    filename TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS bed_layout (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bed_id INTEGER REFERENCES beds(id),
    row INTEGER NOT NULL,
    col INTEGER NOT NULL,
    crop TEXT NOT NULL,
    UNIQUE(bed_id, row, col)
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT UNIQUE NOT NULL,
    subscription TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS companion_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    garden_id INTEGER REFERENCES gardens(id),
    crop_key TEXT NOT NULL,
    data TEXT NOT NULL,
    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(garden_id, crop_key)
  );
  CREATE TABLE IF NOT EXISTS garden_chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    garden_id INTEGER REFERENCES gardens(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS garden_fences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    garden_id INTEGER REFERENCES gardens(id),
    name TEXT DEFAULT 'Fence',
    fence_type TEXT DEFAULT 'wood',
    points TEXT NOT NULL,
    post_spacing_ft REAL DEFAULT 8,
    closed INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS garden_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    garden_id INTEGER REFERENCES gardens(id),
    type TEXT NOT NULL,
    name TEXT DEFAULT '',
    x_ft REAL DEFAULT 0,
    y_ft REAL DEFAULT 0,
    width_ft REAL DEFAULT 2,
    length_ft REAL DEFAULT 2,
    metadata TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS llm_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT,
    api_key TEXT,
    base_url TEXT,
    is_active INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS task_routing (
    task TEXT PRIMARY KEY,
    llm_config_id INTEGER REFERENCES llm_configs(id)
  );
`);

// ---------------------------------------------------------------------------
// Schema migrations — add columns that may not exist in older DBs
// ---------------------------------------------------------------------------

const migrations = [
  'ALTER TABLE gardens ADD COLUMN layout_width_ft  REAL DEFAULT 20',
  'ALTER TABLE gardens ADD COLUMN layout_length_ft REAL DEFAULT 20',
  'ALTER TABLE gardens ADD COLUMN bg_image TEXT',
  'ALTER TABLE beds ADD COLUMN x_ft REAL DEFAULT 0',
  'ALTER TABLE beds ADD COLUMN y_ft REAL DEFAULT 0',
  'ALTER TABLE gardens ADD COLUMN is_default INTEGER DEFAULT 0',
  'ALTER TABLE gardens ADD COLUMN sort_order INTEGER DEFAULT 0',
  'ALTER TABLE plantings ADD COLUMN status_planted INTEGER DEFAULT 0',
  'ALTER TABLE plantings ADD COLUMN status_transplanted INTEGER DEFAULT 0',
  'ALTER TABLE plantings ADD COLUMN status_harvested INTEGER DEFAULT 0',
  'ALTER TABLE plantings ADD COLUMN status_skipped INTEGER DEFAULT 0',
];
for (const sql of migrations) {
  try { db.prepare(sql).run(); } catch {} // column already exists → silent no-op
}

// ---------------------------------------------------------------------------
// VAPID / web-push setup  (keys generated once, persisted in settings table)
// ---------------------------------------------------------------------------

function getOrCreateVapidKeys() {
  const pub  = db.prepare("SELECT value FROM settings WHERE key='vapid_public'").get();
  const priv = db.prepare("SELECT value FROM settings WHERE key='vapid_private'").get();
  if (pub && priv) return { publicKey: pub.value, privateKey: priv.value };

  const keys = webpush.generateVAPIDKeys();
  const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  set.run('vapid_public',  keys.publicKey);
  set.run('vapid_private', keys.privateKey);
  console.log('Generated new VAPID keys');
  return keys;
}

const vapidKeys = getOrCreateVapidKeys();
webpush.setVapidDetails(
  'mailto:gardenarr@localhost',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// ---------------------------------------------------------------------------
// LLM settings helpers
// ---------------------------------------------------------------------------

function maskKey(key) {
  if (!key) return null;
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '…' + key.slice(-4);
}

function getLLMSettings() {
  // Prefer the active config from llm_configs table
  const active = db.prepare('SELECT * FROM llm_configs WHERE is_active = 1 LIMIT 1').get();
  if (active) {
    let apiKey = active.api_key || null;
    if (!apiKey) {
      if (active.provider === 'anthropic') apiKey = process.env.ANTHROPIC_API_KEY || null;
      else if (active.provider === 'openai')  apiKey = process.env.OPENAI_API_KEY  || null;
      else if (active.provider === 'google')  apiKey = process.env.GOOGLE_API_KEY  || null;
    }
    return {
      provider: active.provider,
      model: active.model || null,
      api_key: apiKey,
      ollama_base_url: active.base_url || null,
    };
  }

  // Legacy fallback: read from old flat settings table
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  const provider = s.provider || 'anthropic';
  let apiKey = s.api_key || null;
  if (!apiKey) {
    if (provider === 'anthropic') apiKey = process.env.ANTHROPIC_API_KEY || null;
    else if (provider === 'openai')  apiKey = process.env.OPENAI_API_KEY  || null;
    else if (provider === 'google')  apiKey = process.env.GOOGLE_API_KEY  || null;
  }
  return {
    provider,
    model: s.model || null,
    api_key: apiKey,
    ollama_base_url: s.ollama_base_url || null,
  };
}

function getLLMSettingsForTask(task) {
  const row = db.prepare('SELECT llm_config_id FROM task_routing WHERE task = ?').get(task);
  if (row?.llm_config_id) {
    const cfg = db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(row.llm_config_id);
    if (cfg) {
      let apiKey = cfg.api_key || null;
      if (!apiKey) {
        if (cfg.provider === 'anthropic') apiKey = process.env.ANTHROPIC_API_KEY || null;
        else if (cfg.provider === 'openai')  apiKey = process.env.OPENAI_API_KEY  || null;
        else if (cfg.provider === 'google')  apiKey = process.env.GOOGLE_API_KEY  || null;
      }
      return { provider: cfg.provider, model: cfg.model || null, api_key: apiKey, ollama_base_url: cfg.base_url || null };
    }
  }
  return getLLMSettings();
}

// ---------------------------------------------------------------------------
// LLM configs API  (multi-provider management)
// ---------------------------------------------------------------------------

function serializeConfig(cfg) {
  return {
    id: cfg.id,
    name: cfg.name,
    provider: cfg.provider,
    model: cfg.model || '',
    api_key_hint: maskKey(cfg.api_key),
    base_url: cfg.base_url || '',
    is_active: cfg.is_active === 1,
  };
}

app.get('/api/llm-configs', (_req, res) => {
  const configs = db.prepare('SELECT * FROM llm_configs ORDER BY id ASC').all();
  res.json(configs.map(serializeConfig));
});

app.post('/api/llm-configs', (req, res) => {
  const { name, provider, model, api_key, base_url, make_active } = req.body;
  if (!name?.trim() || !provider) return res.status(400).json({ error: 'name and provider are required' });

  const existing = db.prepare('SELECT COUNT(*) as c FROM llm_configs').get();
  const shouldActivate = make_active || existing.c === 0 ? 1 : 0;

  if (shouldActivate) {
    db.prepare('UPDATE llm_configs SET is_active = 0').run();
  }

  const result = db.prepare(
    'INSERT INTO llm_configs (name, provider, model, api_key, base_url, is_active) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name.trim(), provider, model || null, api_key || null, base_url || null, shouldActivate);

  const created = db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(result.lastInsertRowid);
  res.json(serializeConfig(created));
});

app.put('/api/llm-configs/:id', (req, res) => {
  const { name, provider, model, api_key, base_url } = req.body;
  const id = req.params.id;
  const cfg = db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(id);
  if (!cfg) return res.status(404).json({ error: 'Not found' });

  db.prepare(
    'UPDATE llm_configs SET name=?, provider=?, model=?, base_url=? WHERE id=?'
  ).run(
    name?.trim() ?? cfg.name,
    provider ?? cfg.provider,
    model !== undefined ? (model || null) : cfg.model,
    base_url !== undefined ? (base_url || null) : cfg.base_url,
    id
  );
  // Only update key if a non-empty value was sent
  if (api_key?.trim()) {
    db.prepare('UPDATE llm_configs SET api_key=? WHERE id=?').run(api_key.trim(), id);
  }

  const updated = db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(id);
  res.json(serializeConfig(updated));
});

app.post('/api/llm-configs/:id/test', async (req, res) => {
  const cfg = db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(req.params.id);
  if (!cfg) return res.status(404).json({ error: 'Not found' });

  let apiKey = cfg.api_key || null;
  if (!apiKey) {
    if (cfg.provider === 'anthropic') apiKey = process.env.ANTHROPIC_API_KEY || null;
    else if (cfg.provider === 'openai')  apiKey = process.env.OPENAI_API_KEY  || null;
    else if (cfg.provider === 'google')  apiKey = process.env.GOOGLE_API_KEY  || null;
  }

  const settings = { provider: cfg.provider, model: cfg.model || null, api_key: apiKey, ollama_base_url: cfg.base_url || null };

  try {
    const reply = await chat('Reply with exactly one word: OK', settings, { maxTokens: 16 });
    res.json({ ok: true, response: reply.trim() });
  } catch (e) {
    res.json({ ok: false, error: safeErrorMessage(e) });
  }
});

app.post('/api/llm-configs/:id/activate', (req, res) => {
  const cfg = db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(req.params.id);
  if (!cfg) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE llm_configs SET is_active = 0').run();
  db.prepare('UPDATE llm_configs SET is_active = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/llm-configs/:id', (req, res) => {
  const cfg = db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(req.params.id);
  if (!cfg) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM llm_configs WHERE id = ?').run(req.params.id);
  // If we deleted the active one, activate the first remaining config
  if (cfg.is_active) {
    const next = db.prepare('SELECT id FROM llm_configs ORDER BY id ASC LIMIT 1').get();
    if (next) db.prepare('UPDATE llm_configs SET is_active = 1 WHERE id = ?').run(next.id);
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Task routing API
// ---------------------------------------------------------------------------

const KNOWN_TASKS = [
  { task: 'schedule',    label: 'Planting schedule' },
  { task: 'companion',   label: 'Companion planting' },
  { task: 'plant_info',  label: 'Plant info' },
];

app.get('/api/task-routing', (_req, res) => {
  const rows = db.prepare('SELECT task, llm_config_id FROM task_routing').all();
  const map = {};
  for (const r of rows) map[r.task] = r.llm_config_id;
  res.json(KNOWN_TASKS.map(t => ({ ...t, llm_config_id: map[t.task] || null })));
});

app.post('/api/task-routing', (req, res) => {
  // body: { schedule: 3, companion: null, plant_info: 1 }
  const upsert = db.prepare('INSERT OR REPLACE INTO task_routing (task, llm_config_id) VALUES (?, ?)');
  const del    = db.prepare('DELETE FROM task_routing WHERE task = ?');
  for (const { task } of KNOWN_TASKS) {
    if (!(task in req.body)) continue;
    const val = req.body[task];
    if (val) upsert.run(task, val);
    else del.run(task);
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Legacy settings API  (kept for backward compatibility)
// ---------------------------------------------------------------------------

app.get('/api/settings', (req, res) => {
  const s = getLLMSettings();
  res.json({
    provider: s.provider,
    model: s.model || '',
    api_key_hint: maskKey(s.api_key),
    ollama_base_url: s.ollama_base_url || '',
  });
});

app.post('/api/settings', (req, res) => {
  const { provider, model, api_key, ollama_base_url } = req.body;
  const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  if (provider !== undefined) set.run('provider', provider);
  if (model !== undefined)    set.run('model', model || '');
  if (api_key)                set.run('api_key', api_key);
  if (ollama_base_url !== undefined) set.run('ollama_base_url', ollama_base_url || '');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Push notification endpoints
// ---------------------------------------------------------------------------

app.get('/api/push/public-key', (_req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  db.prepare(
    'INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription) VALUES (?, ?)'
  ).run(sub.endpoint, JSON.stringify(sub));
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// AI endpoints
// ---------------------------------------------------------------------------

async function scheduleForCrops(location, crops) {
  const settings = getLLMSettingsForTask('schedule');
  const text = await chat(
    `You are a gardening expert. For ${location}, give a planting schedule for: ${crops.join(', ')}.
Reply ONLY with valid JSON, no markdown, no extra text:
{"crops":[{"name":"string","sow_indoors":"string or null","transplant_or_direct_sow":"string","harvest":"string","tip":"string"}]}`,
    settings,
    { maxTokens: 4096 }
  );
  const raw = text.replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

app.post('/api/schedule', llmLimiter, async (req, res) => {
  const { location, crops } = req.body;
  if (!location || !crops?.length) return res.status(400).json({ error: 'Missing location or crops' });
  if (crops.length > 50) return res.status(400).json({ error: 'Too many crops (max 50)' });

  try {
    const BATCH_SIZE = 15;
    if (crops.length <= BATCH_SIZE) {
      return res.json(await scheduleForCrops(location, crops));
    }
    const batches = [];
    for (let i = 0; i < crops.length; i += BATCH_SIZE) batches.push(crops.slice(i, i + BATCH_SIZE));
    const results = await Promise.all(batches.map(b => scheduleForCrops(location, b)));
    res.json({ crops: results.flatMap(r => r.crops) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: safeErrorMessage(e) });
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function companionForCrops(cropList, settings, retries = 2) {
  if (!settings.api_key && !settings.ollama_base_url) {
    throw new Error('No API key configured. Please set your API key in Settings.');
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const text = await chat(
        `You are a gardening expert specializing in companion planting. Analyze companion relationships among these crops: ${cropList.join(', ')}.

IMPORTANT: Only include BENEFICIAL and HARMFUL pairs. Do NOT include neutral pairs — skip any pair where the crops have no significant interaction. Focus especially on harmful pairings (e.g. potatoes and tomatoes are nightshades and compete for nutrients/share blight, fennel inhibits most plants, etc).

Reply ONLY with valid JSON, no markdown fences, no extra text:
{
  "pairs": [
    {
      "crop_a": "string",
      "crop_b": "string",
      "relationship": "beneficial" | "harmful",
      "reason": "brief explanation"
    }
  ],
  "bed_suggestions": [
    {
      "bed_name": "string",
      "crops": ["crop1", "crop2"],
      "notes": "why these work well together"
    }
  ],
  "avoid_together": [
    {
      "crops": ["crop1", "crop2"],
      "reason": "why to keep apart"
    }
  ],
  "tips": ["tip1", "tip2"]
}`,
        settings,
        { maxTokens: 8192 }
      );
      const raw = text.replace(/```json|```/g, '').trim();
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.error('Failed to parse companion JSON:', raw.slice(0, 200));
        throw new Error('AI returned invalid JSON. Try again.');
      }
    } catch (e) {
      const isRetryable = /rate|limit|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|overloaded|socket|hang up|529|503|429|500/i.test(e.message);
      if (isRetryable && attempt < retries) {
        const delay = (attempt + 1) * 3000; // 3s, 6s
        console.log(`Companion batch retry ${attempt + 1}/${retries} after ${delay}ms: ${e.message}`);
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }
}


app.post('/api/companion', llmLimiter, async (req, res) => {
  const { crops } = req.body;
  if (!crops?.length) return res.status(400).json({ error: 'Missing crops' });
  if (crops.length > 50) return res.status(400).json({ error: 'Too many crops (max 50)' });

  // Extend timeout — single call but can take a while for many crops
  req.setTimeout(600000);
  res.setTimeout(600000);

  try {
    const settings = getLLMSettingsForTask('companion');
    console.log(`Companion analysis: ${crops.length} crops in a single call`);
    const data = await companionForCrops(crops, settings);
    res.json(data);
  } catch (e) {
    console.error('Companion analysis error:', e);
    res.status(500).json({ error: safeErrorMessage(e) });
  }
});

// ---------------------------------------------------------------------------
// Companion cache (per garden)
// ---------------------------------------------------------------------------

function companionCropKey(crops) {
  return [...crops].map(c => c.trim().toLowerCase()).sort().join('||');
}

app.get('/api/gardens/:id/companion', (req, res) => {
  const row = db.prepare(
    'SELECT data, crop_key, cached_at FROM companion_cache WHERE garden_id = ? ORDER BY cached_at DESC LIMIT 1'
  ).get(req.params.id);
  if (!row) return res.json(null);
  res.json({ ...JSON.parse(row.data), crop_key: row.crop_key, cached_at: row.cached_at });
});

app.post('/api/gardens/:id/companion', (req, res) => {
  const { crops, result } = req.body;
  if (!crops?.length || !result) return res.status(400).json({ error: 'Missing crops or result' });
  const key = companionCropKey(crops);
  db.prepare(
    'INSERT OR REPLACE INTO companion_cache (garden_id, crop_key, data, cached_at) VALUES (?, ?, ?, datetime(\'now\'))'
  ).run(req.params.id, key, JSON.stringify(result));
  res.json({ ok: true });
});

app.delete('/api/gardens/:id/companion', (req, res) => {
  db.prepare('DELETE FROM companion_cache WHERE garden_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Plant info (AI-generated, cached per crop name)
// ---------------------------------------------------------------------------

app.post('/api/plants/info', llmLimiter, async (req, res) => {
  const { crop } = req.body;
  if (!crop?.trim()) return res.status(400).json({ error: 'Missing crop name' });
  if (crop.length > 100) return res.status(400).json({ error: 'Crop name too long' });

  const key = crop.trim().toLowerCase();

  const cached = db.prepare('SELECT data FROM plant_info_cache WHERE crop = ?').get(key);
  if (cached) return res.json(JSON.parse(cached.data));

  try {
    const settings = getLLMSettingsForTask('plant_info');
    const text = await chat(
      `You are a gardening expert. Provide detailed growing information for: ${crop}.

Reply ONLY with valid JSON, no markdown, no extra text:
{
  "description": "1-2 sentence overview of the plant",
  "difficulty": "Easy | Moderate | Challenging",
  "spacing_inches": number,
  "days_to_germination": "e.g. 7–14 days",
  "days_to_maturity": "e.g. 60–80 days",
  "sun": "Full sun | Part shade | Full shade",
  "water": "brief watering needs",
  "soil": "brief soil preferences",
  "common_pests": ["pest1", "pest2"],
  "common_diseases": ["disease1", "disease2"],
  "companion_benefits": ["plant it near X because Y"],
  "harvest_tips": "how to know when ready and how to harvest",
  "storage": "brief storage guidance"
}`,
      settings,
      { maxTokens: 1024 }
    );
    const data = JSON.parse(text.replace(/```json|```/g, '').trim());
    db.prepare('INSERT OR REPLACE INTO plant_info_cache (crop, data) VALUES (?, ?)').run(key, JSON.stringify(data));
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: safeErrorMessage(e) });
  }
});

// Return which crop names are already in the plant_info_cache
app.post('/api/plants/info/cached', (req, res) => {
  const { crops } = req.body;
  if (!crops?.length) return res.json({ cached: [] });
  const keys = crops.map(c => c.trim().toLowerCase());
  const placeholders = keys.map(() => '?').join(',');
  const rows = db.prepare(`SELECT crop FROM plant_info_cache WHERE crop IN (${placeholders})`).all(...keys);
  res.json({ cached: rows.map(r => r.crop) });
});

// ---------------------------------------------------------------------------
// Journal & images
// ---------------------------------------------------------------------------

app.get('/api/plantings/:id/journal', (req, res) => {
  const entries = db.prepare(
    'SELECT * FROM journal_entries WHERE planting_id = ? ORDER BY created_at ASC'
  ).all(req.params.id);
  const images = db.prepare(
    `SELECT ji.* FROM journal_images ji
     JOIN journal_entries je ON ji.journal_entry_id = je.id
     WHERE je.planting_id = ?`
  ).all(req.params.id);
  const imagesByEntry = {};
  for (const img of images) {
    (imagesByEntry[img.journal_entry_id] ||= []).push(img);
  }
  res.json(entries.map(e => ({ ...e, images: imagesByEntry[e.id] || [] })));
});

// POST with optional image upload
app.post('/api/plantings/:id/journal', upload.single('image'), (req, res) => {
  const { note, label } = req.body;
  if (!note?.trim() && !req.file) {
    return res.status(400).json({ error: 'Entry must have a note or an image' });
  }
  const entry = db.prepare(
    'INSERT INTO journal_entries (planting_id, note, label) VALUES (?, ?, ?)'
  ).run(req.params.id, note?.trim() || null, label || null);

  let image = null;
  if (req.file) {
    const imgRow = db.prepare(
      'INSERT INTO journal_images (journal_entry_id, filename) VALUES (?, ?)'
    ).run(entry.lastInsertRowid, req.file.filename);
    image = { id: imgRow.lastInsertRowid, filename: req.file.filename };
  }
  res.json({ id: entry.lastInsertRowid, note: note?.trim() || null, label: label || null, images: image ? [image] : [] });
});

app.delete('/api/journal/:id', (req, res) => {
  const images = db.prepare('SELECT filename FROM journal_images WHERE journal_entry_id = ?').all(req.params.id);
  for (const img of images) {
    const safe = safeFilename(img.filename);
    if (safe) {
      const filePath = path.join(IMAGES_DIR, safe);
      fs.unlink(filePath, () => {}); // best-effort delete
    }
  }
  db.prepare('DELETE FROM journal_images WHERE journal_entry_id = ?').run(req.params.id);
  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/journal/images/:id', (req, res) => {
  const img = db.prepare('SELECT filename FROM journal_images WHERE id = ?').get(req.params.id);
  if (!img) return res.status(404).json({ error: 'Not found' });
  const safe = safeFilename(img.filename);
  if (safe) fs.unlink(path.join(IMAGES_DIR, safe), () => {});
  db.prepare('DELETE FROM journal_images WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Garden / bed / planting CRUD
// ---------------------------------------------------------------------------

app.get('/api/gardens', (req, res) => {
  res.json(db.prepare('SELECT * FROM gardens ORDER BY sort_order ASC, created_at DESC').all());
});

app.post('/api/gardens', (req, res) => {
  const { name, zone, zipcode } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Garden name is required' });
  const safeName = sanitizeString(name, 100);
  const safeZone = sanitizeString(zone, 20);
  const safeZip = sanitizeString(zipcode, 10);
  const result = db.prepare('INSERT INTO gardens (name, zone, zipcode) VALUES (?, ?, ?)').run(safeName, safeZone, safeZip);
  res.json({ id: result.lastInsertRowid, name: safeName, zone: safeZone, zipcode: safeZip });
});

// Must be registered before /:id routes to avoid "reorder" matching :id
app.post('/api/gardens/reorder', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
  const update = db.prepare('UPDATE gardens SET sort_order=? WHERE id=?');
  order.forEach((id, i) => update.run(i, id));
  res.json({ ok: true });
});

app.post('/api/gardens/:id/set-default', (req, res) => {
  const garden = db.prepare('SELECT id FROM gardens WHERE id = ?').get(req.params.id);
  if (!garden) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE gardens SET is_default=0').run();
  db.prepare('UPDATE gardens SET is_default=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/gardens/:id', (req, res) => {
  db.prepare('DELETE FROM plantings WHERE garden_id = ?').run(req.params.id);
  db.prepare('DELETE FROM beds WHERE garden_id = ?').run(req.params.id);
  db.prepare('DELETE FROM companion_cache WHERE garden_id = ?').run(req.params.id);
  db.prepare('DELETE FROM garden_fences WHERE garden_id = ?').run(req.params.id);
  db.prepare('DELETE FROM garden_features WHERE garden_id = ?').run(req.params.id);
  db.prepare('DELETE FROM garden_chat WHERE garden_id = ?').run(req.params.id);
  db.prepare('DELETE FROM gardens WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/gardens/:id/plantings', (req, res) => {
  res.json(db.prepare('SELECT * FROM plantings WHERE garden_id = ? ORDER BY created_at DESC').all(req.params.id));
});

app.post('/api/gardens/:id/plantings', (req, res) => {
  const { crop, sow_indoors, transplant_or_direct_sow, harvest, tip, notes, bed_id } = req.body;
  const result = db.prepare(
    'INSERT INTO plantings (garden_id, bed_id, crop, sow_indoors, transplant_or_direct_sow, harvest, tip, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.params.id, bed_id || null, crop, sow_indoors, transplant_or_direct_sow, harvest, tip, notes || '');
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/plantings/:id', (req, res) => {
  const { crop, sow_indoors, transplant_or_direct_sow, harvest, tip, notes,
          status_planted, status_transplanted, status_harvested, status_skipped } = req.body;
  // If only status fields are being updated (partial update)
  if (crop === undefined && status_planted !== undefined) {
    db.prepare(
      'UPDATE plantings SET status_planted=?, status_transplanted=?, status_harvested=?, status_skipped=? WHERE id=?'
    ).run(status_planted ? 1 : 0, status_transplanted ? 1 : 0, status_harvested ? 1 : 0, status_skipped ? 1 : 0, req.params.id);
    return res.json({ ok: true });
  }
  db.prepare(
    'UPDATE plantings SET crop=?, sow_indoors=?, transplant_or_direct_sow=?, harvest=?, tip=?, notes=?, status_planted=?, status_transplanted=?, status_harvested=?, status_skipped=? WHERE id=?'
  ).run(crop, sow_indoors || null, transplant_or_direct_sow, harvest, tip, notes || '',
        status_planted ? 1 : 0, status_transplanted ? 1 : 0, status_harvested ? 1 : 0, status_skipped ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/plantings/:id', (req, res) => {
  db.prepare('DELETE FROM plantings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/gardens/:id/beds', (req, res) => {
  res.json(db.prepare('SELECT * FROM beds WHERE garden_id = ?').all(req.params.id));
});

app.post('/api/gardens/:id/beds', (req, res) => {
  const { name, width_ft, length_ft } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Bed name is required' });
  const safeName = sanitizeString(name, 100);
  const safeW = validateNumeric(width_ft, 1, 100, 4);
  const safeL = validateNumeric(length_ft, 1, 100, 8);
  const result = db.prepare('INSERT INTO beds (garden_id, name, width_ft, length_ft) VALUES (?, ?, ?, ?)').run(req.params.id, safeName, safeW, safeL);
  res.json({ id: result.lastInsertRowid, name: safeName, width_ft: safeW, length_ft: safeL });
});

app.put('/api/beds/:id', (req, res) => {
  const { name, width_ft, length_ft } = req.body;
  const bed = db.prepare('SELECT * FROM beds WHERE id = ?').get(req.params.id);
  if (!bed) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE beds SET name=?, width_ft=?, length_ft=? WHERE id=?').run(
    name?.trim() ?? bed.name,
    width_ft  != null ? Number(width_ft)  : bed.width_ft,
    length_ft != null ? Number(length_ft) : bed.length_ft,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/beds/:id', (req, res) => {
  db.prepare('DELETE FROM bed_layout WHERE bed_id = ?').run(req.params.id);
  db.prepare('DELETE FROM beds WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/beds/:id/layout', (req, res) => {
  res.json(db.prepare('SELECT row, col, crop FROM bed_layout WHERE bed_id = ?').all(req.params.id));
});

app.put('/api/beds/:id/layout/:row/:col', (req, res) => {
  const { crop } = req.body;
  if (!crop?.trim()) return res.status(400).json({ error: 'Missing crop' });
  db.prepare('INSERT OR REPLACE INTO bed_layout (bed_id, row, col, crop) VALUES (?, ?, ?, ?)')
    .run(req.params.id, req.params.row, req.params.col, crop.trim());
  res.json({ ok: true });
});

app.delete('/api/beds/:id/layout/:row/:col', (req, res) => {
  db.prepare('DELETE FROM bed_layout WHERE bed_id = ? AND row = ? AND col = ?')
    .run(req.params.id, req.params.row, req.params.col);
  res.json({ ok: true });
});

app.delete('/api/beds/:id/layout', (req, res) => {
  db.prepare('DELETE FROM bed_layout WHERE bed_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Garden fences CRUD
// ---------------------------------------------------------------------------

app.get('/api/gardens/:id/fences', (req, res) => {
  const rows = db.prepare('SELECT * FROM garden_fences WHERE garden_id = ?').all(req.params.id);
  res.json(rows.map(r => ({ ...r, points: JSON.parse(r.points) })));
});

app.post('/api/gardens/:id/fences', (req, res) => {
  const { name, fence_type, points, post_spacing_ft, closed } = req.body;
  if (!points?.length) return res.status(400).json({ error: 'points required' });
  const result = db.prepare(
    'INSERT INTO garden_fences (garden_id, name, fence_type, points, post_spacing_ft, closed) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.params.id, name || 'Fence', fence_type || 'wood', JSON.stringify(points), post_spacing_ft || 8, closed ? 1 : 0);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/fences/:id', (req, res) => {
  const fence = db.prepare('SELECT * FROM garden_fences WHERE id = ?').get(req.params.id);
  if (!fence) return res.status(404).json({ error: 'Not found' });
  const { name, fence_type, points, post_spacing_ft, closed } = req.body;
  db.prepare(
    'UPDATE garden_fences SET name=?, fence_type=?, points=?, post_spacing_ft=?, closed=? WHERE id=?'
  ).run(
    name ?? fence.name, fence_type ?? fence.fence_type,
    points ? JSON.stringify(points) : fence.points,
    post_spacing_ft ?? fence.post_spacing_ft,
    closed !== undefined ? (closed ? 1 : 0) : fence.closed,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/fences/:id', (req, res) => {
  db.prepare('DELETE FROM garden_fences WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Garden features CRUD (trees, bushes, compost, paths)
// ---------------------------------------------------------------------------

app.get('/api/gardens/:id/features', (req, res) => {
  const rows = db.prepare('SELECT * FROM garden_features WHERE garden_id = ?').all(req.params.id);
  res.json(rows.map(r => ({ ...r, metadata: JSON.parse(r.metadata || '{}') })));
});

app.post('/api/gardens/:id/features', (req, res) => {
  const { type, name, x_ft, y_ft, width_ft, length_ft, metadata } = req.body;
  if (!type) return res.status(400).json({ error: 'type required' });
  const result = db.prepare(
    'INSERT INTO garden_features (garden_id, type, name, x_ft, y_ft, width_ft, length_ft, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.params.id, type, name || '', x_ft || 0, y_ft || 0, width_ft || 2, length_ft || 2, JSON.stringify(metadata || {}));
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/features/:id', (req, res) => {
  const feat = db.prepare('SELECT * FROM garden_features WHERE id = ?').get(req.params.id);
  if (!feat) return res.status(404).json({ error: 'Not found' });
  const { name, x_ft, y_ft, width_ft, length_ft, metadata } = req.body;
  db.prepare(
    'UPDATE garden_features SET name=?, x_ft=?, y_ft=?, width_ft=?, length_ft=?, metadata=? WHERE id=?'
  ).run(
    name !== undefined ? name : feat.name,
    x_ft !== undefined ? x_ft : feat.x_ft,
    y_ft !== undefined ? y_ft : feat.y_ft,
    width_ft !== undefined ? width_ft : feat.width_ft,
    length_ft !== undefined ? length_ft : feat.length_ft,
    metadata ? JSON.stringify(metadata) : feat.metadata,
    req.params.id
  );
  res.json({ ok: true });
});

app.patch('/api/features/:id/position', (req, res) => {
  const { x_ft, y_ft } = req.body;
  db.prepare('UPDATE garden_features SET x_ft=?, y_ft=? WHERE id=?').run(
    Number(x_ft) || 0, Number(y_ft) || 0, req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/features/:id', (req, res) => {
  db.prepare('DELETE FROM garden_features WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// AI fence guidance (soil type, frost line, post depth)
// ---------------------------------------------------------------------------

app.post('/api/gardens/:id/fence-guidance', llmLimiter, async (req, res) => {
  const garden = db.prepare('SELECT * FROM gardens WHERE id = ?').get(req.params.id);
  if (!garden) return res.status(404).json({ error: 'Not found' });
  const zipcode = garden.zipcode || req.body.zipcode;
  if (!zipcode) return res.status(400).json({ error: 'No zip code set for this garden. Update your garden settings.' });

  try {
    const settings = getLLMSettings();
    const text = await chat(
      `You are a fencing and landscaping expert. For zip code ${zipcode} in the United States, provide guidance on installing garden fence posts.

Consider the local climate, soil conditions, and frost line depth for this region.

Reply ONLY with valid JSON, no markdown fences:
{
  "region_name": "brief region description (e.g. Northeast Ohio)",
  "soil_type": "predominant soil type (e.g. Clay loam)",
  "soil_notes": "brief note about working with this soil",
  "frost_line_depth_inches": number,
  "recommended_post_hole_depth_inches": number,
  "use_concrete": true or false,
  "concrete_notes": "why or why not to use concrete",
  "post_diameter_inches": number,
  "recommended_post_spacing_ft": number,
  "recommendations": [
    "specific recommendation 1",
    "specific recommendation 2",
    "specific recommendation 3"
  ],
  "best_time_to_install": "best season/months for installation",
  "drainage_notes": "any drainage considerations"
}`,
      settings,
      { maxTokens: 1024 }
    );
    const data = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(data);
  } catch (e) {
    console.error('Fence guidance error:', e);
    res.status(500).json({ error: safeErrorMessage(e) });
  }
});

// ---------------------------------------------------------------------------
// Garden layout canvas endpoints
// ---------------------------------------------------------------------------

// Update garden canvas dimensions (and optionally clear bg)
app.patch('/api/gardens/:id', (req, res) => {
  const { layout_width_ft, layout_length_ft } = req.body;
  const garden = db.prepare('SELECT * FROM gardens WHERE id = ?').get(req.params.id);
  if (!garden) return res.status(404).json({ error: 'Not found' });
  db.prepare(
    'UPDATE gardens SET layout_width_ft=?, layout_length_ft=? WHERE id=?'
  ).run(
    layout_width_ft  != null ? Number(layout_width_ft)  : (garden.layout_width_ft  || 20),
    layout_length_ft != null ? Number(layout_length_ft) : (garden.layout_length_ft || 20),
    req.params.id
  );
  res.json({ ok: true });
});

// Move a bed on the canvas
app.patch('/api/beds/:id/position', (req, res) => {
  const { x_ft, y_ft } = req.body;
  db.prepare('UPDATE beds SET x_ft=?, y_ft=? WHERE id=?').run(
    Number(x_ft) || 0,
    Number(y_ft) || 0,
    req.params.id
  );
  res.json({ ok: true });
});

// Upload a background map/satellite image for the garden canvas
app.post('/api/gardens/:id/layout/bg', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  const garden = db.prepare('SELECT * FROM gardens WHERE id = ?').get(req.params.id);
  if (!garden) return res.status(404).json({ error: 'Not found' });

  // Delete the previous background image file if one exists
  if (garden.bg_image) {
    const safe = safeFilename(garden.bg_image);
    if (safe) fs.unlink(path.join(IMAGES_DIR, safe), () => {});
  }

  db.prepare('UPDATE gardens SET bg_image=? WHERE id=?').run(req.file.filename, req.params.id);
  res.json({ ok: true, filename: req.file.filename });
});

// Delete background image
app.delete('/api/gardens/:id/layout/bg', (req, res) => {
  const garden = db.prepare('SELECT * FROM gardens WHERE id = ?').get(req.params.id);
  if (!garden) return res.status(404).json({ error: 'Not found' });
  if (garden.bg_image) {
    const safe = safeFilename(garden.bg_image);
    if (safe) fs.unlink(path.join(IMAGES_DIR, safe), () => {});
  }
  db.prepare("UPDATE gardens SET bg_image=NULL WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// AI bed arrangement + crop distribution
app.post('/api/gardens/:id/layout/suggest', llmLimiter, async (req, res) => {
  const garden = db.prepare('SELECT * FROM gardens WHERE id = ?').get(req.params.id);
  if (!garden) return res.status(404).json({ error: 'Not found' });

  const beds = db.prepare('SELECT * FROM beds WHERE garden_id = ?').all(req.params.id);
  if (!beds.length) return res.status(400).json({ error: 'No beds to arrange' });

  const plantings = db.prepare('SELECT crop FROM plantings WHERE garden_id = ?').all(req.params.id);
  const crops = [...new Set(plantings.map(p => p.crop))];

  // Load existing bed layouts to see what's already placed
  const existingLayouts = {};
  for (const bed of beds) {
    const cells = db.prepare('SELECT row, col, crop FROM bed_layout WHERE bed_id = ?').all(bed.id);
    existingLayouts[bed.id] = cells;
  }

  const gardenW = garden.layout_width_ft || 20;
  const gardenL = garden.layout_length_ft || 20;

  const bedDescriptions = beds.map(b => {
    const existing = existingLayouts[b.id] || [];
    const placedCrops = [...new Set(existing.map(c => c.crop))];
    const cols = Math.max(1, Math.round(b.width_ft || 4));
    const rows = Math.max(1, Math.round(b.length_ft || 8));
    const totalCells = cols * rows;
    const usedCells = existing.length;
    return `- Bed "${b.name}" (id:${b.id}, ${b.width_ft || 4}ft × ${b.length_ft || 8}ft, grid: ${cols} cols × ${rows} rows, ${totalCells} cells total, ${usedCells} cells used): ${placedCrops.length ? 'has: ' + placedCrops.join(', ') : 'empty'}`;
  }).join('\n');

  const unplacedCrops = crops.filter(crop => {
    return !Object.values(existingLayouts).some(cells => cells.some(c => c.crop === crop));
  });

  const prompt = `You are a garden layout and companion planting expert. You have a ${gardenW}ft × ${gardenL}ft garden (width × length, north is top).

Beds:
${bedDescriptions}

${crops.length ? `All crops in this garden: ${crops.join(', ')}` : 'No crops saved yet.'}
${unplacedCrops.length ? `Crops NOT yet placed in any bed: ${unplacedCrops.join(', ')}` : 'All crops are already placed in beds.'}

Tasks:
1. POSITION beds: suggest x_ft, y_ft for each bed. Taller/sun-loving crops on the north side. Leave 2+ ft gaps. Keep beds inside the boundary.
2. DISTRIBUTE unplaced crops: assign each unplaced crop to a bed_id and specify how many cells it needs (1 sq ft per cell). Consider companion planting and spacing. I will fill in the actual grid cells programmatically.

Return ONLY valid JSON, no markdown:
{
  "beds": [{"id": number, "x_ft": number, "y_ft": number}],
  "crop_assignments": [{"bed_id": number, "crop": "string", "cells": number}],
  "tips": ["tip1", "tip2"]
}`;

  try {
    const settings = getLLMSettings();
    req.setTimeout(600000);
    res.setTimeout(600000);
    const text = await chat(prompt, settings, { maxTokens: 16384 });
    let raw = text.replace(/```json|```/g, '').trim();

    // Attempt to repair truncated JSON — the AI may run out of tokens mid-array
    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      console.log('AI arrange JSON parse failed, attempting repair...');
      // Try closing any unclosed arrays/objects
      let repaired = raw;
      // Remove trailing incomplete object (e.g. `, {"bed_id": 1, "row"`)
      repaired = repaired.replace(/,\s*\{[^}]*$/, '');
      // Remove trailing comma
      repaired = repaired.replace(/,\s*$/, '');
      // Count unclosed brackets and close them
      const opens = (repaired.match(/[\[{]/g) || []);
      const closes = (repaired.match(/[\]}]/g) || []);
      let needed = opens.length - closes.length;
      // Walk backwards to determine correct closing order
      const stack = [];
      for (const ch of repaired) {
        if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}' || ch === ']') stack.pop();
      }
      while (stack.length) {
        const open = stack.pop();
        repaired += open === '{' ? '}' : ']';
      }
      try {
        data = JSON.parse(repaired);
        console.log('AI arrange JSON repaired successfully');
      } catch (e2) {
        throw new Error('AI returned invalid JSON that could not be repaired. Try again with fewer crops.');
      }
    }

    // Distribute crops into bed cells programmatically based on AI assignments
    if (data.crop_assignments?.length) {
      const upsert = db.prepare(
        'INSERT OR REPLACE INTO bed_layout (bed_id, row, col, crop) VALUES (?, ?, ?, ?)'
      );
      const validBedIds = new Set(beds.map(b => b.id));

      // Build a map of occupied cells per bed
      const occupied = {};
      for (const bed of beds) {
        occupied[bed.id] = new Set(
          (existingLayouts[bed.id] || []).map(c => `${c.row},${c.col}`)
        );
      }

      let placed = 0;
      for (const a of data.crop_assignments) {
        if (!validBedIds.has(a.bed_id) || !a.crop?.trim()) continue;
        const bed = beds.find(b => b.id === a.bed_id);
        const maxCols = Math.max(1, Math.round(bed.width_ft || 4));
        const maxRows = Math.max(1, Math.round(bed.length_ft || 8));
        const cellsNeeded = Math.max(1, Math.min(a.cells || 1, maxCols * maxRows));

        // Fill next available empty cells in this bed
        let filled = 0;
        for (let r = 0; r < maxRows && filled < cellsNeeded; r++) {
          for (let c = 0; c < maxCols && filled < cellsNeeded; c++) {
            const key = `${r},${c}`;
            if (occupied[a.bed_id].has(key)) continue;
            upsert.run(a.bed_id, r, c, a.crop.trim());
            occupied[a.bed_id].add(key);
            filled++;
            placed++;
          }
        }
      }
      console.log(`AI placed ${placed} crops into bed cells`);
    }

    // Persist bed positions
    if (data.beds?.length) {
      for (const b of data.beds) {
        if (!beds.find(bed => bed.id === b.id)) continue;
        db.prepare('UPDATE beds SET x_ft=?, y_ft=? WHERE id=?').run(
          Number(b.x_ft) || 0, Number(b.y_ft) || 0, b.id
        );
      }
    }

    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: safeErrorMessage(e) });
  }
});

// ---------------------------------------------------------------------------
// Garden AI Chatbot (tool-use based)
// ---------------------------------------------------------------------------

const GARDEN_CHAT_TOOLS = [
  {
    name: 'list_plantings',
    description: 'List all crops/plantings saved in this garden with their schedule info and status.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'add_planting',
    description: 'Add a new crop to the garden planting list. Use this when the user wants to grow something new.',
    input_schema: {
      type: 'object',
      properties: {
        crop: { type: 'string', description: 'Crop name (e.g. "Tomatoes")' },
        sow_indoors: { type: 'string', description: 'When to start seeds indoors (optional)' },
        transplant_or_direct_sow: { type: 'string', description: 'When to transplant or direct sow' },
        harvest: { type: 'string', description: 'Expected harvest time' },
        tip: { type: 'string', description: 'Growing tip' },
        notes: { type: 'string', description: 'Additional notes' },
      },
      required: ['crop'],
    },
  },
  {
    name: 'remove_planting',
    description: 'Remove a crop from the garden planting list by its ID.',
    input_schema: {
      type: 'object',
      properties: { planting_id: { type: 'number', description: 'ID of the planting to remove' } },
      required: ['planting_id'],
    },
  },
  {
    name: 'list_beds',
    description: 'List all beds in the garden with their dimensions, positions, and what crops are planted in their grid cells.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_bed',
    description: 'Create a new garden bed.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Bed name' },
        width_ft: { type: 'number', description: 'Width in feet (1-50)' },
        length_ft: { type: 'number', description: 'Length in feet (1-50)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'assign_crop_to_bed',
    description: 'Place a crop into specific grid cell(s) of a bed. Each cell is ~1 sq ft.',
    input_schema: {
      type: 'object',
      properties: {
        bed_id: { type: 'number', description: 'Bed ID' },
        crop: { type: 'string', description: 'Crop name to place' },
        cells: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              row: { type: 'number' },
              col: { type: 'number' },
            },
          },
          description: 'Array of {row, col} grid positions to fill',
        },
      },
      required: ['bed_id', 'crop', 'cells'],
    },
  },
  {
    name: 'remove_crop_from_bed',
    description: 'Remove crops from specific grid cells in a bed, or clear all cells.',
    input_schema: {
      type: 'object',
      properties: {
        bed_id: { type: 'number', description: 'Bed ID' },
        cells: {
          type: 'array',
          items: { type: 'object', properties: { row: { type: 'number' }, col: { type: 'number' } } },
          description: 'Specific cells to clear. Omit to clear the entire bed.',
        },
      },
      required: ['bed_id'],
    },
  },
  {
    name: 'move_bed',
    description: 'Reposition a bed on the garden canvas.',
    input_schema: {
      type: 'object',
      properties: {
        bed_id: { type: 'number' },
        x_ft: { type: 'number', description: 'New X position in feet' },
        y_ft: { type: 'number', description: 'New Y position in feet' },
      },
      required: ['bed_id', 'x_ft', 'y_ft'],
    },
  },
  {
    name: 'get_plant_info',
    description: 'Get detailed growing information about a specific plant/crop, including spacing, sun needs, pests, harvest tips, etc. Use this to answer gardening questions or recommend plants.',
    input_schema: {
      type: 'object',
      properties: {
        crop: { type: 'string', description: 'Plant/crop name to look up' },
      },
      required: ['crop'],
    },
  },
  {
    name: 'get_companion_info',
    description: 'Check companion planting relationships between specific crops. Returns which are beneficial, harmful, or neutral neighbors.',
    input_schema: {
      type: 'object',
      properties: {
        crops: { type: 'array', items: { type: 'string' }, description: 'List of crop names to check relationships between' },
      },
      required: ['crops'],
    },
  },
  {
    name: 'recommend_plants',
    description: 'Recommend plants based on user criteria. Use your gardening expertise plus the garden zone/location to suggest interesting plants. Consider what they already grow.',
    input_schema: {
      type: 'object',
      properties: {
        criteria: { type: 'string', description: 'What the user is looking for (e.g. "herbs for shade", "pollinator-friendly flowers", "easy vegetables for beginners")' },
        existing_crops: { type: 'array', items: { type: 'string' }, description: 'Crops already in the garden (for companion consideration)' },
      },
      required: ['criteria'],
    },
  },
];

function buildGardenChatSystem(garden) {
  return `You are a friendly, knowledgeable garden assistant for the garden "${garden.name}".
${garden.zone ? `Garden zone: ${garden.zone}.` : ''}${garden.zipcode ? ` Zip code: ${garden.zipcode}.` : ''}
Garden canvas: ${garden.layout_width_ft || 20}ft × ${garden.layout_length_ft || 20}ft.

You help users plan, plant, and manage their garden. You can:
- Add/remove crops from their planting list
- Place crops into bed grid cells (each cell = ~1 sq ft)
- Create and arrange beds on the canvas
- Look up plant info and companion planting data
- Recommend interesting plants to grow

Be conversational and helpful. When you make changes, confirm what you did. When recommending plants, be specific about why they'd work in this garden. If a user asks about companion planting and you don't have the info cached, use the get_companion_info tool to look it up.

Keep responses concise — a couple sentences plus any relevant details. Don't be overly verbose.`;
}

async function executeGardenTool(gardenId, name, input, settings) {
  switch (name) {
    case 'list_plantings': {
      const rows = db.prepare('SELECT * FROM plantings WHERE garden_id = ? ORDER BY created_at DESC').all(gardenId);
      return JSON.stringify(rows);
    }
    case 'add_planting': {
      const result = db.prepare(
        'INSERT INTO plantings (garden_id, crop, sow_indoors, transplant_or_direct_sow, harvest, tip, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(gardenId, input.crop, input.sow_indoors || null, input.transplant_or_direct_sow || null, input.harvest || null, input.tip || null, input.notes || '');
      return JSON.stringify({ ok: true, id: result.lastInsertRowid, crop: input.crop });
    }
    case 'remove_planting': {
      db.prepare('DELETE FROM plantings WHERE id = ? AND garden_id = ?').run(input.planting_id, gardenId);
      return JSON.stringify({ ok: true });
    }
    case 'list_beds': {
      const beds = db.prepare('SELECT * FROM beds WHERE garden_id = ?').all(gardenId);
      const result = beds.map(b => {
        const cells = db.prepare('SELECT row, col, crop FROM bed_layout WHERE bed_id = ?').all(b.id);
        const crops = [...new Set(cells.map(c => c.crop))];
        const cols = Math.max(1, Math.round(b.width_ft || 4));
        const rows = Math.max(1, Math.round(b.length_ft || 8));
        return { ...b, grid: `${cols}x${rows}`, total_cells: cols * rows, used_cells: cells.length, crops_placed: crops };
      });
      return JSON.stringify(result);
    }
    case 'create_bed': {
      const result = db.prepare(
        'INSERT INTO beds (garden_id, name, width_ft, length_ft) VALUES (?, ?, ?, ?)'
      ).run(gardenId, input.name, input.width_ft || 4, input.length_ft || 8);
      return JSON.stringify({ ok: true, id: result.lastInsertRowid, name: input.name });
    }
    case 'assign_crop_to_bed': {
      const bed = db.prepare('SELECT * FROM beds WHERE id = ? AND garden_id = ?').get(input.bed_id, gardenId);
      if (!bed) return JSON.stringify({ error: 'Bed not found' });
      const upsert = db.prepare('INSERT OR REPLACE INTO bed_layout (bed_id, row, col, crop) VALUES (?, ?, ?, ?)');
      let placed = 0;
      const maxCols = Math.max(1, Math.round(bed.width_ft || 4));
      const maxRows = Math.max(1, Math.round(bed.length_ft || 8));
      for (const cell of (input.cells || [])) {
        if (cell.row >= 0 && cell.row < maxRows && cell.col >= 0 && cell.col < maxCols) {
          upsert.run(input.bed_id, cell.row, cell.col, input.crop);
          placed++;
        }
      }
      return JSON.stringify({ ok: true, placed, bed: bed.name });
    }
    case 'remove_crop_from_bed': {
      const bed = db.prepare('SELECT * FROM beds WHERE id = ? AND garden_id = ?').get(input.bed_id, gardenId);
      if (!bed) return JSON.stringify({ error: 'Bed not found' });
      if (input.cells?.length) {
        const del = db.prepare('DELETE FROM bed_layout WHERE bed_id = ? AND row = ? AND col = ?');
        for (const cell of input.cells) del.run(input.bed_id, cell.row, cell.col);
        return JSON.stringify({ ok: true, cleared: input.cells.length, bed: bed.name });
      } else {
        db.prepare('DELETE FROM bed_layout WHERE bed_id = ?').run(input.bed_id);
        return JSON.stringify({ ok: true, cleared: 'all', bed: bed.name });
      }
    }
    case 'move_bed': {
      const bed = db.prepare('SELECT * FROM beds WHERE id = ? AND garden_id = ?').get(input.bed_id, gardenId);
      if (!bed) return JSON.stringify({ error: 'Bed not found' });
      db.prepare('UPDATE beds SET x_ft=?, y_ft=? WHERE id=?').run(input.x_ft, input.y_ft, input.bed_id);
      return JSON.stringify({ ok: true, bed: bed.name, x_ft: input.x_ft, y_ft: input.y_ft });
    }
    case 'get_plant_info': {
      const key = input.crop.trim().toLowerCase();
      const cached = db.prepare('SELECT data FROM plant_info_cache WHERE crop = ?').get(key);
      if (cached) return cached.data;
      // Generate info via LLM
      try {
        const text = await chat(
          `You are a gardening expert. Provide detailed growing information for: ${input.crop}.
Reply ONLY with valid JSON:
{"description":"overview","difficulty":"Easy|Moderate|Challenging","spacing_inches":12,"days_to_germination":"7-14","days_to_maturity":"60-80","sun":"Full sun","water":"needs","soil":"preferences","common_pests":["pest"],"common_diseases":["disease"],"companion_benefits":["tip"],"harvest_tips":"how to harvest","storage":"storage tips"}`,
          settings, { maxTokens: 1024 }
        );
        const data = text.replace(/```json|```/g, '').trim();
        JSON.parse(data); // validate
        db.prepare('INSERT OR REPLACE INTO plant_info_cache (crop, data) VALUES (?, ?)').run(key, data);
        return data;
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    }
    case 'get_companion_info': {
      if (!input.crops?.length || input.crops.length < 2) return JSON.stringify({ error: 'Need at least 2 crops' });
      try {
        const text = await chat(
          `Analyze companion planting relationships between: ${input.crops.join(', ')}.
Only include beneficial and harmful pairs. Reply ONLY with JSON:
{"pairs":[{"crop_a":"","crop_b":"","relationship":"beneficial|harmful","reason":"why"}]}`,
          settings, { maxTokens: 2048 }
        );
        return text.replace(/```json|```/g, '').trim();
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    }
    case 'recommend_plants': {
      // The AI itself is the recommendation engine — just return a prompt for it to reason with
      return JSON.stringify({
        note: 'Use your gardening expertise to recommend plants based on the criteria. Consider the garden zone, existing crops for companion planting, and the specific request.',
        criteria: input.criteria,
        existing_crops: input.existing_crops || [],
      });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// Get chat history
app.get('/api/gardens/:id/chat', (req, res) => {
  const rows = db.prepare(
    'SELECT id, role, content, tool_calls, created_at FROM garden_chat WHERE garden_id = ? ORDER BY created_at ASC'
  ).all(req.params.id);
  res.json(rows.map(r => ({
    ...r,
    tool_calls: r.tool_calls ? JSON.parse(r.tool_calls) : null,
  })));
});

// Send a chat message
app.post('/api/gardens/:id/chat', llmLimiter, async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Empty message' });
  if (message.length > 2000) return res.status(400).json({ error: 'Message too long (max 2000 characters)' });

  const garden = db.prepare('SELECT * FROM gardens WHERE id = ?').get(req.params.id);
  if (!garden) return res.status(404).json({ error: 'Garden not found' });

  req.setTimeout(600000);
  res.setTimeout(600000);

  try {
    const settings = getLLMSettings();
    if (!settings.api_key && !settings.ollama_base_url) {
      return res.status(400).json({ error: 'No API key configured' });
    }

    // Load recent chat history (last 20 exchanges for context)
    const history = db.prepare(
      'SELECT role, content FROM garden_chat WHERE garden_id = ? ORDER BY created_at DESC LIMIT 40'
    ).all(req.params.id).reverse();

    // Build messages array for the API
    const messages = history.map(h => ({ role: h.role, content: h.content }));
    messages.push({ role: 'user', content: message.trim() });

    // Save user message
    db.prepare('INSERT INTO garden_chat (garden_id, role, content) VALUES (?, ?, ?)').run(
      req.params.id, 'user', message.trim()
    );

    const systemPrompt = buildGardenChatSystem(garden);

    const { reply, toolCalls } = await chatWithTools(
      messages, systemPrompt, GARDEN_CHAT_TOOLS,
      (name, input) => executeGardenTool(req.params.id, name, input, settings),
      settings,
      { maxTokens: 4096, maxTurns: 8 }
    );

    // Save assistant reply
    db.prepare('INSERT INTO garden_chat (garden_id, role, content, tool_calls) VALUES (?, ?, ?, ?)').run(
      req.params.id, 'assistant', reply, toolCalls.length ? JSON.stringify(toolCalls) : null
    );

    // Determine which data was modified so frontend knows what to refresh
    const modified = new Set();
    for (const tc of toolCalls) {
      if (['add_planting', 'remove_planting', 'list_plantings'].includes(tc.name)) modified.add('plantings');
      if (['create_bed', 'move_bed', 'list_beds', 'assign_crop_to_bed', 'remove_crop_from_bed'].includes(tc.name)) modified.add('beds');
      if (['assign_crop_to_bed', 'remove_crop_from_bed'].includes(tc.name)) modified.add('layouts');
    }

    res.json({
      reply,
      toolCalls,
      modified: [...modified],
    });
  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ error: safeErrorMessage(e) });
  }
});

// Clear chat history
app.delete('/api/gardens/:id/chat', (req, res) => {
  db.prepare('DELETE FROM garden_chat WHERE garden_id = ?').run(req.params.id);
  res.json({ ok: true });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'frontend/dist')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'frontend/dist/index.html')));
}

// ---------------------------------------------------------------------------
// Weekly planting reminder — every Monday at 8:00 AM server-local time
// ---------------------------------------------------------------------------

async function sendPushReminders() {
  const subscriptions = db.prepare('SELECT subscription FROM push_subscriptions').all();
  if (!subscriptions.length) return;

  const gardens = db.prepare('SELECT id, name FROM gardens').all();
  if (!gardens.length) return;

  const plantingCounts = db.prepare(
    'SELECT garden_id, COUNT(*) as count FROM plantings GROUP BY garden_id'
  ).all();
  const countByGarden = {};
  for (const r of plantingCounts) countByGarden[r.garden_id] = r.count;

  const lines = gardens
    .filter(g => countByGarden[g.id])
    .map(g => `${g.name} (${countByGarden[g.id]} crop${countByGarden[g.id] !== 1 ? 's' : ''})`);

  if (!lines.length) return;

  const payload = JSON.stringify({
    title: 'Gardenarr — weekly reminder',
    body: `Gardens this week: ${lines.join(', ')}. Check your planting schedule!`,
    url: '/',
    tag: 'gardenarr-weekly',
  });

  const dead = [];
  for (const row of subscriptions) {
    try {
      await webpush.sendNotification(JSON.parse(row.subscription), payload);
    } catch (e) {
      // 404/410 means the subscription is no longer valid
      if (e.statusCode === 404 || e.statusCode === 410) {
        dead.push(JSON.parse(row.subscription).endpoint);
      } else {
        console.error('Push error:', e.message);
      }
    }
  }
  for (const endpoint of dead) {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }
  if (dead.length) console.log(`Removed ${dead.length} expired push subscription(s)`);
}

// Run every Monday at 08:00 (server local time)
cron.schedule('0 8 * * 1', sendPushReminders);

const PORT = process.env.PORT || 3700;
app.listen(PORT, () => console.log(`Garden planner running on port ${PORT}`));
