export default function LeadsetCardSkeleton() {
  return (
    <article className="leadset-card skeleton-card">
      <div>
        <div className="skeleton skeleton-status" />
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-description" />
      </div>

      <div className="chip-row">
        <div className="skeleton skeleton-chip" />
        <div className="skeleton skeleton-chip" />
        <div className="skeleton skeleton-chip" />
      </div>

      <div className="chip-row">
        <div className="skeleton skeleton-chip" style={{ width: '60%' }} />
        <div className="skeleton skeleton-chip" style={{ width: '70%' }} />
      </div>

      <div className="metrics-row">
        <div className="skeleton skeleton-metric" />
        <div className="skeleton skeleton-button" />
      </div>
    </article>
  )
}

