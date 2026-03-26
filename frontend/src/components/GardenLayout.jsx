import { useState, useEffect, useRef } from 'react'
import './GardenLayout.css'

// Deterministic color from crop name
const PALETTE = [
  '#5a9e3a','#e8941a','#2a9e80','#c05050',
  '#7050a0','#c07030','#3878b8','#8aaa28',
  '#d06080','#40987a','#b08818','#5080c8',
]
function cropColor(crop) {
  let h = 0
  for (const c of crop) h = Math.imul(31, h) + c.charCodeAt(0) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

// -------------------------------------------------------------------
// BedGrid — renders one bed as a click/drag-paintable grid
// -------------------------------------------------------------------
function BedGrid({ bed, layout, selectedCrop, onCellChange }) {
  const painting = useRef(false)
  const cols = Math.max(1, Math.round(bed.width_ft))
  const rows = Math.max(1, Math.round(bed.length_ft))

  useEffect(() => {
    const stop = () => { painting.current = false }
    window.addEventListener('mouseup', stop)
    window.addEventListener('touchend', stop)
    return () => {
      window.removeEventListener('mouseup', stop)
      window.removeEventListener('touchend', stop)
    }
  }, [])

  function applyCell(row, col) {
    const key = `${row},${col}`
    const existing = layout[key]
    if (selectedCrop) {
      onCellChange(row, col, existing === selectedCrop ? null : selectedCrop)
    } else {
      if (existing) onCellChange(row, col, null)
    }
  }

  return (
    <div
      className={`bed-grid ${selectedCrop ? 'mode-paint' : 'mode-erase'}`}
      style={{ gridTemplateColumns: `repeat(${cols}, var(--cell-size))` }}
      onMouseLeave={() => { painting.current = false }}
    >
      {Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, col) => {
          const crop = layout[`${row},${col}`]
          const color = crop ? cropColor(crop) : undefined
          return (
            <div
              key={`${row}-${col}`}
              className={`bed-cell ${crop ? 'occupied' : 'empty'}`}
              style={color ? { background: color, borderColor: color } : {}}
              title={crop || (selectedCrop ? `Place ${selectedCrop}` : 'Click to erase')}
              onMouseDown={() => { painting.current = true; applyCell(row, col) }}
              onMouseEnter={() => { if (painting.current) applyCell(row, col) }}
              onTouchStart={e => { e.preventDefault(); painting.current = true; applyCell(row, col) }}
            >
              {crop && (
                <span className="cell-label">
                  {crop.length > 5 ? crop.slice(0, 4) + '·' : crop}
                </span>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

// -------------------------------------------------------------------
// GardenLayout — bed management + grid + crop palette
// -------------------------------------------------------------------
export default function GardenLayout({ garden, plantings }) {
  const [beds, setBeds] = useState([])
  const [activeBedId, setActiveBedId] = useState(null)
  const [layouts, setLayouts] = useState({})
  const [selectedCrop, setSelectedCrop] = useState(null)
  const [customCrop, setCustomCrop] = useState('')
  const loadedBeds = useRef(new Set())

  // New bed form
  const [showNewBed, setShowNewBed] = useState(false)
  const [bedName, setBedName] = useState('')
  const [bedWidth, setBedWidth] = useState(4)
  const [bedLength, setBedLength] = useState(8)
  const [creating, setCreating] = useState(false)

  const activeBed = beds.find(b => b.id === activeBedId) || null
  const activeLayout = layouts[activeBedId] || {}
  const savedCrops = [...new Set(plantings.map(p => p.crop))]
  const placedCrops = [...new Set(Object.values(activeLayout))]

  useEffect(() => { loadBeds() }, [garden.id])

  async function loadBeds() {
    const data = await fetch(`/api/gardens/${garden.id}/beds`).then(r => r.json())
    setBeds(data)
    if (data.length) {
      setActiveBedId(data[0].id)
      await loadLayout(data[0].id)
    }
  }

  async function loadLayout(bedId) {
    if (loadedBeds.current.has(bedId)) return
    loadedBeds.current.add(bedId)
    const cells = await fetch(`/api/beds/${bedId}/layout`).then(r => r.json())
    const map = {}
    for (const c of cells) map[`${c.row},${c.col}`] = c.crop
    setLayouts(prev => ({ ...prev, [bedId]: map }))
  }

  useEffect(() => {
    if (activeBedId) loadLayout(activeBedId)
  }, [activeBedId])

  function handleCellChange(row, col, crop) {
    setLayouts(prev => {
      const bed = { ...(prev[activeBedId] || {}) }
      if (crop) bed[`${row},${col}`] = crop
      else delete bed[`${row},${col}`]
      return { ...prev, [activeBedId]: bed }
    })
    if (crop) {
      fetch(`/api/beds/${activeBedId}/layout/${row}/${col}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ crop }),
      }).catch(console.error)
    } else {
      fetch(`/api/beds/${activeBedId}/layout/${row}/${col}`, { method: 'DELETE' }).catch(console.error)
    }
  }

  async function createBed() {
    if (!bedName.trim()) return
    setCreating(true)
    const bed = await fetch(`/api/gardens/${garden.id}/beds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: bedName.trim(), width_ft: bedWidth, length_ft: bedLength }),
    }).then(r => r.json())
    const fullBed = { ...bed, garden_id: garden.id, width_ft: bedWidth, length_ft: bedLength, name: bedName.trim() }
    setBeds(prev => [...prev, fullBed])
    setLayouts(prev => ({ ...prev, [bed.id]: {} }))
    loadedBeds.current.add(bed.id)
    setActiveBedId(bed.id)
    setBedName('')
    setBedWidth(4)
    setBedLength(8)
    setShowNewBed(false)
    setCreating(false)
  }

  async function deleteBed(id) {
    if (!confirm(`Delete bed "${activeBed.name}"? This cannot be undone.`)) return
    await fetch(`/api/beds/${id}`, { method: 'DELETE' })
    const remaining = beds.filter(b => b.id !== id)
    setBeds(remaining)
    setLayouts(prev => { const n = { ...prev }; delete n[id]; return n })
    loadedBeds.current.delete(id)
    setActiveBedId(remaining[0]?.id || null)
  }

  function clearLayout() {
    if (!confirm('Clear all crops from this bed?')) return
    setLayouts(prev => ({ ...prev, [activeBedId]: {} }))
    fetch(`/api/beds/${activeBedId}/layout`, { method: 'DELETE' }).catch(console.error)
  }

  function addCustomCrop() {
    const c = customCrop.trim()
    if (!c) return
    setSelectedCrop(c)
    setCustomCrop('')
  }

  return (
    <div className="garden-layout">
      {/* Bed tabs */}
      <div className="bed-tabs">
        {beds.map(bed => (
          <button
            key={bed.id}
            className={`bed-tab ${activeBedId === bed.id ? 'active' : ''}`}
            onClick={() => setActiveBedId(bed.id)}
          >
            {bed.name}
            <span className="bed-tab-dims">{bed.width_ft}×{bed.length_ft}ft</span>
          </button>
        ))}
        <button className="bed-tab bed-tab-add" onClick={() => setShowNewBed(v => !v)}>
          + Add bed
        </button>
      </div>

      {/* New bed form */}
      {showNewBed && (
        <div className="new-bed-form">
          <input
            placeholder="Bed name (e.g. Raised Bed 1)"
            value={bedName}
            onChange={e => setBedName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createBed()}
            autoFocus
          />
          <div className="new-bed-dims">
            <label>
              Width
              <input type="number" min={1} max={20} value={bedWidth} onChange={e => setBedWidth(Math.min(20, Math.max(1, +e.target.value)))} />
              ft
            </label>
            <label>
              Length
              <input type="number" min={1} max={20} value={bedLength} onChange={e => setBedLength(Math.min(20, Math.max(1, +e.target.value)))} />
              ft
            </label>
            <span className="dim-hint">{bedWidth * bedLength} sq ft</span>
          </div>
          <div className="new-bed-actions">
            <button className="btn-primary btn-sm" onClick={createBed} disabled={creating || !bedName.trim()}>
              {creating ? 'Creating…' : 'Create bed'}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setShowNewBed(false)}>Cancel</button>
          </div>
        </div>
      )}

      {activeBed ? (
        <div className="layout-workspace">
          {/* Crop palette */}
          <div className="crop-palette">
            <div className="palette-section-label">Paint with</div>

            <button
              className={`palette-eraser ${!selectedCrop ? 'active' : ''}`}
              onClick={() => setSelectedCrop(null)}
            >
              ✕ Eraser
            </button>

            {savedCrops.length > 0 && (
              <>
                <div className="palette-group-label">Saved plantings</div>
                {savedCrops.map(crop => (
                  <button
                    key={crop}
                    className={`palette-chip ${selectedCrop === crop ? 'active' : ''}`}
                    style={{ '--chip-color': cropColor(crop) }}
                    onClick={() => setSelectedCrop(prev => prev === crop ? null : crop)}
                  >
                    <span className="chip-dot" />
                    {crop}
                  </button>
                ))}
              </>
            )}

            <div className="palette-group-label">Custom</div>
            <div className="palette-custom-row">
              <input
                placeholder="Crop name…"
                value={customCrop}
                onChange={e => setCustomCrop(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomCrop()}
              />
              <button className="btn-ghost btn-sm" onClick={addCustomCrop}>Use</button>
            </div>
            {selectedCrop && !savedCrops.includes(selectedCrop) && (
              <button
                className="palette-chip active"
                style={{ '--chip-color': cropColor(selectedCrop) }}
                onClick={() => setSelectedCrop(null)}
              >
                <span className="chip-dot" />
                {selectedCrop}
              </button>
            )}
          </div>

          {/* Grid area */}
          <div className="grid-area">
            <div className="grid-header">
              <div>
                <span className="grid-title">{activeBed.name}</span>
                <span className="grid-subtitle">{activeBed.width_ft} × {activeBed.length_ft} ft · {activeBed.width_ft * activeBed.length_ft} sq ft</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {Object.keys(activeLayout).length > 0 && (
                  <button className="btn-ghost btn-sm" onClick={clearLayout}>Clear all</button>
                )}
                <button className="btn-danger btn-sm" onClick={() => deleteBed(activeBed.id)}>Delete bed</button>
              </div>
            </div>

            <div className="grid-scroll">
              <div className="grid-compass"><span>N</span></div>
              <BedGrid
                bed={activeBed}
                layout={activeLayout}
                selectedCrop={selectedCrop}
                onCellChange={handleCellChange}
              />
            </div>

            {placedCrops.length > 0 && (
              <div className="grid-legend">
                {placedCrops.map(crop => (
                  <span key={crop} className="legend-item">
                    <span className="legend-dot" style={{ background: cropColor(crop) }} />
                    {crop}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        !showNewBed && (
          <div className="layout-empty">
            <p>No beds yet.</p>
            <button className="btn-primary" onClick={() => setShowNewBed(true)}>Add your first bed</button>
          </div>
        )
      )}
    </div>
  )
}
