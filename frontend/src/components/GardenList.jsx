import { useState, useRef } from 'react'
import './GardenList.css'

const ZONES = ['Zone 3a','Zone 3b','Zone 4a','Zone 4b','Zone 5a','Zone 5b','Zone 6a','Zone 6b','Zone 7a','Zone 7b','Zone 8a','Zone 8b','Zone 9a','Zone 9b','Zone 10a','Zone 10b']

export default function GardenList({ gardens, activeGarden, onSelect, onCreate, onDelete, onSetDefault, onReorder }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [zone, setZone] = useState('')
  const [zip, setZip] = useState('')
  const [dragOverId, setDragOverId] = useState(null)
  const [dragOverPos, setDragOverPos] = useState(null) // 'before' | 'after'
  const dragId = useRef(null)

  async function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) return
    await onCreate(name.trim(), zone, zip)
    setName(''); setZone(''); setZip(''); setCreating(false)
  }

  // ── drag-to-reorder ────────────────────────────────────────────────────────

  function onDragStart(e, id) {
    dragId.current = id
    e.dataTransfer.effectAllowed = 'move'
    // Slight delay so the drag image renders before the element gets dimmed
    requestAnimationFrame(() => e.target.classList.add('dragging'))
  }

  function onDragOver(e, id) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id === dragId.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDragOverId(id)
    setDragOverPos(pos)
  }

  function onDragLeave(e) {
    // Only clear if leaving the item entirely (not just moving to a child)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverId(null)
      setDragOverPos(null)
    }
  }

  function onDrop(e, targetId) {
    e.preventDefault()
    const srcId = dragId.current
    if (!srcId || srcId === targetId) { clearDrag(); return }
    const ordered = [...gardens]
    const si = ordered.findIndex(g => g.id === srcId)
    const ti = ordered.findIndex(g => g.id === targetId)
    const [moved] = ordered.splice(si, 1)
    // Insert before or after depending on drop position
    const insertAt = dragOverPos === 'before' ? ti : ti + (si < ti ? 0 : 1)
    ordered.splice(Math.min(insertAt, ordered.length), 0, moved)
    onReorder(ordered.map(g => g.id))
    clearDrag()
  }

  function onDragEnd(e) {
    e.target.classList.remove('dragging')
    clearDrag()
  }

  function clearDrag() {
    dragId.current = null
    setDragOverId(null)
    setDragOverPos(null)
  }

  return (
    <div className="garden-list">
      <div className="garden-list-header">
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: 300 }}>My gardens</span>
        <button className="add-btn" onClick={() => setCreating(!creating)}>
          {creating ? '✕' : '+ New'}
        </button>
      </div>

      {creating && (
        <form className="new-garden-form" onSubmit={handleCreate}>
          <input
            placeholder="Garden name"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          <select value={zone} onChange={e => setZone(e.target.value)}>
            <option value="">Select zone...</option>
            {ZONES.map(z => <option key={z}>{z}</option>)}
          </select>
          <input placeholder="Or enter zip code" value={zip} onChange={e => setZip(e.target.value)} />
          <button type="submit" className="create-btn">Create garden</button>
        </form>
      )}

      <div className="garden-items">
        {gardens.length === 0 && !creating && (
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' }}>No gardens yet</p>
        )}
        {gardens.map(g => (
          <div
            key={g.id}
            className={[
              'garden-item',
              activeGarden?.id === g.id ? 'active' : '',
              dragOverId === g.id ? `drop-${dragOverPos}` : '',
            ].filter(Boolean).join(' ')}
            draggable
            onDragStart={e => onDragStart(e, g.id)}
            onDragOver={e => onDragOver(e, g.id)}
            onDragLeave={onDragLeave}
            onDrop={e => onDrop(e, g.id)}
            onDragEnd={onDragEnd}
            onClick={() => onSelect(g)}
          >
            <span className="drag-handle" title="Drag to reorder">⠿</span>
            <div className="garden-item-body">
              <div className="garden-item-name">
                {g.name}
                {g.is_default ? <span className="default-badge">default</span> : null}
              </div>
              <div className="garden-item-meta">{g.zone || g.zipcode || 'No zone set'}</div>
            </div>
            <div className="garden-item-actions">
              <button
                className={`star-btn ${g.is_default ? 'starred' : ''}`}
                onClick={e => { e.stopPropagation(); onSetDefault(g.id) }}
                title={g.is_default ? 'Default garden' : 'Set as default'}
              >
                {g.is_default ? '★' : '☆'}
              </button>
              <button
                className="delete-garden-btn"
                onClick={e => { e.stopPropagation(); onDelete(g.id) }}
                title="Delete garden"
              >×</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
