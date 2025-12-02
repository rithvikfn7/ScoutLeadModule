import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

const SESSION_ID_STORAGE_KEY = 'scout_session_id'

/**
 * Hook to get and manage sessionId from URL or localStorage
 * 
 * Priority:
 * 1. URL parameter (?sessionId=xxx) - for sharing links
 * 2. localStorage - for persistence across refreshes
 * 
 * When sessionId is found in URL, it's saved to localStorage
 */
export function useSessionId() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [sessionId, setSessionId] = useState(() => {
    // Check URL first
    const urlSessionId = searchParams.get('sessionId')
    if (urlSessionId) {
      // Save to localStorage for persistence
      localStorage.setItem(SESSION_ID_STORAGE_KEY, urlSessionId)
      return urlSessionId
    }
    
    // Fall back to localStorage
    return localStorage.getItem(SESSION_ID_STORAGE_KEY) || null
  })

  // Update sessionId when URL changes
  useEffect(() => {
    const urlSessionId = searchParams.get('sessionId')
    if (urlSessionId && urlSessionId !== sessionId) {
      localStorage.setItem(SESSION_ID_STORAGE_KEY, urlSessionId)
      setSessionId(urlSessionId)
    }
  }, [searchParams, sessionId])

  // Function to manually set sessionId
  const setSessionIdValue = useCallback((newSessionId) => {
    if (newSessionId) {
      localStorage.setItem(SESSION_ID_STORAGE_KEY, newSessionId)
      setSessionId(newSessionId)
      // Update URL without reload
      setSearchParams({ sessionId: newSessionId }, { replace: true })
    } else {
      localStorage.removeItem(SESSION_ID_STORAGE_KEY)
      setSessionId(null)
      // Remove from URL
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('sessionId')
      setSearchParams(newParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Function to clear sessionId
  const clearSessionId = useCallback(() => {
    setSessionIdValue(null)
  }, [setSessionIdValue])

  return {
    sessionId,
    setSessionId: setSessionIdValue,
    clearSessionId,
    hasSessionId: Boolean(sessionId),
  }
}

