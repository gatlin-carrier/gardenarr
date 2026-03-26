import { useState, useEffect } from 'react'
import './CompanionPlanner.css'

const ALL_CROPS = [
  'Tomatoes','Peppers','Cucumbers','Zucchini','Squash','Eggplant','Broccoli','Cauliflower','Cabbage',
  'Lettuce','Spinach','Kale','Swiss Chard','Arugula','Bok Choy','Collards',
  'Carrots','Beets','Radishes','Turnips','Onions','Garlic','Leeks',
  'Beans','Peas','Edamame','Snap Peas',
  'Basil','Cilantro','Parsley','Dill','Thyme','Rosemary','Sage','Mint','Marigolds',
  'Corn','Pumpkins','Watermelon','Potatoes','Sunflowers','Nasturtiums'
]

export default function CompanionPlanner({ savedPlantings = [] }) {
  const [selected, setSelected] = useState(new Set())
  const [customCrop, setCustomCrop] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Pre-select saved plantings when the component mounts or saved plantings change
  useEffect(() => {
    if (!savedPlantings.length) return
    setSelected(prev => {
      const next = new Set(prev)
      for (const p of savedPlantings) next.add(p.crop)
      return next
    })
  }, [savedPlantings])

  const savedCropNames = new Set(savedPlantings.map(p => p.crop))

  function toggleCrop(crop) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(crop) ? next.delete(crop) : next.add(crop)
      return next
    })
    setResult(null)
  }

  function addCustom() {
    if (!customCrop.trim()) return
    setSelected(prev => new Set([...prev, customCrop.trim()]))
    setCustomCrop('')
  }

  async function analyze() {
    if (selected.size < 2) { setError('Select at least 2 crops to analyze.'); return }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/companion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ crops: [...selected] })
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setResult(data)
    } catch(e) {
      setError('Failed to analyze. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  const beneficial = result?.pairs?.filter(p => p.relationship === 'beneficial') || []
  const harmful = result?.pairs?.filter(p => p.relationship === 'harmful') || []

  return (
    <div className="companion-planner">
      <div className="companion-intro">
        <p>Select the crops you're planning to grow and get AI-powered advice on what to plant together, what to keep apart, and how to organize your beds.</p>
        {savedPlantings.length > 0 && (
          <div className="saved-preloaded-notice">
            {savedPlantings.length} saved planting{savedPlantings.length !== 1 ? 's' : ''} pre-selected below.
          </div>
        )}
      </div>

      <div className="cp-crop-grid">
        {ALL_CROPS.map(crop => (
          <button
            key={crop}
            className={`crop-chip ${selected.has(crop) ? 'selected' : ''} ${savedCropNames.has(crop) && selected.has(crop) ? 'saved' : ''}`}
            onClick={() => toggleCrop(crop)}
          >
            {crop}
          </button>
        ))}
      </div>

      {/* Saved crops that aren't in the standard list */}
      {savedPlantings.filter(p => !ALL_CROPS.includes(p.crop)).length > 0 && (
        <div className="cp-saved-extras">
          <span className="cp-saved-extras-label">From your garden:</span>
          {savedPlantings.filter(p => !ALL_CROPS.includes(p.crop)).map(p => (
            <button
              key={p.crop}
              className={`crop-chip ${selected.has(p.crop) ? 'selected saved' : ''}`}
              onClick={() => toggleCrop(p.crop)}
            >
              {p.crop}
            </button>
          ))}
        </div>
      )}

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
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Analyzing:</span>
          {[...selected].map(c => (
            <span key={c} className="selected-chip">
              {c}<button onClick={() => toggleCrop(c)}>×</button>
            </span>
          ))}
        </div>
      )}

      {error && <div className="error-msg">{error}</div>}

      <button
        className="btn-primary analyze-btn"
        onClick={analyze}
        disabled={loading || selected.size < 2}
      >
        {loading ? 'Analyzing companion relationships...' : `Analyze ${selected.size} crop${selected.size !== 1 ? 's' : ''}`}
      </button>

      {result && (
        <div className="companion-results">

          {beneficial.length > 0 && (
            <div className="result-section">
              <h3 className="result-section-title good">Great companions</h3>
              <div className="pairs-grid">
                {beneficial.map((p, i) => (
                  <div key={i} className="pair-card beneficial">
                    <div className="pair-crops">
                      <span className="pair-crop">{p.crop_a}</span>
                      <span className="pair-icon">+</span>
                      <span className="pair-crop">{p.crop_b}</span>
                    </div>
                    <div className="pair-reason">{p.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {harmful.length > 0 && (
            <div className="result-section">
              <h3 className="result-section-title bad">Keep apart</h3>
              <div className="pairs-grid">
                {harmful.map((p, i) => (
                  <div key={i} className="pair-card harmful">
                    <div className="pair-crops">
                      <span className="pair-crop">{p.crop_a}</span>
                      <span className="pair-icon bad">✕</span>
                      <span className="pair-crop">{p.crop_b}</span>
                    </div>
                    <div className="pair-reason">{p.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.bed_suggestions?.length > 0 && (
            <div className="result-section">
              <h3 className="result-section-title">Suggested bed groupings</h3>
              <div className="beds-grid">
                {result.bed_suggestions.map((bed, i) => (
                  <div key={i} className="bed-card">
                    <div className="bed-name">{bed.bed_name}</div>
                    <div className="bed-crops">
                      {bed.crops.map(c => <span key={c} className="bed-crop-tag">{c}</span>)}
                    </div>
                    <div className="bed-notes">{bed.notes}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.avoid_together?.length > 0 && (
            <div className="result-section">
              <h3 className="result-section-title bad">Never plant together</h3>
              {result.avoid_together.map((a, i) => (
                <div key={i} className="avoid-row">
                  <div className="avoid-crops">
                    {a.crops.map((c, j) => (
                      <span key={c}>{c}{j < a.crops.length - 1 ? ' & ' : ''}</span>
                    ))}
                  </div>
                  <div className="avoid-reason">{a.reason}</div>
                </div>
              ))}
            </div>
          )}

          {result.tips?.length > 0 && (
            <div className="result-section">
              <h3 className="result-section-title">General tips</h3>
              <ul className="tips-list">
                {result.tips.map((tip, i) => <li key={i}>{tip}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
