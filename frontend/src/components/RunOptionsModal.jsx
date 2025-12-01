import { useState } from 'react'
import PropTypes from 'prop-types'

export default function RunOptionsModal({
  itemCount = 0,
  onExtend,
  onCancel,
  loading = false,
}) {
  const [extendCount, setExtendCount] = useState(10)

  const handleExtend = () => {
    if (extendCount > 0) {
      onExtend(extendCount)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: '420px' }}>
        <h2 style={{ marginTop: 0, marginBottom: '12px' }}>
          Add more leads
        </h2>

        <label style={{ fontSize: '14px', fontWeight: 500, marginBottom: '0px', display: 'block', textAlign: 'left' }}>
          Additional leads to fetch
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', marginTop: '0px' }}>
          <input
            type="number"
            min="1"
            max="100"
            value={extendCount}
            onChange={(e) => setExtendCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
            style={{
              width: '100%',
              padding: '10px 14px',
              border: '1px solid #d0d5dd',
              borderRadius: '10px',
              fontSize: '16px',
            }}
          />
          <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>leads</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            className="cta-secondary"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className="cta-primary"
            onClick={handleExtend}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="material-icons" style={{ animation: 'spin 1s linear infinite', marginRight: '8px' }}>sync</span>
                Adding…
              </>
            ) : (
              `Add ${extendCount} leads`
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

RunOptionsModal.propTypes = {
  itemCount: PropTypes.number,
  onExtend: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  loading: PropTypes.bool,
}

