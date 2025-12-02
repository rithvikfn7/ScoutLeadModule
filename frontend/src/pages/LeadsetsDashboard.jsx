import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import LeadsetCard from '../components/LeadsetCard'
import LeadsetCardSkeleton from '../components/LeadsetCardSkeleton'
import FN7FactRotator from '../components/FN7FactRotator'
import { useDataCache } from '../contexts/DataCacheContext'

const API_BASE = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3000'

export default function LeadsetsDashboard() {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState('latest')
  const [showSeedModal, setShowSeedModal] = useState(false)
  const [seedStatus, setSeedStatus] = useState({ loading: false, message: '' })
  const fileInputRef = useRef(null)
  const navigate = useNavigate()
  const mountTimeRef = useRef(Date.now())
  const [forceShowLoader, setForceShowLoader] = useState(true)
  
  // Get cached data from FN7 SDK reads
  const { leadsets = [], isLoading = true, error, isInitialized = false, refreshCache, refreshCounter } = useDataCache()
  
  // Handle file upload and seed
  const handleSeedFromFile = useCallback(async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    setSeedStatus({ loading: true, message: 'Reading file...' })
    
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      
      // Support:
      // - Array format: [ {...}, {...} ]
      // - Object with "leadsets": { leadsets: [...] }
      // - Brain-style object with "lead_sets": { lead_sets: [...] }
      const leadsetsArray = Array.isArray(data)
        ? data
        : (data.leadsets || data.lead_sets || [])
      const settings = data.settings || null
      
      if (!Array.isArray(leadsetsArray) || leadsetsArray.length === 0) {
        setSeedStatus({ loading: false, message: 'Error: No leadsets found in file' })
        return
      }
      
      setSeedStatus({ loading: true, message: `Seeding ${leadsetsArray.length} leadsets...` })
      
      const response = await fetch(`${API_BASE}/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadsets: leadsetsArray, settings }),
      })
      
      if (!response.ok) {
        throw new Error(`Seed failed: ${response.statusText}`)
      }
      
      const result = await response.json()
      setSeedStatus({ loading: false, message: result.message })
      
      // Refresh the cache to show new leadsets
      if (refreshCache) {
        setTimeout(() => refreshCache(), 500)
      }
      
      // Close modal after success
      setTimeout(() => {
        setShowSeedModal(false)
        setSeedStatus({ loading: false, message: '' })
      }, 2000)
      
    } catch (err) {
      setSeedStatus({ loading: false, message: `Error: ${err.message}` })
    }
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [refreshCache])
  
  // Handle delete all data (factory reset)
  const handleDeleteAll = useCallback(async () => {
    if (!window.confirm('⚠️ FACTORY RESET\n\nThis will:\n• Delete all Exa websets associated with your leadsets\n• Delete all Firebase data (leadsets, runs, items, enrichments)\n\nThis cannot be undone. Continue?')) {
      return
    }
    
    setSeedStatus({ loading: true, message: 'Factory reset in progress... Deleting Exa websets and Firebase data...' })
    
    try {
      const response = await fetch(`${API_BASE}/seed`, { method: 'DELETE' })
      
      if (!response.ok) {
        throw new Error(`Factory reset failed: ${response.statusText}`)
      }
      
      const result = await response.json()
      setSeedStatus({ 
        loading: false, 
        message: result.message || `Factory reset complete! Deleted ${result.exaWebsetsDeleted || 0} Exa websets and ${result.firebaseDocsDeleted || 0} Firebase documents.`
      })
      
      // Refresh the cache
      if (refreshCache) {
        setTimeout(() => refreshCache(true), 500)
      }
      
    } catch (err) {
      setSeedStatus({ loading: false, message: `Error: ${err.message}` })
    }
  }, [refreshCache])
  
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
    console.log('[Dashboard] Recomputing filteredLeadsets, refreshCounter:', refreshCounter, 'leadsets:', leadsets?.length)
    const term = searchTerm.trim().toLowerCase()
    return leadsets
      .filter((leadset) => {
        if (statusFilter !== 'all') {
          if ((leadset.status || 'idle').toLowerCase() !== statusFilter) return false
        }
        if (!term) return true
        const haystack = [
          leadset.name,
          leadset.description,
          leadset.segment?.segment_archetype,
          leadset.segment?.geo_region,
          ...(leadset.segment?.tribe || []),
          ...(leadset.intent?.signals || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(term)
      })
      .sort((a, b) => {
        if (sortKey === 'buyers') {
          return (b.est_count || 0) - (a.est_count || 0)
        }
        if (sortKey === 'status') {
          return (a.status || '').localeCompare(b.status || '')
        }
        const dateA = new Date(a?.createdAt || 0).getTime()
        const dateB = new Date(b?.createdAt || 0).getTime()
        return dateB - dateA
      })
  }, [leadsets, searchTerm, statusFilter, sortKey, refreshCounter])

  const totalLeads = useMemo(() => {
    return leadsets.reduce((sum, leadset) => sum + (leadset.est_count || 0), 0)
  }, [leadsets])
  

  return (
    <main className="page">
      <div className="page-header-aligned">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 className="page-title">Leadsets dashboard</h1>
            <p className="page-subtitle">
              Scout has identified {leadsets.length} leadset{leadsets.length !== 1 ? 's' : ''} with {totalLeads.toLocaleString()} total lead{totalLeads !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => setShowSeedModal(true)}
            style={{ flexShrink: 0 }}
          >
            <span className="material-icons" style={{ fontSize: '18px', marginRight: '8px' }}>settings</span>
            Manage Data
          </button>
        </div>
      </div>

      {error && <div className="status-pill status-failed">Error: {error}</div>}

      <section className="card-grid">
        {showLoading ? (
          <>
            {[...Array(6)].map((_, i) => (
              <LeadsetCardSkeleton key={`skeleton-${i}`} />
            ))}
            <div style={{ gridColumn: '1 / -1' }}>
              <FN7FactRotator interval={4000} />
              <div
                style={{
                  textAlign: 'center',
                  padding: '16px',
                  color: 'var(--text-secondary)',
                  fontSize: '14px',
                  marginTop: '12px',
                }}
              >
                <div style={{ marginBottom: '8px' }}>🔍 Fetching your leadsets...</div>
                <div style={{ fontSize: '12px', opacity: 0.7 }}>
                  This only happens on first visit. Subsequent loads are instant!
                </div>
              </div>
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
            <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
              No leadsets yet.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => setShowSeedModal(true)}
              style={{ marginTop: '8px' }}
            >
              <span className="material-icons" style={{ fontSize: '18px', marginRight: '8px' }}>upload_file</span>
              Populate Leadsets
            </button>
          </div>
        )}
      </section>
      
      {/* Seed Modal */}
      {showSeedModal && (
        <div className="modal-overlay" onClick={() => !seedStatus.loading && setShowSeedModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: '16px' }}>Populate Leadsets</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
              Upload a JSON file containing leadsets to seed your database.
              The file should be an array of leadset objects or an object with a "leadsets" array.
            </p>
            
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleSeedFromFile}
              style={{ display: 'none' }}
            />
            
            <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
              <button
                className="btn btn-primary"
                onClick={() => fileInputRef.current?.click()}
                disabled={seedStatus.loading}
                style={{ width: '100%' }}
              >
                <span className="material-icons" style={{ fontSize: '18px', marginRight: '8px' }}>upload_file</span>
                {seedStatus.loading ? 'Processing...' : 'Upload JSON File'}
              </button>
              
              <button
                className="btn btn-danger"
                onClick={handleDeleteAll}
                disabled={seedStatus.loading}
                style={{ width: '100%', background: '#dc3545' }}
              >
                <span className="material-icons" style={{ fontSize: '18px', marginRight: '8px' }}>restart_alt</span>
                Factory Reset (Delete All)
              </button>
            </div>
            
            {seedStatus.message && (
              <div style={{
                marginTop: '16px',
                padding: '12px',
                borderRadius: '8px',
                background: seedStatus.message.startsWith('Error') ? 'rgba(220, 53, 69, 0.1)' : 'rgba(40, 167, 69, 0.1)',
                color: seedStatus.message.startsWith('Error') ? '#dc3545' : '#28a745',
              }}>
                {seedStatus.message}
              </div>
            )}
            
            <button
              className="btn"
              onClick={() => setShowSeedModal(false)}
              disabled={seedStatus.loading}
              style={{ marginTop: '16px', width: '100%' }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

