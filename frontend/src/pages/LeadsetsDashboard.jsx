import { useMemo, useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import LeadsetCard from '../components/LeadsetCard'
import LeadsetCardSkeleton from '../components/LeadsetCardSkeleton'
import FN7FactRotator from '../components/FN7FactRotator'
import { useDataCache } from '../contexts/DataCacheContext'

export default function LeadsetsDashboard() {
  const navigate = useNavigate()
  const mountTimeRef = useRef(Date.now())
  const [forceShowLoader, setForceShowLoader] = useState(true)
  
  // Get cached data from FN7 SDK reads
  const { leadsets = [], isLoading = true, error, isInitialized = false, refreshCache, refreshCounter } = useDataCache()
  
  // Auto-refresh when there are running leadsets
  const hasRunningLeadsets = useMemo(() => {
    return leadsets.some(ls => ['running', 'processing', 'pending'].includes((ls.status || '').toLowerCase()))
  }, [leadsets])

  useEffect(() => {
    if (!hasRunningLeadsets) return
    
    const interval = setInterval(() => {
      refreshCache(true)
    }, 5000)
    
    return () => clearInterval(interval)
  }, [hasRunningLeadsets, refreshCache])
  
  // Show skeleton for minimum 500ms to ensure it's visible during fast loads
  useEffect(() => {
    if (isInitialized && !isLoading) {
      const elapsed = Date.now() - mountTimeRef.current
      const remaining = Math.max(0, 500 - elapsed)
      if (remaining > 0) {
        const timer = setTimeout(() => setForceShowLoader(false), remaining)
        return () => clearTimeout(timer)
      } else {
        setForceShowLoader(false)
      }
    } else {
      mountTimeRef.current = Date.now()
      setForceShowLoader(true)
    }
  }, [isInitialized, isLoading])
  
  const showLoading = !isInitialized || isLoading || forceShowLoader

  const filteredLeadsets = useMemo(() => {
    return leadsets.sort((a, b) => {
      const dateA = new Date(a?.createdAt || 0).getTime()
      const dateB = new Date(b?.createdAt || 0).getTime()
      return dateB - dateA
    })
  }, [leadsets, refreshCounter])

  const totalLeads = useMemo(() => {
    return leadsets.reduce((sum, leadset) => sum + (leadset.est_count || 0), 0)
  }, [leadsets])
  

  return (
    <main className="page">
      <div className="page-header-aligned">
        <div>
          <h1 className="page-title">Leadsets</h1>
          <p className="page-subtitle">
            {leadsets.length} leadset{leadsets.length !== 1 ? 's' : ''} • {totalLeads.toLocaleString()} estimated leads
          </p>
        </div>
      </div>

      {error && <div className="status-pill status-failed">Error: {error}</div>}

      <section className="card-grid">
        {showLoading ? (
          <>
            {[...Array(6)].map((_, i) => (
              <LeadsetCardSkeleton key={`skeleton-${i}`} />
            ))}
            <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}>
              <FN7FactRotator interval={4000} />
            </div>
          </>
        ) : filteredLeadsets.length > 0 ? (
          filteredLeadsets.map((leadset) => (
            <LeadsetCard
              key={leadset.id}
              leadset={leadset}
              onOpen={() => navigate(`/leadsets/${leadset.id}`)}
            />
          ))
        ) : (
          <div className="empty-state" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px' }}>
            <p style={{ color: 'var(--text-secondary)' }}>
              No leadsets available. Leadsets will appear here once Scout identifies them.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}
