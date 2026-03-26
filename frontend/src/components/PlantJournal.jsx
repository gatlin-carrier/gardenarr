import { useState, useRef } from 'react'
import './PlantJournal.css'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PlantJournal({ plantingId }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState(null) // null = not yet loaded
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // new entry form
  const [note, setNote] = useState('')
  const [label, setLabel] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef()

  async function open_() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (entries !== null) return
    await load()
  }

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await fetch(`/api/plantings/${plantingId}/journal`).then(r => r.json())
      setEntries(data)
    } catch {
      setError('Failed to load journal.')
    } finally {
      setLoading(false)
    }
  }

  function pickFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  function clearFile() {
    setFile(null)
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function submit(e) {
    e.preventDefault()
    if (!note.trim() && !file) return
    setSubmitting(true)
    setError('')
    try {
      const form = new FormData()
      if (note.trim()) form.append('note', note.trim())
      if (label) form.append('label', label)
      if (file) form.append('image', file)

      const res = await fetch(`/api/plantings/${plantingId}/journal`, { method: 'POST', body: form })
      const entry = await res.json()
      if (entry.error) { setError(entry.error); return }
      setEntries(prev => [...(prev || []), { ...entry, created_at: new Date().toISOString() }])
      setNote('')
      setLabel('')
      clearFile()
    } catch {
      setError('Failed to save entry.')
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteEntry(id) {
    await fetch(`/api/journal/${id}`, { method: 'DELETE' })
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  return (
    <div className="plant-journal-section">
      <button className="journal-toggle btn-ghost btn-sm" onClick={open_}>
        {open ? '▲ Journal' : '▼ Journal'}
        {entries?.length > 0 && <span className="journal-count">{entries.length}</span>}
      </button>

      {open && (
        <div className="journal-panel">
          {loading && <div className="journal-status">Loading journal…</div>}
          {error && <div className="journal-error">{error}</div>}

          {/* Entry list */}
          {entries?.length > 0 && (
            <div className="journal-entries">
              {entries.map(entry => (
                <div key={entry.id} className={`journal-entry ${entry.label === 'seed_packet' ? 'entry-seed' : ''}`}>
                  <div className="entry-meta">
                    <span className="entry-date">{formatDate(entry.created_at)}</span>
                    {entry.label === 'seed_packet' && <span className="entry-label-badge">Seed packet</span>}
                    <button className="entry-delete" onClick={() => deleteEntry(entry.id)} title="Delete entry">✕</button>
                  </div>
                  {entry.images?.length > 0 && (
                    <div className="entry-images">
                      {entry.images.map(img => (
                        <a key={img.id} href={`/uploads/${img.filename}`} target="_blank" rel="noopener noreferrer">
                          <img src={`/uploads/${img.filename}`} alt="Journal photo" className="entry-thumb" />
                        </a>
                      ))}
                    </div>
                  )}
                  {entry.note && <p className="entry-note">{entry.note}</p>}
                </div>
              ))}
            </div>
          )}

          {entries?.length === 0 && !loading && (
            <p className="journal-empty">No entries yet. Add your first note or photo below.</p>
          )}

          {/* New entry form */}
          <form className="journal-form" onSubmit={submit}>
            <div className="journal-form-top">
              <textarea
                rows={2}
                placeholder="Add a note…"
                value={note}
                onChange={e => setNote(e.target.value)}
              />
              <select value={label} onChange={e => setLabel(e.target.value)} className="label-select">
                <option value="">General</option>
                <option value="seed_packet">Seed packet</option>
                <option value="seedling">Seedling</option>
                <option value="progress">Progress</option>
                <option value="harvest">Harvest</option>
              </select>
            </div>

            {preview && (
              <div className="image-preview-row">
                <img src={preview} alt="Preview" className="image-preview" />
                <button type="button" className="remove-preview" onClick={clearFile}>✕</button>
              </div>
            )}

            <div className="journal-form-actions">
              <label className="btn-ghost btn-sm upload-label">
                📷 Add photo
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickFile} />
              </label>
              <button type="submit" className="btn-primary btn-sm" disabled={submitting || (!note.trim() && !file)}>
                {submitting ? 'Saving…' : 'Add entry'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
