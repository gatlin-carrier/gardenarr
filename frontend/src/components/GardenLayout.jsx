import { useState, useEffect, useRef } from 'react'
import './GardenLayout.css'

// ─── crop categories (mirrors PlantingList) ──────────────────────────────────

const CROP_CATS = [
  { id: 'vegetables', emoji: '🥦', color: '#16a34a', light: '#f0fdf4' },
  { id: 'fruits',     emoji: '🍓', color: '#dc2626', light: '#fef2f2' },
  { id: 'herbs',      emoji: '🌿', color: '#059669', light: '#ecfdf5' },
  { id: 'roots',      emoji: '🥕', color: '#d97706', light: '#fffbeb' },
  { id: 'flowers',    emoji: '🌸', color: '#db2777', light: '#fdf2f8' },
  { id: 'other',      emoji: '🌱', color: '#6b7280', light: '#f9fafb' },
]
const CROP_CAT_BY_ID = Object.fromEntries(CROP_CATS.map(c => [c.id, c]))
const CROP_KW = {
  fruits:     ['tomato','pepper','capsicum','tomatillo','strawberry','raspberry','blueberry','blackberry','gooseberry','currant','grape','melon','watermelon','cantaloupe','honeydew','passionfruit','kiwi','fig'],
  herbs:      ['basil','parsley','cilantro','coriander','dill','mint','thyme','rosemary','sage','oregano','marjoram','tarragon','chervil','borage','stevia','lemon balm','lemongrass','bay','sorrel','lovage','fennel','anise','caraway','chive'],
  roots:      ['carrot','beet','beetroot','radish','turnip','parsnip','potato','sweet potato','rutabaga','swede','kohlrabi','daikon','yam','horseradish','celeriac','salsify','ginger','turmeric'],
  flowers:    ['sunflower','marigold','nasturtium','zinnia','dahlia','cosmos','calendula','pansy','petunia','rose','lavender','chamomile','chrysanthemum','echinacea','delphinium','snapdragon','poppy','cornflower','foxglove'],
  vegetables: ['lettuce','spinach','kale','chard','arugula','rocket','cabbage','broccoli','cauliflower','brussels','bok choy','pak choi','collard','mustard','endive','radicchio','celery','asparagus','artichoke','onion','garlic','shallot','leek','scallion','ramp','watercress','cucumber','zucchini','courgette','squash','pumpkin','eggplant','aubergine','okra','corn','maize','bean','pea'],
}
function getCropCat(crop) {
  const lower = crop.toLowerCase()
  for (const [id, kws] of Object.entries(CROP_KW)) {
    if (kws.some(kw => lower.includes(kw))) return CROP_CAT_BY_ID[id]
  }
  return CROP_CAT_BY_ID.other
}

// ─── helpers ────────────────────────────────────────────────────────────────

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

function getCanvasPoint(svgEl, e) {
  const pt = svgEl.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  return pt.matrixTransform(svgEl.getScreenCTM().inverse())
}

// ─── BedGrid (click/drag crop painter) ──────────────────────────────────────

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

// ─── Crop swatches inside SVG bed rect ──────────────────────────────────────

function BedSwatches({ bedId, layout, bw, bl }) {
  const crops = Object.entries(layout)
  if (!crops.length) return null
  const unique = [...new Set(crops.map(([, c]) => c))]
  const sw = Math.min(bw / unique.length, bl * 0.35, 0.6)
  const startX = bw / 2 - (unique.length * (sw + 0.08)) / 2
  return (
    <g>
      {unique.map((crop, i) => (
        <rect
          key={crop}
          x={startX + i * (sw + 0.08)}
          y={bl - sw - 0.25}
          width={sw}
          height={sw}
          fill={cropColor(crop)}
          rx={0.08}
          opacity={0.85}
        />
      ))}
    </g>
  )
}

// ─── GardenLayout (main component) ──────────────────────────────────────────

export default function GardenLayout({ garden: gardenProp, plantings }) {
  const [garden, setGarden]         = useState({ ...gardenProp })
  const [beds, setBeds]             = useState([])
  const [layouts, setLayouts]       = useState({})
  const [selectedBedId, setSelectedBedId] = useState(null)
  const [selectedCrop, setSelectedCrop]   = useState(null)
  const [customCrop, setCustomCrop]       = useState('')
  const [showNewBed, setShowNewBed]       = useState(false)
  const [bedName, setBedName]             = useState('')
  const [bedWidth, setBedWidth]           = useState(4)
  const [bedLength, setBedLength]         = useState(8)
  const [creating, setCreating]           = useState(false)
  const [editingBed, setEditingBed]       = useState(false)
  const [bedDraft, setBedDraft]           = useState({ name: '', width_ft: 4, length_ft: 8 })
  const [bedSaving, setBedSaving]         = useState(false)
  const [aiLoading, setAiLoading]         = useState(false)
  const [aiTips, setAiTips]               = useState([])
  const [aiError, setAiError]             = useState('')
  const [bgUploading, setBgUploading]     = useState(false)
  const loadedBeds  = useRef(new Set())
  const svgRef      = useRef(null)
  const drag        = useRef({ active: false, bedId: null, ox: 0, oy: 0 })
  const bgInputRef  = useRef(null)

  const W = garden.layout_width_ft  || 20
  const L = garden.layout_length_ft || 20
  const MARGIN = 1
  const selectedBed = beds.find(b => b.id === selectedBedId) || null
  const activeLayout = layouts[selectedBedId] || {}
  const savedCrops = [...new Set(plantings.map(p => p.crop))]
  const placedCrops = [...new Set(Object.values(activeLayout))]

  // ── data loading ──────────────────────────────────────────────────────────

  useEffect(() => { loadBeds() }, [garden.id])

  async function loadBeds() {
    const data = await fetch(`/api/gardens/${garden.id}/beds`).then(r => r.json())
    setBeds(data)
    if (data.length) {
      setSelectedBedId(data[0].id)
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
    if (selectedBedId) loadLayout(selectedBedId)
  }, [selectedBedId])

  // ── bed CRUD ──────────────────────────────────────────────────────────────

  async function createBed() {
    if (!bedName.trim()) return
    setCreating(true)
    const bed = await fetch(`/api/gardens/${garden.id}/beds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: bedName.trim(), width_ft: bedWidth, length_ft: bedLength }),
    }).then(r => r.json())
    const fullBed = {
      ...bed, garden_id: garden.id,
      width_ft: bedWidth, length_ft: bedLength,
      name: bedName.trim(), x_ft: 1, y_ft: 1,
    }
    setBeds(prev => [...prev, fullBed])
    setLayouts(prev => ({ ...prev, [bed.id]: {} }))
    loadedBeds.current.add(bed.id)
    setSelectedBedId(bed.id)
    setBedName(''); setBedWidth(4); setBedLength(8); setShowNewBed(false)
    setCreating(false)
  }

  async function deleteBed(id) {
    if (!window.confirm(`Delete bed "${selectedBed.name}"? This cannot be undone.`)) return
    await fetch(`/api/beds/${id}`, { method: 'DELETE' })
    const remaining = beds.filter(b => b.id !== id)
    setBeds(remaining)
    setLayouts(prev => { const n = { ...prev }; delete n[id]; return n })
    loadedBeds.current.delete(id)
    setSelectedBedId(remaining[0]?.id || null)
    setEditingBed(false)
  }

  function startBedEdit() {
    setBedDraft({ name: selectedBed.name, width_ft: selectedBed.width_ft || 4, length_ft: selectedBed.length_ft || 8 })
    setEditingBed(true)
  }

  async function saveBedEdit() {
    if (!bedDraft.name.trim()) return
    setBedSaving(true)
    const w = Math.max(1, Math.min(50, Number(bedDraft.width_ft) || 4))
    const l = Math.max(1, Math.min(50, Number(bedDraft.length_ft) || 8))
    await fetch(`/api/beds/${selectedBed.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: bedDraft.name.trim(), width_ft: w, length_ft: l }),
    })
    setBeds(prev => prev.map(b => b.id === selectedBed.id
      ? { ...b, name: bedDraft.name.trim(), width_ft: w, length_ft: l }
      : b
    ))
    setBedSaving(false)
    setEditingBed(false)
  }

  // ── cell painting ─────────────────────────────────────────────────────────

  function handleCellChange(row, col, crop) {
    setLayouts(prev => {
      const bed = { ...(prev[selectedBedId] || {}) }
      if (crop) bed[`${row},${col}`] = crop
      else delete bed[`${row},${col}`]
      return { ...prev, [selectedBedId]: bed }
    })
    if (crop) {
      fetch(`/api/beds/${selectedBedId}/layout/${row}/${col}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ crop }),
      }).catch(console.error)
    } else {
      fetch(`/api/beds/${selectedBedId}/layout/${row}/${col}`, { method: 'DELETE' }).catch(console.error)
    }
  }

  function clearLayout() {
    if (!window.confirm('Clear all crops from this bed?')) return
    setLayouts(prev => ({ ...prev, [selectedBedId]: {} }))
    fetch(`/api/beds/${selectedBedId}/layout`, { method: 'DELETE' }).catch(console.error)
  }

  // ── garden dimensions ─────────────────────────────────────────────────────

  function updateDimension(field, value) {
    const num = Math.max(4, Math.min(200, Number(value) || 0))
    const updated = { ...garden, [field]: num }
    setGarden(updated)
    fetch(`/api/gardens/${garden.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layout_width_ft: updated.layout_width_ft, layout_length_ft: updated.layout_length_ft }),
    }).catch(console.error)
  }

  // ── background image ──────────────────────────────────────────────────────

  async function handleBgUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBgUploading(true)
    const fd = new FormData()
    fd.append('image', file)
    try {
      const result = await fetch(`/api/gardens/${garden.id}/layout/bg`, { method: 'POST', body: fd }).then(r => r.json())
      if (result.filename) setGarden(g => ({ ...g, bg_image: result.filename }))
    } catch (err) {
      console.error(err)
    } finally {
      setBgUploading(false)
      e.target.value = ''
    }
  }

  async function removeBg() {
    await fetch(`/api/gardens/${garden.id}/layout/bg`, { method: 'DELETE' })
    setGarden(g => ({ ...g, bg_image: null }))
  }

  // ── SVG drag ──────────────────────────────────────────────────────────────

  function onBedPointerDown(e, bed) {
    e.preventDefault()
    e.stopPropagation()
    setSelectedBedId(bed.id)
    const p = getCanvasPoint(svgRef.current, e)
    drag.current = { active: true, bedId: bed.id, ox: p.x - (bed.x_ft || 0), oy: p.y - (bed.y_ft || 0) }
  }

  function onSvgMouseMove(e) {
    if (!drag.current.active) return
    const p = getCanvasPoint(svgRef.current, e)
    const bed = beds.find(b => b.id === drag.current.bedId)
    if (!bed) return
    const nx = Math.max(0, Math.min(W - (bed.width_ft || 4), p.x - drag.current.ox))
    const ny = Math.max(0, Math.min(L - (bed.length_ft || 8), p.y - drag.current.oy))
    // Round to 0.5ft for snap feel
    const rx = Math.round(nx * 2) / 2
    const ry = Math.round(ny * 2) / 2
    setBeds(prev => prev.map(b => b.id === drag.current.bedId ? { ...b, x_ft: rx, y_ft: ry } : b))
  }

  function onSvgMouseUp() {
    if (!drag.current.active) return
    drag.current.active = false
    const bed = beds.find(b => b.id === drag.current.bedId)
    if (bed) {
      fetch(`/api/beds/${bed.id}/position`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x_ft: bed.x_ft || 0, y_ft: bed.y_ft || 0 }),
      }).catch(console.error)
    }
  }

  // ── AI arrange ────────────────────────────────────────────────────────────

  async function aiArrange() {
    setAiLoading(true); setAiError(''); setAiTips([])
    try {
      const data = await fetch(`/api/gardens/${garden.id}/layout/suggest`, { method: 'POST' }).then(r => r.json())
      if (data.error) throw new Error(data.error)
      setBeds(prev => prev.map(b => {
        const suggestion = data.beds?.find(s => s.id === b.id)
        return suggestion ? { ...b, x_ft: suggestion.x_ft, y_ft: suggestion.y_ft } : b
      }))
      setAiTips(data.tips || [])
      // Persist new positions
      for (const suggestion of (data.beds || [])) {
        fetch(`/api/beds/${suggestion.id}/position`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ x_ft: suggestion.x_ft, y_ft: suggestion.y_ft }),
        }).catch(console.error)
      }
    } catch (e) {
      setAiError(e.message)
    } finally {
      setAiLoading(false)
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  const bgUrl = garden.bg_image ? `/uploads/${garden.bg_image}` : null

  return (
    <div className="garden-layout">

      {/* ── Canvas toolbar ── */}
      <div className="canvas-toolbar">
        <div className="canvas-dims">
          <label>
            Width
            <input
              type="number" min={4} max={200}
              value={W}
              onChange={e => updateDimension('layout_width_ft', e.target.value)}
            />
            ft
          </label>
          <span className="dim-x">×</span>
          <label>
            Length
            <input
              type="number" min={4} max={200}
              value={L}
              onChange={e => updateDimension('layout_length_ft', e.target.value)}
            />
            ft
          </label>
          <span className="dim-sqft">{W * L} sq ft</span>
        </div>

        <div className="canvas-toolbar-actions">
          <input ref={bgInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBgUpload} />
          {!bgUrl ? (
            <button className="btn-ghost btn-sm" onClick={() => bgInputRef.current?.click()} disabled={bgUploading}>
              {bgUploading ? 'Uploading…' : '🗺 Map image'}
            </button>
          ) : (
            <button className="btn-ghost btn-sm" onClick={removeBg} title="Remove background image">
              ✕ Remove map
            </button>
          )}
          <button
            className="btn-ghost btn-sm btn-ai"
            onClick={aiArrange}
            disabled={aiLoading || beds.length === 0}
            title="Let AI suggest bed positions based on companion planting &amp; sun needs"
          >
            {aiLoading ? '✨ Arranging…' : '✨ AI arrange'}
          </button>
          <button className="btn-ghost btn-sm" onClick={() => setShowNewBed(v => !v)}>
            + Add bed
          </button>
        </div>
      </div>

      {/* ── AI tips panel ── */}
      {aiTips.length > 0 && (
        <div className="ai-tips-panel">
          <div className="ai-tips-title">Layout tips from AI</div>
          <ul className="ai-tips-list">
            {aiTips.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
          <button className="ai-tips-dismiss" onClick={() => setAiTips([])}>Dismiss</button>
        </div>
      )}
      {aiError && <div className="ai-error">{aiError}</div>}

      {/* ── New bed form ── */}
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
              <input type="number" min={1} max={50} value={bedWidth}
                onChange={e => setBedWidth(Math.min(50, Math.max(1, +e.target.value)))} />
              ft
            </label>
            <label>
              Length
              <input type="number" min={1} max={50} value={bedLength}
                onChange={e => setBedLength(Math.min(50, Math.max(1, +e.target.value)))} />
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

      {/* ── SVG garden canvas ── */}
      {beds.length > 0 || !showNewBed ? (
        <div className="canvas-wrap">
          {beds.length === 0 && (
            <div className="canvas-empty">
              <p>No beds yet — add one above to get started.</p>
            </div>
          )}
          <svg
            ref={svgRef}
            className="garden-svg"
            viewBox={`${-MARGIN} ${-MARGIN} ${W + MARGIN * 2} ${L + MARGIN * 2}`}
            onMouseMove={onSvgMouseMove}
            onMouseUp={onSvgMouseUp}
            onMouseLeave={onSvgMouseUp}
          >
            {/* Background image */}
            {bgUrl && (
              <image href={bgUrl} x={0} y={0} width={W} height={L}
                preserveAspectRatio="xMidYMid slice" className="svg-bg-image" />
            )}

            {/* Garden boundary */}
            <rect x={0} y={0} width={W} height={L} className="garden-boundary" />

            {/* Grid lines (1ft) */}
            {Array.from({ length: Math.floor(W) - 1 }, (_, i) => (
              <line key={`v${i}`} x1={i+1} y1={0} x2={i+1} y2={L} className="grid-line" />
            ))}
            {Array.from({ length: Math.floor(L) - 1 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={i+1} x2={W} y2={i+1} className="grid-line" />
            ))}

            {/* Compass N */}
            <text x={W / 2} y={-0.35} className="compass-n">N</text>
            <text x={W / 2} y={L + 0.7} className="compass-s">S</text>

            {/* Dimension labels */}
            <text x={W + 0.2} y={L / 2} className="dim-label" dominantBaseline="middle">{L}ft</text>
            <text x={W / 2} y={-0.85} className="dim-label" textAnchor="middle">{W}ft</text>

            {/* Beds */}
            {beds.map(bed => {
              const x = bed.x_ft || 0
              const y = bed.y_ft || 0
              const bw = bed.width_ft || 4
              const bl = bed.length_ft || 8
              const isSelected = bed.id === selectedBedId
              const bedLayout = layouts[bed.id] || {}
              return (
                <g
                  key={bed.id}
                  className={`bed-group${isSelected ? ' bed-selected' : ''}`}
                  transform={`translate(${x},${y})`}
                  onMouseDown={e => onBedPointerDown(e, bed)}
                  style={{ cursor: 'grab' }}
                >
                  <rect width={bw} height={bl} className="bed-rect" rx={0.12} />
                  <text x={bw / 2} y={bl / 2 - 0.15} className="bed-label" textAnchor="middle" dominantBaseline="middle">
                    {bed.name}
                  </text>
                  <BedSwatches bedId={bed.id} layout={bedLayout} bw={bw} bl={bl} />
                </g>
              )
            })}
          </svg>
          <div className="canvas-hint">Drag beds to reposition · Click a bed to paint crops below</div>
        </div>
      ) : null}

      {/* ── Selected bed paint section ── */}
      {selectedBed && (
        <div className="paint-section">
          <div className="paint-header">
            {editingBed ? (
              <div className="bed-edit-form">
                <div className="bed-edit-row">
                  <div className="bed-edit-field bed-edit-name">
                    <label>Bed name</label>
                    <input
                      value={bedDraft.name}
                      onChange={e => setBedDraft(d => ({ ...d, name: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && saveBedEdit()}
                      autoFocus
                    />
                  </div>
                  <div className="bed-edit-field">
                    <label>Width (ft)</label>
                    <input type="number" min={1} max={50} value={bedDraft.width_ft}
                      onChange={e => setBedDraft(d => ({ ...d, width_ft: e.target.value }))} />
                  </div>
                  <div className="bed-edit-field">
                    <label>Length (ft)</label>
                    <input type="number" min={1} max={50} value={bedDraft.length_ft}
                      onChange={e => setBedDraft(d => ({ ...d, length_ft: e.target.value }))} />
                  </div>
                </div>
                <div className="bed-edit-actions">
                  <button className="btn-primary btn-sm" onClick={saveBedEdit} disabled={bedSaving || !bedDraft.name.trim()}>
                    {bedSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button className="btn-ghost btn-sm" onClick={() => setEditingBed(false)}>Cancel</button>
                  {Object.keys(activeLayout).length > 0 && (
                    <button className="btn-ghost btn-sm" onClick={clearLayout} style={{ marginLeft: 'auto' }}>Clear crops</button>
                  )}
                  <button className="btn-ghost btn-sm btn-danger" onClick={() => deleteBed(selectedBed.id)}>Delete bed</button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <span className="paint-title">{selectedBed.name}</span>
                  <span className="paint-subtitle">{selectedBed.width_ft} × {selectedBed.length_ft} ft · {selectedBed.width_ft * selectedBed.length_ft} sq ft</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-ghost btn-sm" onClick={startBedEdit}>Edit bed</button>
                  {Object.keys(activeLayout).length > 0 && (
                    <button className="btn-ghost btn-sm" onClick={clearLayout}>Clear crops</button>
                  )}
                  <button className="btn-ghost btn-sm btn-danger" onClick={() => deleteBed(selectedBed.id)}>Delete</button>
                </div>
              </>
            )}
          </div>

          <div className="paint-workspace">
            {/* Crop palette */}
            <div className="crop-palette">
              <div className="palette-section-label">Paint with</div>
              <button
                className={`palette-eraser ${!selectedCrop ? 'active' : ''}`}
                onClick={() => setSelectedCrop(null)}
              >
                ✕ Eraser
              </button>

              {/* Compact planting cards */}
              {(() => {
                const seen = new Set()
                const unique = plantings.filter(p => { if (seen.has(p.crop)) return false; seen.add(p.crop); return true })
                if (!unique.length) return null
                return (
                  <>
                    <div className="palette-group-label">Saved plantings</div>
                    {unique.map(p => {
                      const cat = getCropCat(p.crop)
                      const active = selectedCrop === p.crop
                      return (
                        <button
                          key={p.crop}
                          className={`palette-card${active ? ' palette-card--active' : ''}`}
                          style={{ '--cat-color': cat.color, '--cat-light': cat.light }}
                          onClick={() => setSelectedCrop(prev => prev === p.crop ? null : p.crop)}
                        >
                          <span className="palette-card-emoji">{cat.emoji}</span>
                          <div className="palette-card-body">
                            <span className="palette-card-name">{p.crop}</span>
                            {p.harvest && <span className="palette-card-meta">🌾 {p.harvest}</span>}
                          </div>
                          {active && <span className="palette-card-check">✓</span>}
                        </button>
                      )
                    })}
                  </>
                )
              })()}

              <div className="palette-group-label">Custom</div>
              <div className="palette-custom-row">
                <input
                  placeholder="Crop name…"
                  value={customCrop}
                  onChange={e => setCustomCrop(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && customCrop.trim()) { setSelectedCrop(customCrop.trim()); setCustomCrop('') } }}
                />
                <button className="btn-ghost btn-sm" onClick={() => { if (customCrop.trim()) { setSelectedCrop(customCrop.trim()); setCustomCrop('') } }}>Use</button>
              </div>
              {selectedCrop && !savedCrops.includes(selectedCrop) && (() => {
                const cat = getCropCat(selectedCrop)
                return (
                  <button
                    className="palette-card palette-card--active"
                    style={{ '--cat-color': cat.color, '--cat-light': cat.light }}
                    onClick={() => setSelectedCrop(null)}
                  >
                    <span className="palette-card-emoji">{cat.emoji}</span>
                    <div className="palette-card-body">
                      <span className="palette-card-name">{selectedCrop}</span>
                      <span className="palette-card-meta">Custom · click to deselect</span>
                    </div>
                  </button>
                )
              })()}
            </div>

            {/* Grid */}
            <div className="grid-area">
              <div className="grid-compass"><span>N</span></div>
              <div className="grid-scroll">
                <BedGrid
                  bed={selectedBed}
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
        </div>
      )}
    </div>
  )
}
