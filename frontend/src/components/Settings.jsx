import { useState, useEffect } from 'react'
import './Settings.css'

const PROVIDERS = [
  { value: 'anthropic', label: 'Claude (Anthropic)' },
  { value: 'openai',    label: 'OpenAI (ChatGPT)' },
  { value: 'google',    label: 'Gemini (Google)' },
  { value: 'ollama',    label: 'Ollama (local)' },
  { value: 'lmstudio', label: 'LM Studio (local)' },
  { value: 'custom',   label: 'Custom (OpenAI-compatible)' },
]

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  google: 'gemini-1.5-pro',
  ollama: 'llama3.2',
  lmstudio: 'local-model',
  custom: '',
}

const DEFAULT_URLS = {
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  custom: '',
}

const PROVIDER_BADGES = {
  anthropic: { label: 'Anthropic', color: '#d97706' },
  openai:    { label: 'OpenAI',    color: '#10a37f' },
  google:    { label: 'Google',    color: '#4285f4' },
  ollama:    { label: 'Ollama',    color: '#7c3aed' },
  lmstudio:  { label: 'LM Studio', color: '#0891b2' },
  custom:    { label: 'Custom',    color: '#6b7280' },
}

const LOCAL_PROVIDERS = ['ollama', 'lmstudio', 'custom']
const KEY_LABEL = {
  anthropic: 'Anthropic API key',
  openai:    'OpenAI API key',
  google:    'Google AI API key',
}

const EMPTY_FORM = { name: '', provider: 'anthropic', model: '', api_key: '', base_url: '' }

export default function Settings({ onClose }) {
  const [configs, setConfigs] = useState([])
  const [taskRouting, setTaskRouting] = useState([])   // [{ task, label, llm_config_id }]
  const [routingDraft, setRoutingDraft] = useState({}) // { task: llm_config_id|'' }
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)     // null = not editing, 'new' = adding new
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [routingSaving, setRoutingSaving] = useState(false)
  const [routingSaved, setRoutingSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    try {
      const [cfgData, routeData] = await Promise.all([
        fetch('/api/llm-configs').then(r => r.json()),
        fetch('/api/task-routing').then(r => r.json()),
      ])
      setConfigs(cfgData)
      setTaskRouting(routeData)
      const draft = {}
      for (const t of routeData) draft[t.task] = t.llm_config_id || ''
      setRoutingDraft(draft)
    } catch {
      setError('Failed to load settings.')
    } finally {
      setLoading(false)
    }
  }

  async function loadConfigs() {
    const data = await fetch('/api/llm-configs').then(r => r.json())
    setConfigs(data)
  }

  function startAdd() {
    setForm({ ...EMPTY_FORM })
    setEditingId('new')
    setError('')
  }

  function startEdit(cfg) {
    setForm({
      name: cfg.name,
      provider: cfg.provider,
      model: cfg.model || '',
      api_key: '',
      base_url: cfg.base_url || '',
    })
    setEditingId(cfg.id)
    setError('')
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError('')
  }

  function setFormField(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value }
      if (field === 'provider') {
        next.model = ''
        next.base_url = DEFAULT_URLS[value] || ''
        next.api_key = ''
      }
      return next
    })
  }

  async function saveForm() {
    if (!form.name.trim()) { setError('Name is required.'); return }
    if (!form.provider)    { setError('Provider is required.'); return }
    setSaving(true)
    setError('')
    try {
      const body = {
        name: form.name.trim(),
        provider: form.provider,
        model: form.model.trim() || null,
        base_url: form.base_url.trim() || null,
      }
      if (form.api_key.trim()) body.api_key = form.api_key.trim()

      let res
      if (editingId === 'new') {
        body.make_active = configs.length === 0
        res = await fetch('/api/llm-configs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch(`/api/llm-configs/${editingId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      if (!res.ok) throw new Error('Save failed')
      await loadConfigs()
      cancelEdit()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function activate(id) {
    await fetch(`/api/llm-configs/${id}/activate`, { method: 'POST' })
    await loadConfigs()
  }

  async function deleteConfig(id) {
    if (!window.confirm('Remove this LLM configuration?')) return
    await fetch(`/api/llm-configs/${id}`, { method: 'DELETE' })
    // Clear any task routing that pointed to this config
    setRoutingDraft(d => {
      const next = { ...d }
      for (const k of Object.keys(next)) {
        if (next[k] === id) next[k] = ''
      }
      return next
    })
    await loadConfigs()
  }

  async function saveRouting() {
    setRoutingSaving(true)
    setRoutingSaved(false)
    try {
      const body = {}
      for (const [task, val] of Object.entries(routingDraft)) {
        body[task] = val ? Number(val) : null
      }
      const res = await fetch('/api/task-routing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Save failed')
      setRoutingSaved(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setRoutingSaving(false)
    }
  }

  const badge = (provider) => {
    const b = PROVIDER_BADGES[provider] || PROVIDER_BADGES.custom
    return <span className="llm-badge" style={{ background: b.color + '22', color: b.color }}>{b.label}</span>
  }

  const isLocal = LOCAL_PROVIDERS.includes(form.provider)

  return (
    <div className="settings-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal settings-modal--wide">
        <div className="settings-header">
          <h2>LLM settings</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="settings-loading">Loading…</div>
        ) : (
          <div className="settings-body">

            {/* ── Section: Configured LLMs ── */}
            <div className="settings-section-title">Configured LLMs</div>

            {configs.length > 0 && (
              <div className="llm-list">
                {configs.map(cfg => (
                  <div key={cfg.id} className={`llm-row${cfg.is_active ? ' llm-row--active' : ''}`}>
                    <button
                      className="llm-activate-btn"
                      title={cfg.is_active ? 'Currently active (default)' : 'Set as default'}
                      onClick={() => !cfg.is_active && activate(cfg.id)}
                      disabled={cfg.is_active}
                    >
                      {cfg.is_active ? '●' : '○'}
                    </button>
                    <div className="llm-row-info">
                      <span className="llm-row-name">{cfg.name}</span>
                      <div className="llm-row-meta">
                        {badge(cfg.provider)}
                        {cfg.model && <span className="llm-row-model">{cfg.model}</span>}
                        {cfg.api_key_hint && <span className="llm-row-key">{cfg.api_key_hint}</span>}
                        {cfg.base_url && <span className="llm-row-url">{cfg.base_url}</span>}
                      </div>
                    </div>
                    <div className="llm-row-actions">
                      <button className="btn-ghost btn-sm" onClick={() => startEdit(cfg)} disabled={editingId !== null}>Edit</button>
                      <button className="btn-ghost btn-sm btn-danger" onClick={() => deleteConfig(cfg.id)} disabled={editingId !== null}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {configs.length === 0 && editingId === null && (
              <p className="settings-hint">No LLMs configured yet. Add one below.</p>
            )}

            {/* Inline add/edit form */}
            {editingId !== null && (
              <div className="llm-form">
                <div className="llm-form-title">{editingId === 'new' ? 'Add LLM' : 'Edit LLM'}</div>

                <div className="settings-field">
                  <label>Name</label>
                  <input
                    value={form.name}
                    onChange={e => setFormField('name', e.target.value)}
                    placeholder="e.g. Claude Sonnet, Local Llama, GPT-4o"
                  />
                </div>

                <div className="settings-field">
                  <label>Provider</label>
                  <select value={form.provider} onChange={e => setFormField('provider', e.target.value)}>
                    {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>

                <div className="settings-field">
                  <label>Model</label>
                  <input
                    value={form.model}
                    onChange={e => setFormField('model', e.target.value)}
                    placeholder={DEFAULT_MODELS[form.provider] || 'model name'}
                  />
                  <span className="settings-hint">Leave blank to use the default above.</span>
                </div>

                {!isLocal && KEY_LABEL[form.provider] && (
                  <div className="settings-field">
                    <label>{KEY_LABEL[form.provider]}</label>
                    <input
                      type="password"
                      value={form.api_key}
                      onChange={e => setFormField('api_key', e.target.value)}
                      placeholder={editingId !== 'new' ? 'Paste new key to replace…' : 'Paste API key…'}
                      autoComplete="off"
                    />
                    <span className="settings-hint">Keys are stored server-side only and never sent back to the browser.</span>
                  </div>
                )}

                {isLocal && (
                  <div className="settings-field">
                    <label>Base URL</label>
                    <input
                      value={form.base_url}
                      onChange={e => setFormField('base_url', e.target.value)}
                      placeholder={DEFAULT_URLS[form.provider] || 'http://localhost:PORT/v1'}
                    />
                    <span className="settings-hint">OpenAI-compatible endpoint. Each local model can have its own entry.</span>
                  </div>
                )}

                {error && <div className="settings-error">{error}</div>}

                <div className="settings-actions">
                  <button className="btn-primary" onClick={saveForm} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button className="btn-ghost" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            )}

            {editingId === null && (
              <button className="btn-ghost" onClick={startAdd}>+ Add LLM</button>
            )}

            {/* ── Section: Task routing ── */}
            {configs.length > 0 && editingId === null && (
              <>
                <div className="settings-divider" />
                <div className="settings-section-title">Task routing</div>
                <p className="settings-hint">
                  Choose which LLM handles each task. Leave as "Default" to always use the active LLM (●).
                </p>

                <div className="task-routing-list">
                  {taskRouting.map(t => (
                    <div key={t.task} className="task-routing-row">
                      <span className="task-routing-label">{t.label}</span>
                      <select
                        value={routingDraft[t.task] ?? ''}
                        onChange={e => setRoutingDraft(d => ({ ...d, [t.task]: e.target.value }))}
                      >
                        <option value="">Default (active)</option>
                        {configs.map(cfg => (
                          <option key={cfg.id} value={cfg.id}>{cfg.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                {error && <div className="settings-error">{error}</div>}

                <div className="settings-actions">
                  <button className="btn-primary" onClick={saveRouting} disabled={routingSaving}>
                    {routingSaving ? 'Saving…' : routingSaved ? 'Saved!' : 'Save routing'}
                  </button>
                  <button className="btn-ghost" onClick={onClose}>Close</button>
                </div>
              </>
            )}

            {(configs.length === 0 || editingId !== null) && editingId === null && (
              <div className="settings-actions">
                <button className="btn-ghost" onClick={onClose}>Close</button>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
