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

// Helper function to highlight important words in snippet
const highlightSnippet = (text) => {
  if (!text) return text

  // Words to highlight: capitalized words, quoted text, numbers with units
  const parts = []
  const regex = /(".*?"|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b|\b\d+%|\$\d+(?:,\d{3})*(?:\.\d+)?[KMB]?|\b\d+[+]?\b)/g

  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index))
    }

    // Add highlighted match
    parts.push(
      <span
        key={match.index}
        style={{
          fontWeight: 600,
          color: '#000000'
        }}
      >
        {match[0]}
      </span>
    )

    lastIndex = regex.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }

  return parts.length > 0 ? parts : text
}

/**
 * BASE_FIELD_OPTIONS
 * 
 * All supported enrichment fields with UI metadata.
 * These are filtered per-leadset based on enrichment_fields from Firebase.
 * 
 * Categories:
 * - Contact: email, phone, hasLinkedinMessaging, primaryContactChannel
 * - Classification: leadType, geoLocation, employeeCount
 * - Intent: buyingIntent, buyingIntentReason, partnershipIntentLevel, partnershipIntentReason
 */
const BASE_FIELD_OPTIONS = [
  // === CONTACT INFORMATION ===
  {
    key: 'email',
    label: 'Work Email',
    description: 'Professional email address for the primary contact or decision maker.',
    defaultCost: 1.0,
    category: 'contact',
  },
  {
    key: 'phone',
    label: 'Work Phone',
    description: 'Direct phone number in international format.',
    defaultCost: 1.0,
    category: 'contact',
  },
  {
    key: 'linkedinUrl',
    label: 'LinkedIn URL',
    description: 'Direct LinkedIn profile URL for the contact or company.',
    defaultCost: 0.5,
    category: 'contact',
  },
  {
    key: 'primaryContactChannel',
    label: 'Best Contact Channel',
    description: 'The most effective channel to reach this lead (LinkedIn, Email, Phone, etc.).',
    defaultCost: 0.25,
    category: 'contact',
  },

  // === LEAD CLASSIFICATION ===
  {
    key: 'leadType',
    label: 'Lead Type',
    description: 'Classification: Retailer, Distributor, Influencer, Expert, Investor, etc.',
    defaultCost: 0.25,
    category: 'classification',
  },
  {
    key: 'geoLocation',
    label: 'Location',
    description: 'City and country (e.g. "Mumbai, India").',
    defaultCost: 0.25,
    category: 'classification',
  },
  {
    key: 'employeeCount',
    label: 'Company Size',
    description: 'Estimated headcount range (e.g. "51-200").',
    defaultCost: 0.5,
    category: 'classification',
  },

  // === INTENT SIGNALS ===
  {
    key: 'buyingIntent',
    label: 'Buying Intent',
    description: 'High / Medium / Low likelihood to purchase.',
    defaultCost: 0.75,
    category: 'intent',
  },
  {
    key: 'buyingIntentReason',
    label: 'Buying Intent Reason',
    description: 'Brief explanation for the buying intent assessment.',
    defaultCost: 0.25,
    category: 'intent',
  },
  {
    key: 'partnershipIntentLevel',
    label: 'Partnership Intent',
    description: 'High / Medium / Low openness to partnerships.',
    defaultCost: 0.25,
    category: 'intent',
  },
  {
    key: 'partnershipIntentReason',
    label: 'Partnership Intent Reason',
    description: 'Brief explanation for the partnership intent assessment.',
    defaultCost: 0.25,
    category: 'intent',
  },
  {
    key: 'audienceOverlapScore',
    label: 'Audience Overlap',
    description: 'Score 1-10 indicating target audience overlap potential.',
    defaultCost: 0.25,
    category: 'intent',
  },
]

// Map backend/brain enrichment field names -> UI/internal keys
const LEADSET_ENRICHMENT_FIELD_MAP = {
  contact_email: 'email',
  contact_phone: 'phone',
  buying_intent_level: 'buyingIntent',
  company_size_band: 'employeeCount',
  has_linkedin_messaging: 'linkedinUrl',  // Now fetches actual LinkedIn URL
  linkedin_url: 'linkedinUrl',
  primary_contact_channel: 'primaryContactChannel',
  lead_type: 'leadType',
  geo_location: 'geoLocation',
  buying_intent_reason: 'buyingIntentReason',
  partnership_intent_level: 'partnershipIntentLevel',
  partnership_intent_reason: 'partnershipIntentReason',
  audience_overlap_score: 'audienceOverlapScore',
}

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

function capitalizeFirst(value) {
  if (!value || typeof value !== 'string') return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Determine if a leadset is a "Buyer" type or "Partner" type
 * Buyer types: retailer, distributor, platform, investor
 * Partner types: other_b2b, influencer, expert, creator
 */
const BUYER_TARGETS = ['retailer', 'distributor', 'platform', 'investor']
const PARTNER_TARGETS = ['other_b2b', 'influencer', 'expert', 'creator']

function getLeadsetType(leadset) {
  const target = (leadset?.target || '').toLowerCase()
  if (BUYER_TARGETS.includes(target)) return 'buyer'
  if (PARTNER_TARGETS.includes(target)) return 'partner'
  // Check enrichment_fields as fallback
  const fields = leadset?.enrichment_fields || []
  const hasBuyingIntent = fields.includes('buying_intent_level')
  const hasPartnershipIntent = fields.includes('partnership_intent_level')
  if (hasBuyingIntent && !hasPartnershipIntent) return 'buyer'
  if (hasPartnershipIntent && !hasBuyingIntent) return 'partner'
  // Default: if has both or neither, return 'mixed'
  return 'mixed'
}

const hasContactInfo = (item = {}) => {
  const enrichment = item.enrichment || {}
  const hasValidEmail = enrichment.email && enrichment.email !== 'Not found'
  const hasValidPhone = enrichment.phone && enrichment.phone !== 'Not found'
  const hasValidLinkedin = enrichment.linkedinUrl && enrichment.linkedinUrl !== 'Not found' && enrichment.linkedinUrl.trim()
  return (
    hasValidEmail ||
    hasValidPhone ||
    hasValidLinkedin
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
  const { leadset, run, items, settings, isLoading, error, isInitialized, refreshLeadset, refreshCounter } = useLeadsetCache(leadsetId)
  
  // Local UI state
  const [websetItems, setWebsetItems] = useState([]) // Items from Exa webset polling
  const [activeFilters, setActiveFilters] = useState(DEFAULT_FILTERS)
  const [selectedFields, setSelectedFields] = useState(() => new Set())
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
  const [hoveredSnippet, setHoveredSnippet] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  
  const PAGE_SIZE = 10
  const toastTimeoutRef = useRef(null)
  const websetPollIntervalRef = useRef(null)
  const enrichmentPollIntervalRef = useRef(null)
  const recentHighlightTimeoutRef = useRef(null)
  const lastPolledRunIdRef = useRef(null)
  const activeEnrichmentIdRef = useRef(null)

  const showLoading = isLoading || !isInitialized || isRequestingRun
  
  // Derive which enrichment fields are allowed for this leadset (from leadset.enrichment_fields)
  const allowedFieldKeys = useMemo(() => {
    const rawFields = Array.isArray(leadset?.enrichment_fields)
      ? leadset.enrichment_fields
      : []

    const mapped = new Set()
    rawFields.forEach((raw) => {
      const key = LEADSET_ENRICHMENT_FIELD_MAP[raw]
      if (key) {
        mapped.add(key)
      }
    })

    // If none specified on leadset, allow all base options
    if (mapped.size === 0) {
      BASE_FIELD_OPTIONS.forEach((opt) => mapped.add(opt.key))
    }

    return Array.from(mapped)
  }, [leadset])

  const FIELD_OPTIONS = useMemo(() => {
    return BASE_FIELD_OPTIONS.filter((opt) => allowedFieldKeys.includes(opt.key))
  }, [allowedFieldKeys])

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
      if (enrichmentPollIntervalRef.current) clearInterval(enrichmentPollIntervalRef.current)
      activeEnrichmentIdRef.current = null
    }
  }, [])

  // Clear isRequestingRun when new run data appears
  useEffect(() => {
    if (isRequestingRun && run?.id) {
      const timer = setTimeout(() => setIsRequestingRun(false), 500)
      return () => clearTimeout(timer)
    }
  }, [isRequestingRun, run?.id])

  // Process items from cache - depends on refreshCounter to force re-computation
  const finalItems = useMemo(() => {
    console.log('[LeadsetDetail] Recomputing finalItems, refreshCounter:', refreshCounter, 'items:', items?.length)
    return Array.isArray(items) ? items.map(item => ({ ...item, __source: 'firebase' })) : []
  }, [items, refreshCounter])

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

    // Prevent duplicate operations
    if (activeEnrichmentIdRef.current) {
      showToast('An enrichment is already in progress. Please wait.', 'info')
      return
    }

    const selectedFieldList = Array.from(selectedFields)
    if (!selectedFieldList.length) {
      showToast('Select at least one data type to unlock.', 'error')
      return
    }

    setIsEnrichmentRequesting(true)
    // Close modal immediately after starting request
    setIsDetailsModalOpen(false)
    showToast('Enrichment started. Processing leads...', 'info')

    try {
      const result = await requestEnrichment(leadsetId, run.id, selectedFieldList)
      const enrichmentId = result.enrichmentId

      if (enrichmentId) {
        activeEnrichmentIdRef.current = enrichmentId
        let pollCount = 0
        const maxPolls = 100

        // Clear any existing poll interval
        if (enrichmentPollIntervalRef.current) {
          clearInterval(enrichmentPollIntervalRef.current)
        }

        enrichmentPollIntervalRef.current = setInterval(async () => {
          pollCount++
          try {
            const enrichmentStatus = await getEnrichmentStatus(leadsetId, run.id, enrichmentId)
            const status = enrichmentStatus.status

            if (['completed', 'done'].includes(status)) {
              clearInterval(enrichmentPollIntervalRef.current)
              enrichmentPollIntervalRef.current = null
              activeEnrichmentIdRef.current = null
              setIsEnrichmentRequesting(false)
              showToast('Enrichment complete! Data updated.', 'success')
              // Force refresh to get latest data
              refreshLeadset()
              if (recentHighlightTimeoutRef.current) clearTimeout(recentHighlightTimeoutRef.current)
            } else if (status === 'failed') {
              clearInterval(enrichmentPollIntervalRef.current)
              enrichmentPollIntervalRef.current = null
              activeEnrichmentIdRef.current = null
              setIsEnrichmentRequesting(false)
              showToast('Enrichment failed. Please try again.', 'error')
            } else if (pollCount >= maxPolls) {
              clearInterval(enrichmentPollIntervalRef.current)
              enrichmentPollIntervalRef.current = null
              activeEnrichmentIdRef.current = null
              setIsEnrichmentRequesting(false)
              showToast('Enrichment is taking longer than expected. Please refresh.', 'info')
            } else {
              // Refresh data periodically during enrichment to show progress
              if (pollCount % 2 === 0) {
                refreshLeadset()
              }
            }
          } catch (pollError) {
            console.error('Polling error:', pollError)
            if (pollCount >= maxPolls) {
              clearInterval(enrichmentPollIntervalRef.current)
              enrichmentPollIntervalRef.current = null
              activeEnrichmentIdRef.current = null
              setIsEnrichmentRequesting(false)
            }
          }
        }, 2500) // Poll every 2.5 seconds for faster updates
      } else {
        setIsEnrichmentRequesting(false)
      }
    } catch (err) {
      console.error(err)
      activeEnrichmentIdRef.current = null
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
                  <th style={{ paddingRight: '4px' }}>Leads</th>
                  <th style={{ paddingLeft: '0px', transform: 'translateX(5px)', width: '300px', maxWidth: '300px' }}>About leads</th>
                  <th style={{ transform: 'translateX(10px)' }}>Intent</th>
                  <th style={{ transform: 'translateX(-20px)' }}>Employee Count</th>
                  <th>Lead type & geo</th>
                  <th>Score</th>
                  <th style={{ transform: 'translateX(20px)' }}>Contact & channels</th>
                  <th>Intent & partnership notes</th>
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
        <div className="status-pill" style={{ marginBottom: '12px', background: 'linear-gradient(to right, rgba(255, 108, 87, 0.1), rgba(181, 106, 241, 0.1))', color: '#000000', padding: '12px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
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

      <div style={{ marginBottom: '0px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="detail-title">{leadset.name}</h2>
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
          <span className="toolbar-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{filteredItems.length} lead{filteredItems.length !== 1 ? 's' : ''}</span>
            {isRunActive && (
              <span style={{ marginLeft: '4px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'linear-gradient(to right, #FF6C57, #B56AF1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                <span className="material-icons" style={{ fontSize: '16px', animation: 'spin 1s linear infinite', background: 'linear-gradient(to right, #FF6C57, #B56AF1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>sync</span>
                Fetching new leads...
              </span>
            )}
            {isRefreshing && (
              <span style={{ marginLeft: '4px', color: '#2196f3', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-icons" style={{ fontSize: '16px', animation: 'spin 1s linear infinite' }}>sync</span>
                Refreshing...
              </span>
            )}
          </span>
          <div className="selection-actions">
            {showExtendButton && !disableExtend && (
              <button
                type="button"
                onClick={openExtendModal}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: 400,
                  borderRadius: '8px',
                  border: '1px solid #000000',
                  background: 'white',
                  color: '#000000',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
              >
                <span className="material-icons" style={{ fontSize: '18px' }}>add_circle</span>
                Get more leads
              </button>
            )}
            <button
              type="button"
              disabled={!run?.id || filteredItems.length === 0 || isEnrichmentRequesting}
              onClick={() => setIsDetailsModalOpen(true)}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: 600,
                borderRadius: '8px',
                border: 'none',
                background: isEnrichmentRequesting 
                  ? 'linear-gradient(to right, rgba(255, 108, 87, 0.5), rgba(181, 106, 241, 0.5))'
                  : 'linear-gradient(to right, #FF6C57, #B56AF1)',
                color: '#ffffff',
                cursor: isEnrichmentRequesting ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s ease'
              }}
            >
              {isEnrichmentRequesting ? (
                <>
                  <span className="material-icons" style={{ fontSize: '16px', animation: 'spin 1s linear infinite' }}>sync</span>
                  Enriching...
                </>
              ) : (
                'Unlock details'
              )}
            </button>
          </div>
        </div>

        <div className="table-scroll">
            {/* Determine leadset type for column rendering */}
            {(() => {
              const leadsetType = getLeadsetType(leadset)
              const isBuyer = leadsetType === 'buyer' || leadsetType === 'mixed'
              const isPartner = leadsetType === 'partner' || leadsetType === 'mixed'
              
              return (
            <table>
              <thead>
                <tr>
                  {/* Common columns */}
                  <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '140px' }}>Lead</th>
                  <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '200px', maxWidth: '250px' }}>About</th>
                  <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '60px' }}>Score</th>
                  <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '180px' }}>Email</th>
                  <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '120px' }}>Phone</th>
                  <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '90px' }}>LinkedIn</th>
                  <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '100px' }}>Best Channel</th>
                  <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '90px' }}>Lead Type</th>
                  <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '120px' }}>Location</th>
                  
                  {/* Buyer-specific columns */}
                  {isBuyer && <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '80px' }}>Size</th>}
                  {isBuyer && <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '80px' }}>Buy Intent</th>}
                  {isBuyer && <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '180px' }}>Buy Reason</th>}
                  
                  {/* Partner-specific columns */}
                  {isPartner && <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '80px' }}>Partner Intent</th>}
                  {isPartner && <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '180px' }}>Partner Reason</th>}
                  {isPartner && <th style={{ borderRight: '1px solid #e0e0e0', minWidth: '70px' }}>Overlap</th>}
                  
                  <th style={{ minWidth: '70px' }}>Status</th>
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
                      {/* Lead Name */}
                      <td
                        style={{ borderRight: '1px solid #e0e0e0', cursor: item.sourceUrl ? 'pointer' : 'default' }}
                        onClick={(e) => {
                          if (item.sourceUrl && !e.target.closest('a')) {
                            window.open(item.sourceUrl, '_blank', 'noopener,noreferrer')
                          }
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="material-icons" style={{ fontSize: '16px', color: '#667085', flexShrink: 0 }}>
                            {item.entityType === 'company' ? 'business' : 'person'}
                          </span>
                          {item.sourceUrl ? (
                            <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="lead-link">
                              {item.entity?.company || '—'}
                              <span className="lead-link-icon">↗</span>
                            </a>
                          ) : (
                            <span style={{ fontWeight: 500 }}>{item.entity?.company || '—'}</span>
                          )}
                        </div>
                      </td>

                      {/* About / Snippet */}
                      <td style={{ borderRight: '1px solid #e0e0e0', maxWidth: '250px' }}>
                        <div
                          onClick={() => toggleSnippetExpansion(itemId)}
                          onMouseEnter={() => setHoveredSnippet(itemId)}
                          onMouseLeave={() => setHoveredSnippet(null)}
                          style={{ cursor: 'pointer', position: 'relative' }}
                        >
                          <div
                            className="snippet"
                            style={{
                              fontSize: '12px',
                              color: '#475467',
                              lineHeight: '1.4',
                              display: isSnippetExpanded ? 'block' : '-webkit-box',
                              WebkitLineClamp: isSnippetExpanded ? 'unset' : 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {snippetText ? highlightSnippet(snippetText) : '—'}
                          </div>
                          {!isSnippetExpanded && hoveredSnippet === itemId && snippetText && (
                            <span style={{ color: '#1976d2', fontWeight: 500, fontSize: '11px' }}>Read more</span>
                          )}
                        </div>
                      </td>

                      {/* Score */}
                      <td style={{ borderRight: '1px solid #e0e0e0', textAlign: 'center' }}>
                        <span style={{ fontWeight: 600, color: '#101828' }}>{formatScore(item.score, item)}%</span>
                      </td>

                      {/* Email */}
                      <td style={{ borderRight: '1px solid #e0e0e0' }}>
                        {item.enrichment?.email && item.enrichment.email !== 'Not found' ? (
                          <a href={`mailto:${item.enrichment.email}`} style={{ color: '#1976d2', fontSize: '12px', wordBreak: 'break-all' }}>
                            {item.enrichment.email}
                          </a>
                        ) : item.enrichment?.email === 'Not found' ? (
                          <span style={{ color: '#dc2626', fontSize: '12px', fontStyle: 'italic' }}>Not found</span>
                        ) : (
                          <span style={{ color: '#98a2b3' }}>—</span>
                        )}
                      </td>

                      {/* Phone */}
                      <td style={{ borderRight: '1px solid #e0e0e0' }}>
                        {item.enrichment?.phone && item.enrichment.phone !== 'Not found' ? (
                          <a href={`tel:${item.enrichment.phone}`} style={{ color: '#1976d2', fontSize: '12px' }}>
                            {item.enrichment.phone}
                          </a>
                        ) : item.enrichment?.phone === 'Not found' ? (
                          <span style={{ color: '#dc2626', fontSize: '12px', fontStyle: 'italic' }}>Not found</span>
                        ) : (
                          <span style={{ color: '#98a2b3' }}>—</span>
                        )}
                      </td>

                      {/* LinkedIn URL */}
                      <td style={{ borderRight: '1px solid #e0e0e0' }}>
                        {item.enrichment?.linkedinUrl && item.enrichment.linkedinUrl !== 'Not found' ? (
                          <a 
                            href={item.enrichment.linkedinUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            style={{ color: '#0077b5', fontSize: '12px' }}
                          >
                            View ↗
                          </a>
                        ) : item.enrichment?.linkedinUrl === 'Not found' ? (
                          <span style={{ color: '#dc2626', fontSize: '12px', fontStyle: 'italic' }}>Not found</span>
                        ) : (
                          <span style={{ color: '#98a2b3' }}>—</span>
                        )}
                      </td>

                      {/* Best Contact Channel */}
                      <td style={{ borderRight: '1px solid #e0e0e0' }}>
                        <span style={{ 
                          color: item.enrichment?.primaryContactChannel ? '#101828' : '#98a2b3',
                          fontSize: '12px'
                        }}>
                          {formatInsightValue(item.enrichment?.primaryContactChannel, 40)}
                        </span>
                      </td>

                      {/* Lead Type */}
                      <td style={{ borderRight: '1px solid #e0e0e0' }}>
                        <span style={{ 
                          color: item.enrichment?.leadType ? '#101828' : '#98a2b3',
                          fontSize: '12px',
                          fontWeight: item.enrichment?.leadType ? 500 : 400
                        }}>
                          {formatInsightValue(item.enrichment?.leadType, 40)}
                        </span>
                      </td>

                      {/* Location */}
                      <td style={{ borderRight: '1px solid #e0e0e0' }}>
                        <span style={{ 
                          color: item.enrichment?.geoLocation ? '#101828' : '#98a2b3',
                          fontSize: '12px'
                        }}>
                          {formatInsightValue(item.enrichment?.geoLocation, 50)}
                        </span>
                      </td>

                      {/* Buyer-specific: Company Size */}
                      {isBuyer && (
                        <td style={{ borderRight: '1px solid #e0e0e0', textAlign: 'center' }}>
                          <span style={{ 
                            color: item.enrichment?.employeeCount ? '#101828' : '#98a2b3',
                            fontSize: '12px'
                          }}>
                            {formatInsightValue(item.enrichment?.employeeCount)}
                          </span>
                        </td>
                      )}

                      {/* Buyer-specific: Buying Intent */}
                      {isBuyer && (
                        <td style={{ borderRight: '1px solid #e0e0e0', textAlign: 'center' }}>
                          <span style={{ 
                            color: item.enrichment?.buyingIntent === 'high' ? '#16a34a' 
                                 : item.enrichment?.buyingIntent === 'medium' ? '#ca8a04'
                                 : item.enrichment?.buyingIntent === 'low' ? '#dc2626'
                                 : '#98a2b3',
                            fontWeight: item.enrichment?.buyingIntent ? 600 : 400,
                            fontSize: '12px'
                          }}>
                            {capitalizeFirst(formatInsightValue(item.enrichment?.buyingIntent))}
                          </span>
                        </td>
                      )}

                      {/* Buyer-specific: Buying Intent Reason */}
                      {isBuyer && (
                        <td style={{ borderRight: '1px solid #e0e0e0' }}>
                          <span style={{ 
                            color: item.enrichment?.buyingIntentReason ? '#475467' : '#98a2b3',
                            fontSize: '11px',
                            lineHeight: '1.3'
                          }}>
                            {formatInsightValue(item.enrichment?.buyingIntentReason, 100)}
                          </span>
                        </td>
                      )}

                      {/* Partner-specific: Partnership Intent */}
                      {isPartner && (
                        <td style={{ borderRight: '1px solid #e0e0e0', textAlign: 'center' }}>
                          <span style={{ 
                            color: item.enrichment?.partnershipIntentLevel?.toLowerCase() === 'high' ? '#16a34a' 
                                 : item.enrichment?.partnershipIntentLevel?.toLowerCase() === 'medium' ? '#ca8a04'
                                 : item.enrichment?.partnershipIntentLevel?.toLowerCase() === 'low' ? '#dc2626'
                                 : '#98a2b3',
                            fontWeight: item.enrichment?.partnershipIntentLevel ? 600 : 400,
                            fontSize: '12px'
                          }}>
                            {capitalizeFirst(formatInsightValue(item.enrichment?.partnershipIntentLevel))}
                          </span>
                        </td>
                      )}

                      {/* Partner-specific: Partnership Intent Reason */}
                      {isPartner && (
                        <td style={{ borderRight: '1px solid #e0e0e0' }}>
                          <span style={{ 
                            color: item.enrichment?.partnershipIntentReason ? '#475467' : '#98a2b3',
                            fontSize: '11px',
                            lineHeight: '1.3'
                          }}>
                            {formatInsightValue(item.enrichment?.partnershipIntentReason, 100)}
                          </span>
                        </td>
                      )}

                      {/* Partner-specific: Audience Overlap Score */}
                      {isPartner && (
                        <td style={{ borderRight: '1px solid #e0e0e0', textAlign: 'center' }}>
                          <span style={{ 
                            color: item.enrichment?.audienceOverlapScore ? '#101828' : '#98a2b3',
                            fontWeight: item.enrichment?.audienceOverlapScore ? 600 : 400,
                            fontSize: '12px'
                          }}>
                            {formatInsightValue(item.enrichment?.audienceOverlapScore)}
                          </span>
                        </td>
                      )}

                      {/* Status */}
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
                  <td colSpan={9 + (isBuyer ? 3 : 0) + (isPartner ? 3 : 0) + 1}>
                    <div className="empty-state">No leads match the current filters. Clear filters to see all results.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
              )
            })()}
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
