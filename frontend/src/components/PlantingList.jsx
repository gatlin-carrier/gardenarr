import { useState } from 'react'
import PlantJournal from './PlantJournal.jsx'
import './PlantingList.css'

// ─── Category classification ─────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'vegetables', label: 'Vegetables', emoji: '🥦', color: '#16a34a', light: '#f0fdf4' },
  { id: 'fruits',     label: 'Fruits',     emoji: '🍓', color: '#dc2626', light: '#fef2f2' },
  { id: 'herbs',      label: 'Herbs',      emoji: '🌿', color: '#059669', light: '#ecfdf5' },
  { id: 'roots',      label: 'Roots',      emoji: '🥕', color: '#d97706', light: '#fffbeb' },
  { id: 'flowers',    label: 'Flowers',    emoji: '🌸', color: '#db2777', light: '#fdf2f8' },
  { id: 'other',      label: 'Other',      emoji: '🌱', color: '#6b7280', light: '#f9fafb' },
]

const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]))

const KEYWORDS = {
  fruits:     ['tomato', 'pepper', 'capsicum', 'tomatillo', 'strawberry', 'raspberry', 'blueberry', 'blackberry', 'gooseberry', 'currant', 'grape', 'melon', 'watermelon', 'cantaloupe', 'honeydew', 'passionfruit', 'kiwi', 'fig', 'mulberry'],
  herbs:      ['basil', 'parsley', 'cilantro', 'coriander', 'dill', 'mint', 'thyme', 'rosemary', 'sage', 'oregano', 'marjoram', 'tarragon', 'chervil', 'borage', 'stevia', 'lemon balm', 'lemongrass', 'bay', 'sorrel', 'lovage', 'fennel', 'anise', 'caraway', 'chive'],
  roots:      ['carrot', 'beet', 'beetroot', 'radish', 'turnip', 'parsnip', 'potato', 'sweet potato', 'rutabaga', 'swede', 'kohlrabi', 'daikon', 'yam', 'horseradish', 'celeriac', 'salsify', 'ginger', 'turmeric'],
  flowers:    ['sunflower', 'marigold', 'nasturtium', 'zinnia', 'dahlia', 'cosmos', 'calendula', 'pansy', 'petunia', 'rose', 'lavender', 'chamomile', 'chrysanthemum', 'echinacea', 'delphinium', 'snapdragon', 'poppy', 'cornflower', 'foxglove'],
  vegetables: ['lettuce', 'spinach', 'kale', 'chard', 'arugula', 'rocket', 'cabbage', 'broccoli', 'cauliflower', 'brussels', 'bok choy', 'pak choi', 'collard', 'mustard', 'endive', 'radicchio', 'celery', 'asparagus', 'artichoke', 'onion', 'garlic', 'shallot', 'leek', 'scallion', 'ramp', 'watercress', 'cucumber', 'zucchini', 'courgette', 'squash', 'pumpkin', 'eggplant', 'aubergine', 'okra', 'corn', 'maize', 'bean', 'pea'],
}

function getCategory(crop) {
  const lower = crop.toLowerCase()
  for (const [id, keywords] of Object.entries(KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return id
  }
  return 'other'
}

// ─── PlantInfo expandable panel ──────────────────────────────────────────────

function PlantInfo({ crop }) {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  async function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (info) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/plants/info', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ crop }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setInfo(data)
    } catch {
      setError('Failed to load plant info.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="plant-info-section">
      <button className="pl-expand-btn" onClick={toggle}>
        {open ? '▲ Less info' : '▼ Growing guide'}
      </button>

      {open && (
        <div className="plant-info-panel">
          {loading && <div className="plant-info-loading">Loading…</div>}
          {error && <div className="plant-info-error">{error}</div>}
          {info && (
            <>
              {info.description && <p className="pi-description">{info.description}</p>}
              <div className="pi-grid">
                <InfoChip label="Difficulty"       value={info.difficulty} />
                <InfoChip label="Sun"              value={info.sun} />
                <InfoChip label="Germination"      value={info.days_to_germination} />
                <InfoChip label="Days to maturity" value={info.days_to_maturity} />
                <InfoChip label="Spacing"          value={info.spacing_inches ? `${info.spacing_inches}"` : null} />
                <InfoChip label="Water"            value={info.water} />
                <InfoChip label="Soil"             value={info.soil} />
              </div>
              {info.common_pests?.length > 0      && <InfoList label="Pests"            items={info.common_pests} />}
              {info.common_diseases?.length > 0   && <InfoList label="Diseases"         items={info.common_diseases} />}
              {info.companion_benefits?.length > 0 && <InfoList label="Companion plants" items={info.companion_benefits} />}
              {info.harvest_tips && (
                <div className="pi-block">
                  <div className="pi-block-label">Harvest tips</div>
                  <p>{info.harvest_tips}</p>
                </div>
              )}
              {info.storage && (
                <div className="pi-block">
                  <div className="pi-block-label">Storage</div>
                  <p>{info.storage}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function InfoChip({ label, value }) {
  if (!value) return null
  return (
    <div className="pi-chip">
      <span className="pi-chip-label">{label}</span>
      <span className="pi-chip-value">{value}</span>
    </div>
  )
}

function InfoList({ label, items }) {
  return (
    <div className="pi-block">
      <div className="pi-block-label">{label}</div>
      <ul className="pi-list">
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  )
}

// ─── PlantingList ─────────────────────────────────────────────────────────────

export default function PlantingList({ plantings, onUpdate, onDelete }) {
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft]         = useState({})
  const [saving, setSaving]       = useState(false)
  const [activeCategory, setActiveCategory] = useState(null)

  // Build category counts from full list
  const categoryCounts = {}
  for (const p of plantings) {
    const id = getCategory(p.crop)
    categoryCounts[id] = (categoryCounts[id] || 0) + 1
  }
  const presentCategories = CATEGORIES.filter(c => categoryCounts[c.id])

  const visible = activeCategory
    ? plantings.filter(p => getCategory(p.crop) === activeCategory)
    : plantings

  function startEdit(p) {
    setEditingId(p.id)
    setDraft({
      crop: p.crop,
      sow_indoors: p.sow_indoors || '',
      transplant_or_direct_sow: p.transplant_or_direct_sow || '',
      harvest: p.harvest || '',
      tip: p.tip || '',
      notes: p.notes || '',
    })
  }

  function cancelEdit() { setEditingId(null); setDraft({}) }

  async function commitEdit(id) {
    setSaving(true)
    await onUpdate(id, { ...draft, sow_indoors: draft.sow_indoors || null })
    setSaving(false)
    setEditingId(null)
    setDraft({})
  }

  if (!plantings.length) return (
    <div className="no-plantings">
      <div className="no-plantings-icon">🌱</div>
      <p>No saved plantings yet.</p>
      <p className="no-plantings-sub">Generate a schedule and save crops to see them here.</p>
    </div>
  )

  return (
    <div className="planting-list">

      {/* Category filter bar */}
      {presentCategories.length > 1 && (
        <div className="pl-filter-bar">
          <button
            className={`pl-filter-pill ${activeCategory === null ? 'active' : ''}`}
            onClick={() => setActiveCategory(null)}
          >
            All <span className="pill-count">{plantings.length}</span>
          </button>
          {presentCategories.map(cat => (
            <button
              key={cat.id}
              className={`pl-filter-pill ${activeCategory === cat.id ? 'active' : ''}`}
              style={{ '--pill-color': cat.color }}
              onClick={() => setActiveCategory(prev => prev === cat.id ? null : cat.id)}
            >
              {cat.emoji} {cat.label}
              <span className="pill-count">{categoryCounts[cat.id]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Cards */}
      <div className="planting-cards">
        {visible.map(p => {
          const catId = getCategory(p.crop)
          const cat   = CAT_BY_ID[catId]

          if (editingId === p.id) {
            return (
              <div key={p.id} className="planting-card editing" style={{ '--cat-color': cat.color }}>
                <div className="edit-field">
                  <label>Crop name</label>
                  <input value={draft.crop} onChange={e => setDraft(d => ({ ...d, crop: e.target.value }))} />
                </div>
                <div className="edit-row">
                  <div className="edit-field">
                    <label>Sow indoors</label>
                    <input placeholder="e.g. Feb–Mar" value={draft.sow_indoors}
                      onChange={e => setDraft(d => ({ ...d, sow_indoors: e.target.value }))} />
                  </div>
                  <div className="edit-field">
                    <label>Transplant / Direct sow</label>
                    <input placeholder="e.g. May" value={draft.transplant_or_direct_sow}
                      onChange={e => setDraft(d => ({ ...d, transplant_or_direct_sow: e.target.value }))} />
                  </div>
                  <div className="edit-field">
                    <label>Harvest</label>
                    <input placeholder="e.g. Jul–Sep" value={draft.harvest}
                      onChange={e => setDraft(d => ({ ...d, harvest: e.target.value }))} />
                  </div>
                </div>
                <div className="edit-field">
                  <label>Tip</label>
                  <input value={draft.tip} onChange={e => setDraft(d => ({ ...d, tip: e.target.value }))} />
                </div>
                <div className="edit-field">
                  <label>Notes</label>
                  <textarea rows={2} value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
                </div>
                <div className="edit-actions">
                  <button className="btn-primary" onClick={() => commitEdit(p.id)} disabled={saving || !draft.crop.trim()}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button className="btn-ghost" onClick={cancelEdit} disabled={saving}>Cancel</button>
                </div>
              </div>
            )
          }

          return (
            <div key={p.id} className="planting-card" style={{ '--cat-color': cat.color, '--cat-light': cat.light }}>
              {/* Header */}
              <div className="pc-header">
                <div className="pc-identity">
                  <span className="pc-emoji">{cat.emoji}</span>
                  <div className="pc-name-wrap">
                    <span className="pc-name">{p.crop}</span>
                    <span className="pc-cat-tag" style={{ color: cat.color, background: cat.light }}>{cat.label}</span>
                  </div>
                </div>
                <div className="pc-actions">
                  <button className="btn-ghost btn-sm" onClick={() => startEdit(p)}>Edit</button>
                  <button className="pc-remove-btn" onClick={() => onDelete(p.id)} title="Remove">✕</button>
                </div>
              </div>

              {/* Timeline */}
              <div className="pc-timeline">
                {p.sow_indoors && (
                  <div className="pc-tl-step">
                    <span className="pc-tl-icon">🌱</span>
                    <div className="pc-tl-body">
                      <span className="pc-tl-label">Sow indoors</span>
                      <span className="pc-tl-date">{p.sow_indoors}</span>
                    </div>
                  </div>
                )}
                {p.sow_indoors && <span className="pc-tl-arrow">→</span>}
                <div className="pc-tl-step">
                  <span className="pc-tl-icon">{p.sow_indoors ? '🌿' : '🌱'}</span>
                  <div className="pc-tl-body">
                    <span className="pc-tl-label">{p.sow_indoors ? 'Transplant' : 'Direct sow'}</span>
                    <span className="pc-tl-date">{p.transplant_or_direct_sow}</span>
                  </div>
                </div>
                <span className="pc-tl-arrow">→</span>
                <div className="pc-tl-step">
                  <span className="pc-tl-icon">🌾</span>
                  <div className="pc-tl-body">
                    <span className="pc-tl-label">Harvest</span>
                    <span className="pc-tl-date">{p.harvest}</span>
                  </div>
                </div>
              </div>

              {/* Tip */}
              {p.tip && <div className="pc-tip">💡 {p.tip}</div>}
              {p.notes && <div className="pc-notes">{p.notes}</div>}

              {/* Expandable sections */}
              <div className="pc-expanders">
                <PlantInfo crop={p.crop} />
                <PlantJournal plantingId={p.id} />
              </div>
            </div>
          )
        })}

        {visible.length === 0 && (
          <div className="pl-empty-filter">
            No {CAT_BY_ID[activeCategory]?.label.toLowerCase()} saved yet.
          </div>
        )}
      </div>
    </div>
  )
}
