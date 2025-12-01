import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  exportRun,
  requestEnrichment,
  getEnrichmentStatus,
  startLeadsetRun,
  fetchWebsetStatus,
  cancelRun,
} from '../services/apiClient'
import UnlockModal from '../components/UnlockModal'
import RunOptionsModal from '../components/RunOptionsModal'
import BuyerItemSkeleton from '../components/BuyerItemSkeleton'
import FN7FactRotator from '../components/FN7FactRotator'
import { useLeadsetCache } from '../contexts/DataCacheContext'

const statusClassMap = {
  idle: 'status-pill status-idle',
  running: 'status-pill status-running',
  enriching: 'status-pill status-enriching',
  failed: 'status-pill status-failed',
  completed: 'status-pill status-completed',
}

const RECENCY_BUCKETS = [
  { key: '7d', label: 'Last 7 days', cutoff: 7 },
  { key: '30d', label: 'Last 30 days', cutoff: 30 },
  { key: '90d', label: 'Last 90 days', cutoff: 90 },
  { key: 'older', label: 'Older', cutoff: Infinity },
]

const DEFAULT_FILTERS = {
  search: '',
  recency: [],
  hasContact: false,
}

const SNIPPET_PREVIEW_LENGTH = 200

const FIELD_OPTIONS = [
  {
    key: 'buyingIntent',
    label: 'Buying Intent',
    description: 'Classify the lead\'s intent as High / Medium / Low with a short reason.',
    defaultCost: 0.75,
  },
  {
    key: 'employeeCount',
    label: 'Employee Count',
    description: 'Estimated headcount or team size so you can gauge scale.',
    defaultCost: 0.5,
  },
  {
    key: 'phone',
    label: 'Phone',
    description: 'Best available work phone number.',
    defaultCost: 1.0,
  },
  {
    key: 'email',
    label: 'Email',
    description: 'Best available work email address.',
    defaultCost: 1.0,
  },
]

const INSIGHT_FIELDS = FIELD_OPTIONS.filter((option) => !['phone', 'email'].includes(option.key))

const getItemId = (item) => item.itemId || item.id

const fieldValueExists = (enrichment = {}, fieldKey) => {
  const value = enrichment?.[fieldKey]
  if (typeof value === 'string') {
    return value.trim().length > 0
  }
  return Boolean(value)
}

function formatInsightValue(value, maxLength = 180) {
  if (!value) return '—'
  if (typeof value !== 'string') {
    return String(value)
  }
  if (value.length > maxLength) {
    return `${value.slice(0, maxLength).trim()}…`
  }
  return value
}

const hasContactInfo = (item = {}) => {
  const enrichment = item.enrichment || {}
  return (
    fieldValueExists(enrichment, 'email') ||
    fieldValueExists(enrichment, 'phone') ||
    (enrichment.linkedinUrl && enrichment.linkedinUrl.trim())
  )
}

function bucketizeRecency(iso) {
  if (!iso) return 'older'
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays <= 7) return '7d'
  if (diffDays <= 30) return '30d'
  if (diffDays <= 90) return '90d'
  return 'older'
}

function formatScore(score, item) {
  if ((score === undefined || score === null || score === 0) && item?.evaluations?.length > 0) {
    const satisfiedCount = item.evaluations.filter(e => e.satisfied === 'yes').length
    return Math.round((satisfiedCount / item.evaluations.length) * 100)
  }
  if (score === undefined || score === null) return '—'
  return Math.round(score)
}

export default function LeadsetDetail() {
  const { leadsetId } = useParams()
  const navigate = useNavigate()
  
  // Get data from cache (reads from Firebase via FN7 SDK)
  const { leadset, run, items, settings, isLoading, error, isInitialized, refreshLeadset } = useLeadsetCache(leadsetId)
  
  // Local UI state
  const [websetItems, setWebsetItems] = useState([]) // Items from Exa webset polling
  const [activeFilters, setActiveFilters] = useState(DEFAULT_FILTERS)
  const [selectedFields, setSelectedFields] = useState(() => new Set(FIELD_OPTIONS.map((opt) => opt.key)))
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  const [isExtendModalOpen, setIsExtendModalOpen] = useState(false)
  const [existingItemCount, setExistingItemCount] = useState(0)
  const [isRequestingRun, setIsRequestingRun] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isEnrichmentRequesting, setIsEnrichmentRequesting] = useState(false)
  const [isCancelingRun, setIsCancelingRun] = useState(false)
  const [websetData, setWebsetData] = useState(null)
  const [toast, setToast] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [recentlyEnrichedIds, setRecentlyEnrichedIds] = useState(() => new Set())
  const [expandedSnippets, setExpandedSnippets] = useState(() => new Set())
  const [isRefreshing, setIsRefreshing] = useState(false)
  
  const PAGE_SIZE = 10
  const toastTimeoutRef = useRef(null)
  const websetPollIntervalRef = useRef(null)
  const recentHighlightTimeoutRef = useRef(null)
  const lastPolledRunIdRef = useRef(null)

  const showLoading = isLoading || !isInitialized || isRequestingRun
  
  // Check if a run is currently active (for showing table loading indicator)
  const derivedWebsetStatus = websetData?.status?.toLowerCase() || ''
  const isRunActive = ['running', 'processing', 'pending'].includes(derivedWebsetStatus)

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type })
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    toastTimeoutRef.current = setTimeout(() => setToast(null), 5000)
  }, [])

  const toggleFieldSelection = useCallback((fieldKey) => {
    setSelectedFields((prev) => {
      const next = new Set(prev)
      if (next.has(fieldKey)) {
        next.delete(fieldKey)
      } else {
        next.add(fieldKey)
      }
      return next
    })
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
      if (recentHighlightTimeoutRef.current) clearTimeout(recentHighlightTimeoutRef.current)
      if (websetPollIntervalRef.current) clearInterval(websetPollIntervalRef.current)
    }
  }, [])

  // Clear isRequestingRun when new run data appears
  useEffect(() => {
    if (isRequestingRun && run?.id) {
      const timer = setTimeout(() => setIsRequestingRun(false), 500)
      return () => clearTimeout(timer)
    }
  }, [isRequestingRun, run?.id])

  // Process items from cache
  const finalItems = useMemo(() => {
    return Array.isArray(items) ? items.map(item => ({ ...item, __source: 'firebase' })) : []
  }, [items])

  // Start polling for webset status
  const startWebsetPolling = useCallback((runId) => {
    if (websetPollIntervalRef.current) {
      clearInterval(websetPollIntervalRef.current)
      websetPollIntervalRef.current = null
    }

    const fetchAndUpdateWebset = async () => {
      try {
        const webset = await fetchWebsetStatus(leadsetId, runId)
        setWebsetData(webset)
        
        // Update websetItems with items from Exa
        if (webset?.items && Array.isArray(webset.items)) {
          setWebsetItems(webset.items.map(item => ({ ...item, __source: 'webset' })))
        }
        
        const isRunning = ['running', 'processing', 'pending'].includes(webset?.status)
        if (!isRunning && websetPollIntervalRef.current) {
          clearInterval(websetPollIntervalRef.current)
          websetPollIntervalRef.current = null
          // Refresh cache when run completes to get items from Firebase
          refreshLeadset()
        }
      } catch (err) {
        console.error('Failed to fetch webset status:', err)
      }
    }
    
    fetchAndUpdateWebset()
    websetPollIntervalRef.current = setInterval(fetchAndUpdateWebset, 3000)
  }, [leadsetId, refreshLeadset])

  // Auto-start polling if we land on a page with an already running run
  useEffect(() => {
    const activeStatuses = ['running', 'processing', 'pending']
    const currentStatus = (run?.status || '').toLowerCase()

    if (run?.id && activeStatuses.includes(currentStatus)) {
      if (lastPolledRunIdRef.current !== run.id) {
        lastPolledRunIdRef.current = run.id
        startWebsetPolling(run.id)
      }
    } else {
      lastPolledRunIdRef.current = null
    }
  }, [run?.id, run?.status, startWebsetPolling])

  // Execute run with specific mode and count
  const executeRun = useCallback(async (mode = 'new', count = 10) => {
    setIsRequestingRun(true)
    setWebsetData(null)
    setIsExtendModalOpen(false)
    
    try {
      const runDoc = await startLeadsetRun(leadsetId, { mode, count })
      
      if (runDoc?.id) {
        startWebsetPolling(runDoc.id)
        showToast(
          mode === 'extend'
            ? `Adding ${count} more leads...`
            : mode === 'replace'
              ? 'Starting fresh with new leads...'
              : 'Starting run...',
          'info'
        )
      }
    } catch (err) {
      console.error(err)
      let errorMessage = err.message || 'Unable to start run'
      if (err.code === 'QUOTA_EXCEEDED' || err.message?.includes('quota')) {
        errorMessage = err.message || 'Exa API quota exceeded. Please try again later.'
      }
      showToast(errorMessage, 'error')
      setIsRequestingRun(false)
    }
  }, [leadsetId, showToast, startWebsetPolling])

  const totalBuyerCount = finalItems.length + websetItems.length
  const hasExistingWebset = Boolean(run?.websetId || leadset?.websetId)
  const showRunButton = !hasExistingWebset
  const showExtendButton = hasExistingWebset
  const disableExtend = ['running', 'processing', 'pending'].includes(derivedWebsetStatus) || isRequestingRun

  const handleStartNewRun = useCallback(() => {
    if (websetPollIntervalRef.current) {
      clearInterval(websetPollIntervalRef.current)
      websetPollIntervalRef.current = null
    }
    executeRun('new', 10)
  }, [executeRun])

  const openExtendModal = useCallback(() => {
    if (websetPollIntervalRef.current) {
      clearInterval(websetPollIntervalRef.current)
      websetPollIntervalRef.current = null
    }
    setExistingItemCount(totalBuyerCount)
    setIsExtendModalOpen(true)
  }, [totalBuyerCount])

  // Extract filter values for explicit dependency tracking
  const searchTerm = activeFilters.search
  const hasContactFilter = activeFilters.hasContact
  const recencyFilter = activeFilters.recency

  const dedupedItems = useMemo(() => {
    const allItems = [...websetItems, ...finalItems]
    const itemMap = new Map()
    allItems.forEach((item) => {
      const itemId = getItemId(item)
      if (!itemId) return
      const existing = itemMap.get(itemId)
      if (!existing || item.__source === 'firebase') {
        itemMap.set(itemId, item)
      }
    })
    return Array.from(itemMap.values())
  }, [finalItems, websetItems])

  // Filtered items - using explicit dependencies to ensure re-computation
  const filteredItems = useMemo(() => {
    return dedupedItems.filter((item) => {
      // Recency filter
      if (recencyFilter.length) {
        const bucket = bucketizeRecency(item.recency)
        if (!recencyFilter.includes(bucket)) return false
      }
      // Has contact filter
      if (hasContactFilter && !hasContactInfo(item)) {
        return false
      }
      // Search filter
      if (searchTerm) {
        const term = searchTerm.trim().toLowerCase()
        if (term.length) {
          const company = (item.entity?.company || '').toLowerCase()
          const domain = (item.entity?.domain || '').toLowerCase()
          const snippet = (item.snippet || '').toLowerCase()
          if (!company.includes(term) && !domain.includes(term) && !snippet.includes(term)) {
            return false
          }
        }
      }
      return true
    })
  }, [dedupedItems, searchTerm, hasContactFilter, recencyFilter])

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))

  useEffect(() => {
    setCurrentPage(1)
  }, [leadsetId, filteredItems.length])

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredItems.slice(start, start + PAGE_SIZE)
  }, [filteredItems, currentPage])

  const isFilterActive = Boolean(searchTerm?.trim()) || hasContactFilter || recencyFilter.length > 0

  const toggleFilter = (key, value) => {
    setActiveFilters((prev) => {
      const current = prev[key] || []
      const exists = current.includes(value)
      return { ...prev, [key]: exists ? current.filter((v) => v !== value) : [...current, value] }
    })
  }

  const handleSearchFilter = (e) => {
    setActiveFilters((prev) => ({ ...prev, search: e.target.value }))
  }

  const toggleHasContactFilter = () => {
    setActiveFilters((prev) => ({ ...prev, hasContact: !prev.hasContact }))
  }

  const toggleSnippetExpansion = useCallback((itemId) => {
    setExpandedSnippets((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }, [])

  // Handle refresh with loading state
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await refreshLeadset()
    } finally {
      // Add a small delay for UX
      setTimeout(() => setIsRefreshing(false), 500)
    }
  }, [refreshLeadset])

  // Handle unlock (enrichment) - calls backend API
  // Enriches the entire webset (all leads)
  const handleUnlock = async () => {
    if (!leadsetId || !run?.id) return

    const selectedFieldList = Array.from(selectedFields)
    if (!selectedFieldList.length) {
      showToast('Select at least one data type to unlock.', 'error')
      return
    }

    setIsEnrichmentRequesting(true)

    try {
      const result = await requestEnrichment(leadsetId, run.id, selectedFieldList)
      const enrichmentId = result.enrichmentId
      setIsDetailsModalOpen(false)

      if (enrichmentId) {
        let pollCount = 0
        const maxPolls = 100

        const pollInterval = setInterval(async () => {
          pollCount++
          try {
            const enrichmentStatus = await getEnrichmentStatus(leadsetId, run.id, enrichmentId)
            const status = enrichmentStatus.status

            if (['completed', 'done'].includes(status)) {
              clearInterval(pollInterval)
              setIsEnrichmentRequesting(false)
              refreshLeadset()
              if (recentHighlightTimeoutRef.current) clearTimeout(recentHighlightTimeoutRef.current)
              showToast('Enrichment completed for all leads in this webset', 'success')
            } else if (status === 'failed') {
              clearInterval(pollInterval)
              setIsEnrichmentRequesting(false)
              showToast('Enrichment failed. Please try again.', 'error')
            } else if (pollCount >= maxPolls) {
              clearInterval(pollInterval)
              setIsEnrichmentRequesting(false)
              showToast('Enrichment is taking longer than expected. Please refresh.', 'info')
            }
          } catch (pollError) {
            console.error('Polling error:', pollError)
            if (pollCount >= maxPolls) {
              clearInterval(pollInterval)
              setIsEnrichmentRequesting(false)
            }
          }
        }, 3000)
      } else {
        setIsEnrichmentRequesting(false)
      }
    } catch (err) {
      console.error(err)
      setIsEnrichmentRequesting(false)
      showToast(err.response?.data?.message || err.message || 'Unable to request enrichment', 'error')
    }
  }

  // Handle download - calls backend API
  const handleDownload = async () => {
    if (!run?.id) return
    setIsExporting(true)
    try {
      await exportRun(leadsetId, run.id)
    } catch (err) {
      console.error(err)
      showToast(err.message || 'Unable to export CSV', 'error')
    } finally {
      setIsExporting(false)
    }
  }

  // Handle cancel run - calls backend API
  const handleCancelRun = async () => {
    if (!run?.id || !leadsetId) {
      showToast('No run available to cancel.', 'error')
      return
    }
    
    if (!window.confirm('Are you sure you want to cancel this run?')) return
    
    setIsCancelingRun(true)
    try {
      await cancelRun(leadsetId, run.id)
      if (websetPollIntervalRef.current) {
        clearInterval(websetPollIntervalRef.current)
        websetPollIntervalRef.current = null
      }
      refreshLeadset()
    } catch (err) {
      console.error('Error canceling run:', err)
      showToast(err.message || 'Unable to cancel run', 'error')
    } finally {
      setIsCancelingRun(false)
    }
  }

  // Computed stats
  const latestStats = useMemo(() => {
    return {
      runId: run?.id || null,
      status: run?.status || leadset?.status || 'idle',
      analyzed: run?.counters?.analyzed ?? 0,
      found: run?.counters?.found ?? finalItems.length,
      enriched: run?.counters?.enriched ?? finalItems.filter(hasContactInfo).length,
    }
  }, [run, leadset, finalItems])

  const overallStats = useMemo(() => {
    const uniqueKeys = new Set()
    finalItems.forEach((item) => {
      const key = item.entity?.company?.toLowerCase() || 
                  item.entity?.domain?.toLowerCase() || 
                  item.sourceUrl?.toLowerCase() || 
                  getItemId(item)
      if (key) uniqueKeys.add(key)
    })
    
    return {
      totalBuyers: finalItems.length,
      totalEnriched: finalItems.filter(hasContactInfo).length,
      totalUniqueBuyers: uniqueKeys.size,
    }
  }, [finalItems])

  const overallEnrichmentRate = useMemo(() => {
    if (!overallStats.totalBuyers) return 0
    return Math.round((overallStats.totalEnriched / overallStats.totalBuyers) * 100)
  }, [overallStats])

  const activeStatus = latestStats.status || 'idle'
  const normalizedStatus = activeStatus.toLowerCase()
  const statusClass = statusClassMap[normalizedStatus] ?? statusClassMap.idle
  // Prioritize run.status over websetData.status, especially for terminal states
  // When run is idle/completed, use that instead of websetData which might be stale
  const shouldUseRunStatus = ['idle', 'completed', 'failed'].includes(normalizedStatus)
  const finalWebsetStatus = shouldUseRunStatus 
    ? normalizedStatus 
    : (websetData?.status?.toLowerCase() || normalizedStatus)
  const statusDisplayText = finalWebsetStatus.charAt(0).toUpperCase() + finalWebsetStatus.slice(1)
  const fieldCostOverrides = settings?.cost?.fields || null
  const fieldCostMap = useMemo(() => {
    return FIELD_OPTIONS.reduce((acc, option) => {
      const overrideValue = fieldCostOverrides?.[option.key]
      const parsedValue =
        typeof overrideValue === 'number' && !Number.isNaN(overrideValue)
          ? overrideValue
          : option.defaultCost
      acc[option.key] = parsedValue
      return acc
    }, {})
  }, [fieldCostOverrides])
  const perBuyerCost = useMemo(() => {
    if (!selectedFields.size) return 0
    let total = 0
    selectedFields.forEach((field) => {
      total += fieldCostMap[field] ?? 0
    })
    return total
  }, [selectedFields, fieldCostMap])
  const totalBuyersInWebset = filteredItems.length
  const estimatedCost = totalBuyersInWebset * perBuyerCost

  // Error state
  if (error && !leadset && isInitialized && !isLoading) {
    return (
      <main className="page">
        <div className="page-header">
          <div style={{ fontSize: '20px', color: '#737373', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span onClick={() => navigate('/leadsets')} style={{ cursor: 'pointer', color: '#737373' }}>Leadsets</span>
            <span>&gt;</span>
            <span style={{ fontWeight: 600, color: '#000000' }}>Leads</span>
          </div>
        </div>
        <div style={{ padding: '24px', textAlign: 'center', marginTop: '48px' }}>
          <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: '#f44336' }}>
            ⚠️ Error Loading Leadset
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
            {error}
          </div>
          <button className="cta-primary" type="button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </main>
    )
  }

  // Loading state
  if (showLoading || !leadset) {
    return (
      <main className="page">
        <div className="page-header">
          <div style={{ fontSize: '20px', color: '#737373', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span onClick={() => navigate('/leadsets')} style={{ cursor: 'pointer', color: '#737373' }}>Leadsets</span>
            <span>&gt;</span>
            <span style={{ fontWeight: 600, color: '#000000' }}>Leads</span>
          </div>
        </div>
        <div style={{ marginBottom: '24px' }}>
          <FN7FactRotator interval={4000} />
        </div>
        <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          <div style={{ fontSize: '16px', marginBottom: '8px', fontWeight: 500 }}>
            🔍 Loading leadset details...
          </div>
          <div style={{ fontSize: '13px', opacity: 0.7 }}>
            This only happens on first visit. Subsequent loads are instant thanks to our smart caching!
          </div>
        </div>
        <div className="table-shell">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Signal snippet</th>
                  <th>Buyer context</th>
                  <th>Score</th>
                  <th>Contact & channels</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {[...Array(8)].map((_, i) => (
                  <BuyerItemSkeleton key={`skeleton-${i}`} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="page">
      <div className="page-header">
        <div style={{ fontSize: '20px', color: '#737373', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span onClick={() => navigate('/leadsets')} style={{ cursor: 'pointer', color: '#737373' }}>Leadsets</span>
          <span>&gt;</span>
          <span style={{ fontWeight: 600, color: '#000000' }}>Leads</span>
        </div>
        <div className="selection-actions">
          {showRunButton && (
            <button className="cta-secondary" type="button" onClick={handleStartNewRun} disabled={isRequestingRun}>
              <span className="material-icons">{isRequestingRun ? 'sync' : 'play_arrow'}</span>&nbsp;
              {isRequestingRun ? 'Starting…' : 'Run leadset'}
            </button>
          )}
          {showExtendButton && !disableExtend && (
            <button
              type="button"
              onClick={openExtendModal}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: 600,
                borderRadius: '8px',
                border: '1px solid transparent',
                backgroundImage: 'linear-gradient(white, white), linear-gradient(to right, #FF6C57, #B56AF1)',
                backgroundOrigin: 'border-box',
                backgroundClip: 'padding-box, border-box',
                color: '#000000',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s ease'
              }}
            >
              <span className="material-icons" style={{ fontSize: '18px' }}>add_circle</span>
              Add leads
            </button>
          )}
          {['running', 'processing', 'pending'].includes(derivedWebsetStatus) && (
            <button
              type="button"
              onClick={handleCancelRun}
              disabled={isCancelingRun || !run?.id}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: 600,
                borderRadius: '8px',
                border: '1px solid transparent',
                backgroundImage: 'linear-gradient(white, white), linear-gradient(to right, #FF6C57, #B56AF1)',
                backgroundOrigin: 'border-box',
                backgroundClip: 'padding-box, border-box',
                color: '#000000',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s ease'
              }}
            >
              <span className="material-icons" style={{ fontSize: '18px' }}>stop</span>
              {isCancelingRun ? 'Canceling…' : run?.mode === 'extend' ? 'Cancel leads' : 'Cancel run'}
            </button>
          )}
          <button
            type="button"
            onClick={handleDownload}
            disabled={!run?.id || isExporting || !latestStats.found}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: 600,
              borderRadius: '8px',
              border: 'none',
              background: '#000000',
              color: '#ffffff',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s ease'
            }}
          >
            <span className="material-icons" style={{ fontSize: '18px' }}>download</span>
            {isExporting ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
      </div>

      {toast && (
        <div style={{ padding: '1px', background: 'linear-gradient(to right, #FF6C57, #B56AF1)', borderRadius: '8px', marginBottom: '16px' }}>
          <div style={{ position: 'relative', background: 'white', borderRadius: '7px' }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '7px', background: 'linear-gradient(to right, #FF6C57, #B56AF1)', opacity: 0.05, pointerEvents: 'none' }} />
            <div className={`toast toast-${toast.type}`} style={{ position: 'relative', zIndex: 1, background: 'transparent', marginBottom: 0 }}>
              <span>{toast.message}</span>
              <button type="button" onClick={() => setToast(null)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}>
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="status-pill status-failed" style={{ marginBottom: '12px', padding: '12px 16px' }}>
          Error: {error}
        </div>
      )}

      {isEnrichmentRequesting && (
        <div className="status-pill" style={{ marginBottom: '12px', backgroundColor: '#2196f3', color: 'white', padding: '12px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="material-icons" style={{ animation: 'spin 1s linear infinite' }}>sync</span>
          <span>Enriching contact details... This may take a few moments.</span>
        </div>
      )}

      {websetData && (
        <div className="status-pill" style={{
          marginBottom: '12px',
          background: 'linear-gradient(to right, rgba(255, 108, 87, 0.2), rgba(181, 106, 241, 0.2))',
          color: '#000000',
          padding: '12px 16px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          border: '1px solid #d0d0d0',
        }}>
          <div style={{ flex: 1 }}>
            <strong>Status:</strong> {statusDisplayText}
            {['running', 'processing'].includes(finalWebsetStatus) && ' (updating every 3s...)'}
          </div>
        </div>
      )}

      <div style={{ marginBottom: '0px' }}>
        <h2 className="detail-title">{leadset.name}</h2>
      </div>

      <section className="filter-bar" style={{ marginTop: '-8px' }}>
        <div className="filter-quick" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', flexBasis: '100%' }}>
          <div className="search-input-wrapper" style={{ flexBasis: '100%', position: 'relative' }}>
            <span className="material-icons search-input-icon" style={{ position: 'absolute', left: '16px', fontSize: '20px', color: '#666', pointerEvents: 'none' }}>search</span>
            <input
              className="search-input"
              type="search"
              value={activeFilters.search}
              onChange={handleSearchFilter}
              placeholder="Search company, domain or snippet"
              style={{
                width: '100%',
                padding: '14px 16px 14px 48px',
                fontSize: '15px',
                border: '1px solid rgba(0, 0, 0, 0.3)',
                borderRadius: '10px',
                outline: 'none',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                fontWeight: 400
              }}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            <button type="button" onClick={toggleHasContactFilter} className={`filter-chip ${activeFilters.hasContact ? 'active' : ''}`}>
              Has contact info
            </button>
            {RECENCY_BUCKETS.map((bucket) => (
              <button
                key={bucket.key}
                className={`filter-chip ${activeFilters.recency.includes(bucket.key) ? 'active' : ''}`}
                type="button"
                onClick={() => toggleFilter('recency', bucket.key)}
              >
                {bucket.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="table-shell">
        <div className="selection-toolbar">
          <span className="toolbar-label">
            {filteredItems.length} lead{filteredItems.length !== 1 ? 's' : ''}
            {isRunActive && (
              <span style={{ marginLeft: '12px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'linear-gradient(to right, #FF6C57, #B56AF1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                <span className="material-icons" style={{ fontSize: '16px', animation: 'spin 1s linear infinite', background: 'linear-gradient(to right, #FF6C57, #B56AF1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>sync</span>
                Fetching new leads...
              </span>
            )}
            {isRefreshing && (
              <span style={{ marginLeft: '12px', color: '#2196f3', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-icons" style={{ fontSize: '16px', animation: 'spin 1s linear infinite' }}>sync</span>
                Refreshing...
              </span>
            )}
          </span>
          <div className="selection-actions">
            <button
              className="icon-button"
              type="button"
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
              aria-label="Refresh data"
              style={{ padding: '8px', border: 'none', background: 'transparent' }}
            >
              <span
                className="material-icons"
                style={{ fontSize: '20px', animation: isRefreshing ? 'spin 1s linear infinite' : 'none', color: '#000000' }}
              >
                {isRefreshing ? 'sync' : 'refresh'}
              </span>
            </button>
            <button
              type="button"
              disabled={!run?.id || filteredItems.length === 0}
              onClick={() => setIsDetailsModalOpen(true)}
              style={{
                padding: '12px 20px',
                fontSize: '14px',
                fontWeight: 600,
                borderRadius: '8px',
                border: 'none',
                background: 'linear-gradient(to right, #FF6C57, #B56AF1)',
                color: '#ffffff',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s ease'
              }}
            >
              Get more details
            </button>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Signal snippet</th>
                <th>Buyer context</th>
                <th>Score</th>
                <th>Contact & channels</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {showLoading && !paginatedItems.length ? (
                [...Array(8)].map((_, i) => <BuyerItemSkeleton key={`skeleton-${i}`} />)
              ) : (
                paginatedItems.map((item) => {
                  const itemId = getItemId(item)
                  const isRecentlyEnriched = recentlyEnrichedIds.has(itemId)
                  const snippetText = item.snippet || ''
                  const isSnippetExpanded = expandedSnippets.has(itemId)
                  const shouldTruncateSnippet = snippetText.length > SNIPPET_PREVIEW_LENGTH
                  const displayedSnippet = !isSnippetExpanded && shouldTruncateSnippet
                    ? `${snippetText.slice(0, SNIPPET_PREVIEW_LENGTH).trim()}…`
                    : snippetText
                  return (
                    <tr key={itemId} className={isRecentlyEnriched ? 'recently-enriched' : ''}>
                      <td>
                        {item.sourceUrl ? (
                          <a href={item.sourceUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 500, marginBottom: '4px', color: '#000000', textDecoration: 'none', display: 'block', cursor: 'pointer' }}>
                            {item.entity?.company || '—'}
                          </a>
                        ) : (
                          <div style={{ fontWeight: 500, marginBottom: '4px' }}>{item.entity?.company || '—'}</div>
                        )}
                        {item.entity?.domain && <div style={{ fontSize: '0.875em', color: '#666' }}>{item.entity.domain}</div>}
                        {item.entityType && (
                          <span className="chip" style={{ marginTop: '6px', display: 'inline-block' }}>
                            {item.entityType === 'person' ? 'Person' : 'Company'}
                          </span>
                        )}
                      </td>
                      <td>
                        <p
                          className={`snippet ${isSnippetExpanded ? 'expanded' : ''}`}
                          style={{ marginBottom: shouldTruncateSnippet ? '8px' : '4px' }}
                        >
                          {displayedSnippet || '—'}
                        </p>
                        {shouldTruncateSnippet && (
                          <button
                            type="button"
                            onClick={() => toggleSnippetExpansion(itemId)}
                            className="link-button"
                            style={{ padding: 0, border: 'none', background: 'none', color: '#1976d2', fontWeight: 500, cursor: 'pointer' }}
                          >
                            {isSnippetExpanded ? 'Show less' : 'Read more'}
                          </button>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {INSIGHT_FIELDS.map((field) => {
                            const value = item.enrichment?.[field.key]
                            return (
                              <div key={`${itemId}-${field.key}`}>
                                <div style={{ fontSize: '0.7em', color: '#475467', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                  {field.label}
                                </div>
                                <div style={{ fontSize: '0.85em', color: value ? '#101828' : '#98a2b3' }}>
                                  {formatInsightValue(value)}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </td>
                      <td>{formatScore(item.score, item)}%</td>
                      <td>
                        {item.enrichment?.email || item.enrichment?.phone ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {item.enrichment?.email && <a href={`mailto:${item.enrichment.email}`} style={{ color: '#1976d2' }}>{item.enrichment.email}</a>}
                            {item.enrichment?.phone && <a href={`tel:${item.enrichment.phone}`} style={{ color: '#1976d2' }}>{item.enrichment.phone}</a>}
                          </div>
                        ) : (
                          <span style={{ color: '#999' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span className={`enrichment-pill enrichment-${item.enrichment?.status || 'none'}`}>
                          {item.enrichment?.status || 'none'}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
              {!showLoading && !filteredItems.length && (
                <tr>
                  <td colSpan="6">
                    <div className="empty-state">No leads match the current filters. Clear filters to see all results.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filteredItems.length > PAGE_SIZE && (
          <div className="pagination">
            <span style={{ fontSize: '0.9em', color: '#475467' }}>
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredItems.length)} of {filteredItems.length} leads
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="cta-secondary" type="button" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>« First</button>
              <button className="cta-secondary" type="button" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>‹ Prev</button>
              <span style={{ alignSelf: 'center', fontSize: '0.9em', color: '#475467' }}>Page {currentPage} / {totalPages}</span>
              <button className="cta-secondary" type="button" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next ›</button>
              <button className="cta-secondary" type="button" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>Last »</button>
            </div>
          </div>
        )}
      </section>

      {isDetailsModalOpen && (
        <UnlockModal
          count={totalBuyersInWebset}
          fieldOptions={FIELD_OPTIONS}
          selectedFields={selectedFields}
          onToggleField={toggleFieldSelection}
          costByField={fieldCostMap}
          perBuyerCost={perBuyerCost}
          estimatedCost={estimatedCost}
          onCancel={() => setIsDetailsModalOpen(false)}
          onConfirm={handleUnlock}
          loading={isEnrichmentRequesting}
        />
      )}

      {isExtendModalOpen && (
        <RunOptionsModal
          itemCount={existingItemCount}
          onExtend={(count) => executeRun('extend', count)}
          onCancel={() => setIsExtendModalOpen(false)}
          loading={isRequestingRun}
        />
      )}
    </main>
  )
}
