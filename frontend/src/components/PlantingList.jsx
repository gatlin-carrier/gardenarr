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

export default function PlantingList({ plantings, onUpdate, onDelete, onAdd }) {
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft]         = useState({})
  const [saving, setSaving]       = useState(false)
  const [activeCategory, setActiveCategory] = useState(null)
  const [statusFilter, setStatusFilter]     = useState(null) // 'in_progress' | 'completed' | 'skipped' | null
  const [showAddForm, setShowAddForm] = useState(false)
  const [addDraft, setAddDraft]   = useState({ crop: '', sow_indoors: '', transplant_or_direct_sow: '', harvest: '', tip: '', notes: '' })
  const [bulkGuide, setBulkGuide] = useState({ loading: false, done: 0, total: 0, errors: [] })

  // Build category counts from full list
  const categoryCounts = {}
  for (const p of plantings) {
    const id = getCategory(p.crop)
    categoryCounts[id] = (categoryCounts[id] || 0) + 1
  }
  const presentCategories = CATEGORIES.filter(c => categoryCounts[c.id])

  function getPlantingStatus(p) {
    if (p.status_skipped) return 'skipped'
    if (p.status_harvested) return 'completed'
    if (p.status_transplanted || p.status_planted) return 'in_progress'
    return 'not_started'
  }

  // Status filter counts
  const statusCounts = { in_progress: 0, completed: 0, skipped: 0 }
  for (const p of plantings) {
    const s = getPlantingStatus(p)
    if (s === 'in_progress') statusCounts.in_progress++
    else if (s === 'completed') statusCounts.completed++
    else if (s === 'skipped') statusCounts.skipped++
  }

  let visible = plantings
  if (activeCategory) visible = visible.filter(p => getCategory(p.crop) === activeCategory)
  if (statusFilter === 'in_progress') visible = visible.filter(p => { const s = getPlantingStatus(p); return s === 'in_progress' })
  else if (statusFilter === 'completed') visible = visible.filter(p => getPlantingStatus(p) === 'completed')
  else if (statusFilter === 'skipped') visible = visible.filter(p => getPlantingStatus(p) === 'skipped')
  else if (statusFilter === 'todo') visible = visible.filter(p => getPlantingStatus(p) === 'not_started')

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

  async function toggleStatus(p, field) {
    const updated = { status_planted: p.status_planted || 0, status_transplanted: p.status_transplanted || 0,
                      status_harvested: p.status_harvested || 0, status_skipped: p.status_skipped || 0 }
    // If toggling "skipped" on, turn off the others; if toggling a progress field on, turn off skipped
    if (field === 'status_skipped') {
      if (!updated.status_skipped) {
        updated.status_planted = 0; updated.status_transplanted = 0; updated.status_harvested = 0
      }
    } else if (updated.status_skipped) {
      updated.status_skipped = 0
    }
    updated[field] = updated[field] ? 0 : 1
    await onUpdate(p.id, updated)
  }

  async function submitAdd() {
    if (!addDraft.crop.trim()) return
    await onAdd(addDraft)
    setAddDraft({ crop: '', sow_indoors: '', transplant_or_direct_sow: '', harvest: '', tip: '', notes: '' })
    setShowAddForm(false)
  }

  async function commitEdit(id) {
    setSaving(true)
    await onUpdate(id, { ...draft, sow_indoors: draft.sow_indoors || null })
    setSaving(false)
    setEditingId(null)
    setDraft({})
  }

  async function fetchAllGuides() {
    const uniqueCrops = [...new Set(plantings.map(p => p.crop))]
    // Check which are already cached
    let uncached = uniqueCrops
    try {
      const res = await fetch('/api/plants/info/cached', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ crops: uniqueCrops }),
      })
      const { cached } = await res.json()
      const cachedSet = new Set(cached)
      uncached = uniqueCrops.filter(c => !cachedSet.has(c.trim().toLowerCase()))
    } catch {}

    if (!uncached.length) {
      setBulkGuide({ loading: false, done: uniqueCrops.length, total: uniqueCrops.length, errors: [] })
      return
    }

    setBulkGuide({ loading: true, done: 0, total: uncached.length, errors: [] })
    const errors = []
    for (let i = 0; i < uncached.length; i++) {
      try {
        await fetch('/api/plants/info', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ crop: uncached[i] }),
        })
      } catch {
        errors.push(uncached[i])
      }
      setBulkGuide(prev => ({ ...prev, done: i + 1, errors: [...errors] }))
    }
    setBulkGuide(prev => ({ ...prev, loading: false }))
  }

  const addFormJsx = showAddForm && (
    <div className="planting-card editing add-form-card">
      <div className="edit-field">
        <label>Crop name</label>
        <input value={addDraft.crop} onChange={e => setAddDraft(d => ({ ...d, crop: e.target.value }))} placeholder="e.g. Tomatoes" autoFocus />
      </div>
      <div className="edit-row">
        <div className="edit-field">
          <label>Sow indoors</label>
          <input placeholder="e.g. Feb-Mar" value={addDraft.sow_indoors} onChange={e => setAddDraft(d => ({ ...d, sow_indoors: e.target.value }))} />
        </div>
        <div className="edit-field">
          <label>Transplant / Direct sow</label>
          <input placeholder="e.g. May" value={addDraft.transplant_or_direct_sow} onChange={e => setAddDraft(d => ({ ...d, transplant_or_direct_sow: e.target.value }))} />
        </div>
        <div className="edit-field">
          <label>Harvest</label>
          <input placeholder="e.g. Jul-Sep" value={addDraft.harvest} onChange={e => setAddDraft(d => ({ ...d, harvest: e.target.value }))} />
        </div>
      </div>
      <div className="edit-field">
        <label>Tip</label>
        <input value={addDraft.tip} onChange={e => setAddDraft(d => ({ ...d, tip: e.target.value }))} />
      </div>
      <div className="edit-field">
        <label>Notes</label>
        <textarea rows={2} value={addDraft.notes} onChange={e => setAddDraft(d => ({ ...d, notes: e.target.value }))} />
      </div>
      <div className="edit-actions">
        <button className="btn-primary" onClick={submitAdd} disabled={!addDraft.crop.trim()}>Add plant</button>
        <button className="btn-ghost" onClick={() => setShowAddForm(false)}>Cancel</button>
      </div>
    </div>
  )

  if (!plantings.length) return (
    <div className="no-plantings">
      <div className="no-plantings-icon">🌱</div>
      <p>No saved plantings yet.</p>
      <p className="no-plantings-sub">Generate a schedule and save crops to see them here, or add one manually.</p>
      <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => setShowAddForm(true)}>+ Add plant</button>
      {addFormJsx}
    </div>
  )

  return (
    <div className="planting-list">

      {/* Toolbar */}
      <div className="pl-add-bar">
        {!bulkGuide.loading ? (
          <button className="btn-ghost btn-sm" onClick={fetchAllGuides} title="Pre-fetch and cache all growing guides">
            {bulkGuide.done > 0 && !bulkGuide.loading ? 'All guides cached' : 'Fetch all growing guides'}
          </button>
        ) : (
          <div className="pl-bulk-progress">
            <div className="pl-bulk-bar">
              <div className="pl-bulk-fill" style={{ width: `${(bulkGuide.done / bulkGuide.total) * 100}%` }} />
            </div>
            <span className="pl-bulk-label">Fetching guides... {bulkGuide.done}/{bulkGuide.total}</span>
          </div>
        )}
        <button className="btn-primary btn-sm" onClick={() => setShowAddForm(s => !s)}>
          {showAddForm ? 'Cancel' : '+ Add plant'}
        </button>
      </div>
      {bulkGuide.errors.length > 0 && (
        <div className="pl-bulk-errors">Failed to fetch: {bulkGuide.errors.join(', ')}</div>
      )}
      {addFormJsx}

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

      {/* Status filter bar */}
      <div className="pl-filter-bar pl-status-filter">
        <button
          className={`pl-filter-pill ${statusFilter === null ? 'active' : ''}`}
          onClick={() => setStatusFilter(null)}
        >
          All
        </button>
        <button
          className={`pl-filter-pill pl-pill-todo ${statusFilter === 'todo' ? 'active' : ''}`}
          onClick={() => setStatusFilter(prev => prev === 'todo' ? null : 'todo')}
        >
          To do
        </button>
        <button
          className={`pl-filter-pill pl-pill-progress ${statusFilter === 'in_progress' ? 'active' : ''}`}
          onClick={() => setStatusFilter(prev => prev === 'in_progress' ? null : 'in_progress')}
        >
          In progress
          {statusCounts.in_progress > 0 && <span className="pill-count">{statusCounts.in_progress}</span>}
        </button>
        <button
          className={`pl-filter-pill pl-pill-done ${statusFilter === 'completed' ? 'active' : ''}`}
          onClick={() => setStatusFilter(prev => prev === 'completed' ? null : 'completed')}
        >
          Harvested
          {statusCounts.completed > 0 && <span className="pill-count">{statusCounts.completed}</span>}
        </button>
        <button
          className={`pl-filter-pill pl-pill-skipped ${statusFilter === 'skipped' ? 'active' : ''}`}
          onClick={() => setStatusFilter(prev => prev === 'skipped' ? null : 'skipped')}
        >
          Skipped
          {statusCounts.skipped > 0 && <span className="pill-count">{statusCounts.skipped}</span>}
        </button>
      </div>

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

              {/* Timeline with inline checkmarks */}
              <div className={`pc-timeline${p.status_skipped ? ' pc-timeline-skipped' : ''}`}>
                <div className="pc-tl-steps">
                  {p.sow_indoors && (
                    <div className={`pc-tl-step${p.status_planted ? ' step-done' : ''}`}>
                      <button
                        className={`pc-tl-check${p.status_planted ? ' checked' : ''}`}
                        onClick={() => toggleStatus(p, 'status_planted')}
                        title={p.status_planted ? 'Mark as not done' : 'Mark as done'}
                      >
                        {p.status_planted ? '✓' : ''}
                      </button>
                      <span className="pc-tl-icon">🌱</span>
                      <div className="pc-tl-body">
                        <span className="pc-tl-label">Sow indoors</span>
                        <span className="pc-tl-date">{p.sow_indoors}</span>
                      </div>
                    </div>
                  )}
                  {p.sow_indoors && <span className="pc-tl-arrow">→</span>}
                  <div className={`pc-tl-step${p.status_transplanted ? ' step-done' : ''}`}>
                    <button
                      className={`pc-tl-check${p.status_transplanted ? ' checked' : ''}`}
                      onClick={() => toggleStatus(p, 'status_transplanted')}
                      title={p.status_transplanted ? 'Mark as not done' : 'Mark as done'}
                    >
                      {p.status_transplanted ? '✓' : ''}
                    </button>
                    <span className="pc-tl-icon">{p.sow_indoors ? '🌿' : '🌱'}</span>
                    <div className="pc-tl-body">
                      <span className="pc-tl-label">{p.sow_indoors ? 'Transplant' : 'Direct sow'}</span>
                      <span className="pc-tl-date">{p.transplant_or_direct_sow}</span>
                    </div>
                  </div>
                  <span className="pc-tl-arrow">→</span>
                  <div className={`pc-tl-step${p.status_harvested ? ' step-done' : ''}`}>
                    <button
                      className={`pc-tl-check${p.status_harvested ? ' checked' : ''}`}
                      onClick={() => toggleStatus(p, 'status_harvested')}
                      title={p.status_harvested ? 'Mark as not done' : 'Mark as done'}
                    >
                      {p.status_harvested ? '✓' : ''}
                    </button>
                    <span className="pc-tl-icon">🌾</span>
                    <div className="pc-tl-body">
                      <span className="pc-tl-label">Harvest</span>
                      <span className="pc-tl-date">{p.harvest}</span>
                    </div>
                  </div>
                </div>
                <button
                  className={`pc-skip-btn${p.status_skipped ? ' active' : ''}`}
                  onClick={() => toggleStatus(p, 'status_skipped')}
                  title={p.status_skipped ? 'Undo skip' : 'Did not plant'}
                >
                  {p.status_skipped ? '✕ Skipped' : '✕ Did Not Plant'}
                </button>
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
            {statusFilter
              ? `No ${statusFilter === 'todo' ? 'to-do' : statusFilter === 'in_progress' ? 'in-progress' : statusFilter} plantings${activeCategory ? ` in ${CAT_BY_ID[activeCategory]?.label.toLowerCase()}` : ''}.`
              : `No ${activeCategory ? CAT_BY_ID[activeCategory]?.label.toLowerCase() : 'plantings'} saved yet.`}
          </div>
        )}
      </div>
    </div>
  )
}
