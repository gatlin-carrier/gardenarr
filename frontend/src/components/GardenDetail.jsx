import { useState, useEffect } from 'react'
import CropScheduler from './CropScheduler.jsx'
import PlantingList from './PlantingList.jsx'
import CompanionPlanner from './CompanionPlanner.jsx'
import './GardenDetail.css'

export default function GardenDetail({ garden }) {
  const [plantings, setPlantings] = useState([])
  const [activeTab, setActiveTab] = useState('schedule')

  useEffect(() => { fetchPlantings() }, [garden.id])

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

  async function deletePlanting(id) {
    await fetch(`/api/plantings/${id}`, { method: 'DELETE' })
    setPlantings(prev => prev.filter(p => p.id !== id))
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
        <button className={`tab ${activeTab === 'schedule' ? 'active' : ''}`} onClick={() => setActiveTab('schedule')}>
          Generate schedule
        </button>
        <button className={`tab ${activeTab === 'companion' ? 'active' : ''}`} onClick={() => setActiveTab('companion')}>
          Companion planting
        </button>
        <button className={`tab ${activeTab === 'saved' ? 'active' : ''}`} onClick={() => setActiveTab('saved')}>
          Saved plantings {plantings.length > 0 && <span className="tab-count">{plantings.length}</span>}
        </button>
      </div>

      {activeTab === 'schedule' && (
        <CropScheduler garden={garden} onSave={savePlantings} />
      )}

      {activeTab === 'companion' && (
        <CompanionPlanner />
      )}

      {activeTab === 'saved' && (
        <PlantingList plantings={plantings} onDelete={deletePlanting} />
      )}
    </div>
  )
}
