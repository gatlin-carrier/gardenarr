import { useState } from 'react'
import PlantJournal from './PlantJournal.jsx'
import './PlantingList.css'

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
      <button className="plant-info-toggle btn-ghost btn-sm" onClick={toggle}>
        {open ? '▲ Less info' : '▼ More info'}
      </button>

      {open && (
        <div className="plant-info-panel">
          {loading && <div className="plant-info-loading">Loading plant info…</div>}
          {error && <div className="plant-info-error">{error}</div>}
          {info && (
            <>
              {info.description && <p className="pi-description">{info.description}</p>}

              <div className="pi-grid">
                <InfoChip label="Difficulty"      value={info.difficulty} />
                <InfoChip label="Sun"             value={info.sun} />
                <InfoChip label="Germination"     value={info.days_to_germination} />
                <InfoChip label="Days to maturity" value={info.days_to_maturity} />
                <InfoChip label="Spacing"         value={info.spacing_inches ? `${info.spacing_inches}"` : null} />
                <InfoChip label="Water"           value={info.water} />
                <InfoChip label="Soil"            value={info.soil} />
              </div>

              {info.common_pests?.length > 0 && (
                <InfoList label="Common pests" items={info.common_pests} />
              )}
              {info.common_diseases?.length > 0 && (
                <InfoList label="Common diseases" items={info.common_diseases} />
              )}
              {info.companion_benefits?.length > 0 && (
                <InfoList label="Companion planting" items={info.companion_benefits} />
              )}

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

export default function PlantingList({ plantings, onUpdate, onDelete }) {
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)

  function startEdit(p) {
    setEditingId(p.id)
    setDraft({
      crop: p.crop,
      sow_indoors: p.sow_indoors || '',
      transplant_or_direct_sow: p.transplant_or_direct_sow || '',
      harvest: p.harvest || '',
      tip: p.tip || '',
      notes: p.notes || ''
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft({})
  }

  async function commitEdit(id) {
    setSaving(true)
    await onUpdate(id, { ...draft, sow_indoors: draft.sow_indoors || null })
    setSaving(false)
    setEditingId(null)
    setDraft({})
  }

  if (!plantings.length) return (
    <div className="no-plantings">
      <p>No saved plantings yet.</p>
      <p style={{ fontSize: 13 }}>Generate a schedule and save crops to see them here.</p>
    </div>
  )

  return (
    <div className="planting-list">
      {plantings.map(p => {
        if (editingId === p.id) {
          return (
            <div key={p.id} className="planting-card editing">
              <div className="edit-field">
                <label>Crop name</label>
                <input value={draft.crop} onChange={e => setDraft(d => ({ ...d, crop: e.target.value }))} />
              </div>
              <div className="edit-row">
                <div className="edit-field">
                  <label>Sow indoors</label>
                  <input placeholder="e.g. Feb–Mar" value={draft.sow_indoors} onChange={e => setDraft(d => ({ ...d, sow_indoors: e.target.value }))} />
                </div>
                <div className="edit-field">
                  <label>Transplant / Direct sow</label>
                  <input placeholder="e.g. May" value={draft.transplant_or_direct_sow} onChange={e => setDraft(d => ({ ...d, transplant_or_direct_sow: e.target.value }))} />
                </div>
                <div className="edit-field">
                  <label>Harvest</label>
                  <input placeholder="e.g. Jul–Sep" value={draft.harvest} onChange={e => setDraft(d => ({ ...d, harvest: e.target.value }))} />
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
          <div key={p.id} className="planting-card">
            <div className="planting-header">
              <div className="planting-crop">{p.crop}</div>
              <div className="planting-actions">
                <button className="btn-ghost btn-sm" onClick={() => startEdit(p)}>Edit</button>
                <button className="btn-danger btn-sm" onClick={() => onDelete(p.id)}>Remove</button>
              </div>
            </div>
            <div className="planting-timeline">
              {p.sow_indoors && (
                <div className="pt-row">
                  <span className="pt-label">Sow indoors</span>
                  <span className="tag tag-sow">{p.sow_indoors}</span>
                </div>
              )}
              <div className="pt-row">
                <span className="pt-label">{p.sow_indoors ? 'Transplant' : 'Direct sow'}</span>
                <span className="tag tag-transplant">{p.transplant_or_direct_sow}</span>
              </div>
              <div className="pt-row">
                <span className="pt-label">Harvest</span>
                <span className="tag tag-harvest">{p.harvest}</span>
              </div>
            </div>
            {p.tip && <div className="planting-tip">{p.tip}</div>}
            {p.notes && <div className="planting-notes">{p.notes}</div>}
            <PlantInfo crop={p.crop} />
            <PlantJournal plantingId={p.id} />
          </div>
        )
      })}
    </div>
  )
}
