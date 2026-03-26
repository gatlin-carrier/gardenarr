import './PlantingList.css'

export default function PlantingList({ plantings, onDelete }) {
  if (!plantings.length) return (
    <div className="no-plantings">
      <p>No saved plantings yet.</p>
      <p style={{ fontSize: 13 }}>Generate a schedule and save crops to see them here.</p>
    </div>
  )

  return (
    <div className="planting-list">
      {plantings.map(p => (
        <div key={p.id} className="planting-card">
          <div className="planting-header">
            <div className="planting-crop">{p.crop}</div>
            <button className="btn-danger" onClick={() => onDelete(p.id)}>Remove</button>
          </div>
          <div className="planting-timeline">
            {p.sow_indoors && (
              <div className="pt-row">
                <span className="pt-label">Sow indoors</span>
                <span className="tag tag-sow">{p.sow_indoors}</span>
              </div>
            )}
            <div className="pt-row">
              <span className="pt-label">{p.sow_indoors ? 'Transplant' : 'Direct sow'}</span>
              <span className="tag tag-transplant">{p.transplant_or_direct_sow}</span>
            </div>
            <div className="pt-row">
              <span className="pt-label">Harvest</span>
              <span className="tag tag-harvest">{p.harvest}</span>
            </div>
          </div>
          {p.tip && <div className="planting-tip">{p.tip}</div>}
          {p.notes && <div className="planting-notes">{p.notes}</div>}
        </div>
      ))}
    </div>
  )
}
