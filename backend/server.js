const express = require('express');
const cors = require('cors');
const multer = require('multer');
const webpush = require('web-push');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { chat } = require('./llm');

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = process.env.DB_PATH || './data/garden.db';
const DATA_DIR = path.resolve(path.dirname(DB_PATH));
const IMAGES_DIR = path.join(DATA_DIR, 'images');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });
const db = new Database(DB_PATH);

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

app.use('/uploads', express.static(IMAGES_DIR));

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
  return key.slice(0, 7) + '****';
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
    res.json({ ok: false, error: e.message });
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

app.post('/api/schedule', async (req, res) => {
  const { location, crops } = req.body;
  if (!location || !crops?.length) return res.status(400).json({ error: 'Missing location or crops' });

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
    res.status(500).json({ error: e.message });
  }
});

async function companionForCrops(cropList, settings) {
  if (!settings.api_key && !settings.ollama_base_url) {
    throw new Error('No API key configured. Please set your API key in Settings.');
  }
  const text = await chat(
    `You are a gardening expert specializing in companion planting. Analyze ALL possible pairings among these crops: ${cropList.join(', ')}.

IMPORTANT: You MUST evaluate EVERY possible pair of crops. For ${cropList.length} crops that means ${cropList.length * (cropList.length - 1) / 2} pairs. Do not skip any pairs. Pay special attention to harmful relationships (e.g. potatoes and tomatoes are both nightshades and should not be planted together).

Reply ONLY with valid JSON, no markdown fences, no extra text:
{
  "pairs": [
    {
      "crop_a": "string",
      "crop_b": "string",
      "relationship": "beneficial" | "harmful" | "neutral",
      "reason": "brief explanation of why"
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
  "tips": ["general companion planting tip 1", "tip 2", "tip 3"]
}`,
    settings,
    { maxTokens: 4096 }
  );
  const raw = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse companion JSON:', raw.slice(0, 200));
    throw new Error('AI returned invalid JSON. Try again.');
  }
}

// Build batches so every pair of crops appears in at least one batch.
// For each pair of non-overlapping groups, create cross-group batches
// that interleave crops from both groups.
function buildCompanionBatches(crops, batchSize) {
  if (crops.length <= batchSize) return [crops];

  // Split into non-overlapping base groups
  const groups = [];
  for (let i = 0; i < crops.length; i += batchSize) {
    groups.push(crops.slice(i, i + batchSize));
  }

  // Start with the base groups (covers all intra-group pairs)
  const batches = [...groups];

  // For every pair of groups, create cross-batches so each crop in group A
  // appears with each crop in group B in at least one batch.
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      // Interleave: take half from each group per batch
      const half = Math.floor(batchSize / 2);
      for (let i = 0; i < groups[a].length; i += half) {
        for (let j = 0; j < groups[b].length; j += half) {
          const chunk = [
            ...groups[a].slice(i, i + half),
            ...groups[b].slice(j, j + half),
          ];
          if (chunk.length >= 2) batches.push(chunk);
        }
      }
    }
  }

  return batches;
}

app.post('/api/companion', async (req, res) => {
  const { crops } = req.body;
  if (!crops?.length) return res.status(400).json({ error: 'Missing crops' });

  try {
    const settings = getLLMSettingsForTask('companion');
    const BATCH_SIZE = 10;

    if (crops.length <= BATCH_SIZE) {
      return res.json(await companionForCrops(crops, settings));
    }

    // Chunk into batches and run sequentially to avoid rate limits
    const batches = buildCompanionBatches(crops, BATCH_SIZE);
    const results = [];
    const errors = [];
    for (let i = 0; i < batches.length; i++) {
      try {
        const r = await companionForCrops(batches[i], settings);
        results.push(r);
      } catch (e) {
        console.error(`Companion batch ${i + 1}/${batches.length} failed:`, e.message);
        errors.push(e.message);
      }
    }

    if (!results.length) {
      throw new Error(errors[0] || 'All companion batches failed');
    }

    // Merge results, deduplicating pairs by sorted crop key
    const pairMap = new Map();
    const avoidMap = new Map();
    const bedSuggestions = [];
    const allTips = [];

    for (const r of results) {
      for (const pair of (r.pairs || [])) {
        const key = [pair.crop_a, pair.crop_b].sort().join('||');
        if (!pairMap.has(key)) pairMap.set(key, pair);
      }
      for (const avoid of (r.avoid_together || [])) {
        const key = [...avoid.crops].sort().join('||');
        if (!avoidMap.has(key)) avoidMap.set(key, avoid);
      }
      bedSuggestions.push(...(r.bed_suggestions || []));
      allTips.push(...(r.tips || []));
    }

    // Deduplicate bed suggestions by crop set and tips by value
    const seenBeds = new Set();
    const uniqueBeds = bedSuggestions.filter(b => {
      const key = [...b.crops].sort().join('||');
      if (seenBeds.has(key)) return false;
      seenBeds.add(key);
      return true;
    });

    res.json({
      pairs: [...pairMap.values()],
      bed_suggestions: uniqueBeds,
      avoid_together: [...avoidMap.values()],
      tips: [...new Set(allTips)],
    });
  } catch (e) {
    console.error('Companion analysis error:', e);
    res.status(500).json({ error: e.message });
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

app.post('/api/plants/info', async (req, res) => {
  const { crop } = req.body;
  if (!crop?.trim()) return res.status(400).json({ error: 'Missing crop name' });

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
    res.status(500).json({ error: e.message });
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
    const filePath = path.join(IMAGES_DIR, img.filename);
    fs.unlink(filePath, () => {}); // best-effort delete
  }
  db.prepare('DELETE FROM journal_images WHERE journal_entry_id = ?').run(req.params.id);
  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/journal/images/:id', (req, res) => {
  const img = db.prepare('SELECT filename FROM journal_images WHERE id = ?').get(req.params.id);
  if (!img) return res.status(404).json({ error: 'Not found' });
  fs.unlink(path.join(IMAGES_DIR, img.filename), () => {});
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
  const result = db.prepare('INSERT INTO gardens (name, zone, zipcode) VALUES (?, ?, ?)').run(name, zone, zipcode);
  res.json({ id: result.lastInsertRowid, name, zone, zipcode });
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
  const result = db.prepare('INSERT INTO beds (garden_id, name, width_ft, length_ft) VALUES (?, ?, ?, ?)').run(req.params.id, name, width_ft, length_ft);
  res.json({ id: result.lastInsertRowid, name, width_ft: width_ft || 4, length_ft: length_ft || 8 });
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

app.post('/api/gardens/:id/fence-guidance', async (req, res) => {
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
    res.status(500).json({ error: e.message });
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
    fs.unlink(path.join(IMAGES_DIR, garden.bg_image), () => {});
  }

  db.prepare('UPDATE gardens SET bg_image=? WHERE id=?').run(req.file.filename, req.params.id);
  res.json({ ok: true, filename: req.file.filename });
});

// Delete background image
app.delete('/api/gardens/:id/layout/bg', (req, res) => {
  const garden = db.prepare('SELECT * FROM gardens WHERE id = ?').get(req.params.id);
  if (!garden) return res.status(404).json({ error: 'Not found' });
  if (garden.bg_image) fs.unlink(path.join(IMAGES_DIR, garden.bg_image), () => {});
  db.prepare("UPDATE gardens SET bg_image=NULL WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// AI bed arrangement suggestion
app.post('/api/gardens/:id/layout/suggest', async (req, res) => {
  const garden = db.prepare('SELECT * FROM gardens WHERE id = ?').get(req.params.id);
  if (!garden) return res.status(404).json({ error: 'Not found' });

  const beds = db.prepare('SELECT b.*, GROUP_CONCAT(p.crop) as crops FROM beds b LEFT JOIN plantings p ON p.bed_id = b.id WHERE b.garden_id = ? GROUP BY b.id').all(req.params.id);

  if (!beds.length) return res.status(400).json({ error: 'No beds to arrange' });

  const gardenW = garden.layout_width_ft  || 20;
  const gardenL = garden.layout_length_ft || 20;

  const bedDescriptions = beds.map(b =>
    `- Bed "${b.name}" (${b.width_ft || 4}ft × ${b.length_ft || 8}ft): ${b.crops || 'no crops assigned'}`
  ).join('\n');

  const prompt = `You are a garden layout expert. Arrange these raised beds within a ${gardenW}ft × ${gardenL}ft garden space (width × length, assume north is the top edge).

Beds:
${bedDescriptions}

Rules:
- Place taller/sun-loving crops (corn, tomatoes, sunflowers) on the north side so they don't shade shorter crops
- Group companion plants near each other
- Leave at least 2ft between beds for walking paths
- Keep all beds fully inside the garden boundary
- Beds may not overlap

Return ONLY valid JSON, no markdown:
{"beds":[{"id":number,"x_ft":number,"y_ft":number}],"tips":["tip1","tip2","tip3"]}`;

  try {
    const settings = getLLMSettings();
    const text = await chat(prompt, settings, { maxTokens: 1024 });
    const data = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
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
