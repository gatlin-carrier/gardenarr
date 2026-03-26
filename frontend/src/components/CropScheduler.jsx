import { useState, useEffect } from 'react'
import './CropScheduler.css'

const CROP_CATEGORIES = {
  'Vegetables': ['Tomatoes','Peppers','Cucumbers','Zucchini','Squash','Eggplant','Broccoli','Cauliflower','Cabbage','Brussels Sprouts'],
  'Greens': ['Lettuce','Spinach','Kale','Swiss Chard','Arugula','Bok Choy','Collards','Mustard Greens'],
  'Roots': ['Carrots','Beets','Radishes','Turnips','Parsnips','Sweet Potatoes','Onions','Garlic'],
  'Legumes': ['Beans','Peas','Edamame','Lima Beans','Snap Peas'],
  'Herbs': ['Basil','Cilantro','Parsley','Dill','Thyme','Rosemary','Sage','Mint','Oregano'],
  'Others': ['Corn','Pumpkins','Watermelon','Cantaloupe','Sunflowers','Potatoes']
}

export default function CropScheduler({ garden, onSave }) {
  const storageKey = `garden-crops-${garden.id}`
  const [selected, setSelected] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })
  const [schedule, setSchedule] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [customCrop, setCustomCrop] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...selected]))
    } catch {}
  }, [selected, storageKey])

  function toggleCrop(crop) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(crop) ? next.delete(crop) : next.add(crop)
      return next
    })
    setSchedule([])
    setSaved(false)
  }

  function addCustom() {
    if (!customCrop.trim()) return
    setSelected(prev => new Set([...prev, customCrop.trim()]))
    setCustomCrop('')
  }

  async function generate() {
    const location = garden.zone || (garden.zipcode ? `zip code ${garden.zipcode}` : null)
    if (!location) { setError('This garden has no zone or zip code set.'); return }
    if (!selected.size) { setError('Select at least one crop.'); return }

    setLoading(true)
    setError('')
    setSchedule([])
    setSaved(false)

    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ location, crops: [...selected] })
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setSchedule(data.crops || [])
    } catch(e) {
      setError('Failed to generate schedule. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  async function saveAll() {
    await onSave(schedule.map(c => ({
      crop: c.name,
      sow_indoors: c.sow_indoors || null,
      transplant_or_direct_sow: c.transplant_or_direct_sow,
      harvest: c.harvest,
      tip: c.tip
    })))
    setSaved(true)
  }

  return (
    <div className="crop-scheduler">
      <div className="crop-categories">
        {Object.entries(CROP_CATEGORIES).map(([cat, crops]) => (
          <div key={cat} className="crop-category">
            <div className="cat-label">{cat}</div>
            <div className="crop-chips">
              {crops.map(crop => (
                <button
                  key={crop}
                  className={`crop-chip ${selected.has(crop) ? 'selected' : ''}`}
                  onClick={() => toggleCrop(crop)}
                >
                  {crop}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="custom-crop-row">
        <input
          placeholder="Add custom crop..."
          value={customCrop}
          onChange={e => setCustomCrop(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addCustom()}
        />
        <button className="btn-ghost" onClick={addCustom}>Add</button>
      </div>

      {selected.size > 0 && (
        <div className="selected-summary">
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Selected:</span>
          {[...selected].map(c => (
            <span key={c} className="selected-chip">
              {c}
              <button onClick={() => toggleCrop(c)}>×</button>
            </span>
          ))}
        </div>
      )}

      {error && <div className="error-msg">{error}</div>}

      <div className="scheduler-actions">
        <button className="btn-primary generate-btn" onClick={generate} disabled={loading || !selected.size}>
          {loading ? 'Generating schedule...' : `Generate schedule for ${selected.size || 0} crop${selected.size !== 1 ? 's' : ''}`}
        </button>
      </div>

      {schedule.length > 0 && (
        <div className="schedule-results">
          <div className="schedule-results-header">
            <h3>Planting schedule</h3>
            <button className={`btn-primary save-btn ${saved ? 'saved' : ''}`} onClick={saveAll} disabled={saved}>
              {saved ? 'Saved!' : 'Save all to garden'}
            </button>
          </div>
          {schedule.map((crop, i) => (
            <div key={i} className="schedule-card">
              <div className="schedule-crop-name">{crop.name}</div>
              <div className="timeline">
                {crop.sow_indoors && (
                  <div className="timeline-row">
                    <div className="tl-label">Sow indoors</div>
                    <div className="tl-bar sow">{crop.sow_indoors}</div>
                  </div>
                )}
                <div className="timeline-row">
                  <div className="tl-label">{crop.sow_indoors ? 'Transplant' : 'Direct sow'}</div>
                  <div className="tl-bar transplant">{crop.transplant_or_direct_sow}</div>
                </div>
                <div className="timeline-row">
                  <div className="tl-label">Harvest</div>
                  <div className="tl-bar harvest">{crop.harvest}</div>
                </div>
              </div>
              {crop.tip && <div className="crop-tip">{crop.tip}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
