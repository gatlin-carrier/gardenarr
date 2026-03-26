import { useState, useEffect } from 'react'
import GardenList from './components/GardenList.jsx'
import GardenDetail from './components/GardenDetail.jsx'
import './App.css'

export default function App() {
  const [gardens, setGardens] = useState([])
  const [activeGarden, setActiveGarden] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchGardens() }, [])

  async function fetchGardens() {
    try {
      const res = await fetch('/api/gardens')
      const data = await res.json()
      setGardens(data)
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  async function createGarden(name, zone, zipcode) {
    const res = await fetch('/api/gardens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, zone, zipcode })
    })
    const garden = await res.json()
    setGardens(prev => [garden, ...prev])
    setActiveGarden(garden)
  }

  async function deleteGarden(id) {
    await fetch(`/api/gardens/${id}`, { method: 'DELETE' })
    setGardens(prev => prev.filter(g => g.id !== id))
    if (activeGarden?.id === id) setActiveGarden(null)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontSize: '18px' }}>Loading your gardens...</div>
    </div>
  )

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo">Gardenarr</h1>
          <p className="logo-sub">AI-powered sowing schedules</p>
        </div>
        <GardenList
          gardens={gardens}
          activeGarden={activeGarden}
          onSelect={setActiveGarden}
          onCreate={createGarden}
          onDelete={deleteGarden}
        />
      </aside>
      <main className="main-content">
        {activeGarden ? (
          <GardenDetail garden={activeGarden} />
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🌱</div>
            <h2>Select or create a garden</h2>
            <p>Add a garden in the sidebar to get started with your planting schedule.</p>
          </div>
        )}
      </main>
    </div>
  )
}
