/**
 * API Client - Handles backend API calls for ACTIONS ONLY
 * 
 * Architecture:
 * - Frontend SDK reads directly from Firebase (for displaying data to users)
 * - Backend API is ONLY for:
 *   1. Exa API communication (run, enrich, cancel)
 *   2. Firebase writes (via Exa webhooks)
 *   3. Export/download operations
 * 
 * Exa Websets Integration:
 * - POST /leadsets/:id/run -> Creates Webset in Exa, searches for buyers
 * - GET /leadsets/:id/runs/:runId/webset -> Gets live items from Exa
 * - POST /leadsets/:id/runs/:runId/enrich -> Creates enrichments for email/phone
 */

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000'

/**
 * Generic request helper with error handling
 */
async function request(path, options = {}) {
  const token = localStorage.getItem('authToken')
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  }

  const fetchOpts = {
    ...options,
    headers,
  }

  if (fetchOpts.body && typeof fetchOpts.body === 'object' && 
      !(fetchOpts.body instanceof FormData) && !(fetchOpts.body instanceof Blob)) {
    fetchOpts.body = JSON.stringify(fetchOpts.body)
  }

  const res = await fetch(`${API_BASE_URL}${path}`, fetchOpts)

  if (!res.ok) {
    const text = await res.text()
    let errorMessage = text || `Request failed: ${res.status}`
    try {
      const errorJson = JSON.parse(text)
      errorMessage = errorJson.message || errorJson.error || text
      const error = new Error(errorMessage)
      error.code = errorJson.code
      error.errorCode = errorJson.errorCode // Preserve errorCode for handling specific errors
      error.statusCode = res.status
      error.suggestion = errorJson.suggestion
      error.response = { data: errorJson } // Preserve full response data
      throw error
    } catch (parseError) {
      if (parseError.code || parseError.errorCode) throw parseError
      const error = new Error(errorMessage)
      error.statusCode = res.status
      throw error
    }
  }

  if (options.responseType === 'blob') {
    return res.blob()
  }

  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return res
  }

  return res.json()
}

/* ============================================
   ACTION API CALLS (to backend -> Exa)
   ============================================ */

/**
 * Check if a leadset has an existing run with buyers
 * Returns info about existing webset and item count
 */
export function checkRunStatus(leadsetId) {
  return request(`/leadsets/${leadsetId}/run-status`)
}

/**
 * Start a new run for a leadset
 * Backend: Creates Webset in Exa to search for buyers
 * 
 * Options:
 * - mode: 'new' | 'extend' | 'replace'
 *   - 'new': Create new run (returns 409 if existing webset)
 *   - 'extend': Add more buyers to existing data
 *   - 'replace': Delete existing webset and create new one
 * - count: Number of buyers to fetch (default: 10)
 * - force: Force new run even if existing (default: false)
 * 
 * Flow:
 * 1. Backend reads leadset from Firebase
 * 2. Backend creates Webset in Exa with search query from leadset
 * 3. Exa searches the web for matching companies/buyers
 * 4. Backend creates run doc in Firebase
 * 5. Frontend polls /webset endpoint for live results
 */
export function startLeadsetRun(leadsetId, options = {}) {
  const { mode = 'new', count = 10, force = false } = options
  return request(`/leadsets/${leadsetId}/run`, { 
    method: 'POST',
    body: { mode, count, force },
  })
}

/**
 * Get webset status and items from Exa (via backend)
 * 
 * This endpoint:
 * - Fetches current webset status from Exa API
 * - Returns all items found so far
 * - Updates Firebase with latest data
 * 
 * Poll this during active runs for real-time updates
 */
export function fetchWebsetStatus(leadsetId, runId) {
  return request(`/leadsets/${leadsetId}/runs/${runId}/webset`)
}

/**
 * Request enrichment for selected items
 * Backend: Creates enrichments in Exa for email/phone extraction
 * 
 * Flow:
 * 1. Frontend sends list of itemIds to enrich
 * 2. Backend creates email enrichment in Exa
 * 3. Backend creates phone enrichment in Exa
 * 4. Exa searches for contact details
 * 5. Frontend polls enrichment status for completion
 * 6. Backend updates items in Firebase with contact info
 */
export function requestEnrichment(leadsetId, runId, fields = []) {
  return request(`/leadsets/${leadsetId}/runs/${runId}/enrich`, {
    method: 'POST',
    body: { fields },
  })
}

/**
 * Get enrichment status
 * Backend: Checks Exa enrichment status, fetches results when complete
 */
export function getEnrichmentStatus(leadsetId, runId, enrichmentId) {
  return request(`/leadsets/${leadsetId}/runs/${runId}/enrichment/${enrichmentId}`)
}

/**
 * Cancel a running webset
 * Backend: Cancels webset in Exa, updates run status in Firebase
 */
export function cancelRun(leadsetId, runId) {
  return request(`/leadsets/${leadsetId}/runs/${runId}/cancel`, {
    method: 'POST',
    body: { reason: 'manual_cancel' },
  })
}

/**
 * Export run data as CSV
 * Backend: Generates CSV from Firebase data, uploads to Storage
 */
export async function exportRun(leadsetId, runId) {
  const response = await fetch(`${API_BASE_URL}/leadsets/${leadsetId}/runs/${runId}/export`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(localStorage.getItem('authToken') ? { Authorization: `Bearer ${localStorage.getItem('authToken')}` } : {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Export failed: ${response.status}`)
  }

  // Check if there's a storage URL in the header
  const storageUrl = response.headers.get('x-export-url')
  if (storageUrl) {
    window.open(storageUrl, '_blank')
    return storageUrl
  }

  // Otherwise, download the blob directly
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `leadset-run-${runId}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  
  return url
}
