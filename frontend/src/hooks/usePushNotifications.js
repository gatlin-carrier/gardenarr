import { useState, useEffect } from 'react'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export function usePushNotifications() {
  // 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'
  const [status, setStatus] = useState('unsubscribed')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported')
      return
    }
    if (Notification.permission === 'denied') { setStatus('denied'); return }

    // Check if already subscribed
    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription()
    ).then(sub => {
      setStatus(sub ? 'subscribed' : 'unsubscribed')
    }).catch(() => {})
  }, [])

  async function subscribe() {
    setLoading(true)
    try {
      const { publicKey } = await fetch('/api/push/public-key').then(r => r.json())
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sub),
      })
      setStatus('subscribed')
    } catch (e) {
      if (Notification.permission === 'denied') setStatus('denied')
      console.error('Push subscribe failed:', e)
    } finally {
      setLoading(false)
    }
  }

  async function unsubscribe() {
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setStatus('unsubscribed')
    } catch (e) {
      console.error('Push unsubscribe failed:', e)
    } finally {
      setLoading(false)
    }
  }

  async function toggle() {
    if (status === 'subscribed') await unsubscribe()
    else await subscribe()
  }

  return { status, loading, toggle }
}
