import { useState, useEffect } from 'react'
import './Settings.css'

const PROVIDERS = [
  { value: 'anthropic', label: 'Claude (Anthropic)' },
  { value: 'openai',    label: 'OpenAI (ChatGPT)' },
  { value: 'google',    label: 'Gemini (Google)' },
  { value: 'ollama',    label: 'Ollama (local)' },
]

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  google: 'gemini-1.5-pro',
  ollama: 'llama3.2',
}

const KEY_LABELS = {
  anthropic: 'Anthropic API key',
  openai: 'OpenAI API key',
  google: 'Google AI API key',
  ollama: null,
}

export default function Settings({ onClose }) {
  const [provider, setProvider] = useState('anthropic')
  const [model, setModel] = useState('')
  const [newApiKey, setNewApiKey] = useState('')
  const [apiKeyHint, setApiKeyHint] = useState(null)
  const [ollamaUrl, setOllamaUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        setProvider(data.provider || 'anthropic')
        setModel(data.model || '')
        setApiKeyHint(data.api_key_hint || null)
        setOllamaUrl(data.ollama_base_url || '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const body = { provider, model: model.trim(), ollama_base_url: ollamaUrl.trim() }
      if (newApiKey.trim()) body.api_key = newApiKey.trim()
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Save failed')
      // Refresh hint
      const updated = await fetch('/api/settings').then(r => r.json())
      setApiKeyHint(updated.api_key_hint || null)
      setNewApiKey('')
      setSaved(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const keyLabel = KEY_LABELS[provider]

  return (
    <div className="settings-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal">
        <div className="settings-header">
          <h2>LLM settings</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="settings-loading">Loading…</div>
        ) : (
          <div className="settings-body">
            <div className="settings-field">
              <label>Provider</label>
              <select value={provider} onChange={e => { setProvider(e.target.value); setModel(''); setNewApiKey('') }}>
                {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            <div className="settings-field">
              <label>Model</label>
              <input
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder={DEFAULT_MODELS[provider]}
              />
              <span className="settings-hint">Leave blank to use the default above.</span>
            </div>

            {keyLabel && (
              <div className="settings-field">
                <label>{keyLabel}</label>
                <input
                  type="password"
                  value={newApiKey}
                  onChange={e => setNewApiKey(e.target.value)}
                  placeholder={apiKeyHint ? `Current: ${apiKeyHint} — paste to replace` : 'Paste API key…'}
                  autoComplete="off"
                />
                <span className="settings-hint">
                  Keys are stored server-side only and never sent back to the browser.
                  {!apiKeyHint && ` Falls back to the ${provider.toUpperCase()}_API_KEY environment variable if left blank.`}
                </span>
              </div>
            )}

            {provider === 'ollama' && (
              <div className="settings-field">
                <label>Ollama base URL</label>
                <input
                  value={ollamaUrl}
                  onChange={e => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                />
              </div>
            )}

            {error && <div className="settings-error">{error}</div>}

            <div className="settings-actions">
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : saved ? 'Saved!' : 'Save settings'}
              </button>
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
