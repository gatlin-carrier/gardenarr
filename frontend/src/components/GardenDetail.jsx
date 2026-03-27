import { useState, useEffect, useRef } from 'react'
import CropScheduler from './CropScheduler.jsx'
import PlantingList from './PlantingList.jsx'
import CompanionPlanner from './CompanionPlanner.jsx'
import GardenLayout from './GardenLayout.jsx'
import './GardenDetail.css'

const ALL_CROPS = [
  'Tomatoes','Peppers','Cucumbers','Zucchini','Squash','Eggplant','Broccoli','Cauliflower','Cabbage',
  'Lettuce','Spinach','Kale','Swiss Chard','Arugula','Bok Choy','Collards',
  'Carrots','Beets','Radishes','Turnips','Onions','Garlic','Leeks',
  'Beans','Peas','Edamame','Snap Peas',
  'Basil','Cilantro','Parsley','Dill','Thyme','Rosemary','Sage','Mint','Marigolds',
  'Corn','Pumpkins','Watermelon','Potatoes','Sunflowers','Nasturtiums'
]

export default function GardenDetail({ garden }) {
  const [plantings, setPlantings] = useState([])
  const [activeTab, setActiveTab] = useState('saved')

  // Companion analysis state — lifted here so it survives tab switches
  const [companionLoading, setCompanionLoading] = useState(false)
  const [companionResult, setCompanionResult] = useState(null)
  const [companionError, setCompanionError] = useState('')
  const [companionSelected, setCompanionSelected] = useState(new Set())
  const [companionCachedInfo, setCompanionCachedInfo] = useState(null)
  const companionAbortRef = useRef(null)

  useEffect(() => { fetchPlantings() }, [garden.id])

  // Load cached companion data whenever garden changes
  useEffect(() => {
    setCompanionResult(null)
    setCompanionCachedInfo(null)
    setCompanionSelected(new Set())
    fetch(`/api/gardens/${garden.id}/companion`)
      .then(r => r.json())
      .then(data => {
        if (data && data.pairs) {
          setCompanionResult(data)
          setCompanionCachedInfo(data.cached_at ? `Cached ${new Date(data.cached_at + 'Z').toLocaleDateString()}` : 'Cached')
          if (data.crop_key) {
            const crops = data.crop_key.split('||').map(c => c.trim())
            const allNames = [...ALL_CROPS]
            const nameMap = {}
            for (const n of allNames) nameMap[n.toLowerCase()] = n
            setCompanionSelected(new Set(crops.map(c => nameMap[c] || c)))
          }
        }
      })
      .catch(() => {})
  }, [garden.id])

  // Pre-populate companion selection from saved plantings
  useEffect(() => {
    if (!plantings.length) return
    setCompanionSelected(prev => {
      const next = new Set(prev)
      for (const p of plantings) next.add(p.crop)
      return next
    })
  }, [plantings])

  async function fetchPlantings() {
    const res = await fetch(`/api/gardens/${garden.id}/plantings`)
    const data = await res.json()
    setPlantings(data)
  }

  async function savePlantings(crops) {
    for (const crop of crops) {
      await fetch(`/api/gardens/${garden.id}/plantings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(crop)
      })
    }
    fetchPlantings()
  }

  async function updatePlanting(id, data) {
    await fetch(`/api/plantings/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data)
    })
    setPlantings(prev => prev.map(p => p.id === id ? { ...p, ...data } : p))
  }

  async function addPlanting(data) {
    const res = await fetch(`/api/gardens/${garden.id}/plantings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data)
    })
    const { id } = await res.json()
    setPlantings(prev => [{ id, garden_id: garden.id, ...data, created_at: new Date().toISOString(),
      status_planted: 0, status_transplanted: 0, status_harvested: 0, status_skipped: 0 }, ...prev])
  }

  async function deletePlanting(id) {
    await fetch(`/api/plantings/${id}`, { method: 'DELETE' })
    setPlantings(prev => prev.filter(p => p.id !== id))
  }

  async function analyzeCompanion(cropList) {
    if (companionAbortRef.current) companionAbortRef.current.abort()
    const controller = new AbortController()
    companionAbortRef.current = controller

    setCompanionLoading(true)
    setCompanionError('')
    setCompanionResult(null)
    setCompanionCachedInfo(null)

    try {
      const res = await fetch('/api/companion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ crops: cropList }),
        signal: controller.signal
      })
      const data = await res.json()
      if (data.error) { setCompanionError(data.error); return }
      setCompanionResult(data)
      fetch(`/api/gardens/${garden.id}/companion`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ crops: cropList, result: data })
      }).catch(() => {})
    } catch (e) {
      if (e.name === 'AbortError') return
      setCompanionError('Failed to analyze. Is the backend running?')
    } finally {
      setCompanionLoading(false)
      companionAbortRef.current = null
    }
  }

  function cancelCompanion() {
    if (companionAbortRef.current) {
      companionAbortRef.current.abort()
      companionAbortRef.current = null
    }
    setCompanionLoading(false)
  }

  function toggleCompanionCrop(crop) {
    setCompanionSelected(prev => {
      const next = new Set(prev)
      next.has(crop) ? next.delete(crop) : next.add(crop)
      return next
    })
    setCompanionResult(null)
    setCompanionCachedInfo(null)
  }

  const location = garden.zone || (garden.zipcode ? `zip ${garden.zipcode}` : 'No zone set')

  return (
    <div className="garden-detail">
      <div className="garden-detail-header">
        <div>
          <h2 className="garden-title">{garden.name}</h2>
          <span className="garden-zone-badge">{location}</span>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'saved' ? 'active' : ''}`} onClick={() => setActiveTab('saved')}>
          Plantings {plantings.length > 0 && <span className="tab-count">{plantings.length}</span>}
        </button>
        <button className={`tab ${activeTab === 'companion' ? 'active' : ''}`} onClick={() => setActiveTab('companion')}>
          Companions
          {companionLoading && <span className="tab-analyzing-dot" title="Analysis in progress" />}
        </button>
        <button className={`tab ${activeTab === 'layout' ? 'active' : ''}`} onClick={() => setActiveTab('layout')}>
          Bed layout
        </button>
        <div className="tab-spacer" />
        <button
          className={`tab tab-new-schedule ${activeTab === 'schedule' ? 'active' : ''}`}
          onClick={() => setActiveTab('schedule')}
          title="Generate a new planting schedule"
        >
          + New schedule
        </button>
      </div>

      {/* Sticky banner shown when analysis is running on another tab */}
      {companionLoading && activeTab !== 'companion' && (
        <div className="companion-progress-banner">
          <span className="companion-banner-spinner" />
          <span>Analyzing companion relationships…</span>
          <button className="companion-banner-btn" onClick={() => setActiveTab('companion')}>View progress</button>
          <button className="companion-banner-cancel" onClick={cancelCompanion}>Cancel</button>
        </div>
      )}

      {activeTab === 'schedule' && (
        <CropScheduler garden={garden} onSave={savePlantings} />
      )}

      {activeTab === 'companion' && (
        <CompanionPlanner
          gardenId={garden.id}
          savedPlantings={plantings}
          loading={companionLoading}
          result={companionResult}
          error={companionError}
          selected={companionSelected}
          cachedInfo={companionCachedInfo}
          onToggleCrop={toggleCompanionCrop}
          onAddCustom={crop => setCompanionSelected(prev => new Set([...prev, crop]))}
          onAnalyze={analyzeCompanion}
          onCancel={cancelCompanion}
        />
      )}

      {activeTab === 'layout' && (
        <GardenLayout garden={garden} plantings={plantings} />
      )}

      {activeTab === 'saved' && (
        <PlantingList plantings={plantings} onUpdate={updatePlanting} onDelete={deletePlanting} onAdd={addPlanting} />
      )}
    </div>
  )
}
