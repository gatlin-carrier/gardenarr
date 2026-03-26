import { useState } from 'react'
import './GardenList.css'

const ZONES = ['Zone 3a','Zone 3b','Zone 4a','Zone 4b','Zone 5a','Zone 5b','Zone 6a','Zone 6b','Zone 7a','Zone 7b','Zone 8a','Zone 8b','Zone 9a','Zone 9b','Zone 10a','Zone 10b']

export default function GardenList({ gardens, activeGarden, onSelect, onCreate, onDelete }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [zone, setZone] = useState('')
  const [zip, setZip] = useState('')

  async function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) return
    await onCreate(name.trim(), zone, zip)
    setName(''); setZone(''); setZip(''); setCreating(false)
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
            className={`garden-item ${activeGarden?.id === g.id ? 'active' : ''}`}
            onClick={() => onSelect(g)}
          >
            <div className="garden-item-name">{g.name}</div>
            <div className="garden-item-meta">{g.zone || g.zipcode || 'No zone set'}</div>
            <button
              className="delete-garden-btn"
              onClick={e => { e.stopPropagation(); onDelete(g.id) }}
              title="Delete garden"
            >×</button>
          </div>
        ))}
      </div>
    </div>
  )
}
