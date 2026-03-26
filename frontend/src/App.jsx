import { useState, useEffect, useRef } from 'react'
import GardenList from './components/GardenList.jsx'
import GardenDetail from './components/GardenDetail.jsx'
import Settings from './components/Settings.jsx'
import { usePushNotifications } from './hooks/usePushNotifications.js'
import './App.css'

export default function App() {
  const [gardens, setGardens] = useState([])
  const [activeGarden, setActiveGarden] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const { status: pushStatus, loading: pushLoading, toggle: togglePush } = usePushNotifications()

  // PWA: install prompt
  const [installPrompt, setInstallPrompt] = useState(null)
  // PWA: update available
  const [updateReady, setUpdateReady] = useState(false)
  const updateSWRef = useRef(null)
  // PWA: offline ready toast
  const [offlineReady, setOfflineReady] = useState(false)

  useEffect(() => {
    fetchGardens()

    // Native install prompt (Android/desktop Chrome)
    const onBeforeInstall = (e) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // SW update available
    const onUpdate = (e) => { updateSWRef.current = e.detail.updateSW; setUpdateReady(true) }
    window.addEventListener('pwa-update-available', onUpdate)

    // SW offline ready
    const onOffline = () => { setOfflineReady(true); setTimeout(() => setOfflineReady(false), 4000) }
    window.addEventListener('pwa-offline-ready', onOffline)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('pwa-update-available', onUpdate)
      window.removeEventListener('pwa-offline-ready', onOffline)
    }
  }, [])

  async function triggerInstall() {
    if (!installPrompt) return
    installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  async function applyUpdate() {
    setUpdateReady(false)
    await updateSWRef.current?.(true)
  }

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
    <>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {/* PWA: update available */}
      {updateReady && (
        <div className="pwa-banner pwa-update">
          <span>A new version is available.</span>
          <button className="pwa-banner-btn" onClick={applyUpdate}>Update now</button>
          <button className="pwa-banner-dismiss" onClick={() => setUpdateReady(false)}>✕</button>
        </div>
      )}

      {/* PWA: offline ready toast */}
      {offlineReady && (
        <div className="pwa-toast">App ready to work offline</div>
      )}

      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-header-top">
              <h1 className="logo">Gardenarr</h1>
              <div style={{ display: 'flex', gap: 4 }}>
                {installPrompt && (
                  <button className="settings-btn" onClick={triggerInstall} title="Install app">⬇</button>
                )}
                {pushStatus !== 'unsupported' && (
                  <button
                    className={`settings-btn ${pushStatus === 'subscribed' ? 'settings-btn--active' : ''}`}
                    onClick={togglePush}
                    disabled={pushLoading || pushStatus === 'denied'}
                    title={
                      pushStatus === 'subscribed' ? 'Disable reminders' :
                      pushStatus === 'denied'     ? 'Notifications blocked in browser' :
                                                    'Enable weekly reminders'
                    }
                  >🔔</button>
                )}
                <button className="settings-btn" onClick={() => setShowSettings(true)} title="LLM settings">⚙</button>
              </div>
            </div>
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
    </>
  )
}
