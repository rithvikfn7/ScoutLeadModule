export default function BuyerItemSkeleton() {
  return (
    <tr className="buyer-item skeleton-item">
      <td>
        <div className="skeleton skeleton-company" />
        <div className="skeleton skeleton-domain" />
      </td>
      <td>
        <div className="skeleton skeleton-snippet" />
        <div className="skeleton skeleton-snippet" style={{ width: '60%', marginTop: '4px' }} />
      </td>
      <td>
        <div className="skeleton skeleton-snippet" style={{ width: '90%' }} />
        <div className="skeleton skeleton-snippet" style={{ width: '70%', marginTop: '4px' }} />
        <div className="skeleton skeleton-snippet" style={{ width: '50%', marginTop: '4px' }} />
      </td>
      <td>
        <div className="skeleton skeleton-score" />
      </td>
      <td>
        <div className="skeleton skeleton-contact" />
      </td>
      <td>
        <div className="skeleton skeleton-enrichment" />
      </td>
    </tr>
  )
}

