const statusClassMap = {
  idle: 'status-pill status-idle',
  running: 'status-pill status-running',
  enriching: 'status-pill status-enriching',
  failed: 'status-pill status-failed',
  completed: 'status-pill status-completed',
}

function formatCount(value) {
  if (value === undefined || value === null) return '—'
  if (value > 999) {
    return `${(value / 1000).toFixed(1)}k`
  }
  return value.toLocaleString()
}

export default function LeadsetCard({ leadset, onOpen }) {
  const { name, description, segment = {}, intent = {}, est_count: estCount, status = 'idle' } = leadset
  const normalizedStatus = (status || 'idle').toLowerCase()
  const statusClass = statusClassMap[normalizedStatus] ?? statusClassMap.idle
  const intentSignals = (intent.signals || []).slice(0, 3)

  return (
    <article className="leadset-card">
      <div className="leadset-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="leads-count-badge">
          <span className="leads-count-number">{formatCount(estCount)}</span>
          <span className="leads-count-text">potential leads</span>
        </div>
        <div className={statusClass} style={{ marginTop: '35px', display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', padding: 0 }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'currentColor' }} />
          {normalizedStatus}
        </div>
      </div>
      <div>
        <h3 className="leadset-title">{name}</h3>
        <p className="leadset-description">{description}</p>
        {(segment.tribe || []).length > 0 && (
          <div className="hashtags-row">
            {(segment.tribe || []).map((tribe) => (
              <span className="hashtag" key={tribe}>
                {tribe}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="chip-section">
        <h4 className="chip-section-heading">
          <span className="material-icons" style={{ fontSize: '20px', marginRight: '8px' }}>person</span>
          Ideal Customer Profile
        </h4>
        <div className="chip-row">
          {segment.segment_archetype && <span className="chip">{segment.segment_archetype}</span>}
          {segment.geo_region && <span className="chip">{segment.geo_region}</span>}
          {segment.firmographic_company_size && (
            <span className="chip">{segment.firmographic_company_size}</span>
          )}
        </div>
      </div>

      {intentSignals.length > 0 && (
        <div className="chip-section">
          <h4 className="chip-section-heading">
            <span className="material-icons" style={{ fontSize: '20px', marginRight: '8px' }}>track_changes</span>
            Intent
          </h4>
          <div className="chip-row">
            {intentSignals.map((signal) => (
              <span className="chip intent" key={signal}>
                {signal}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="metrics-row">
        <button className="cta-view-leads" type="button" onClick={onOpen}>
          <span className="material-icons" style={{ fontSize: '18px' }}>visibility</span>
          View Leads
        </button>
      </div>
    </article>
  )
}
