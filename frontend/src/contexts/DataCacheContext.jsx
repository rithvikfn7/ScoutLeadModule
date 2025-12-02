import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import sdk from '../sdk'
import { useSessionId } from '../hooks/useSessionId'

const DataCacheContext = createContext(null)

/**
 * DataCacheContext - Listens to aggregated leadset feed document
 * Backend writes to `leadsetFeed/global` whenever data changes.
 * Filters leadsets by sessionId if provided.
 */
export function DataCacheProvider({ children }) {
  const { sessionId } = useSessionId()
  const [feedData, setFeedData] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [refreshCounter, setRefreshCounter] = useState(0)
  const lastUpdateRef = useRef(null)

  const applyFeedData = useCallback((data, force = false) => {
    if (!data) {
      return
    }
    // Avoid duplicate updates with same timestamp (unless forced)
    if (!force && lastUpdateRef.current === data.updatedAt) {
      console.log('[Data] Skipping duplicate update with same timestamp')
      return
    }
    lastUpdateRef.current = data.updatedAt
    console.log('[Data] Applying feed data update:', data.updatedAt, 'leadsets:', data.leadsets?.length)
    setFeedData(data)
    setIsInitialized(true)
    setIsLoading(false)
    setError(null)
    setRefreshCounter(c => c + 1) // Force re-render on every update
  }, [])

  const refreshCache = useCallback(async (force = false) => {
    console.log('[Data] Manually refreshing cache...', force ? '(forced)' : '')
    // Reset last update ref if forcing to ensure we get fresh data
    if (force) {
      lastUpdateRef.current = null
    }
    try {
      const snapshot = await sdk.getFirebaseData('leadsetFeed', 'global')
      if (snapshot) {
        console.log('[Data] Manual refresh received:', {
          updatedAt: snapshot?.updatedAt,
          leadsetCount: snapshot?.leadsets?.length,
          leadsetStatuses: snapshot?.leadsets?.map(ls => ({ id: ls.id?.slice(-6), status: ls.status })),
        })
        applyFeedData(snapshot, force)
      } else {
        console.log('[Data] No feed data found')
        setFeedData(null)
        setIsInitialized(true)
        setIsLoading(false)
        setError('Feed not available yet. Please run a seed.')
      }
    } catch (err) {
      console.error('[Data] Failed to fetch feed document:', err)
      setError(err.message || 'Failed to load data')
      setIsLoading(false)
    }
  }, [applyFeedData])

  useEffect(() => {
    setIsLoading(true)
    console.log('[Data] Starting real-time listener for leadsetFeed/global')
    
    const subscription = sdk.startFirebaseListener('leadsetFeed', 'global').subscribe({
      next: (data) => {
        console.log('[Data] Real-time update received:', {
          updatedAt: data?.updatedAt,
          leadsetCount: data?.leadsets?.length,
          leadsetStatuses: data?.leadsets?.map(ls => ({ id: ls.id?.slice(-6), status: ls.status })),
        })
        applyFeedData(data)
      },
      error: (err) => {
        console.error('[Data] Feed listener error:', err)
        setError(err.message || 'Failed to listen for changes')
      },
    })

    // Ensure we get the latest snapshot immediately
    refreshCache().catch(() => {})

    return () => {
      console.log('[Data] Unsubscribing from leadsetFeed listener')
      subscription?.unsubscribe?.()
    }
  }, [applyFeedData, refreshCache])

  const value = useMemo(() => {
    let leadsets = feedData?.leadsets || []
    const settings = feedData?.settings || { cost: { perContact: 2 } }
    let leadsetDetails = feedData?.leadsetDetails || {}

    // Filter by sessionId if provided
    if (sessionId) {
      leadsets = leadsets.filter(leadset => leadset.sessionId === sessionId)
      // Also filter leadsetDetails to only include matching leadsets
      const filteredLeadsetIds = new Set(leadsets.map(ls => ls.id))
      leadsetDetails = Object.fromEntries(
        Object.entries(leadsetDetails).filter(([id]) => filteredLeadsetIds.has(id))
      )
      console.log(`[Data] Filtered to ${leadsets.length} leadsets for sessionId: ${sessionId}`)
    }

    return {
      leadsets,
      settings,
      leadsetDetails,
      feedUpdatedAt: feedData?.updatedAt || null,
      isLoading,
      error,
      isInitialized,
      refreshCache,
      refreshCounter, // Include counter to force re-renders
      sessionId, // Expose sessionId for UI
    }
  }, [feedData, isLoading, error, isInitialized, refreshCache, refreshCounter, sessionId])

  return (
    <DataCacheContext.Provider value={value}>
      {children}
    </DataCacheContext.Provider>
  )
}

export function useDataCache() {
  const context = useContext(DataCacheContext)
  if (!context) {
    throw new Error('useDataCache must be used within DataCacheProvider')
  }
  return context
}

/**
 * Hook backed by feed detail data
 */
export function useLeadsetCache(leadsetId) {
  const { settings, leadsetDetails, isInitialized, error, refreshCache, refreshCounter } = useDataCache()
  const detail = leadsetId ? leadsetDetails[leadsetId] : null

  const isDetailReady = Boolean(detail)
  const isLoading = !isInitialized || (leadsetId ? !isDetailReady : false)
  const detailError =
    !isLoading && leadsetId && !detail
      ? 'Leadset not found or not yet synced'
      : null

  // Force refresh helper that ensures fresh data
  const refreshLeadset = useCallback(() => {
    return refreshCache(true)
  }, [refreshCache])

  return {
    leadset: detail?.leadset || null,
    run: detail?.run || null,
    items: detail?.items || [],
    settings,
    isLoading,
    error: detailError || error,
    isInitialized: isInitialized && (leadsetId ? isDetailReady : true),
    refreshLeadset,
    updateItems: () => {},
    refreshCounter, // Expose for dependency tracking
  }
}
