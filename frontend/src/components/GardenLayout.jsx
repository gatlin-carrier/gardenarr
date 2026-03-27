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
          return (
            <div
              key={`${row}-${col}`}
              className={`bed-cell ${crop ? 'occupied' : 'empty'}${isSelected ? ' cell-selected' : ''}`}
              style={color ? { background: color, borderColor: color } : {}}
              title={crop || (selectedCrop ? `Place ${selectedCrop}` : 'Click to select')}
              onMouseDown={() => handleClick(row, col)}
              onMouseEnter={() => { if (painting.current) applyCell(row, col) }}
              onTouchStart={e => { e.preventDefault(); handleClick(row, col) }}
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
  // Fence & feature state
  const [activeTool, setActiveTool]               = useState('select')
  const [fences, setFences]                       = useState([])
  const [features, setFeatures]                   = useState([])
  const [drawingFence, setDrawingFence]           = useState([]) // points being drawn
  const [selectedFenceId, setSelectedFenceId]     = useState(null)
  const [selectedFeatureId, setSelectedFeatureId] = useState(null)
  const [fenceGuidance, setFenceGuidance]         = useState(null)
  const [fenceGuidanceLoading, setFenceGuidanceLoading] = useState(false)
  const [fenceGuidanceError, setFenceGuidanceError]     = useState('')

  const loadedBeds  = useRef(new Set())
  const svgRef      = useRef(null)
  const drag        = useRef({ active: false, bedId: null, ox: 0, oy: 0 })
  const featureDrag = useRef({ active: false, featureId: null, ox: 0, oy: 0 })
  const bgInputRef  = useRef(null)

  const W = garden.layout_width_ft  || 20
  const L = garden.layout_length_ft || 20
  const MARGIN = 1
  const selectedBed = beds.find(b => b.id === selectedBedId) || null
  const selectedFence = fences.find(f => f.id === selectedFenceId) || null
  const selectedFeature = features.find(f => f.id === selectedFeatureId) || null
  const activeLayout = layouts[selectedBedId] || {}
  const savedCrops = [...new Set(plantings.map(p => p.crop))]
  const placedCrops = [...new Set(Object.values(activeLayout))]

  // ── data loading ──────────────────────────────────────────────────────────

  useEffect(() => { loadBeds(); loadFences(); loadFeatures() }, [garden.id])

  async function loadBeds() {
    const data = await fetch(`/api/gardens/${garden.id}/beds`).then(r => r.json())
    setBeds(data)
    if (data.length) {
      setSelectedBedId(data[0].id)
      await loadLayout(data[0].id)
    }
  }

  async function loadFences() {
    const data = await fetch(`/api/gardens/${garden.id}/fences`).then(r => r.json())
    setFences(data)
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

  // ── fence drawing ────────────────────────────────────────────────────────

  function onCanvasClick(e) {
    if (activeTool === 'select') return
    const p = getCanvasPoint(svgRef.current, e)
    const x = Math.round(p.x * 2) / 2
    const y = Math.round(p.y * 2) / 2
    if (x < 0 || y < 0 || x > W || y > L) return

    if (activeTool === 'fence') {
      setDrawingFence(prev => [...prev, { x, y }])
      return
    }

    // Placement tools
    const typeMap = { tree: 'tree', bush: 'bush', compost: 'compost', path: 'path' }
    const type = typeMap[activeTool]
    if (type) {
      const defaults = {
        tree: { width_ft: 3, length_ft: 3, name: 'Tree' },
        bush: { width_ft: 2, length_ft: 2, name: 'Bush' },
        compost: { width_ft: 3, length_ft: 3, name: 'Compost' },
        path: { width_ft: 2, length_ft: 4, name: 'Path' },
      }[type]
      placeFeature(type, x, y, defaults)
    }
  }

  async function placeFeature(type, x, y, defaults) {
    const body = { type, name: defaults.name, x_ft: x, y_ft: y, width_ft: defaults.width_ft, length_ft: defaults.length_ft }
    const res = await fetch(`/api/gardens/${garden.id}/features`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json())
    const feat = { id: res.id, garden_id: garden.id, ...body, metadata: {} }
    setFeatures(prev => [...prev, feat])
    setSelectedFeatureId(res.id)
    setSelectedBedId(null)
    setSelectedFenceId(null)
    setActiveTool('select')
  }

  async function finishFence(close) {
    const pts = close && drawingFence.length >= 3
      ? [...drawingFence, drawingFence[0]]
      : drawingFence
    if (pts.length < 2) { setDrawingFence([]); return }
    const body = { name: `Fence ${fences.length + 1}`, fence_type: 'wood', points: pts, post_spacing_ft: 8, closed: close }
    const res = await fetch(`/api/gardens/${garden.id}/fences`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json())
    setFences(prev => [...prev, { id: res.id, garden_id: garden.id, ...body }])
    setDrawingFence([])
    setSelectedFenceId(res.id)
    setSelectedBedId(null)
    setSelectedFeatureId(null)
    setActiveTool('select')
  }

  function cancelFenceDrawing() {
    setDrawingFence([])
    if (activeTool === 'fence') setActiveTool('select')
  }

  async function updateFence(id, data) {
    await fetch(`/api/fences/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })
    setFences(prev => prev.map(f => f.id === id ? { ...f, ...data } : f))
  }

  async function deleteFence(id) {
    if (!confirm('Delete this fence?')) return
    await fetch(`/api/fences/${id}`, { method: 'DELETE' })
    setFences(prev => prev.filter(f => f.id !== id))
    setSelectedFenceId(null)
  }

  async function updateFeature(id, data) {
    await fetch(`/api/features/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })
    setFeatures(prev => prev.map(f => f.id === id ? { ...f, ...data } : f))
  }

  async function deleteFeature(id) {
    if (!confirm('Delete this feature?')) return
    await fetch(`/api/features/${id}`, { method: 'DELETE' })
    setFeatures(prev => prev.filter(f => f.id !== id))
    setSelectedFeatureId(null)
  }

  // Fence squaring: snap each interior angle to nearest 90 degrees
  function squareFence(fence) {
    const pts = [...fence.points]
    if (pts.length < 3) return
    // Simple approach: snap each point to align with axis of previous segment
    const squared = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      const prev = squared[i - 1]
      const curr = pts[i]
      const dx = Math.abs(curr.x - prev.x)
      const dy = Math.abs(curr.y - prev.y)
      // Snap to horizontal or vertical
      if (dx > dy) {
        squared.push({ x: curr.x, y: prev.y })
      } else {
        squared.push({ x: prev.x, y: curr.y })
      }
    }
    updateFence(fence.id, { points: squared })
  }

  // Fence total length & post count
  function fenceMetrics(fence) {
    const pts = fence.points || []
    let totalLen = 0
    for (let i = 1; i < pts.length; i++) {
      totalLen += Math.sqrt((pts[i].x - pts[i-1].x) ** 2 + (pts[i].y - pts[i-1].y) ** 2)
    }
    const spacing = fence.post_spacing_ft || 8
    const postCount = Math.max(2, Math.floor(totalLen / spacing) + 1)
    return { totalLen: Math.round(totalLen * 10) / 10, postCount, spacing }
  }

  // AI fence guidance
  async function fetchFenceGuidance() {
    setFenceGuidanceLoading(true)
    setFenceGuidanceError('')
    try {
      const res = await fetch(`/api/gardens/${garden.id}/fence-guidance`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setFenceGuidance(data)
    } catch (e) {
      setFenceGuidanceError(e.message)
    } finally {
      setFenceGuidanceLoading(false)
    }
  }

  // Feature dragging
  function onFeaturePointerDown(e, feat) {
    e.preventDefault()
    e.stopPropagation()
    setSelectedFeatureId(feat.id)
    setSelectedBedId(null)
    setSelectedFenceId(null)
    const p = getCanvasPoint(svgRef.current, e)
    featureDrag.current = { active: true, featureId: feat.id, ox: p.x - (feat.x_ft || 0), oy: p.y - (feat.y_ft || 0) }
  }

  function onSvgMouseMoveExt(e) {
    onSvgMouseMove(e)
    if (!featureDrag.current.active) return
    const p = getCanvasPoint(svgRef.current, e)
    const feat = features.find(f => f.id === featureDrag.current.featureId)
    if (!feat) return
    const nx = Math.max(0, Math.min(W - (feat.width_ft || 2), p.x - featureDrag.current.ox))
    const ny = Math.max(0, Math.min(L - (feat.length_ft || 2), p.y - featureDrag.current.oy))
    const rx = Math.round(nx * 2) / 2
    const ry = Math.round(ny * 2) / 2
    setFeatures(prev => prev.map(f => f.id === featureDrag.current.featureId ? { ...f, x_ft: rx, y_ft: ry } : f))
  }

  function onSvgMouseUpExt() {
    onSvgMouseUp()
    if (!featureDrag.current.active) return
    featureDrag.current.active = false
    const feat = features.find(f => f.id === featureDrag.current.featureId)
    if (feat) {
      fetch(`/api/features/${feat.id}/position`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x_ft: feat.x_ft || 0, y_ft: feat.y_ft || 0 }),
      }).catch(console.error)
    }
  }

  // ESC key handler for fence drawing
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') cancelFenceDrawing()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTool])

  function selectItem(type, id) {
    setSelectedBedId(type === 'bed' ? id : null)
    setSelectedFenceId(type === 'fence' ? id : null)
    setSelectedFeatureId(type === 'feature' ? id : null)
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
        </div>
      </div>

      {/* ── Tool selector ── */}
      <div className="tool-selector">
        {[
          { id: 'select', label: 'Select', icon: '↖' },
          { id: 'fence',  label: 'Fence',  icon: '⊞' },
          { id: 'path',   label: 'Path',   icon: '━' },
          { id: 'tree',   label: 'Tree',   icon: '🌳' },
          { id: 'bush',   label: 'Bush',   icon: '🌿' },
          { id: 'compost',label: 'Compost', icon: '♻' },
        ].map(tool => (
          <button
            key={tool.id}
            className={`tool-btn ${activeTool === tool.id ? 'active' : ''}`}
            onClick={() => { setActiveTool(tool.id); if (tool.id !== 'fence') setDrawingFence([]) }}
            title={tool.label}
          >
            <span className="tool-icon">{tool.icon}</span>
            <span className="tool-label">{tool.label}</span>
          </button>
        ))}
        {drawingFence.length >= 2 && (
          <>
            <div className="tool-divider" />
            <button className="btn-ghost btn-sm" onClick={() => finishFence(false)}>Finish fence</button>
            {drawingFence.length >= 3 && (
              <button className="btn-ghost btn-sm" onClick={() => finishFence(true)}>Close loop</button>
            )}
            <button className="btn-ghost btn-sm" onClick={cancelFenceDrawing}>Cancel</button>
            <span className="tool-hint">{drawingFence.length} posts placed</span>
          </>
        )}
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
                className={`garden-svg${activeTool !== 'select' ? ' tool-active' : ''}`}
                viewBox={`${-MARGIN} ${-MARGIN} ${W + MARGIN * 2} ${L + MARGIN * 2}`}
                onMouseMove={onSvgMouseMoveExt}
                onMouseUp={onSvgMouseUpExt}
                onMouseLeave={onSvgMouseUpExt}
                onClick={onCanvasClick}
              >
                {bgUrl && (
                  <image href={bgUrl} x={0} y={0} width={W} height={L}
                    preserveAspectRatio="xMidYMid slice" className="svg-bg-image" />
                )}
                <rect x={0} y={0} width={W} height={L} className="garden-boundary" />
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

                {/* ── Paths (render first so they're behind beds) ── */}
                {features.filter(f => f.type === 'path').map(feat => (
                  <g key={`feat-${feat.id}`}
                    className={`feature-group feature-path${feat.id === selectedFeatureId ? ' feature-selected' : ''}`}
                    transform={`translate(${feat.x_ft || 0},${feat.y_ft || 0})`}
                    onMouseDown={e => { if (activeTool === 'select') onFeaturePointerDown(e, feat) }}
                    onClick={e => { e.stopPropagation(); selectItem('feature', feat.id) }}
                    style={{ cursor: activeTool === 'select' ? 'grab' : undefined }}
                  >
                    <rect width={feat.width_ft || 2} height={feat.length_ft || 4} className="path-rect" rx={0.08} />
                    <text x={(feat.width_ft || 2) / 2} y={(feat.length_ft || 4) / 2} className="feature-label" textAnchor="middle" dominantBaseline="middle">
                      {feat.name || 'Path'}
                    </text>
                  </g>
                ))}

                {/* ── Fences ── */}
                {fences.map(fence => {
                  const pts = fence.points || []
                  if (pts.length < 2) return null
                  const pathStr = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
                  const isSel = fence.id === selectedFenceId
                  const spacing = fence.post_spacing_ft || 8
                  // Calculate intermediate post positions
                  const posts = []
                  for (let i = 0; i < pts.length; i++) posts.push(pts[i])
                  // Add intermediate posts along each segment
                  const intermediatePosts = []
                  for (let i = 1; i < pts.length; i++) {
                    const a = pts[i - 1], b = pts[i]
                    const segLen = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
                    const count = Math.floor(segLen / spacing)
                    for (let j = 1; j <= count; j++) {
                      const t = (j * spacing) / segLen
                      if (t < 1) intermediatePosts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
                    }
                  }
                  return (
                    <g key={`fence-${fence.id}`}
                      className={`fence-group${isSel ? ' fence-selected' : ''}`}
                      onClick={e => { e.stopPropagation(); selectItem('fence', fence.id) }}
                      style={{ cursor: 'pointer' }}
                    >
                      <path d={pathStr} className="fence-line" />
                      {posts.map((p, i) => (
                        <circle key={`fp-${i}`} cx={p.x} cy={p.y} r={0.2} className="fence-post" />
                      ))}
                      {intermediatePosts.map((p, i) => (
                        <circle key={`fip-${i}`} cx={p.x} cy={p.y} r={0.12} className="fence-post-minor" />
                      ))}
                      {isSel && pts.length >= 2 && (() => {
                        const mid = pts[Math.floor(pts.length / 2)]
                        const m = fenceMetrics(fence)
                        return <text x={mid.x} y={mid.y - 0.5} className="fence-measure" textAnchor="middle">{m.totalLen}ft</text>
                      })()}
                    </g>
                  )
                })}

                {/* ── Drawing fence preview ── */}
                {drawingFence.length > 0 && (
                  <g className="fence-drawing">
                    {drawingFence.length >= 2 && (
                      <path
                        d={drawingFence.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')}
                        className="fence-line-preview"
                      />
                    )}
                    {drawingFence.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={0.2} className="fence-post-preview" />
                    ))}
                  </g>
                )}

                {/* ── Beds ── */}
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
                      onMouseDown={e => { if (activeTool === 'select') onBedPointerDown(e, bed) }}
                      onClick={e => { e.stopPropagation(); selectItem('bed', bed.id) }}
                      style={{ cursor: activeTool === 'select' ? 'grab' : undefined }}
                    >
                      <rect width={bw} height={bl} className="bed-rect" rx={0.12} />
                      <text x={bw / 2} y={bl / 2 - 0.15} className="bed-label" textAnchor="middle" dominantBaseline="middle">
                        {bed.name}
                      </text>
                      <BedSwatches bedId={bed.id} layout={bedLayout} bw={bw} bl={bl} />
                    </g>
                  )
                })}

                {/* ── Trees & Bushes ── */}
                {features.filter(f => f.type === 'tree' || f.type === 'bush').map(feat => {
                  const r = (feat.width_ft || 2) / 2
                  const cx = (feat.x_ft || 0) + r
                  const cy = (feat.y_ft || 0) + r
                  return (
                    <g key={`feat-${feat.id}`}
                      className={`feature-group feature-${feat.type}${feat.id === selectedFeatureId ? ' feature-selected' : ''}`}
                      onMouseDown={e => { if (activeTool === 'select') onFeaturePointerDown(e, feat) }}
                      onClick={e => { e.stopPropagation(); selectItem('feature', feat.id) }}
                      style={{ cursor: activeTool === 'select' ? 'grab' : undefined }}
                    >
                      <circle cx={cx} cy={cy} r={r} className={`feature-circle feature-circle-${feat.type}`} />
                      <text x={cx} y={cy} className="feature-label" textAnchor="middle" dominantBaseline="middle">
                        {feat.name || feat.type}
                      </text>
                    </g>
                  )
                })}

                {/* ── Compost areas ── */}
                {features.filter(f => f.type === 'compost').map(feat => (
                  <g key={`feat-${feat.id}`}
                    className={`feature-group feature-compost${feat.id === selectedFeatureId ? ' feature-selected' : ''}`}
                    transform={`translate(${feat.x_ft || 0},${feat.y_ft || 0})`}
                    onMouseDown={e => { if (activeTool === 'select') onFeaturePointerDown(e, feat) }}
                    onClick={e => { e.stopPropagation(); selectItem('feature', feat.id) }}
                    style={{ cursor: activeTool === 'select' ? 'grab' : undefined }}
                  >
                    <rect width={feat.width_ft || 3} height={feat.length_ft || 3} className="compost-rect" rx={0.12} />
                    <text x={(feat.width_ft || 3) / 2} y={(feat.length_ft || 3) / 2} className="feature-label" textAnchor="middle" dominantBaseline="middle">
                      {feat.name || 'Compost'}
                    </text>
                  </g>
                ))}
              </svg>
              <div className="canvas-hint">Drag beds to reposition · Click a bed to edit in the panel</div>
            </div>
          ) : null}
        </div>

        {/* ── Right: edit panel ── */}
        {(selectedBed || selectedFence || selectedFeature) && (
          <div className="layout-panel-col">

            {/* ═══ FENCE PANEL ═══ */}
            {selectedFence && (
              <>
                <div className="panel-section">
                  <div className="panel-bed-header">
                    <div>
                      <span className="paint-title">{selectedFence.name}</span>
                      <span className="paint-subtitle">{selectedFence.fence_type} fence</span>
                    </div>
                    <div className="panel-bed-actions">
                      <button className="btn-ghost btn-sm btn-danger" onClick={() => deleteFence(selectedFence.id)}>Delete</button>
                    </div>
                  </div>
                </div>

                <div className="panel-section">
                  <div className="panel-section-label">Fence properties</div>
                  <div className="fence-props-form">
                    <label className="fence-prop">
                      <span>Name</span>
                      <input value={selectedFence.name} onChange={e => updateFence(selectedFence.id, { ...selectedFence, name: e.target.value })} />
                    </label>
                    <label className="fence-prop">
                      <span>Type</span>
                      <select value={selectedFence.fence_type} onChange={e => updateFence(selectedFence.id, { ...selectedFence, fence_type: e.target.value })}>
                        <option value="wood">Wood</option>
                        <option value="wire">Wire/Mesh</option>
                        <option value="chain_link">Chain Link</option>
                        <option value="vinyl">Vinyl</option>
                        <option value="metal">Metal</option>
                        <option value="split_rail">Split Rail</option>
                      </select>
                    </label>
                    <label className="fence-prop">
                      <span>Post spacing (ft)</span>
                      <input type="number" min={2} max={20} step={0.5} value={selectedFence.post_spacing_ft || 8}
                        onChange={e => updateFence(selectedFence.id, { ...selectedFence, post_spacing_ft: Number(e.target.value) })} />
                    </label>
                  </div>
                </div>

                <div className="panel-section">
                  <div className="panel-section-label">Materials estimate</div>
                  {(() => {
                    const m = fenceMetrics(selectedFence)
                    return (
                      <div className="fence-materials">
                        <div className="fence-material-row"><span>Total length</span><strong>{m.totalLen} ft</strong></div>
                        <div className="fence-material-row"><span>Corner/end posts</span><strong>{(selectedFence.points || []).length}</strong></div>
                        <div className="fence-material-row"><span>Total posts ({m.spacing}ft spacing)</span><strong>{m.postCount}</strong></div>
                        <div className="fence-material-row"><span>Panels/sections</span><strong>{Math.max(0, m.postCount - 1)}</strong></div>
                      </div>
                    )
                  })()}
                </div>

                <div className="panel-section">
                  <div className="panel-section-label">Tools</div>
                  <button className="btn-ghost btn-sm" onClick={() => squareFence(selectedFence)}>
                    ⊾ Square corners
                  </button>
                </div>

                <div className="panel-section">
                  <div className="panel-section-label">AI fence guidance</div>
                  {!fenceGuidance && !fenceGuidanceLoading && (
                    <button className="btn-ghost btn-sm btn-ai" onClick={fetchFenceGuidance}>
                      ✨ Get soil & post depth guidance
                    </button>
                  )}
                  {fenceGuidanceLoading && <div className="fence-guidance-loading">Analyzing soil conditions...</div>}
                  {fenceGuidanceError && <div className="ai-error">{fenceGuidanceError}</div>}
                  {fenceGuidance && (
                    <div className="fence-guidance">
                      <div className="fence-guidance-row"><span>Region</span><strong>{fenceGuidance.region_name}</strong></div>
                      <div className="fence-guidance-row"><span>Soil type</span><strong>{fenceGuidance.soil_type}</strong></div>
                      {fenceGuidance.soil_notes && <div className="fence-guidance-note">{fenceGuidance.soil_notes}</div>}
                      <div className="fence-guidance-row"><span>Frost line</span><strong>{fenceGuidance.frost_line_depth_inches}" deep</strong></div>
                      <div className="fence-guidance-row"><span>Post hole depth</span><strong>{fenceGuidance.recommended_post_hole_depth_inches}"</strong></div>
                      <div className="fence-guidance-row"><span>Use concrete</span><strong>{fenceGuidance.use_concrete ? 'Yes' : 'No'}</strong></div>
                      {fenceGuidance.concrete_notes && <div className="fence-guidance-note">{fenceGuidance.concrete_notes}</div>}
                      <div className="fence-guidance-row"><span>Post diameter</span><strong>{fenceGuidance.post_diameter_inches}"</strong></div>
                      <div className="fence-guidance-row"><span>Best time to install</span><strong>{fenceGuidance.best_time_to_install}</strong></div>
                      {fenceGuidance.drainage_notes && <div className="fence-guidance-note">{fenceGuidance.drainage_notes}</div>}
                      {fenceGuidance.recommendations?.length > 0 && (
                        <>
                          <div className="panel-section-label" style={{ marginTop: 8 }}>Recommendations</div>
                          <ul className="fence-guidance-tips">
                            {fenceGuidance.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                          </ul>
                        </>
                      )}
                      <button className="btn-ghost btn-sm" onClick={() => { setFenceGuidance(null); fetchFenceGuidance() }} style={{ marginTop: 6 }}>
                        Refresh guidance
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ═══ FEATURE PANEL ═══ */}
            {selectedFeature && (
              <>
                <div className="panel-section">
                  <div className="panel-bed-header">
                    <div>
                      <span className="paint-title">{selectedFeature.name || selectedFeature.type}</span>
                      <span className="paint-subtitle">{selectedFeature.type} · {selectedFeature.width_ft} × {selectedFeature.length_ft} ft</span>
                    </div>
                    <div className="panel-bed-actions">
                      <button className="btn-ghost btn-sm btn-danger" onClick={() => deleteFeature(selectedFeature.id)}>Delete</button>
                    </div>
                  </div>
                </div>

                <div className="panel-section">
                  <div className="panel-section-label">Properties</div>
                  <div className="fence-props-form">
                    <label className="fence-prop">
                      <span>Name</span>
                      <input value={selectedFeature.name || ''} onChange={e => updateFeature(selectedFeature.id, { name: e.target.value })} />
                    </label>
                    {selectedFeature.type !== 'path' && (
                      <label className="fence-prop">
                        <span>Size (ft)</span>
                        <input type="number" min={1} max={30} step={0.5} value={selectedFeature.width_ft || 2}
                          onChange={e => {
                            const v = Number(e.target.value)
                            updateFeature(selectedFeature.id, { width_ft: v, length_ft: v })
                          }} />
                      </label>
                    )}
                    {selectedFeature.type === 'path' && (
                      <>
                        <label className="fence-prop">
                          <span>Width (ft)</span>
                          <input type="number" min={1} max={30} step={0.5} value={selectedFeature.width_ft || 2}
                            onChange={e => updateFeature(selectedFeature.id, { width_ft: Number(e.target.value) })} />
                        </label>
                        <label className="fence-prop">
                          <span>Length (ft)</span>
                          <input type="number" min={1} max={50} step={0.5} value={selectedFeature.length_ft || 4}
                            onChange={e => updateFeature(selectedFeature.id, { length_ft: Number(e.target.value) })} />
                        </label>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ═══ BED PANEL ═══ */}
            {selectedBed && <>
            {/* Bed selector tabs */}
            {beds.length > 1 && (
              <div className="panel-bed-tabs">
                {beds.map(b => (
                  <button
                    key={b.id}
                    className={`panel-bed-tab ${b.id === selectedBedId ? 'active' : ''}`}
                    onClick={() => selectItem('bed', b.id)}
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
            </>}
          </div>
        )}
      </div>
    </div>
  )
}
