export default function UnlockModal({
  count,
  fieldOptions,
  selectedFields,
  onToggleField,
  costByField,
  perBuyerCost,
  estimatedCost,
  loading,
  onCancel,
  onConfirm,
}) {
  const canSubmit = count > 0 && selectedFields.size > 0 && perBuyerCost > 0 && !loading

  return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ maxWidth: '1200px', minWidth: '500px', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '0', textAlign: 'center', paddingTop: '20px' }}>
        <h3 className="modal-title" style={{ marginBottom: '8px', lineHeight: '1.2', textAlign: 'center' }}>Get More Details</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', marginTop: '0px', lineHeight: '1.4', textAlign: 'center', fontSize: '14px' }}>
          This will enrich <strong>all {count}</strong> leads in this leadset.
        </p>

        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {fieldOptions.map((option) => {
            const fieldCost = costByField[option.key] ?? option.defaultCost ?? 0
            const isChecked = selectedFields.has(option.key)
            return (
              <div
                key={option.key}
                style={isChecked ? {
                  borderRadius: '12px',
                  padding: '1px',
                  background: 'linear-gradient(to right, #FF6C57, #B56AF1)',
                  cursor: 'pointer',
                } : {
                  borderRadius: '12px',
                  padding: '1px',
                  background: '#e4e7ec',
                  cursor: 'pointer',
                }}
                onClick={() => onToggleField(option.key)}
              >
                <div style={{
                  position: 'relative',
                  background: 'white',
                  borderRadius: '11px',
                  padding: '12px 14px',
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'flex-start',
                }}>
                {isChecked && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '11px',
                    background: 'linear-gradient(to right, #FF6C57, #B56AF1)',
                    opacity: 0.04,
                    pointerEvents: 'none',
                  }} />
                )}
                <div style={{ position: 'relative', zIndex: 1, flex: 1, textAlign: 'left' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <strong>{option.label}</strong>
                    <span style={{ color: '#475467', fontSize: '0.9em' }}>
                      {fieldCost.toFixed(2)} tokens / lead
                    </span>
                  </div>
                  <p style={{ margin: 0, color: '#475467', fontSize: '0.9em', textAlign: 'left' }}>{option.description}</p>
                </div>
                </div>
              </div>
            )
          })}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            border: '1px solid #e4e7ec',
            borderRadius: '12px',
            padding: '12px 16px',
            marginBottom: '16px',
            textAlign: 'left',
          }}
        >
          <div>
            <div style={{ fontSize: '0.85em', color: '#475467' }}>Per lead</div>
            <div style={{ fontWeight: 600 }}>{perBuyerCost.toFixed(2)} tokens</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85em', color: '#475467' }}>Estimated total</div>
            <div style={{ fontWeight: 600 }}>{estimatedCost.toFixed(2)} tokens</div>
          </div>
        </div>

        <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', flexWrap: 'nowrap', minWidth: '400px' }}>
          <button className="cta-secondary" type="button" onClick={onCancel} disabled={loading} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
            Cancel
          </button>
          <button className="cta-primary" type="button" onClick={onConfirm} disabled={!canSubmit} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
            {loading ? 'Requesting…' : 'Unlock selected fields'}
          </button>
        </div>
      </div>
    </div>
  )
}

