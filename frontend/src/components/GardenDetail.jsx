import { useState, useEffect } from 'react'
import CropScheduler from './CropScheduler.jsx'
import PlantingList from './PlantingList.jsx'
import CompanionPlanner from './CompanionPlanner.jsx'
import GardenLayout from './GardenLayout.jsx'
import './GardenDetail.css'

export default function GardenDetail({ garden }) {
  const [plantings, setPlantings] = useState([])
  const [activeTab, setActiveTab] = useState('saved')

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

      {activeTab === 'schedule' && (
        <CropScheduler garden={garden} onSave={savePlantings} />
      )}

      {activeTab === 'companion' && (
        <CompanionPlanner gardenId={garden.id} savedPlantings={plantings} />
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
