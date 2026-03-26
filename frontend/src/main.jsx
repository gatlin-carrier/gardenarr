import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import './index.css'

// Register the service worker. With registerType:'prompt' this gives us
// a callback to call when we want to apply a pending update.
const updateSW = registerSW({
  onNeedRefresh() {
    // Dispatch a custom event that App.jsx can listen to
    window.dispatchEvent(new CustomEvent('pwa-update-available', { detail: { updateSW } }))
  },
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent('pwa-offline-ready'))
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
