import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'
import sdk from '../sdk'

const DataCacheContext = createContext(null)

/**
 * DataCacheContext - Listens to aggregated leadset feed document
 * Backend writes to `leadsetFeed/global` whenever data changes.
 */
export function DataCacheProvider({ children }) {
  const [feedData, setFeedData] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isInitialized, setIsInitialized] = useState(false)

  const applyFeedData = useCallback((data) => {
    if (!data) {
      return
    }
    setFeedData(data)
    setIsInitialized(true)
    setIsLoading(false)
    setError(null)
  }, [])

  const refreshCache = useCallback(async () => {
    try {
      const snapshot = await sdk.getFirebaseData('leadsetFeed', 'global')
      if (snapshot) {
        applyFeedData(snapshot)
      } else {
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
    const subscription = sdk.startFirebaseListener('leadsetFeed', 'global').subscribe({
      next: (data) => {
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
      subscription?.unsubscribe?.()
    }
  }, [applyFeedData, refreshCache])

  const value = useMemo(() => {
    const leadsets = feedData?.leadsets || []
    const settings = feedData?.settings || { cost: { perContact: 2 } }
    const leadsetDetails = feedData?.leadsetDetails || {}

    return {
      leadsets,
      settings,
      leadsetDetails,
      feedUpdatedAt: feedData?.updatedAt || null,
      isLoading,
      error,
      isInitialized,
      refreshCache,
    }
  }, [feedData, isLoading, error, isInitialized, refreshCache])

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
  const { settings, leadsetDetails, isInitialized, error, refreshCache } = useDataCache()
  const detail = leadsetId ? leadsetDetails[leadsetId] : null

  const isDetailReady = Boolean(detail)
  const isLoading = !isInitialized || (leadsetId ? !isDetailReady : false)
  const detailError =
    !isLoading && leadsetId && !detail
      ? 'Leadset not found or not yet synced'
      : null

  return {
    leadset: detail?.leadset || null,
    run: detail?.run || null,
    items: detail?.items || [],
    settings,
    isLoading,
    error: detailError || error,
    isInitialized: isInitialized && (leadsetId ? isDetailReady : true),
    refreshLeadset: refreshCache,
    updateItems: () => {},
  }
}
