import { useState, useEffect, useRef, useMemo } from 'react'
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

function BedGrid({ bed, layout, selectedCrop, onCellChange, onCellSelect, selectedCell }) {
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

  function handleClick(row, col) {
    painting.current = true
    applyCell(row, col)
    if (onCellSelect) onCellSelect(row, col)
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
          const isSelected = selectedCell && selectedCell.row === row && selectedCell.col === col

          // Determine which neighbors share the same crop for visual merging
          let mergeClasses = ''
          if (crop) {
            if (row > 0 && layout[`${row - 1},${col}`] === crop) mergeClasses += ' merge-top'
            if (row < rows - 1 && layout[`${row + 1},${col}`] === crop) mergeClasses += ' merge-bottom'
            if (col > 0 && layout[`${row},${col - 1}`] === crop) mergeClasses += ' merge-left'
            if (col < cols - 1 && layout[`${row},${col + 1}`] === crop) mergeClasses += ' merge-right'
          }

          // Only show the label on the first cell of a merged group
          // (the topmost-leftmost cell that has no merge-top and no merge-left)
          const showLabel = crop && !mergeClasses.includes('merge-top') && !mergeClasses.includes('merge-left')

          return (
            <div
              key={`${row}-${col}`}
              className={`bed-cell ${crop ? 'occupied' : 'empty'}${isSelected ? ' cell-selected' : ''}${mergeClasses}`}
              style={color ? { background: color, borderColor: color } : {}}
              title={crop || (selectedCrop ? `Place ${selectedCrop}` : 'Click to select')}
              onMouseDown={() => handleClick(row, col)}
              onMouseEnter={() => { if (painting.current) applyCell(row, col) }}
              onTouchStart={e => { e.preventDefault(); handleClick(row, col) }}
            >
              {showLabel && (
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

// ─── Grass decoration (scattered blades on empty areas) ────────────────────

function seededRandom(seed) {
  let s = seed | 0
  return () => { s = Math.imul(s ^ (s >>> 16), 0x45d9f3b); s = Math.imul(s ^ (s >>> 13), 0x45d9f3b); return ((s ^= s >>> 16) >>> 0) / 4294967296 }
}

function GrassDecoration({ W, L, beds, features }) {
  return useMemo(() => {
    const rand = seededRandom(Math.round(W * 1000 + L * 7))
    const occupied = []
    for (const b of beds) {
      occupied.push({ x: b.x_ft || 0, y: b.y_ft || 0, w: b.width_ft || 4, h: b.length_ft || 8 })
    }
    for (const f of features) {
      occupied.push({ x: f.x_ft || 0, y: f.y_ft || 0, w: f.width_ft || 2, h: f.length_ft || 2 })
    }
    function isOccupied(px, py) {
      for (const r of occupied) {
        if (px >= r.x - 0.3 && px <= r.x + r.w + 0.3 && py >= r.y - 0.3 && py <= r.y + r.h + 0.3) return true
      }
      return false
    }

    const clumps = []
    const count = Math.round(W * L * 0.12)
    for (let i = 0; i < count; i++) {
      const cx = rand() * W
      const cy = rand() * L
      if (isOccupied(cx, cy)) continue
      const bladeCount = 2 + Math.floor(rand() * 3)
      const scale = 0.08 + rand() * 0.06
      const rotation = rand() * 30 - 15
      clumps.push(
        <g key={i} transform={`translate(${cx.toFixed(2)},${cy.toFixed(2)}) scale(${scale.toFixed(3)}) rotate(${rotation.toFixed(1)})`} opacity={0.35 + rand() * 0.2}>
          {Array.from({ length: bladeCount }, (_, j) => {
            const xOff = (rand() - 0.5) * 3
            const lean = (rand() - 0.5) * 2
            const h = 3 + rand() * 4
            return (
              <path
                key={j}
                d={`M${xOff.toFixed(1)},0 Q${(xOff + lean).toFixed(1)},${(-h * 0.6).toFixed(1)} ${(xOff + lean * 1.5).toFixed(1)},${(-h).toFixed(1)}`}
                stroke={`hsl(${110 + rand() * 30}, ${50 + rand() * 20}%, ${30 + rand() * 15}%)`}
                strokeWidth={0.5 + rand() * 0.5}
                fill="none"
                strokeLinecap="round"
              />
            )
          })}
        </g>
      )
    }
    return <g className="grass-deco">{clumps}</g>
  }, [W, L, beds.length, features.length])
}

// ─── Feature SVG shapes (symbolic realism) ─────────────────────────────────

function FeatureSVG({ feature, isSelected, onPointerDown }) {
  const { type, x_ft, y_ft, width_ft, length_ft, name } = feature
  const w = width_ft || 2
  const h = length_ft || 2

  let content
  switch (type) {
    case 'tree': {
      const r = Math.min(w, h) / 2
      const cx = w / 2, cy = h / 2
      content = (
        <>
          {/* trunk */}
          <rect x={cx - r * 0.15} y={cy + r * 0.1} width={r * 0.3} height={r * 0.6} rx={r * 0.05} fill="#8B6914" opacity={0.85} />
          {/* canopy shadow */}
          <ellipse cx={cx + r * 0.08} cy={cy + r * 0.08} rx={r * 0.85} ry={r * 0.75} fill="rgba(0,40,0,0.12)" />
          {/* main canopy */}
          <ellipse cx={cx} cy={cy} rx={r * 0.85} ry={r * 0.75} fill="#2d7a2d" />
          {/* highlight */}
          <ellipse cx={cx - r * 0.15} cy={cy - r * 0.18} rx={r * 0.5} ry={r * 0.4} fill="#4aad4a" opacity={0.5} />
          {/* texture dots */}
          <circle cx={cx + r * 0.25} cy={cy - r * 0.1} r={r * 0.08} fill="#1f5e1f" opacity={0.4} />
          <circle cx={cx - r * 0.3} cy={cy + r * 0.15} r={r * 0.06} fill="#1f5e1f" opacity={0.3} />
        </>
      )
      break
    }
    case 'bush': {
      const cx = w / 2, cy = h / 2
      const rx = w * 0.42, ry = h * 0.38
      content = (
        <>
          {/* shadow */}
          <ellipse cx={cx + 0.05} cy={cy + ry * 0.5} rx={rx * 0.9} ry={ry * 0.3} fill="rgba(0,30,0,0.1)" />
          {/* base mass */}
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#3a8a3a" />
          {/* layered lobes */}
          <ellipse cx={cx - rx * 0.35} cy={cy - ry * 0.15} rx={rx * 0.55} ry={ry * 0.65} fill="#48a048" opacity={0.7} />
          <ellipse cx={cx + rx * 0.3} cy={cy - ry * 0.1} rx={rx * 0.5} ry={ry * 0.6} fill="#42964a" opacity={0.6} />
          {/* highlight */}
          <ellipse cx={cx} cy={cy - ry * 0.3} rx={rx * 0.4} ry={ry * 0.3} fill="#5dbd5d" opacity={0.35} />
          {/* small berry dots */}
          <circle cx={cx - rx * 0.2} cy={cy + ry * 0.1} r={0.06} fill="#c44" opacity={0.6} />
          <circle cx={cx + rx * 0.15} cy={cy - ry * 0.15} r={0.05} fill="#c44" opacity={0.5} />
        </>
      )
      break
    }
    case 'compost': {
      const cx = w / 2, cy = h / 2
      content = (
        <>
          {/* bin body */}
          <rect x={w * 0.1} y={h * 0.15} width={w * 0.8} height={h * 0.75} rx={0.1} fill="#6B4226" />
          {/* slats */}
          <line x1={w * 0.1} y1={h * 0.38} x2={w * 0.9} y2={h * 0.38} stroke="#5a3620" strokeWidth={0.04} />
          <line x1={w * 0.1} y1={h * 0.58} x2={w * 0.9} y2={h * 0.58} stroke="#5a3620" strokeWidth={0.04} />
          <line x1={w * 0.1} y1={h * 0.78} x2={w * 0.9} y2={h * 0.78} stroke="#5a3620" strokeWidth={0.04} />
          {/* compost inside peeking over top */}
          <ellipse cx={cx} cy={h * 0.18} rx={w * 0.35} ry={h * 0.08} fill="#4a6b20" opacity={0.7} />
          {/* lid */}
          <rect x={w * 0.05} y={h * 0.1} width={w * 0.9} height={h * 0.08} rx={0.05} fill="#7a5030" />
          {/* label */}
          <text x={cx} y={cy + h * 0.05} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(w, h) * 0.18} fill="rgba(255,255,255,0.6)" fontWeight="600" pointerEvents="none">&#9851;</text>
        </>
      )
      break
    }
    case 'path': {
      content = (
        <>
          {/* gravel/stone path */}
          <rect x={0} y={0} width={w} height={h} rx={0.08} fill="#c8b898" />
          <rect x={0} y={0} width={w} height={h} rx={0.08} fill="url(#pathPattern)" opacity={0.4} />
          {/* subtle border */}
          <rect x={0} y={0} width={w} height={h} rx={0.08} fill="none" stroke="#b0a080" strokeWidth={0.04} />
        </>
      )
      break
    }
    default: {
      content = (
        <rect x={0} y={0} width={w} height={h} rx={0.1} fill="#aaa" opacity={0.4} stroke="#888" strokeWidth={0.04} />
      )
    }
  }

  return (
    <g
      className={`feature-group${isSelected ? ' feature-selected' : ''}`}
      transform={`translate(${x_ft || 0},${y_ft || 0})`}
      onMouseDown={onPointerDown}
      style={{ cursor: 'grab' }}
    >
      {content}
      {name && (
        <text x={w / 2} y={h + 0.35} className="feature-label" textAnchor="middle" fontSize={0.4} fill="var(--text-muted, #666)" pointerEvents="none">
          {name}
        </text>
      )}
    </g>
  )
}

// ─── SVG pattern defs ──────────────────────────────────────────────────────

function GardenDefs() {
  return (
    <defs>
      <pattern id="pathPattern" width="0.5" height="0.5" patternUnits="userSpaceOnUse">
        <circle cx="0.15" cy="0.15" r="0.08" fill="#a09070" opacity="0.5" />
        <circle cx="0.4" cy="0.35" r="0.06" fill="#a09070" opacity="0.4" />
      </pattern>
    </defs>
  )
}

// ─── Resize handle (corner drag) ───────────────────────────────────────────

function ResizeHandle({ x, y, onResizeStart }) {
  return (
    <g className="resize-handle" onMouseDown={onResizeStart} style={{ cursor: 'nwse-resize' }}>
      {/* invisible hit area */}
      <rect x={x - 0.3} y={y - 0.3} width={0.6} height={0.6} fill="transparent" />
      {/* visible triangle */}
      <path
        d={`M${x},${y - 0.35} L${x + 0.35},${y} L${x},${y} Z`}
        fill="var(--green-600, #16a34a)"
        opacity={0.8}
        transform={`rotate(180, ${x}, ${y - 0.175})`}
      />
      {/* small grip lines */}
      <line x1={x - 0.05} y1={y} x2={x} y2={y - 0.05} stroke="white" strokeWidth={0.03} />
      <line x1={x - 0.15} y1={y} x2={x} y2={y - 0.15} stroke="white" strokeWidth={0.03} />
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
  const [features, setFeatures]           = useState([])
  const [selectedFeatureId, setSelectedFeatureId] = useState(null)
  const [showAddFeature, setShowAddFeature]       = useState(false)
  const loadedBeds  = useRef(new Set())
  const svgRef      = useRef(null)
  const drag        = useRef({ active: false, type: null, id: null, ox: 0, oy: 0 })
  const resize      = useRef({ active: false, type: null, id: null, startW: 0, startH: 0, startX: 0, startY: 0 })
  const bgInputRef  = useRef(null)

  const W = garden.layout_width_ft  || 20
  const L = garden.layout_length_ft || 20
  const MARGIN = 1
  const selectedBed = beds.find(b => b.id === selectedBedId) || null
  const activeLayout = layouts[selectedBedId] || {}
  const savedCrops = [...new Set(plantings.map(p => p.crop))]
  const placedCrops = [...new Set(Object.values(activeLayout))]

  // ── data loading ──────────────────────────────────────────────────────────

  useEffect(() => { loadBeds(); loadFeatures() }, [garden.id])

  async function loadBeds() {
    const data = await fetch(`/api/gardens/${garden.id}/beds`).then(r => r.json())
    setBeds(data)
    if (data.length) {
      setSelectedBedId(data[0].id)
      await loadLayout(data[0].id)
    }
  }

  async function loadFeatures() {
    const data = await fetch(`/api/gardens/${garden.id}/features`).then(r => r.json())
    setFeatures(data)
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

  // ── SVG drag (beds + features) ────────────────────────────────────────────

  function onBedPointerDown(e, bed) {
    e.preventDefault()
    e.stopPropagation()
    setSelectedBedId(bed.id)
    setSelectedFeatureId(null)
    const p = getCanvasPoint(svgRef.current, e)
    drag.current = { active: true, type: 'bed', id: bed.id, ox: p.x - (bed.x_ft || 0), oy: p.y - (bed.y_ft || 0) }
  }

  function onFeaturePointerDown(e, feat) {
    e.preventDefault()
    e.stopPropagation()
    setSelectedFeatureId(feat.id)
    setSelectedBedId(null)
    const p = getCanvasPoint(svgRef.current, e)
    drag.current = { active: true, type: 'feature', id: feat.id, ox: p.x - (feat.x_ft || 0), oy: p.y - (feat.y_ft || 0) }
  }

  function onResizeStart(e, type, id) {
    e.preventDefault()
    e.stopPropagation()
    const p = getCanvasPoint(svgRef.current, e)
    const item = type === 'bed' ? beds.find(b => b.id === id) : features.find(f => f.id === id)
    if (!item) return
    resize.current = {
      active: true, type, id,
      startW: item.width_ft || (type === 'bed' ? 4 : 2),
      startH: item.length_ft || (type === 'bed' ? 8 : 2),
      startX: p.x, startY: p.y,
    }
  }

  function onSvgMouseMove(e) {
    // Handle resize
    if (resize.current.active) {
      const p = getCanvasPoint(svgRef.current, e)
      const dx = p.x - resize.current.startX
      const dy = p.y - resize.current.startY
      const newW = Math.max(1, Math.round((resize.current.startW + dx) * 2) / 2)
      const newH = Math.max(1, Math.round((resize.current.startH + dy) * 2) / 2)
      if (resize.current.type === 'bed') {
        const clamped = { width_ft: Math.min(newW, 50), length_ft: Math.min(newH, 50) }
        setBeds(prev => prev.map(b => b.id === resize.current.id ? { ...b, ...clamped } : b))
      } else {
        const clamped = { width_ft: Math.min(newW, 50), length_ft: Math.min(newH, 50) }
        setFeatures(prev => prev.map(f => f.id === resize.current.id ? { ...f, ...clamped } : f))
      }
      return
    }

    // Handle drag
    if (!drag.current.active) return
    const p = getCanvasPoint(svgRef.current, e)

    if (drag.current.type === 'bed') {
      const bed = beds.find(b => b.id === drag.current.id)
      if (!bed) return
      const nx = Math.max(0, Math.min(W - (bed.width_ft || 4), p.x - drag.current.ox))
      const ny = Math.max(0, Math.min(L - (bed.length_ft || 8), p.y - drag.current.oy))
      const rx = Math.round(nx * 2) / 2
      const ry = Math.round(ny * 2) / 2
      setBeds(prev => prev.map(b => b.id === drag.current.id ? { ...b, x_ft: rx, y_ft: ry } : b))
    } else if (drag.current.type === 'feature') {
      const feat = features.find(f => f.id === drag.current.id)
      if (!feat) return
      const nx = Math.max(0, Math.min(W - (feat.width_ft || 2), p.x - drag.current.ox))
      const ny = Math.max(0, Math.min(L - (feat.length_ft || 2), p.y - drag.current.oy))
      // Free positioning (no grid snap after initial placement)
      const rx = Math.round(nx * 4) / 4  // quarter-foot precision
      const ry = Math.round(ny * 4) / 4
      setFeatures(prev => prev.map(f => f.id === drag.current.id ? { ...f, x_ft: rx, y_ft: ry } : f))
    }
  }

  function onSvgMouseUp() {
    // Handle resize end
    if (resize.current.active) {
      resize.current.active = false
      if (resize.current.type === 'bed') {
        const bed = beds.find(b => b.id === resize.current.id)
        if (bed) {
          fetch(`/api/beds/${bed.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: bed.name, width_ft: bed.width_ft, length_ft: bed.length_ft }),
          }).catch(console.error)
        }
      } else {
        const feat = features.find(f => f.id === resize.current.id)
        if (feat) {
          fetch(`/api/features/${feat.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ width_ft: feat.width_ft, length_ft: feat.length_ft }),
          }).catch(console.error)
        }
      }
      return
    }

    if (!drag.current.active) return
    drag.current.active = false

    if (drag.current.type === 'bed') {
      const bed = beds.find(b => b.id === drag.current.id)
      if (bed) {
        fetch(`/api/beds/${bed.id}/position`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ x_ft: bed.x_ft || 0, y_ft: bed.y_ft || 0 }),
        }).catch(console.error)
      }
    } else if (drag.current.type === 'feature') {
      const feat = features.find(f => f.id === drag.current.id)
      if (feat) {
        fetch(`/api/features/${feat.id}/position`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ x_ft: feat.x_ft || 0, y_ft: feat.y_ft || 0 }),
        }).catch(console.error)
      }
    }
  }

  // ── Feature CRUD ─────────────────────────────────────────────────────────

  async function addFeature(type) {
    // Snap to nearest grid position near center
    const x = Math.round(W / 2)
    const y = Math.round(L / 2)
    const defaults = { tree: { w: 3, h: 3 }, bush: { w: 2, h: 2 }, compost: { w: 2, h: 3 }, path: { w: 1, h: 4 } }
    const d = defaults[type] || { w: 2, h: 2 }
    const res = await fetch(`/api/gardens/${garden.id}/features`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, name: type.charAt(0).toUpperCase() + type.slice(1), x_ft: x, y_ft: y, width_ft: d.w, length_ft: d.h }),
    })
    const data = await res.json()
    const newFeature = { id: data.id, type, name: type.charAt(0).toUpperCase() + type.slice(1), x_ft: x, y_ft: y, width_ft: d.w, length_ft: d.h }
    setFeatures(prev => [...prev, newFeature])
    setSelectedFeatureId(data.id)
    setSelectedBedId(null)
    setShowAddFeature(false)
  }

  async function deleteFeature(id) {
    await fetch(`/api/features/${id}`, { method: 'DELETE' })
    setFeatures(prev => prev.filter(f => f.id !== id))
    if (selectedFeatureId === id) setSelectedFeatureId(null)
  }

  const selectedFeature = features.find(f => f.id === selectedFeatureId) || null

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

  // ── quick-add search ─────────────────────────────────────────────────────

  const [quickSearch, setQuickSearch]     = useState('')
  const [selectedCell, setSelectedCell]   = useState(null) // { row, col }

  function handleCellSelect(row, col) {
    setSelectedCell({ row, col })
    setQuickSearch('')
  }

  function quickAddCrop(crop) {
    if (!selectedCell || !selectedBed) return
    handleCellChange(selectedCell.row, selectedCell.col, crop)
    // Move to next empty cell
    const cols = Math.max(1, Math.round(selectedBed.width_ft))
    const rows = Math.max(1, Math.round(selectedBed.length_ft))
    const layout = layouts[selectedBedId] || {}
    let { row: r, col: c } = selectedCell
    c++
    while (r < rows) {
      while (c < cols) {
        if (!layout[`${r},${c}`]) { setSelectedCell({ row: r, col: c }); setQuickSearch(''); return }
        c++
      }
      c = 0; r++
    }
    setSelectedCell(null)
    setQuickSearch('')
  }

  const quickResults = quickSearch.trim()
    ? [...savedCrops, ...(!savedCrops.some(c => c.toLowerCase() === quickSearch.trim().toLowerCase()) ? [quickSearch.trim()] : [])]
        .filter(c => c.toLowerCase().includes(quickSearch.toLowerCase()))
        .slice(0, 8)
    : []

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
          <div className="feature-add-wrap">
            <button className="btn-ghost btn-sm" onClick={() => setShowAddFeature(v => !v)}>
              + Feature
            </button>
            {showAddFeature && (
              <div className="feature-add-menu">
                <button onClick={() => addFeature('tree')}>🌳 Tree</button>
                <button onClick={() => addFeature('bush')}>🌿 Bush</button>
                <button onClick={() => addFeature('compost')}>♻ Compost</button>
                <button onClick={() => addFeature('path')}>🟫 Path</button>
              </div>
            )}
          </div>
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

      {/* ── Main layout: canvas left + panel right ── */}
      <div className="layout-split">

        {/* ── Left: SVG canvas ── */}
        <div className="layout-canvas-col">
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
                onClick={() => { setSelectedFeatureId(null) }}
              >
                <GardenDefs />
                {bgUrl && (
                  <image href={bgUrl} x={0} y={0} width={W} height={L}
                    preserveAspectRatio="xMidYMid slice" className="svg-bg-image" />
                )}
                <rect x={0} y={0} width={W} height={L} className="garden-boundary" />

                {/* Grass blades on empty areas */}
                <GrassDecoration W={W} L={L} beds={beds} features={features} />

                {Array.from({ length: Math.floor(W) - 1 }, (_, i) => (
                  <line key={`v${i}`} x1={i+1} y1={0} x2={i+1} y2={L} className="grid-line" />
                ))}
                {Array.from({ length: Math.floor(L) - 1 }, (_, i) => (
                  <line key={`h${i}`} x1={0} y1={i+1} x2={W} y2={i+1} className="grid-line" />
                ))}
                <text x={W / 2} y={-0.35} className="compass-n">N</text>
                <text x={W / 2} y={L + 0.7} className="compass-s">S</text>
                <text x={W + 0.2} y={L / 2} className="dim-label" dominantBaseline="middle">{L}ft</text>
                <text x={W / 2} y={-0.85} className="dim-label" textAnchor="middle">{W}ft</text>

                {/* Features (trees, bushes, compost, paths) */}
                {features.map(feat => (
                  <FeatureSVG
                    key={feat.id}
                    feature={feat}
                    isSelected={feat.id === selectedFeatureId}
                    onPointerDown={e => onFeaturePointerDown(e, feat)}
                  />
                ))}

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
                      {/* Resize handle (bottom-right corner) */}
                      {isSelected && (
                        <ResizeHandle x={bw} y={bl} onResizeStart={e => onResizeStart(e, 'bed', bed.id)} />
                      )}
                    </g>
                  )
                })}

                {/* Feature resize handles */}
                {selectedFeatureId && (() => {
                  const f = features.find(ft => ft.id === selectedFeatureId)
                  if (!f) return null
                  const fw = f.width_ft || 2, fh = f.length_ft || 2
                  return (
                    <g transform={`translate(${f.x_ft || 0},${f.y_ft || 0})`}>
                      {/* Selection outline */}
                      <rect width={fw} height={fh} fill="none" stroke="var(--green-600, #16a34a)" strokeWidth={0.06} strokeDasharray="0.2 0.12" rx={0.08} />
                      <ResizeHandle x={fw} y={fh} onResizeStart={e => onResizeStart(e, 'feature', f.id)} />
                    </g>
                  )
                })()}
              </svg>
              <div className="canvas-hint">Drag to reposition · Click to select · Drag corner handle to resize</div>
            </div>
          ) : null}
        </div>

        {/* ── Right: edit panel ── */}
        {selectedBed && (
          <div className="layout-panel-col">
            {/* Bed selector tabs */}
            {beds.length > 1 && (
              <div className="panel-bed-tabs">
                {beds.map(b => (
                  <button
                    key={b.id}
                    className={`panel-bed-tab ${b.id === selectedBedId ? 'active' : ''}`}
                    onClick={() => setSelectedBedId(b.id)}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            )}

            {/* Bed info / edit */}
            <div className="panel-section">
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
                      <label>W (ft)</label>
                      <input type="number" min={1} max={50} value={bedDraft.width_ft}
                        onChange={e => setBedDraft(d => ({ ...d, width_ft: e.target.value }))} />
                    </div>
                    <div className="bed-edit-field">
                      <label>L (ft)</label>
                      <input type="number" min={1} max={50} value={bedDraft.length_ft}
                        onChange={e => setBedDraft(d => ({ ...d, length_ft: e.target.value }))} />
                    </div>
                  </div>
                  <div className="bed-edit-actions">
                    <button className="btn-primary btn-sm" onClick={saveBedEdit} disabled={bedSaving || !bedDraft.name.trim()}>
                      {bedSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => setEditingBed(false)}>Cancel</button>
                    <button className="btn-ghost btn-sm btn-danger" onClick={() => deleteBed(selectedBed.id)} style={{ marginLeft: 'auto' }}>Delete</button>
                  </div>
                </div>
              ) : (
                <div className="panel-bed-header">
                  <div>
                    <span className="paint-title">{selectedBed.name}</span>
                    <span className="paint-subtitle">{selectedBed.width_ft} × {selectedBed.length_ft} ft · {Math.round(selectedBed.width_ft * selectedBed.length_ft)} sq ft</span>
                  </div>
                  <div className="panel-bed-actions">
                    <button className="btn-ghost btn-sm" onClick={startBedEdit}>Edit</button>
                    {Object.keys(activeLayout).length > 0 && (
                      <button className="btn-ghost btn-sm" onClick={clearLayout}>Clear</button>
                    )}
                    <button className="btn-ghost btn-sm btn-danger" onClick={() => deleteBed(selectedBed.id)}>Delete</button>
                  </div>
                </div>
              )}
            </div>

            {/* Bed grid */}
            <div className="panel-section">
              <div className="panel-section-label">Bed grid</div>
              <div className="grid-compass"><span>N</span></div>
              <div className="grid-scroll">
                <BedGrid
                  bed={selectedBed}
                  layout={activeLayout}
                  selectedCrop={selectedCrop}
                  onCellChange={handleCellChange}
                  onCellSelect={handleCellSelect}
                  selectedCell={selectedCell}
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

            {/* Quick add (when cell selected) */}
            {selectedCell && (
              <div className="panel-section panel-quick-add">
                <div className="panel-section-label">
                  Quick add to plot ({selectedCell.row + 1}, {selectedCell.col + 1})
                  <button className="btn-ghost btn-sm" onClick={() => setSelectedCell(null)} style={{ marginLeft: 'auto', padding: '2px 6px' }}>✕</button>
                </div>
                <input
                  className="quick-search-input"
                  placeholder="Search plants..."
                  value={quickSearch}
                  onChange={e => setQuickSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && quickResults.length) quickAddCrop(quickResults[0]) }}
                  autoFocus
                />
                <div className="quick-results">
                  {quickSearch.trim() === '' && savedCrops.slice(0, 6).map(crop => {
                    const cat = getCropCat(crop)
                    return (
                      <button key={crop} className="quick-result-item" onClick={() => quickAddCrop(crop)}>
                        <span>{cat.emoji}</span> {crop}
                      </button>
                    )
                  })}
                  {quickResults.map(crop => {
                    const cat = getCropCat(crop)
                    const isSaved = savedCrops.includes(crop)
                    return (
                      <button key={crop} className="quick-result-item" onClick={() => quickAddCrop(crop)}>
                        <span>{cat.emoji}</span> {crop}
                        {!isSaved && <span className="quick-result-custom">custom</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Paint palette */}
            <div className="panel-section">
              <div className="panel-section-label">Paint tool</div>
              <button
                className={`palette-eraser ${!selectedCrop ? 'active' : ''}`}
                onClick={() => setSelectedCrop(null)}
              >
                ✕ Eraser
              </button>

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
          </div>
        )}

        {/* ── Feature panel (when a feature is selected, no bed) ── */}
        {selectedFeature && !selectedBed && (
          <div className="layout-panel-col">
            <div className="panel-section">
              <div className="panel-bed-header">
                <div>
                  <span className="paint-title">
                    {{ tree: '🌳', bush: '🌿', compost: '♻', path: '🟫' }[selectedFeature.type] || ''}
                    {' '}{selectedFeature.name || selectedFeature.type}
                  </span>
                  <span className="paint-subtitle">
                    {selectedFeature.width_ft} × {selectedFeature.length_ft} ft
                  </span>
                </div>
                <div className="panel-bed-actions">
                  <button className="btn-ghost btn-sm btn-danger" onClick={() => deleteFeature(selectedFeature.id)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
            <div className="panel-section">
              <div className="panel-section-label">Position &amp; size</div>
              <p className="feature-hint">Drag on the canvas to move. Drag the corner handle to resize.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
