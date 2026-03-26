const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = process.env.DB_PATH || './data/garden.db';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

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
`);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function scheduleForCrops(location, crops) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `You are a gardening expert. For ${location}, give a planting schedule for: ${crops.join(', ')}.
Reply ONLY with valid JSON, no markdown, no extra text:
{"crops":[{"name":"string","sow_indoors":"string or null","transplant_or_direct_sow":"string","harvest":"string","tip":"string"}]}`
    }]
  });
  const raw = message.content[0].text.replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

app.post('/api/schedule', async (req, res) => {
  const { location, crops } = req.body;
  if (!location || !crops?.length) return res.status(400).json({ error: 'Missing location or crops' });

  try {
    const BATCH_SIZE = 15;
    if (crops.length <= BATCH_SIZE) {
      const result = await scheduleForCrops(location, crops);
      return res.json(result);
    }

    const batches = [];
    for (let i = 0; i < crops.length; i += BATCH_SIZE) {
      batches.push(crops.slice(i, i + BATCH_SIZE));
    }

    const results = await Promise.all(batches.map(batch => scheduleForCrops(location, batch)));
    const combined = { crops: results.flatMap(r => r.crops) };
    res.json(combined);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/companion', async (req, res) => {
  const { crops } = req.body;
  if (!crops?.length) return res.status(400).json({ error: 'Missing crops' });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `You are a gardening expert specializing in companion planting. Analyze these crops: ${crops.join(', ')}.

Reply ONLY with valid JSON, no markdown, no extra text:
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
}`
      }]
    });

    const raw = message.content[0].text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);
    res.json(parsed);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/gardens', (req, res) => {
  const gardens = db.prepare('SELECT * FROM gardens ORDER BY created_at DESC').all();
  res.json(gardens);
});

app.post('/api/gardens', (req, res) => {
  const { name, zone, zipcode } = req.body;
  const result = db.prepare('INSERT INTO gardens (name, zone, zipcode) VALUES (?, ?, ?)').run(name, zone, zipcode);
  res.json({ id: result.lastInsertRowid, name, zone, zipcode });
});

app.delete('/api/gardens/:id', (req, res) => {
  db.prepare('DELETE FROM plantings WHERE garden_id = ?').run(req.params.id);
  db.prepare('DELETE FROM beds WHERE garden_id = ?').run(req.params.id);
  db.prepare('DELETE FROM gardens WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/gardens/:id/plantings', (req, res) => {
  const plantings = db.prepare('SELECT * FROM plantings WHERE garden_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(plantings);
});

app.post('/api/gardens/:id/plantings', (req, res) => {
  const { crop, sow_indoors, transplant_or_direct_sow, harvest, tip, notes, bed_id } = req.body;
  const result = db.prepare(
    'INSERT INTO plantings (garden_id, bed_id, crop, sow_indoors, transplant_or_direct_sow, harvest, tip, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.params.id, bed_id || null, crop, sow_indoors, transplant_or_direct_sow, harvest, tip, notes || '');
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/plantings/:id', (req, res) => {
  db.prepare('DELETE FROM plantings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/gardens/:id/beds', (req, res) => {
  const beds = db.prepare('SELECT * FROM beds WHERE garden_id = ?').all(req.params.id);
  res.json(beds);
});

app.post('/api/gardens/:id/beds', (req, res) => {
  const { name, width_ft, length_ft } = req.body;
  const result = db.prepare('INSERT INTO beds (garden_id, name, width_ft, length_ft) VALUES (?, ?, ?, ?)').run(req.params.id, name, width_ft, length_ft);
  res.json({ id: result.lastInsertRowid, name, width_ft, length_ft });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'frontend/dist')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'frontend/dist/index.html')));
}

const PORT = process.env.PORT || 3700;
app.listen(PORT, () => console.log(`Garden planner running on port ${PORT}`));
