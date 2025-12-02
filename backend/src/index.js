/**
 * Backend Server - Exa Websets Integration
 * 
 * Architecture:
 * - Backend WRITES to Firebase using FN7 SDK
 * - Backend communicates with Exa Websets API (https://docs.exa.ai/websets)
 * - Backend receives webhooks from Exa for real-time updates
 * - Frontend READS from Firebase via FN7 Frontend SDK
 * 
 * Exa Websets Flow:
 * 1. POST /leadsets/:id/run -> Creates a Webset in Exa with search criteria
 * 2. Exa searches the web and returns items (buyers)
 * 3. POST /leadsets/:id/runs/:runId/enrich -> Creates enrichments for contact details
 * 4. Exa enriches items with email/phone/linkedin
 * 5. Webhooks update Firebase in real-time
 */

const crypto = require('crypto')
const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const { getSDK } = require('./sdk')

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000
const EXA_API_KEY = process.env.EXA_API_KEY
const EXA_API_BASE = 'https://api.exa.ai'
const EXA_WEBHOOK_SECRET = process.env.EXA_WEBHOOK_SECRET
const WEBHOOK_URL = process.env.WEBHOOK_URL // Your public webhook URL

app.use(cors())
app.use(
  express.json({
    limit: '2mb',
    verify: (req, res, buf) => {
      req.rawBody = buf
    },
  })
)

// Initialize SDK
let sdk
try {
  sdk = getSDK({ mode: process.env.FN7_SDK_MODE || 'local' })
} catch (error) {
  console.error('Failed to initialize SDK:', error.message)
  process.exit(1)
}

const firestoreUtils = sdk.getFirestoreUtilities ? sdk.getFirestoreUtilities() : null

function increment(amount) {
  return firestoreUtils?.increment ? firestoreUtils.increment(amount) : amount
}

const FIELD_DESCRIPTION_PREFIX = 'ScoutField::'

/**
 * ENRICHMENT_FIELDS
 * 
 * Each field defines:
 * - label: Human-readable name shown in UI
 * - format: Exa enrichment format ('text', 'email', 'phone', 'options')
 * - instructions: Clear, structured prompt for Exa to extract this field
 * - options (optional): For 'options' format, the allowed values
 * - defaultCost: Token cost per lead for this enrichment
 * 
 * Prompt best practices used:
 * - Be explicit about output format (e.g. "Return exactly one of...")
 * - Provide examples where helpful
 * - Keep instructions concise but unambiguous
 * - Use consistent terminology
 */
const ENRICHMENT_FIELDS = {
  // === CONTACT INFORMATION ===
  email: {
    label: 'Work Email',
    format: 'email',
    instructions: 'Find the best professional work email address for the primary contact or decision maker at this company. Return only the email address in lowercase (e.g. john.doe@company.com). If no email is found, return empty.',
    defaultCost: 1.0,
  },
  phone: {
    label: 'Work Phone',
    format: 'phone',
    instructions: 'Find the best work phone number for the primary contact or decision maker. Return in international format with country code (e.g. +1 555-123-4567 or +91 98765 43210). If no phone is found, return empty.',
    defaultCost: 1.0,
  },
  linkedinUrl: {
    label: 'LinkedIn URL',
    format: 'url',
    instructions: 'Find the LinkedIn profile URL for the primary contact or company. Return ONLY the LinkedIn URL (e.g. https://linkedin.com/company/acme or https://linkedin.com/in/johndoe). Must be a linkedin.com URL. If no LinkedIn profile is found, return empty.',
    defaultCost: 0.5,
  },
  primaryContactChannel: {
    label: 'Best Contact Channel',
    format: 'text',
    instructions: 'Identify the single best channel to reach this lead. Return exactly one of: "LinkedIn DM", "Work Email", "Phone", "Twitter DM", "Website Form", or "Unknown". Choose based on which channel appears most likely to get a response.',
    defaultCost: 0.25,
  },

  // === LEAD CLASSIFICATION ===
  leadType: {
    label: 'Lead Type',
    format: 'text',
    instructions: 'Classify this lead into one category. Return exactly one of: "Retailer", "Distributor", "Influencer", "Creator", "Expert", "Consultant", "Investor", "Platform", "Brand", "Agency", or "Other". Use title case.',
    defaultCost: 0.25,
  },
  geoLocation: {
    label: 'Location',
    format: 'text',
    instructions: 'Return the most specific reliable location for this lead in "City, Country" format (e.g. "Mumbai, India", "San Francisco, USA"). If only country is known, return just the country. Use proper capitalization.',
    defaultCost: 0.25,
  },
  employeeCount: {
    label: 'Company Size',
    format: 'text',
    instructions: 'Estimate the company headcount range. Return exactly one of these ranges: "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+". Base estimate on any available signals (website, LinkedIn, news).',
    defaultCost: 0.5,
  },

  // === INTENT SIGNALS ===
  buyingIntent: {
    label: 'Buying Intent',
    format: 'options',
    options: [{ label: 'High' }, { label: 'Medium' }, { label: 'Low' }],
    instructions: 'Assess how likely this lead is to purchase products/services based on the referenced content. Return exactly "High", "Medium", or "Low". High = actively seeking solutions; Medium = exploring options; Low = no clear purchase signals.',
    defaultCost: 0.75,
  },
  buyingIntentReason: {
    label: 'Buying Intent Reason',
    format: 'text',
    instructions: 'Explain in one concise sentence (max 20 words) why you assigned the buying intent level. Focus on specific signals observed (e.g. "Mentioned budget approval for Q1 tool purchases").',
    defaultCost: 0.25,
  },
  partnershipIntentLevel: {
    label: 'Partnership Intent',
    format: 'options',
    options: [{ label: 'High' }, { label: 'Medium' }, { label: 'Low' }],
    instructions: 'Assess how open this lead is to partnerships or collaborations. Return exactly "High", "Medium", or "Low". High = actively seeking partners; Medium = open to discussions; Low = no partnership signals.',
    defaultCost: 0.25,
  },
  partnershipIntentReason: {
    label: 'Partnership Intent Reason',
    format: 'text',
    instructions: 'Explain in one concise sentence (max 20 words) why you assigned the partnership intent level. Reference specific signals (e.g. "Posted about seeking distribution partners in India").',
    defaultCost: 0.25,
  },
  audienceOverlapScore: {
    label: 'Audience Overlap Score',
    format: 'text',
    instructions: 'Estimate the audience overlap potential on a scale of 1-10, where 10 means highly overlapping target audiences. Return just the number (e.g. "7").',
    defaultCost: 0.25,
  },
  audienceOverlapReason: {
    label: 'Audience Overlap Reason',
    format: 'text',
    instructions: 'Explain in one concise sentence (max 20 words) why you assigned the audience overlap score. Reference specific audience characteristics.',
    defaultCost: 0.25,
  },
  
  // === INFLUENCER/CREATOR FIELDS ===
  estimatedReachBand: {
    label: 'Estimated Reach',
    format: 'text',
    instructions: 'Estimate the social media reach/following range. Return exactly one of: "Nano (1K-10K)", "Micro (10K-50K)", "Mid (50K-500K)", "Macro (500K-1M)", "Mega (1M+)", or "Unknown".',
    defaultCost: 0.25,
  },
  
  // === ROLE/SENIORITY FIELDS ===
  roleSeniorityBand: {
    label: 'Role Seniority',
    format: 'text',
    instructions: 'Classify the seniority level. Return exactly one of: "C-Level", "VP/Director", "Manager", "Senior IC", "IC", or "Unknown".',
    defaultCost: 0.25,
  },
  
  // === INVESTOR FIELDS ===
  investorIntentLevel: {
    label: 'Investor Intent',
    format: 'options',
    options: [{ label: 'High' }, { label: 'Medium' }, { label: 'Low' }],
    instructions: 'Assess how likely this investor is interested in this sector. Return exactly "High", "Medium", or "Low". High = actively investing in similar companies; Medium = thesis aligned; Low = no clear signals.',
    defaultCost: 0.5,
  },
  investorIntentReason: {
    label: 'Investor Intent Reason',
    format: 'text',
    instructions: 'Explain in one concise sentence (max 20 words) why you assigned the investor intent level. Reference portfolio or thesis signals.',
    defaultCost: 0.25,
  },
  
  // === CATEGORY FIT FIELDS ===
  categoryFitScore: {
    label: 'Category Fit Score',
    format: 'text',
    instructions: 'Rate how well this lead fits the target category on a scale of 1-10. Return just the number (e.g. "8").',
    defaultCost: 0.25,
  },
  categoryFitReason: {
    label: 'Category Fit Reason',
    format: 'text',
    instructions: 'Explain in one concise sentence (max 20 words) why you assigned the category fit score. Reference specific category alignment signals.',
    defaultCost: 0.25,
  },
}

Object.entries(ENRICHMENT_FIELDS).forEach(([key, value]) => {
  if (!value.description) {
    value.description = `${FIELD_DESCRIPTION_PREFIX}${key}::${value.instructions}`
  }
})

const DEFAULT_ENRICHMENT_FIELDS = ['email', 'phone']

const LEADSET_ENRICHMENT_FIELD_MAP = {
  // Contact fields
  contact_email: 'email',
  contact_phone: 'phone',
  has_linkedin_messaging: 'linkedinUrl',
  linkedin_url: 'linkedinUrl',
  primary_contact_channel: 'primaryContactChannel',
  
  // Classification fields
  lead_type: 'leadType',
  geo_location: 'geoLocation',
  company_size_band: 'employeeCount',
  
  // Buying intent fields
  buying_intent_level: 'buyingIntent',
  buying_intent_reason: 'buyingIntentReason',
  
  // Partnership intent fields
  partnership_intent_level: 'partnershipIntentLevel',
  partnership_intent_reason: 'partnershipIntentReason',
  
  // Audience/influencer fields
  audience_overlap_score: 'audienceOverlapScore',
  audience_overlap_reason: 'audienceOverlapReason',
  estimated_reach_band: 'estimatedReachBand',
  
  // Role/seniority fields
  role_seniority_band: 'roleSeniorityBand',
  
  // Investor fields
  investor_intent_level: 'investorIntentLevel',
  investor_intent_reason: 'investorIntentReason',
  
  // Category fit fields
  category_fit_score: 'categoryFitScore',
  category_fit_reason: 'categoryFitReason',
}

function getAllowedEnrichmentFieldsForLeadset(leadset = {}) {
  const rawFields = Array.isArray(leadset.enrichment_fields)
    ? leadset.enrichment_fields
    : []

  const mapped = new Set()
  for (const raw of rawFields) {
    const key = LEADSET_ENRICHMENT_FIELD_MAP[raw]
    if (key && ENRICHMENT_FIELDS[key]) {
      mapped.add(key)
    }
  }

  return Array.from(mapped)
}

function normalizeRequestedFields(fieldsInput, allowed = null) {
  const hasExplicitRequest = Array.isArray(fieldsInput) && fieldsInput.length > 0

  // When we have a per-leadset allowlist, prefer intersecting with it
  const cleanedRequested = hasExplicitRequest
    ? Array.from(
        new Set(
          fieldsInput
            .map((field) => (typeof field === 'string' ? field.trim() : ''))
            .filter(Boolean)
        )
      )
    : []

  let candidates = cleanedRequested
  if (!hasExplicitRequest && Array.isArray(allowed) && allowed.length > 0) {
    // No explicit selection → use allowed fields from leadset.enrichment_fields
    candidates = allowed
  }

  const valid = candidates.filter(
    (field) =>
      Boolean(ENRICHMENT_FIELDS[field]) &&
      (!Array.isArray(allowed) || allowed.length === 0 || allowed.includes(field))
  )

  if (valid.length > 0) {
    return valid
  }

  // Fall back to default global fields, optionally intersected with allowed
  if (Array.isArray(allowed) && allowed.length > 0) {
    const intersectedDefault = DEFAULT_ENRICHMENT_FIELDS.filter((f) => allowed.includes(f))
    if (intersectedDefault.length > 0) return intersectedDefault
    return allowed
  }

  return DEFAULT_ENRICHMENT_FIELDS
}

function extractFieldFromEnrichment(enrichment = {}) {
  // Strategy 1: Check metadata.field (most reliable)
  const metadataField = enrichment.metadata?.field
  if (metadataField && ENRICHMENT_FIELDS[metadataField]) {
    console.log(`[Enrich] Extracted field from metadata: ${metadataField}`)
    return metadataField
  }

  // Strategy 2: Check description prefix (ScoutField::fieldKey::instructions)
  const description = enrichment.description || ''
  if (typeof description === 'string' && description.startsWith(FIELD_DESCRIPTION_PREFIX)) {
    const key = description.replace(FIELD_DESCRIPTION_PREFIX, '').split('::')[0]
    if (ENRICHMENT_FIELDS[key]) {
      console.log(`[Enrich] Extracted field from description prefix: ${key}`)
      return key
    }
  }

  // Strategy 3: Check if format matches a field (only works for email/phone)
  if (enrichment.format && ENRICHMENT_FIELDS[enrichment.format]) {
    console.log(`[Enrich] Extracted field from format: ${enrichment.format}`)
    return enrichment.format
  }

  // Strategy 4: Try to find field by description content (fallback)
  // Look for field names in the description
  for (const [fieldKey, fieldDef] of Object.entries(ENRICHMENT_FIELDS)) {
    if (description.toLowerCase().includes(fieldKey.toLowerCase()) || 
        description.toLowerCase().includes(fieldDef.label.toLowerCase())) {
      console.log(`[Enrich] Extracted field from description content: ${fieldKey}`)
      return fieldKey
    }
  }

  // Strategy 5: Infer field from result content (for Exa API responses without metadata)
  const result = enrichment.result
  if (result) {
    // Check if result is an array and get first string value
    let resultStr = ''
    if (Array.isArray(result)) {
      resultStr = result.find(entry => typeof entry === 'string' && entry.trim().length > 0) || ''
    } else if (typeof result === 'string') {
      resultStr = result
    }
    
    if (resultStr) {
      const lowerResult = resultStr.toLowerCase()
      
      // Check for High/Medium/Low patterns - could be buyingIntent or partnershipIntentLevel
      // We need to use the enrichment's format to disambiguate when possible
      if (/^(high|medium|low)(:|$)/i.test(resultStr.trim())) {
        // If format is 'options', we can't easily tell which field it is from content alone
        // Return null to let the caller use a different strategy (e.g., order-based matching)
        // For now, check for partnership keywords in the result
        if (lowerResult.includes('partnership') || lowerResult.includes('collaborat')) {
          console.log(`[Enrich] Inferred field from result content: partnershipIntentLevel`)
          return 'partnershipIntentLevel'
        }
        // Default to buyingIntent for High/Medium/Low without partnership context
        console.log(`[Enrich] Inferred field from result content: buyingIntent`)
        return 'buyingIntent'
      }
      
      // Check for employee count: matches range pattern like "1-10", "501-1000", etc.
      if (/^\d+-\d+$/.test(resultStr.trim()) || /^\d+-\d+\+?$/.test(resultStr.trim())) {
        console.log(`[Enrich] Inferred field from result content: employeeCount`)
        return 'employeeCount'
      }
      
      // Check for partnership intent reason: contains clear "partnership intent" phrasing or collaboration keywords
      if (lowerResult.includes('partnership intent') || 
          (lowerResult.includes('partnership') && (lowerResult.includes('shows') || lowerResult.includes('due to') || lowerResult.includes('because')))) {
        console.log(`[Enrich] Inferred field from result content: partnershipIntentReason`)
        return 'partnershipIntentReason'
      }
      
      // Check for buying intent reason
      if (lowerResult.includes('buying intent') || lowerResult.includes('purchase intent') ||
          (lowerResult.includes('intent') && !lowerResult.includes('partnership') && (lowerResult.includes('shows') || lowerResult.includes('due to') || lowerResult.includes('because')))) {
        console.log(`[Enrich] Inferred field from result content: buyingIntentReason`)
        return 'buyingIntentReason'
      }
      
      // Check for email: contains @ symbol
      if (resultStr.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resultStr.trim())) {
        console.log(`[Enrich] Inferred field from result content: email`)
        return 'email'
      }
      
      // Check for phone: matches phone number patterns
      if (/^[\d\s\-\+\(\)]+$/.test(resultStr.trim()) && resultStr.replace(/\D/g, '').length >= 10) {
        console.log(`[Enrich] Inferred field from result content: phone`)
        return 'phone'
      }
      
      // Check for LinkedIn URL patterns
      if (lowerResult.includes('linkedin.com/') || lowerResult.includes('linkedin.com\\')) {
        console.log(`[Enrich] Inferred field from result content: linkedinUrl`)
        return 'linkedinUrl'
      }
      
      // Check for location patterns (City, Country or State, Country)
      if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/i.test(resultStr.trim())) {
        console.log(`[Enrich] Inferred field from result content: geoLocation`)
        return 'geoLocation'
      }
      
      // Check for contact channel keywords
      if (lowerResult.includes('linkedin dm') || lowerResult.includes('work email') || 
          lowerResult.includes('website form') || lowerResult === 'phone' || lowerResult === 'email') {
        console.log(`[Enrich] Inferred field from result content: primaryContactChannel`)
        return 'primaryContactChannel'
      }
      
      // Check for lead type keywords
      if (/^(retailer|distributor|influencer|expert|investor|creator|consultant|brand|agency|platform)/i.test(resultStr.trim())) {
        console.log(`[Enrich] Inferred field from result content: leadType`)
        return 'leadType'
      }
      
      // Check for audience overlap score (1-10 number pattern)
      if (/^[1-9]|10\b/.test(resultStr.trim()) && (lowerResult.includes('overlap') || lowerResult.includes('audience') || /^[1-9]$|^10$/.test(resultStr.trim()))) {
        console.log(`[Enrich] Inferred field from result content: audienceOverlapScore`)
        return 'audienceOverlapScore'
      }
    }
  }

  console.warn(`[Enrich] Could not extract field from enrichment:`, {
    metadata: enrichment.metadata,
    description: description.substring(0, 100),
    format: enrichment.format,
    resultPreview: Array.isArray(enrichment.result) 
      ? enrichment.result[0]?.substring?.(0, 100) 
      : String(enrichment.result || '').substring(0, 100),
  })
  return null
}

/**
 * Normalize buying intent to high/medium/low
 */
function normalizeBuyingIntent(value) {
  if (!value) return null
  const str = typeof value === 'string' ? value.toLowerCase() : String(value).toLowerCase()
  
  // Check for explicit high/medium/low
  if (str.includes('high')) return 'high'
  if (str.includes('medium')) return 'medium'
  if (str.includes('low')) return 'low'
  
  // Check for intent indicators
  if (str.includes('actively') || str.includes('strong') || str.includes('ready') || str.includes('seeking')) {
    return 'high'
  }
  if (str.includes('evaluating') || str.includes('considering') || str.includes('exploring')) {
    return 'medium'
  }
  
  return 'low'
}

/**
 * Normalize employee count to range format
 */
function normalizeEmployeeCount(value) {
  if (!value) return null
  const str = typeof value === 'string' ? value.trim() : String(value).trim()
  
  // Already in range format (e.g., "1-10", "501-1000")
  if (/^\d+-\d+$/.test(str)) {
    return str
  }
  
  // Extract number from string
  const numMatch = str.match(/\d+/)
  if (!numMatch) return null
  
  const num = parseInt(numMatch[0], 10)
  
  // Convert to range
  if (num <= 10) return '1-10'
  if (num <= 50) return '11-50'
  if (num <= 200) return '51-200'
  if (num <= 500) return '201-500'
  if (num <= 1000) return '501-1000'
  if (num <= 5000) return '1001-5000'
  if (num <= 10000) return '5001-10000'
  if (num <= 25000) return '10001-25000'
  return '25001+'
}

function extractEnrichmentValue(enrichment, fieldKey = null) {
  if (!enrichment) return null
  const { result, status } = enrichment
  
  // Check if Exa returned "not found" or failed status
  if (status === 'failed' || status === 'not_found') {
    return 'Not found'
  }
  
  // Extract raw value
  let rawValue = null
  if (Array.isArray(result)) {
    const firstString = result.find((entry) => typeof entry === 'string' && entry.trim().length > 0)
    if (firstString) {
      rawValue = firstString
    } else {
      const firstValue = result.find((entry) => entry && typeof entry === 'object')
      if (firstValue) {
        rawValue = JSON.stringify(firstValue)
      }
    }
  } else if (typeof result === 'string') {
    rawValue = result
  } else if (result && typeof result === 'object') {
    rawValue = JSON.stringify(result)
  }
  
  // If no result found, return "Not found"
  if (!rawValue || rawValue.trim() === '') {
    return 'Not found'
  }
  
  // Check for common "not found" patterns in the result
  const lowerValue = rawValue.toLowerCase().trim()
  if (lowerValue === 'not found' || 
      lowerValue === 'n/a' || 
      lowerValue === 'none' || 
      lowerValue === 'unavailable' ||
      lowerValue === 'no data' ||
      lowerValue === 'unknown' ||
      lowerValue.startsWith('could not find') ||
      lowerValue.startsWith('unable to find') ||
      lowerValue.startsWith('no ') && lowerValue.includes('found')) {
    return 'Not found'
  }
  
  // Normalize based on field type
  if (fieldKey === 'buyingIntent') {
    return normalizeBuyingIntent(rawValue)
  }
  if (fieldKey === 'employeeCount') {
    return normalizeEmployeeCount(rawValue)
  }
  
  return rawValue
}

/**
 * Update docStatus to trigger frontend refresh
 * Frontend listens to this document and refetches data when it changes
 */
async function updateDocStatus(collections = [], metadata = {}) {
  const payload = {
    version: increment(1),
    lastChange: new Date().toISOString(),
    updated: collections.reduce((acc, col) => ({ ...acc, [col]: true }), {}),
    ...metadata,
  }
  try {
    await sdk.updateFirebaseData('docStatus', 'status', payload)
    console.log('[docStatus] Updated:', collections.join(', '))
  } catch (updateError) {
    await sdk.createFirebaseData('docStatus', 'status', { ...payload, version: 1 })
    console.log('[docStatus] Created:', collections.join(', '))
  }
}

/**
 * Rebuild aggregated feed document for frontend listeners
 * Optional preloadedDocs can skip re-fetching all data
 */
async function rebuildLeadsetFeed(preloadedDocs = null) {
  try {
    const allDocs = preloadedDocs ? toArray(preloadedDocs) : toArray(await sdk.searchFirebaseData({}, 5000))
    const leadsets = allDocs.filter(doc => doc.doc_type === 'leadsets')
    const runs = allDocs.filter(doc => doc.doc_type === 'runs')
    const items = allDocs.filter(doc => doc.doc_type === 'items')
    const settingsDoc = allDocs.find(doc => doc.doc_type === 'settings') || null

    const runsByLeadset = runs.reduce((acc, run) => {
      if (!acc[run.leadsetId]) acc[run.leadsetId] = []
      acc[run.leadsetId].push(run)
      return acc
    }, {})

    const itemsByLeadset = items.reduce((acc, item) => {
      if (!acc[item.leadsetId]) acc[item.leadsetId] = []
      acc[item.leadsetId].push(item)
      return acc
    }, {})

    const leadsetDetails = {}
    leadsets.forEach((leadset) => {
      const lsRuns = runsByLeadset[leadset.id] || []
      const sortedRuns = lsRuns.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      const latestRun = sortedRuns[0] || null

      leadsetDetails[leadset.id] = {
        leadset,
        run: latestRun,
        items: itemsByLeadset[leadset.id] || [],
      }
    })

    const feedPayload = {
      doc_type: 'leadsetFeed',
      id: 'global',
      updatedAt: new Date().toISOString(),
      leadsets,
      leadsetDetails,
      settings: settingsDoc,
      counts: {
        leadsets: leadsets.length,
        runs: runs.length,
        items: items.length,
      },
    }

    // Log leadset statuses for debugging
    const statusSummary = leadsets.map(ls => `${ls.id?.slice(-6)}:${ls.status || 'unknown'}`).join(', ')
    console.log(`[Leadset Feed] Rebuilding with statuses: ${statusSummary}`)

    try {
      await sdk.updateFirebaseData('leadsetFeed', 'global', feedPayload)
    } catch (err) {
      await sdk.createFirebaseData('leadsetFeed', 'global', feedPayload)
    }

    console.log(`[Leadset Feed] Feed rebuilt (${leadsets.length} leadsets, ${runs.length} runs, ${items.length} items)`)
  } catch (error) {
    console.error('[Leadset Feed] Failed to rebuild feed:', error.message)
  }
}

/* ============================================
   EXA WEBSETS API FUNCTIONS
   Based on: https://docs.exa.ai/websets/api
   ============================================ */

/**
 * Create a Webset in Exa
 * https://docs.exa.ai/websets/api/websets/create-a-webset
 * 
 * @param {Object} options
 * @param {string} options.query - Natural language search query
 * @param {number} options.count - Number of items to find
 * @param {string} options.entity - Entity type (company, person, etc.)
 * @param {Array} options.criteria - Evaluation criteria
 * @param {string} options.externalId - Your reference ID (leadsetId)
 */
async function createWebset(options) {
  const { query, count = 50, entity = 'company', criteria = [], externalId, webhookUrl } = options

  if (!EXA_API_KEY) {
    console.log('[Exa] No API key configured - returning mock webset')
    return {
      id: `mock_webset_${Date.now()}`,
      object: 'webset',
      status: 'running',
      externalId,
      search: { query, count, entity },
      counters: { items: 0, enrichments: 0 },
      createdAt: new Date().toISOString(),
    }
  }

  const payload = {
    externalId,
    search: {
      query,
      count,
      entity: { type: entity },
      criteria: criteria.length > 0 ? criteria : undefined,
    },
  }

  // Add webhook URL if configured
  if (webhookUrl || WEBHOOK_URL) {
    payload.webhook = {
      url: webhookUrl || WEBHOOK_URL,
      events: ['webset.idle', 'webset.items.created', 'webset.enrichment.completed'],
    }
  }

  console.log('[Exa] Creating webset:', JSON.stringify(payload, null, 2))

  const response = await fetch(`${EXA_API_BASE}/websets/v0/websets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': EXA_API_KEY,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Exa] Create webset failed:', response.status, errorText)
    throw new Error(`Exa API error (${response.status}): ${errorText}`)
  }

  const webset = await response.json()
  console.log('[Exa] Webset created:', webset.id, 'status:', webset.status)
  return webset
}

/**
 * Create an additional search within an existing Webset (extends results)
 * https://docs.exa.ai/websets/api/websets/searches/create-a-search
 */
async function createWebsetSearch(websetId, options = {}) {
  const { query, count = 50, entity = 'company', criteria = [] } = options

  if (!EXA_API_KEY) {
    console.log('[Exa] No API key configured - returning mock webset search')
    return {
      id: `mock_search_${Date.now()}`,
      object: 'webset_search',
      status: 'running',
      websetId,
      query,
      count,
    }
  }

  const payload = {
    query,
    count,
    entity: entity ? { type: entity } : undefined,
    criteria: criteria.length > 0 ? criteria : undefined,
    behavior: 'append',
  }

  console.log('[Exa] Creating webset search (append):', websetId, JSON.stringify(payload, null, 2))

  const response = await fetch(`${EXA_API_BASE}/websets/v0/websets/${websetId}/searches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': EXA_API_KEY,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Exa] Create webset search failed:', response.status, errorText)
    throw new Error(`Exa API error (${response.status}): ${errorText}`)
  }

  const search = await response.json()
  console.log('[Exa] Webset search created:', search.id, 'status:', search.status)
  return search
}

/**
 * Get a Webset from Exa
 * https://docs.exa.ai/websets/api/websets/get-a-webset
 */
async function getWebset(websetId) {
  if (!EXA_API_KEY) {
    return { id: websetId, status: 'idle', counters: { items: 0 } }
  }

  const response = await fetch(`${EXA_API_BASE}/websets/v0/websets/${websetId}`, {
    method: 'GET',
    headers: {
      'x-api-key': EXA_API_KEY,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Exa API error (${response.status}): ${errorText}`)
  }

  return response.json()
}

/**
 * List all items for a Webset
 * https://docs.exa.ai/websets/api/websets/items/list-all-items-for-a-webset
 */
async function listWebsetItems(websetId, options = {}) {
  const { cursor, limit = 100 } = options

  if (!EXA_API_KEY) {
    return { data: [], hasMore: false }
  }

  const params = new URLSearchParams()
  if (cursor) params.append('cursor', cursor)
  if (limit) params.append('limit', String(limit))

  const url = `${EXA_API_BASE}/websets/v0/websets/${websetId}/items${params.toString() ? '?' + params.toString() : ''}`
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': EXA_API_KEY,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Exa API error (${response.status}): ${errorText}`)
  }

  return response.json()
}

/**
 * Cancel a running Webset
 * https://docs.exa.ai/websets/api/websets/cancel-a-running-webset
 */
async function cancelWebset(websetId) {
  if (!EXA_API_KEY) {
    return { id: websetId, status: 'canceled' }
  }

  const response = await fetch(`${EXA_API_BASE}/websets/v0/websets/${websetId}/cancel`, {
    method: 'POST',
    headers: {
      'x-api-key': EXA_API_KEY,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Exa API error (${response.status}): ${errorText}`)
  }

  return response.json()
}

/**
 * Cancel a running search within a Webset
 * https://docs.exa.ai/websets/api/websets/searches/cancel-a-running-search
 */
async function cancelWebsetSearch(websetId, searchId) {
  if (!EXA_API_KEY) {
    return { id: searchId, status: 'canceled' }
  }

  const response = await fetch(`${EXA_API_BASE}/websets/v0/websets/${websetId}/searches/${searchId}/cancel`, {
    method: 'POST',
    headers: {
      'x-api-key': EXA_API_KEY,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Exa API error (${response.status}): ${errorText}`)
  }

  return response.json()
}

/**
 * Delete a Webset from Exa
 * https://docs.exa.ai/websets/api/websets/delete-a-webset
 * 
 * This permanently deletes the webset and all its items/enrichments
 */
async function deleteWebset(websetId) {
  if (!EXA_API_KEY) {
    console.log(`[Exa] No API key - skipping delete for webset ${websetId}`)
    return { id: websetId, deleted: true }
  }

  console.log(`[Exa] Deleting webset: ${websetId}`)
  
  const response = await fetch(`${EXA_API_BASE}/websets/v0/websets/${websetId}`, {
    method: 'DELETE',
    headers: {
      'x-api-key': EXA_API_KEY,
    },
  })

  if (!response.ok) {
    // 404 means already deleted, which is fine
    if (response.status === 404) {
      console.log(`[Exa] Webset ${websetId} already deleted or not found`)
      return { id: websetId, deleted: true, notFound: true }
    }
    const errorText = await response.text()
    throw new Error(`Exa API error (${response.status}): ${errorText}`)
  }

  console.log(`[Exa] Successfully deleted webset: ${websetId}`)
  return { id: websetId, deleted: true }
}

/**
 * Create an empty webset (without search)
 * POST /v0/websets/
 */
async function createEmptyWebset(externalId) {
  if (!EXA_API_KEY) {
    console.log('[Exa] No API key configured - returning mock empty webset')
    return {
      id: `mock_empty_webset_${Date.now()}`,
      object: 'webset',
      status: 'idle',
      externalId,
      counters: { items: 0, enrichments: 0 },
      createdAt: new Date().toISOString(),
    }
  }

  const payload = {
    externalId,
  }

  console.log('[Exa] Creating empty webset:', JSON.stringify(payload, null, 2))

  const response = await fetch(`${EXA_API_BASE}/websets/v0/websets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': EXA_API_KEY,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Exa] Create empty webset failed:', response.status, errorText)
    throw new Error(`Exa API error (${response.status}): ${errorText}`)
  }

  const webset = await response.json()
  console.log('[Exa] Empty webset created:', webset.id, 'status:', webset.status)
  return webset
}

/**
 * Create an import to add selected items to a webset
 * POST /v0/imports
 * Returns an uploadUrl for CSV upload
 */
async function createImport(websetId, options = {}) {
  const { format = 'csv', entity = 'company', count } = options

  if (!EXA_API_KEY) {
    console.log('[Exa] No API key configured - returning mock import')
    return {
      id: `mock_import_${Date.now()}`,
      object: 'import',
      status: 'pending',
      websetId,
      uploadUrl: 'https://mock-upload-url.example.com',
    }
  }

  const payload = {
    format,
    entity: entity ? { type: entity } : undefined,
    count,
  }

  console.log('[Exa] Creating import for webset:', websetId, JSON.stringify(payload, null, 2))

  const response = await fetch(`${EXA_API_BASE}/websets/v0/imports`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': EXA_API_KEY,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Exa] Create import failed:', response.status, errorText)
    throw new Error(`Exa API error (${response.status}): ${errorText}`)
  }

  const importData = await response.json()
  console.log('[Exa] Import created:', importData.id, 'uploadUrl:', importData.uploadUrl)
  return importData
}

/**
 * Upload CSV data to an import uploadUrl
 * The CSV should contain URLs or data from items to be enriched
 */
async function uploadCsvToImport(uploadUrl, csvContent) {
  if (!EXA_API_KEY) {
    console.log('[Exa] No API key configured - skipping CSV upload')
    return { uploaded: true }
  }

  console.log('[Exa] Uploading CSV to import, size:', csvContent.length, 'bytes')

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/csv',
    },
    body: csvContent,
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Exa] CSV upload failed:', response.status, errorText)
    throw new Error(`CSV upload error (${response.status}): ${errorText}`)
  }

  console.log('[Exa] CSV uploaded successfully')
  return { uploaded: true }
}

/**
 * Get import status
 * GET /v0/imports/{importId}
 */
async function getImportStatus(importId) {
  if (!EXA_API_KEY) {
    return { id: importId, status: 'completed' }
  }

  const response = await fetch(`${EXA_API_BASE}/websets/v0/imports/${importId}`, {
    method: 'GET',
    headers: {
      'x-api-key': EXA_API_KEY,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Exa API error (${response.status}): ${errorText}`)
  }

  return response.json()
}

/**
 * Create an enrichment for a Webset
 * https://docs.exa.ai/websets/api/websets/enrichments/create-an-enrichment
 * 
 * Enrichments extract additional data from items (email, phone, etc.)
 */
async function createEnrichment(websetId, enrichmentOptions = {}) {
  const { description, format = 'text', metadata, options: fieldOptions } = enrichmentOptions

  if (!EXA_API_KEY) {
    return {
      id: `mock_enrichment_${Date.now()}`,
      object: 'webset_enrichment',
      status: 'pending',
      websetId,
      description,
      format,
    }
  }

  // Build enrichment payload
  const payload = {
    description: description || 'Extract information for this lead',
    format,
  }
  
  // Add metadata for field identification
  if (metadata && typeof metadata === 'object') {
    payload.metadata = metadata
  }
  
  // Add options array for 'options' format (High/Medium/Low choices etc.)
  if (format === 'options' && Array.isArray(fieldOptions) && fieldOptions.length > 0) {
    payload.options = fieldOptions
  }

  console.log('[Exa] Creating enrichment for webset:', websetId, JSON.stringify(payload, null, 2))

  const response = await fetch(`${EXA_API_BASE}/websets/v0/websets/${websetId}/enrichments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': EXA_API_KEY,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Exa] Create enrichment failed:', response.status, errorText)
    throw new Error(`Exa enrichment error (${response.status}): ${errorText}`)
  }

  const enrichment = await response.json()
  console.log('[Exa] Enrichment created:', enrichment.id)
  return enrichment
}

/**
 * Get an enrichment status
 */
async function getEnrichment(websetId, enrichmentId) {
  if (!EXA_API_KEY) {
    return { id: enrichmentId, status: 'completed' }
  }

  const response = await fetch(`${EXA_API_BASE}/websets/v0/websets/${websetId}/enrichments/${enrichmentId}`, {
    method: 'GET',
    headers: {
      'x-api-key': EXA_API_KEY,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Exa API error (${response.status}): ${errorText}`)
  }

  return response.json()
}

/**
 * Get a single item from a Webset
 * https://docs.exa.ai/websets/api/websets/items/get-an-item
 */
async function getWebsetItem(websetId, itemId) {
  if (!EXA_API_KEY) {
    return null
  }

  const response = await fetch(`${EXA_API_BASE}/websets/v0/websets/${websetId}/items/${itemId}`, {
    method: 'GET',
    headers: {
      'x-api-key': EXA_API_KEY,
    },
  })

  if (!response.ok) {
    if (response.status === 404) return null
    const errorText = await response.text()
    throw new Error(`Exa API error (${response.status}): ${errorText}`)
  }

  return response.json()
}

/* ============================================
   HELPER FUNCTIONS
   ============================================ */

/**
 * Transform Exa item to our item format
 * Handles Exa API response structure: { id, object, properties: { company, type, url, description, content }, evaluations, enrichments, createdAt, updatedAt }
 */
function transformExaItem(exaItem, runId, leadsetId) {
  const props = exaItem.properties || {}
  
  // Handle company data - can be nested in properties.company or at root level
  const company = props.company || {}
  const person = props.person || {}
  const companyName = company.name || person.name || props.title || ''
  
  // Determine entity type
  const entityType =
    (props.type || 
     exaItem.object === 'webset_item' && props.type ||
     (props.person ? 'person' : null) ||
     (props.company ? 'company' : null) ||
     'company').toLowerCase()
  
  // Extract evaluations for score calculation
  const evaluations = exaItem.evaluations || []
  const satisfiedCount = evaluations.filter(e => e.satisfied === 'yes' || e.satisfied === true).length
  const score = evaluations.length > 0 
    ? Math.round((satisfiedCount / evaluations.length) * 100)
    : 0

  // Extract domain from URL or company data
  let domain = props.domain || company.domain || ''
  const sourceUrl = props.url || exaItem.url || ''
  if (!domain && sourceUrl) {
    try {
      domain = new URL(sourceUrl).hostname.replace(/^www\./, '')
    } catch (e) {
      domain = ''
    }
  }

  // Extract snippet/description - prefer description, fallback to content (truncated)
  let snippet = props.description || ''
  if (!snippet && props.content) {
    // Truncate content to reasonable snippet length
    snippet = typeof props.content === 'string' 
      ? props.content.substring(0, 500).replace(/\s+/g, ' ').trim()
      : ''
  }

  // Process enrichments if present
  const enrichments = exaItem.enrichments || []
  const enrichmentStatus = enrichments.length > 0 ? 'completed' : 'none'
  const enrichmentData = {}
  
  // Extract enrichment values by field
  enrichments.forEach(enrichment => {
    if (enrichment.status === 'completed' && enrichment.result) {
      const field = extractFieldFromEnrichment(enrichment)
      if (field) {
        enrichmentData[field] = extractEnrichmentValue(enrichment, field)
      }
    }
  })

  return {
    itemId: exaItem.id,
    runId,
    leadsetId,
    entityType,
    entity: {
      company: companyName,
      domain,
    },
    snippet: snippet || '',
    sourceUrl,
    platform: domain || 'web',
    recency: exaItem.createdAt || exaItem.updatedAt || new Date().toISOString(),
    score,
    evaluations,
    scoreBreakdown: {},
    matches: {
      segment: [],
      intent: [],
      tribe: [],
    },
    verification: { passed: true },
    enrichment: {
      status: enrichmentStatus,
      ...enrichmentData,
    },
    createdAt: exaItem.createdAt || new Date().toISOString(),
  }
}

/**
 * Verify Exa webhook signature
 */
function verifyExaSignature(rawBody, signature) {
  if (!EXA_WEBHOOK_SECRET) return true
  const digest = crypto.createHmac('sha256', EXA_WEBHOOK_SECRET).update(rawBody).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature || '', 'hex'))
  } catch {
    return false
  }
}

/**
 * Build CSV from items
 */
function buildCsv(items) {
  const header = [
    'company',
    'domain',
    'platform',
    'snippet',
    'recency',
    'score',
    'email',
    'phone',
    'buyingIntent',
    'description',
    'employeeCount',
    'linkedin',
    'leadsetId',
    'runId',
  ]
  const rows = items.map((item) => [
    JSON.stringify(item.entity?.company || ''),
    JSON.stringify(item.entity?.domain || ''),
    JSON.stringify(item.platform || ''),
    JSON.stringify((item.snippet || '').substring(0, 500)),
    item.recency || '',
    item.score ?? '',
    JSON.stringify(item.enrichment?.email || ''),
    JSON.stringify(item.enrichment?.phone || ''),
    JSON.stringify(item.enrichment?.buyingIntent || ''),
    JSON.stringify(item.enrichment?.description || ''),
    JSON.stringify(item.enrichment?.employeeCount || ''),
    JSON.stringify(item.enrichment?.linkedinUrl || ''),
    item.leadsetId || '',
    item.runId || '',
  ])
  return [header, ...rows].map((cells) => cells.join(',')).join('\n')
}

function toArray(payload) {
  if (!payload) return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.data)) return payload.data
  return Object.values(payload)
}

/* ============================================
   API ROUTES
   ============================================ */

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    exaConfigured: !!EXA_API_KEY,
  })
})

/**
 * Debug route: fetch current leadset feed document
 */
app.get('/leadset-feed', async (req, res, next) => {
  try {
    const feed = await sdk.getFirebaseData('leadsetFeed', 'global')
    res.json(feed || {})
  } catch (error) {
    next(error)
  }
})

/**
 * Seed leadsets and settings from JSON upload
 * Used to populate Firebase with initial data
 * 
 * Supports multiple formats:
 * 1. Array of leadsets: [ { id, name, ... }, ... ]
 * 2. Collection object: { session_id, lead_sets: [ ... ], ... }
 * 3. New standard format: { leadset_documents: [ ... ] }
 * 4. Legacy format: { leadsets: [ ... ] }
 */
app.post('/seed', async (req, res, next) => {
  let { leadsets = [], settings = null, clearExisting = false } = req.body
  let collectionSessionId = null
  
  // Handle new standard format: { leadset_documents: [...] }
  if (Array.isArray(req.body.leadset_documents)) {
    leadsets = req.body.leadset_documents
    // Extract sessionId from first leadset if available
    collectionSessionId = leadsets[0]?.session_id || null
    console.log(`[Seed] Detected leadset_documents format with ${leadsets.length} leadsets`)
  }
  // Handle collection format (brain-style): { session_id, lead_sets: [...] }
  else if (req.body.session_id && Array.isArray(req.body.lead_sets)) {
    collectionSessionId = req.body.session_id
    leadsets = req.body.lead_sets
    console.log(`[Seed] Detected collection format with session_id: ${collectionSessionId}`)
  }
  // Handle legacy format: { leadsets: [...] }
  else if (Array.isArray(req.body.leadsets)) {
    leadsets = req.body.leadsets
  }
  // If leadsets is already an array (direct array upload), use it as-is
  
  try {
    let seededLeadsets = 0
    let seededSettings = false
    
    // Optionally clear existing data
    if (clearExisting) {
      const allDocs = toArray(await sdk.searchFirebaseData({}, 5000))
      for (const doc of allDocs) {
        if (doc.doc_type === 'leadsets' || doc.doc_type === 'runs' || doc.doc_type === 'items' || doc.doc_type === 'enrichments') {
          await sdk.deleteFirebaseData(doc.doc_type, doc.id).catch(() => {})
        }
      }
      console.log('[Seed] Cleared existing data')
    }
    
    // Seed leadsets
    for (const leadset of leadsets) {
      if (!leadset.id) {
        // Use doc_id if available (from brain format), otherwise generate
        leadset.id = leadset.doc_id || `ls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      }
      
      // Extract sessionId: prioritize from leadset, then collection, then request body
      const sessionId = leadset.sessionId || leadset.session_id || collectionSessionId || req.body.sessionId
      
      const leadsetDoc = {
        ...leadset,
        id: leadset.id, // Ensure id is set
        sessionId: sessionId, // Add sessionId to each leadset
        status: leadset.status || 'idle',
        createdAt: leadset.createdAt || new Date().toISOString(),
      }
      
      await sdk.createFirebaseData('leadsets', leadset.id, leadsetDoc).catch(() =>
        sdk.updateFirebaseData('leadsets', leadset.id, leadsetDoc)
      )
      seededLeadsets++
      console.log(`[Seed] Created leadset: ${leadset.id} - ${leadset.name} (sessionId: ${sessionId || 'none'})`)
    }
    
    // Seed settings
    if (settings) {
      await sdk.createFirebaseData('settings', 'settings', settings).catch(() =>
        sdk.updateFirebaseData('settings', 'settings', settings)
      )
      seededSettings = true
      console.log('[Seed] Created settings')
    }
    
    await updateDocStatus(['leadsets', 'settings'])
    await rebuildLeadsetFeed().catch((err) => console.warn('[Leadset Feed] Seed rebuild skipped:', err.message))
    
    res.json({
      success: true,
      seededLeadsets,
      seededSettings,
      sessionId: collectionSessionId || (leadsets[0]?.sessionId || leadsets[0]?.session_id) || null,
      message: `Seeded ${seededLeadsets} leadsets${seededSettings ? ' and settings' : ''}${collectionSessionId ? ` with sessionId: ${collectionSessionId}` : ''}`,
    })
  } catch (error) {
    console.error('[Seed] Error:', error)
    next(error)
  }
})

/**
 * Factory Reset - Delete all data from Exa AND Firebase
 * 
 * This is a TRUE factory reset:
 * 1. First, fetch all runs to get associated Exa webset IDs
 * 2. Delete all websets from Exa (this also deletes their items/enrichments in Exa)
 * 3. Then delete all Firebase data using batch operations
 * 
 * This ensures a completely clean slate with no orphaned websets in Exa.
 */
app.delete('/seed', async (req, res, next) => {
  try {
    const results = {
      exaWebsetsDeleted: 0,
      exaWebsetsFailed: 0,
      firebaseDocsDeleted: 0,
    }

    // Step 1: Get all runs to find Exa webset IDs
    console.log('[Factory Reset] Step 1: Finding all Exa websets...')
    
    // Search with a much higher limit to get all documents
    let allDocs = toArray(await sdk.searchFirebaseData({}, 50000))
    const allRuns = allDocs.filter(doc => doc.doc_type === 'runs')
    const allLeadsets = allDocs.filter(doc => doc.doc_type === 'leadsets')
    
    // Collect all unique webset IDs from runs and leadsets
    const websetIds = new Set()
    allRuns.forEach(run => {
      if (run.websetId) websetIds.add(run.websetId)
    })
    allLeadsets.forEach(leadset => {
      if (leadset.websetId) websetIds.add(leadset.websetId)
    })
    
    console.log(`[Factory Reset] Found ${websetIds.size} Exa websets to delete`)

    // Step 2: Delete all websets from Exa (in parallel batches for speed)
    if (EXA_API_KEY && websetIds.size > 0) {
      console.log('[Factory Reset] Step 2: Deleting Exa websets...')
      const websetArray = Array.from(websetIds)
      const batchSize = 10 // Delete 10 at a time to avoid rate limiting
      
      for (let i = 0; i < websetArray.length; i += batchSize) {
        const batch = websetArray.slice(i, i + batchSize)
        const deleteResults = await Promise.allSettled(
          batch.map(websetId => deleteWebset(websetId))
        )
        
        deleteResults.forEach((result, idx) => {
          if (result.status === 'fulfilled') {
            results.exaWebsetsDeleted++
            console.log(`[Factory Reset] Deleted Exa webset: ${batch[idx]}`)
          } else {
            results.exaWebsetsFailed++
            console.warn(`[Factory Reset] Failed to delete Exa webset ${batch[idx]}:`, result.reason?.message)
          }
        })
      }
      
      console.log(`[Factory Reset] Exa cleanup complete: ${results.exaWebsetsDeleted} deleted, ${results.exaWebsetsFailed} failed`)
    } else if (websetIds.size > 0) {
      console.log('[Factory Reset] Skipping Exa webset deletion (no API key configured)')
    }

    // Step 3: Delete all Firebase data - keep searching and deleting until no more documents found
    console.log('[Factory Reset] Step 3: Deleting Firebase data...')
    
    // Keep deleting in batches until no more documents are found
    let totalDeleted = 0
    let batchNumber = 0
    const batchSize = 50
    const maxIterations = 100 // Safety limit to prevent infinite loops
    let hasMoreDocs = true
    
    while (hasMoreDocs && batchNumber < maxIterations) {
      batchNumber++
      // Search again to get current documents
      const currentDocs = toArray(await sdk.searchFirebaseData({}, 50000))
      
      if (currentDocs.length === 0) {
        hasMoreDocs = false
        console.log(`[Factory Reset] No more documents found, deletion complete`)
        break
      }
      
      console.log(`[Factory Reset] Batch ${batchNumber}: Found ${currentDocs.length} documents to delete`)
      
      // Delete in smaller batches
      for (let i = 0; i < currentDocs.length; i += batchSize) {
        const batch = currentDocs.slice(i, i + batchSize)
        const deleteResults = await Promise.allSettled(
          batch.map(doc => {
            try {
              return sdk.deleteFirebaseData(doc.doc_type, doc.id)
            } catch (err) {
              console.warn(`[Factory Reset] Error deleting ${doc.doc_type}/${doc.id}:`, err.message)
              return Promise.reject(err)
            }
          })
        )
        
        const successCount = deleteResults.filter(r => r.status === 'fulfilled').length
        totalDeleted += successCount
        results.firebaseDocsDeleted += successCount
        
        const failedCount = batch.length - successCount
        if (failedCount > 0) {
          console.warn(`[Factory Reset] Failed to delete ${failedCount} documents in batch`)
          // Log which documents failed
          deleteResults.forEach((result, idx) => {
            if (result.status === 'rejected') {
              console.warn(`[Factory Reset] Failed: ${batch[idx].doc_type}/${batch[idx].id} - ${result.reason?.message || 'Unknown error'}`)
            }
          })
        }
      }
      
      console.log(`[Factory Reset] Batch ${batchNumber} complete: ${totalDeleted} total documents deleted so far`)
      
      // Wait a bit before next search to ensure deletions are processed
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Verify if we're done by searching again
      const verifyDocs = toArray(await sdk.searchFirebaseData({}, 50000))
      if (verifyDocs.length === 0) {
        hasMoreDocs = false
        console.log(`[Factory Reset] Verification: No more documents found`)
      } else if (verifyDocs.length === currentDocs.length) {
        // Same number of docs - might be stuck, log warning
        console.warn(`[Factory Reset] Warning: Same number of documents (${verifyDocs.length}) after deletion. Some documents may not be deletable.`)
        hasMoreDocs = false // Stop to avoid infinite loop
      } else {
        console.log(`[Factory Reset] Verification: Found ${verifyDocs.length} more documents, continuing...`)
      }
    }
    
    if (batchNumber >= maxIterations) {
      console.warn(`[Factory Reset] Reached max iterations (${maxIterations}), stopping deletion`)
    }
    
    console.log(`[Factory Reset] Firebase deletion complete: ${results.firebaseDocsDeleted} documents deleted`)
    
    console.log(`[Factory Reset] Complete!`)
    console.log(`  - Exa websets deleted: ${results.exaWebsetsDeleted}`)
    console.log(`  - Exa websets failed: ${results.exaWebsetsFailed}`)
    console.log(`  - Firebase docs deleted: ${results.firebaseDocsDeleted}`)
    
    await rebuildLeadsetFeed().catch((err) => console.warn('[Leadset Feed] Reset rebuild skipped:', err.message))

    res.json({ 
      success: true, 
      ...results,
      message: `Factory reset complete. Deleted ${results.exaWebsetsDeleted} Exa websets and ${results.firebaseDocsDeleted} Firebase documents.`
    })
  } catch (error) {
    console.error('[Factory Reset] Error:', error)
    next(error)
  }
})

/**
 * List all leadsets (for frontend data)
 */
app.get('/leadsets', async (req, res, next) => {
  try {
    // FN7 SDK: searchFirebaseData(queryConstraints, limit, orderBy?, authContext?)
    // Returns all docs for org, we filter by doc_type client-side
    const allDocs = await sdk.searchFirebaseData({}, 500)
    const leadsets = toArray(allDocs).filter(doc => doc.doc_type === 'leadsets')
    res.json(leadsets)
  } catch (error) {
    next(error)
  }
})

/**
 * Get leadset detail with run and items
 * Auto-syncs from Exa if run is still "running"
 */
/**
 * Get websetId for a leadset (quick lookup)
 */
app.get('/leadsets/:leadsetId/webset-id', async (req, res, next) => {
  const { leadsetId } = req.params
  try {
    const allDocs = toArray(await sdk.searchFirebaseData({}, 500))
    const allRuns = allDocs.filter(doc => doc.doc_type === 'runs')
    const runs = allRuns
      .filter(r => r.leadsetId === leadsetId)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    
    const latestRun = runs[0] || null
    
    if (!latestRun) {
      return res.status(404).json({ error: 'No run found for this leadset' })
    }
    
    res.json({
      leadsetId,
      runId: latestRun.id,
      websetId: latestRun.websetId || null,
      runStatus: latestRun.status,
      createdAt: latestRun.createdAt,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/leadsets/:leadsetId/detail', async (req, res, next) => {
  const { leadsetId } = req.params
  try {
    let leadset = await sdk.getFirebaseData('leadsets', leadsetId)
    if (!leadset) {
      return res.status(404).json({ error: 'Leadset not found' })
    }

    // Get latest run
    const allDocs = toArray(await sdk.searchFirebaseData({}, 500))
    const allRuns = allDocs.filter(doc => doc.doc_type === 'runs')
    const runs = allRuns
      .filter(r => r.leadsetId === leadsetId)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    let run = runs[0] || null

    // Get items for this leadset
    let items = []
    
    // If run is "running", auto-sync from Exa
    if (run && run.status === 'running' && run.websetId && EXA_API_KEY) {
      try {
        const webset = await getWebset(run.websetId)
        
        // Get ALL items from Exa (paginate if needed)
        let exaItems = []
        let cursor = null
        do {
          const itemsResponse = await listWebsetItems(run.websetId, { limit: 100, cursor })
          exaItems = exaItems.concat(itemsResponse.data || [])
          cursor = itemsResponse.hasMore ? itemsResponse.nextCursor : null
        } while (cursor)

        // Transform and save items
        items = exaItems.map(item => transformExaItem(item, run.id, leadsetId))
        
        console.log(`[Detail] Transformed ${items.length} items from Exa for leadset ${leadsetId}, run ${run.id}`)
        
        // Update status if webset completed
        const newStatus = webset.status === 'idle' ? 'completed' : webset.status
        
        // Always save items if we have any, regardless of status change
        if (items.length > 0) {
          console.log(`[Detail] Saving ${items.length} items to Firebase...`)
          const saveResults = await Promise.allSettled(items.map(item => 
            sdk.createFirebaseData('items', item.itemId, item).catch((err) => {
              console.log(`[Detail] Item ${item.itemId} already exists, updating instead`)
              return sdk.updateFirebaseData('items', item.itemId, item)
            })
          ))
          
          const saved = saveResults.filter(r => r.status === 'fulfilled').length
          const failed = saveResults.filter(r => r.status === 'rejected').length
          console.log(`[Detail] Saved ${saved} items, ${failed} failed`)
          
          if (failed > 0) {
            console.error(`[Detail] Failed to save ${failed} items:`, 
              saveResults.filter(r => r.status === 'rejected').map(r => r.reason?.message || r.reason))
          }
        }
        
        // Update run status if it changed
        if (run.status !== newStatus) {
          await sdk.updateFirebaseData('runs', run.id, {
            status: newStatus,
            counters: { ...run.counters, found: items.length },
          })
          run = { ...run, status: newStatus, counters: { ...run.counters, found: items.length } }
          
          // Update leadset status if completed
          if (newStatus === 'completed') {
            await sdk.updateFirebaseData('leadsets', leadsetId, { status: 'idle' })
            leadset = { ...leadset, status: 'idle' }
          }
          
          await updateDocStatus(['runs', 'items', 'leadsets'], { leadsetId, runId: run.id })
        } else if (items.length > 0) {
          // Even if status didn't change, update docStatus to trigger frontend refresh
          await updateDocStatus(['items'], { leadsetId, runId: run.id })
        }
      } catch (syncError) {
        console.warn('[Detail] Auto-sync failed:', syncError.message)
      }
    }
    
    // If items not fetched from Exa, get from Firebase
    if (items.length === 0 && run) {
      const allItemDocs = toArray(await sdk.searchFirebaseData({}, 2000))
      const allItems = allItemDocs.filter(doc => doc.doc_type === 'items')
      items = allItems.filter(item => item.runId === run.id)
    }

    res.json({ leadset, run, items })
  } catch (error) {
    next(error)
  }
})

/**
 * Manually sync items from Exa API to Firebase
 * POST /leadsets/:leadsetId/sync-items?websetId=xxx (optional websetId)
 */
app.post('/leadsets/:leadsetId/sync-items', async (req, res, next) => {
  const { leadsetId } = req.params
  const { websetId: providedWebsetId } = req.query
  try {
    if (!EXA_API_KEY) {
      return res.status(400).json({ error: 'Exa API key not configured' })
    }

    let run = null
    let websetId = providedWebsetId

    // If websetId provided in query, use it directly
    if (websetId) {
      console.log(`[Sync] Using provided websetId: ${websetId}`)
      // Try to find or create a run for this websetId
      const allDocs = toArray(await sdk.searchFirebaseData({}, 500))
      const allRuns = allDocs.filter(doc => doc.doc_type === 'runs')
      run = allRuns.find(r => r.websetId === websetId && r.leadsetId === leadsetId)
      
      // If no run exists, create a minimal run document
      if (!run) {
        const runId = `run_${Date.now()}`
        run = {
          id: runId,
          leadsetId,
          websetId,
          status: 'completed',
          mode: 'manual',
          createdAt: new Date().toISOString(),
          counters: { found: 0 },
        }
        await sdk.createFirebaseData('runs', runId, run)
        console.log(`[Sync] Created temporary run ${runId} for webset ${websetId}`)
      }
    } else {
      // Get latest run
      const allDocs = toArray(await sdk.searchFirebaseData({}, 500))
      const allRuns = allDocs.filter(doc => doc.doc_type === 'runs')
      const runs = allRuns
        .filter(r => r.leadsetId === leadsetId)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      
      run = runs[0] || null
      
      if (!run) {
        return res.status(404).json({ error: 'No run found for this leadset. Provide websetId as query parameter: ?websetId=xxx' })
      }

      websetId = run.websetId
      if (!websetId) {
        return res.status(400).json({ error: 'Run has no websetId' })
      }
    }

    console.log(`[Sync] Starting manual sync for leadset ${leadsetId}, run ${run.id}, webset ${websetId}`)

    // Fetch all items from Exa
    let exaItems = []
    let cursor = null
    do {
      const itemsResponse = await listWebsetItems(websetId, { limit: 100, cursor })
      exaItems = exaItems.concat(itemsResponse.data || [])
      cursor = itemsResponse.hasMore ? itemsResponse.nextCursor : null
      console.log(`[Sync] Fetched ${exaItems.length} items so far...`)
    } while (cursor)

    console.log(`[Sync] Total items from Exa: ${exaItems.length}`)

    // Transform items
    const items = exaItems.map(item => transformExaItem(item, run.id, leadsetId))
    console.log(`[Sync] Transformed ${items.length} items`)

    // Save all items to Firebase
    if (items.length > 0) {
      console.log(`[Sync] Saving ${items.length} items to Firebase...`)
      const saveResults = await Promise.allSettled(items.map(item => 
        sdk.createFirebaseData('items', item.itemId, item).catch((err) => {
          console.log(`[Sync] Item ${item.itemId} already exists, updating instead`)
          return sdk.updateFirebaseData('items', item.itemId, item)
        })
      ))
      
      const saved = saveResults.filter(r => r.status === 'fulfilled').length
      const failed = saveResults.filter(r => r.status === 'rejected').length
      
      if (failed > 0) {
        console.error(`[Sync] Failed to save ${failed} items:`, 
          saveResults.filter(r => r.status === 'rejected').map(r => r.reason?.message || r.reason))
      }

      // Update run counters
      await sdk.updateFirebaseData('runs', run.id, {
        counters: { ...run.counters, found: items.length },
      })

      // Trigger frontend refresh
      await updateDocStatus(['items', 'runs'], { leadsetId, runId: run.id })

      res.json({
        success: true,
        message: `Synced ${saved} items to Firebase`,
        stats: {
          total: items.length,
          saved,
          failed,
        },
      })
    } else {
      res.json({
        success: true,
        message: 'No items found in Exa webset',
        stats: {
          total: 0,
          saved: 0,
          failed: 0,
        },
      })
    }
  } catch (error) {
    console.error('[Sync] Error syncing items:', error)
    next(error)
  }
})

/**
 * Delete all items for a leadset
 * DELETE /leadsets/:leadsetId/items
 */
app.delete('/leadsets/:leadsetId/items', async (req, res, next) => {
  const { leadsetId } = req.params
  try {
    console.log(`[Delete] Starting deletion of items for leadset ${leadsetId}`)
    
    // Get all items for this leadset
    const allDocs = toArray(await sdk.searchFirebaseData({}, 10000))
    const allItems = allDocs.filter(doc => doc.doc_type === 'items')
    const itemsToDelete = allItems.filter(item => item.leadsetId === leadsetId)
    
    console.log(`[Delete] Found ${itemsToDelete.length} items to delete`)
    
    if (itemsToDelete.length === 0) {
      return res.json({
        success: true,
        message: 'No items found to delete',
        deleted: 0,
      })
    }
    
    // Delete all items
    const deleteResults = await Promise.allSettled(
      itemsToDelete.map(item => 
        sdk.deleteFirebaseData('items', item.itemId || item.id).catch(err => {
          console.warn(`[Delete] Failed to delete item ${item.itemId || item.id}:`, err.message)
          throw err
        })
      )
    )
    
    const deleted = deleteResults.filter(r => r.status === 'fulfilled').length
    const failed = deleteResults.filter(r => r.status === 'rejected').length
    
    console.log(`[Delete] Deleted ${deleted} items, ${failed} failed`)
    
    // Update docStatus to trigger frontend refresh
    await updateDocStatus(['items'], { leadsetId })
    
    res.json({
      success: true,
      message: `Deleted ${deleted} items`,
      stats: {
        total: itemsToDelete.length,
        deleted,
        failed,
      },
    })
  } catch (error) {
    console.error('[Delete] Error deleting items:', error)
    next(error)
  }
})

/**
 * Get settings
 */
app.get('/settings', async (req, res, next) => {
  try {
    const settings = await sdk.getFirebaseData('settings', 'settings').catch(() => null)
    res.json(settings || { cost: { perContact: 2 } })
  } catch (error) {
    // Return default settings if not found
    res.json({ cost: { perContact: 2 } })
  }
})

/**
 * Start a new run for a leadset
 * Creates a Webset in Exa to search for buyers
 */
/**
 * Check if a leadset has an existing run with a webset
 * Returns info about the existing run/webset if any
 */
app.get('/leadsets/:leadsetId/run-status', async (req, res, next) => {
  const { leadsetId } = req.params
  
  try {
    const leadset = await sdk.getFirebaseData('leadsets', leadsetId)
    if (!leadset) {
      return res.status(404).json({ error: 'Leadset not found' })
    }

    // Check for existing run
    const allDocs = toArray(await sdk.searchFirebaseData({}, 500))
    const allRuns = allDocs.filter(doc => doc.doc_type === 'runs')
    const runs = allRuns
      .filter(r => r.leadsetId === leadsetId)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    
    const latestRun = runs[0] || null
    
    // Count existing items
    const allItems = allDocs.filter(doc => doc.doc_type === 'items')
    const itemCount = latestRun 
      ? allItems.filter(item => item.runId === latestRun.id).length 
      : 0

    res.json({
      hasExistingRun: !!latestRun,
      run: latestRun,
      itemCount,
      websetId: latestRun?.websetId || leadset.websetId || null,
    })
  } catch (error) {
    console.error('[Run Status] Error:', error)
    next(error)
  }
})

/**
 * Start a new run for a leadset
 * 
 * Request body options:
 * - mode: 'new' (default) | 'extend' | 'replace'
 * - count: number of buyers to fetch (default: 10)
 * 
 * Modes:
 * - 'new': Create a new run (fails if existing webset, unless force=true)
 * - 'extend': Add more buyers to existing webset
 * - 'replace': Delete existing webset and create new one
 */
app.post('/leadsets/:leadsetId/run', async (req, res, next) => {
  const { leadsetId } = req.params
  const { mode = 'new', count = 10, force = false } = req.body
  
  try {
    // Get leadset from Firebase
    const leadset = await sdk.getFirebaseData('leadsets', leadsetId)
    if (!leadset) {
      return res.status(404).json({ error: 'Leadset not found' })
    }

    // Check for existing run/webset
    const allDocs = toArray(await sdk.searchFirebaseData({}, 500))
    const allRuns = allDocs.filter(doc => doc.doc_type === 'runs')
    const existingRuns = allRuns
      .filter(r => r.leadsetId === leadsetId)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    
    const latestRun = existingRuns[0] || null
    const existingWebsetId = latestRun?.websetId || leadset.websetId
    
    // If there's an existing webset and mode is 'new' without force, return conflict
    if (existingWebsetId && mode === 'new' && !force) {
      const allItems = allDocs.filter(doc => doc.doc_type === 'items')
      const itemCount = latestRun 
        ? allItems.filter(item => item.runId === latestRun.id).length 
        : 0
      
      return res.status(409).json({
        error: 'EXISTING_WEBSET',
        message: 'This leadset already has buyers. Choose to extend or replace.',
        existingWebsetId,
        existingRunId: latestRun?.id,
        itemCount,
      })
    }

    // Handle 'replace' mode - delete existing webset first
    if (mode === 'replace' && existingWebsetId) {
      console.log(`[Run] Deleting existing webset ${existingWebsetId} for replace mode`)
      try {
        await deleteWebset(existingWebsetId)
        console.log(`[Run] Deleted webset ${existingWebsetId}`)
      } catch (deleteError) {
        console.warn(`[Run] Could not delete webset ${existingWebsetId}:`, deleteError.message)
        // Continue anyway - webset might already be deleted
      }
      
      // Delete existing items for this leadset
      const allItems = allDocs.filter(doc => doc.doc_type === 'items')
      const itemsToDelete = latestRun 
        ? allItems.filter(item => item.runId === latestRun.id)
        : []
      
      for (const item of itemsToDelete) {
        await sdk.deleteFirebaseData('items', item.id).catch(() => {})
      }
      console.log(`[Run] Deleted ${itemsToDelete.length} existing items`)
    }

    // Build search query from leadset data
    const queryParts = []
    if (leadset.description) queryParts.push(leadset.description)
    if (leadset.segment?.segment_archetype) queryParts.push(leadset.segment.segment_archetype)
    if (leadset.segment?.geo_region) queryParts.push(`in ${leadset.segment.geo_region}`)
    if (leadset.segment?.firmographic_company_size) queryParts.push(`${leadset.segment.firmographic_company_size} size`)
    if (leadset.segment?.tribe?.length) queryParts.push(`focusing on ${leadset.segment.tribe.join(', ')}`)
    if (leadset.intent?.signals?.length) queryParts.push(`showing intent for ${leadset.intent.signals.join(', ')}`)
    
    const searchQuery = queryParts.join('. ') || leadset.name || 'companies'

    // Build criteria from intent signals
    const criteria = (leadset.intent?.signals || []).map(signal => ({
      description: `Shows intent or interest in ${signal}`,
    }))

    const requestedCount = parseInt(count, 10) || 10
    let targetWebsetId = existingWebsetId
    let webset = null
    let searchId = null

    if (mode === 'extend') {
      if (!existingWebsetId) {
        return res.status(400).json({
          error: 'NO_EXISTING_WEBSET',
          message: 'Cannot extend because this leadset has no existing webset. Start a new run first.',
        })
      }

      const websetSearch = await createWebsetSearch(existingWebsetId, {
        query: searchQuery,
        count: requestedCount,
        entity: 'company',
        criteria,
      })
      webset = { id: existingWebsetId, status: websetSearch.status || 'running' }
      searchId = websetSearch.id
      targetWebsetId = existingWebsetId
    } else {
      // Create Webset in Exa
      // Use a unique externalId that includes timestamp to avoid conflicts
      const externalId = `${leadsetId}_${Date.now()}`
      webset = await createWebset({
        query: searchQuery,
        count: requestedCount,
        entity: 'company',
        criteria,
        externalId,
      })
      targetWebsetId = webset.id
    }

    // Create run document
    const runId = `run_${Date.now()}`
    const runDoc = {
      id: runId,
      leadsetId,
      websetId: targetWebsetId,
      status: 'running',
      mode, // Track the mode used
      requestedCount,
      searchId: searchId || null,
      counters: { 
        found: 0, 
        enriched: 0, 
        selected: 0, 
        analyzed: 0 
      },
      searchQuery,
      createdAt: new Date().toISOString(),
      createdBy: 'scout-backend',
    }

    // Save to Firebase
    await sdk.createFirebaseData('runs', runId, runDoc)
    await sdk.updateFirebaseData('leadsets', leadsetId, {
      lastRunId: runId,
      websetId: targetWebsetId,
      status: 'running',
    })
    
    await updateDocStatus(['leadsets', 'runs'], { leadsetId, runId })

    await rebuildLeadsetFeed().catch((err) => console.warn('[Leadset Feed] Run rebuild skipped:', err.message))

    console.log(`[Run] Started run ${runId} (mode: ${mode}, count: ${count}) for leadset ${leadsetId}, webset ${targetWebsetId}${searchId ? `, search ${searchId}` : ''}`)
    res.status(201).json(runDoc)
  } catch (error) {
    console.error('[Run] Error starting run:', error)
    next(error)
  }
})

/**
 * Get webset status and items from Exa
 * This is polled by the frontend for real-time updates
 */
app.get('/leadsets/:leadsetId/runs/:runId/webset', async (req, res, next) => {
  const { leadsetId, runId } = req.params
  
  try {
    // Get run from Firebase
    const run = await sdk.getFirebaseData('runs', runId)
    if (!run) {
      return res.status(404).json({ error: 'Run not found' })
    }

    // Get webset status from Exa
    const webset = await getWebset(run.websetId)
    
    // Get ALL items from Exa (paginate if needed)
    let exaItems = []
    let cursor = null
    do {
      const itemsResponse = await listWebsetItems(run.websetId, { limit: 100, cursor })
      exaItems = exaItems.concat(itemsResponse.data || [])
      cursor = itemsResponse.hasMore ? itemsResponse.nextCursor : null
    } while (cursor)

    // Transform items to our format
    const items = exaItems.map(item => transformExaItem(item, runId, leadsetId))

    // Update Firebase with latest counts
    const newStatus = webset.status === 'idle' ? 'completed' : webset.status
    let dataChanged = false
    if (run.status !== newStatus || (run.counters?.found || 0) !== items.length) {
      await sdk.updateFirebaseData('runs', runId, {
        status: newStatus,
        counters: {
          ...run.counters,
          found: items.length,
          analyzed: webset.counters?.searches || 0,
        },
      })
      dataChanged = true

      // Save items to Firebase for caching
      if (items.length > 0) {
        await Promise.all(items.map(item => 
          sdk.createFirebaseData('items', item.itemId, item).catch(() => 
            sdk.updateFirebaseData('items', item.itemId, item)
          )
        ))
        dataChanged = true
      }

      // Update leadset status if webset completed
      if (newStatus === 'completed' || newStatus === 'idle') {
        await sdk.updateFirebaseData('leadsets', leadsetId, { status: 'idle' })
        dataChanged = true
      }

      await updateDocStatus(['runs', 'items', 'leadsets'], { leadsetId, runId })
      // Always rebuild feed when data changes
      await rebuildLeadsetFeed().catch((err) => console.warn('[Leadset Feed] Webset rebuild skipped:', err.message))
    }

    res.json({
      id: webset.id,
      status: webset.status,
      counters: {
        found: items.length,
        analyzed: webset.counters?.searches || 0,
      },
      items,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Webset] Error getting status:', error)
    next(error)
  }
})

/**
 * Cancel a running run/webset
 */
app.post('/leadsets/:leadsetId/runs/:runId/cancel', async (req, res, next) => {
  const { leadsetId, runId } = req.params
  
  try {
    const run = await sdk.getFirebaseData('runs', runId)
    if (!run) {
      return res.status(404).json({ error: 'Run not found' })
    }

    // Cancel running work in Exa (different endpoints for new vs extend)
    if (run.mode === 'extend' && run.searchId && run.websetId) {
      await cancelWebsetSearch(run.websetId, run.searchId).catch(err => {
        console.warn('[Cancel] Failed to cancel webset search:', err.message)
      })
    } else if (run.websetId) {
      await cancelWebset(run.websetId).catch(err => {
        console.warn('[Cancel] Failed to cancel webset:', err.message)
      })
    }

    // Update Firebase
    await sdk.updateFirebaseData('runs', runId, { 
      status: 'canceled',
      canceledAt: new Date().toISOString(),
    })
    await sdk.updateFirebaseData('leadsets', leadsetId, { status: 'idle' })
    await updateDocStatus(['runs', 'leadsets'], { leadsetId, runId })
    await rebuildLeadsetFeed().catch((err) => console.warn('[Leadset Feed] Cancel rebuild skipped:', err.message))

    res.json({ status: 'canceled' })
  } catch (error) {
    next(error)
  }
})

/**
 * Request enrichment for contact details
 * Creates enrichments in Exa for email and phone
 */
app.post('/leadsets/:leadsetId/runs/:runId/enrich', async (req, res, next) => {
  const { leadsetId, runId } = req.params
  const { fields: requestedFieldsInput = [] } = req.body || {}

  try {
    const leadset = await sdk.getFirebaseData('leadsets', leadsetId)
    if (!leadset) {
      return res.status(404).json({ error: 'Leadset not found' })
    }

    const allowedFromLeadset = getAllowedEnrichmentFieldsForLeadset(leadset)
    const requestedFields = normalizeRequestedFields(requestedFieldsInput, allowedFromLeadset)
    const invalidFields = requestedFields.filter((field) => !ENRICHMENT_FIELDS[field])
    if (invalidFields.length > 0) {
      return res.status(400).json({ error: 'Invalid fields requested', invalidFields })
    }

    const run = await sdk.getFirebaseData('runs', runId)
    if (!run) {
      return res.status(404).json({ error: 'Run not found' })
    }

    if (!run.websetId) {
      return res.status(400).json({ error: 'No webset found for this run' })
    }

    // Always enrich entire existing webset
    console.log(`[Enrich] Starting enrichment for entire webset`)
    let allItems = []
    let cursor = null
    do {
      const itemsResponse = await listWebsetItems(run.websetId, { limit: 100, cursor })
      allItems = allItems.concat(itemsResponse.data || [])
      cursor = itemsResponse.hasMore ? itemsResponse.nextCursor : null
    } while (cursor)

    const enrichmentRequests = []
    for (const fieldKey of requestedFields) {
      const definition = ENRICHMENT_FIELDS[fieldKey]
      if (!definition) {
        console.warn(`[Enrich] No definition found for field: ${fieldKey}`)
        continue
      }
      
      console.log(`[Enrich] Creating enrichment for field: ${fieldKey}`, {
        description: definition.description?.substring(0, 100),
        format: definition.format,
        metadata: { field: fieldKey },
      })
      
      // Build enrichment request with proper format
      const enrichmentPayload = {
        description: definition.description,
        format: definition.format === 'options' ? 'options' : definition.format,
        metadata: { field: fieldKey },
      }
      
      // Add options array for 'options' format fields
      if (definition.format === 'options' && definition.options) {
        enrichmentPayload.options = definition.options
      }
      
      const enrichment = await createEnrichment(run.websetId, enrichmentPayload)
      
      console.log(`[Enrich] Created enrichment for ${fieldKey}:`, enrichment.id)
      
      enrichmentRequests.push({
        field: fieldKey,
        enrichmentId: enrichment.id,
        format: definition.format,
      })
    }

    const enrichmentId = `enrich_${Date.now()}`
    await sdk.createFirebaseData('enrichments', enrichmentId, {
      id: enrichmentId,
      runId,
      leadsetId,
      websetId: run.websetId,
      fields: requestedFields,
      requests: enrichmentRequests,
      status: 'pending',
      createdAt: new Date().toISOString(),
    })

    // Update all items to show enriching status
    const transformedItems = allItems.map(exaItem => transformExaItem(exaItem, runId, leadsetId))
    
    await Promise.all(
      transformedItems.map(async (item) => {
        try {
          const existingItem = await sdk.getFirebaseData('items', item.itemId).catch(() => null)
          const existingEnrichment = existingItem?.enrichment || {}
          
          const itemData = {
            ...item,
            enrichment: {
              ...existingEnrichment,
              status: 'enriching',
            },
          }
          
          if (existingItem) {
            await sdk.updateFirebaseData('items', item.itemId, {
              enrichment: itemData.enrichment,
            })
          } else {
            await sdk.createFirebaseData('items', item.itemId, itemData).catch(() => {
              sdk.updateFirebaseData('items', item.itemId, {
                enrichment: itemData.enrichment,
              }).catch(() => {})
            })
          }
        } catch (err) {
          console.warn(`[Enrich] Failed to update item ${item.itemId}:`, err.message)
        }
      })
    )

    // Update both run AND leadset status to 'enriching'
    await Promise.all([
      sdk.updateFirebaseData('runs', runId, {
        status: 'enriching',
        counters: {
          ...run.counters,
        },
      }),
      sdk.updateFirebaseData('leadsets', leadsetId, {
        status: 'enriching',
      }),
    ])

    // Give Firebase a moment to propagate item updates
    await new Promise(resolve => setTimeout(resolve, 300))
    
    // Re-fetch items to get the updated enrichment status before rebuilding feed
    const allDocsAfterEnrichStart = toArray(await sdk.searchFirebaseData({}, 10000))
    await updateDocStatus(['runs', 'items', 'enrichments', 'leadsets'], { leadsetId, runId })
    await rebuildLeadsetFeed(allDocsAfterEnrichStart).catch((err) => console.warn('[Leadset Feed] Enrich rebuild skipped:', err.message))
    console.log(`[Enrich] Rebuilt feed after setting items and leadset to 'enriching' status`)

    console.log(`[Enrich] Started enrichment ${enrichmentId} for entire webset (${allItems.length} items, fields: ${requestedFields.join(', ')})`)
    res.status(202).json({
      enrichmentId,
      status: 'pending',
      requests: enrichmentRequests.map(({ field, enrichmentId }) => ({ field, enrichmentId })),
    })
  } catch (error) {
    console.error('[Enrich] Error:', error)
    next(error)
  }
})

/**
 * Get enrichment status and fetch results from Exa
 */
app.get('/leadsets/:leadsetId/runs/:runId/enrichment/:enrichmentId', async (req, res, next) => {
  const { leadsetId, runId, enrichmentId } = req.params
  
  try {
    const enrichmentDoc = await sdk.getFirebaseData('enrichments', enrichmentId)
    if (!enrichmentDoc) {
      return res.status(404).json({ error: 'Enrichment not found' })
    }

    const run = await sdk.getFirebaseData('runs', runId)
    if (!run) {
      return res.status(404).json({ error: 'Run not found' })
    }

    let requests = Array.isArray(enrichmentDoc.requests) && enrichmentDoc.requests.length
      ? enrichmentDoc.requests
      : []

    if (!requests.length) {
      if (enrichmentDoc.emailEnrichmentId) {
        requests.push({ field: 'email', enrichmentId: enrichmentDoc.emailEnrichmentId, format: 'email' })
      }
      if (enrichmentDoc.phoneEnrichmentId) {
        requests.push({ field: 'phone', enrichmentId: enrichmentDoc.phoneEnrichmentId, format: 'phone' })
      }
    }

    if (!requests.length) {
      console.warn(`[Enrich] No enrichment requests found for enrichment ${enrichmentId}`)
      return res.json({
        id: enrichmentId,
        status: 'pending',
        requests: [],
        error: 'No enrichment requests found',
      })
    }

    console.log(`[Enrich] Checking status for ${requests.length} enrichment requests`)

    // Use websetId from enrichment doc
    const websetId = enrichmentDoc.websetId || run.websetId
    
    if (!websetId) {
      console.error(`[Enrich] No websetId found for enrichment ${enrichmentId}`)
      return res.status(400).json({
        id: enrichmentId,
        status: 'error',
        error: 'No websetId found',
        requests: [],
      })
    }

    console.log(`[Enrich] Checking enrichment status for websetId: ${websetId}, enrichmentId: ${enrichmentId}`)

    const requestStatuses = await Promise.all(
      requests.map(async (request) => {
        try {
          console.log(`[Enrich] Getting status for enrichment ${request.enrichmentId} (field: ${request.field})`)
          const statusResponse = await getEnrichment(websetId, request.enrichmentId)
          const status = statusResponse.status || 'pending'
          console.log(`[Enrich] Enrichment ${request.enrichmentId} (${request.field}) status: ${status}`)
          return {
            ...request,
            status,
          }
        } catch (err) {
          console.warn(`[Enrich] Failed to get status for enrichment ${request.enrichmentId} (${request.field}):`, err.message)
          return {
            ...request,
            status: 'pending',
          }
        }
      })
    )

    console.log(`[Enrich] Enrichment statuses:`, requestStatuses.map(r => `${r.field}:${r.status}`).join(', '))

    // Consider enrichment complete if all are 'completed' or 'done'
    const overallStatus =
      requestStatuses.length === 0 || requestStatuses.every((req) => ['completed', 'done'].includes(req.status))
        ? 'completed'
        : 'pending'

    // Check if enrichment is already completed to avoid re-processing
    if (enrichmentDoc.status === 'completed') {
      console.log(`[Enrich] Enrichment ${enrichmentId} already completed, returning cached status`)
      return res.json({
        id: enrichmentId,
        status: 'completed',
        requests: requestStatuses.map(({ field, status }) => ({ field, status })),
      })
    }

    // If currently processing, return pending status (don't re-process)
    if (enrichmentDoc.status === 'processing') {
      console.log(`[Enrich] Enrichment ${enrichmentId} is currently being processed, returning pending status`)
      return res.json({
        id: enrichmentId,
        status: 'pending',
        requests: requestStatuses.map(({ field, status }) => ({ field, status })),
      })
    }

    // If status is completed but doc not marked as completed, process it
    if (overallStatus === 'completed' && enrichmentDoc.status !== 'completed' && enrichmentDoc.status !== 'processing') {
      console.log(`[Enrich] Enrichment ${enrichmentId} is completed in Exa, processing results...`)
      console.log(`[Enrich] Current enrichment doc status: ${enrichmentDoc.status}`)
      
      // Mark as processing to prevent concurrent processing
      try {
        await sdk.updateFirebaseData('enrichments', enrichmentId, {
          status: 'processing',
        })
        console.log(`[Enrich] Marked enrichment ${enrichmentId} as processing`)
      } catch (err) {
        console.warn(`[Enrich] Failed to mark enrichment as processing:`, err.message)
        // Continue anyway - might be a race condition
      }
      let exaItems = []
      let cursor = null
      do {
        const itemsResponse = await listWebsetItems(websetId, { limit: 100, cursor })
        exaItems = exaItems.concat(itemsResponse.data || [])
        cursor = itemsResponse.hasMore ? itemsResponse.nextCursor : null
      } while (cursor)
      
      console.log(`[Enrich] Fetched ${exaItems.length} items from webset ${websetId} for enrichment processing`)

      const requestedFieldSet = new Set(requestStatuses.map((req) => req.field))
      let enrichedCount = 0
      let skippedCount = 0

      console.log(`[Enrich] Processing ${exaItems.length} items, requested fields: ${Array.from(requestedFieldSet).join(', ')}`)

      // Query all Firebase items and filter by runId/leadsetId (we only need websetId, not individual itemIds)
      const allDocs = toArray(await sdk.searchFirebaseData({}, 10000))
      const firebaseItemsArray = allDocs.filter(doc => 
        doc.doc_type === 'items' && doc.runId === runId && doc.leadsetId === leadsetId
      )
      
      const firebaseItemsByUrl = new Map()
      const firebaseItemsById = new Map()
      
      firebaseItemsArray.forEach(item => {
        // Use document id for Firebase operations
        const docId = item.id || item.itemId
        if (item.sourceUrl && docId) {
          firebaseItemsByUrl.set(item.sourceUrl, { ...item, docId })
        }
        if (item.itemId && docId) {
          firebaseItemsById.set(item.itemId, { ...item, docId })
        }
      })
      
      console.log(`[Enrich] Found ${firebaseItemsArray.length} Firebase items for runId: ${runId}, leadsetId: ${leadsetId}`)

      // Helper function to normalize URLs for matching
      const normalizeUrlForMatch = (url) => {
        if (!url) return ''
        try {
          const urlObj = new URL(url)
          return urlObj.href.replace(/\/$/, '').toLowerCase()
        } catch {
          return url.replace(/\/$/, '').toLowerCase()
        }
      }

      // Update all items in the webset (enriches the entire webset)
      for (const exaItem of exaItems) {
        const enrichmentsArray = exaItem.enrichments || []
        const fieldUpdates = {}
        const matchedFields = new Set() // Track which fields we've already matched
        let linkedinUrl = null

        if (!enrichmentsArray || enrichmentsArray.length === 0) {
          skippedCount++
          continue
        }

        for (const enrichment of enrichmentsArray) {
          // Check for LinkedIn URL - either by metadata.field or by detecting linkedin.com in URL result
          const isLinkedInField = enrichment.metadata?.field === 'linkedinUrl'
          if ((enrichment.format === 'url' || isLinkedInField) && enrichment.result && enrichment.result.length > 0) {
            const urlResult = enrichment.result[0]
            if (urlResult && (isLinkedInField || urlResult.toLowerCase().includes('linkedin.com'))) {
              linkedinUrl = urlResult
              matchedFields.add('linkedinUrl')
              continue
            }
          }

          // Log enrichment details for debugging
          console.log(`[Enrich] Processing enrichment:`, {
            id: enrichment.id,
            format: enrichment.format,
            description: enrichment.description?.substring(0, 100),
            metadata: enrichment.metadata,
            hasResult: !!enrichment.result,
            resultType: Array.isArray(enrichment.result) ? 'array' : typeof enrichment.result,
            resultLength: Array.isArray(enrichment.result) ? enrichment.result.length : 'N/A',
          })

          let fieldKey = extractFieldFromEnrichment(enrichment)
          
          // If we already matched this field, try to find an alternative
          // This handles cases where inference can't distinguish between buyingIntent and partnershipIntentLevel
          if (fieldKey && matchedFields.has(fieldKey)) {
            console.log(`[Enrich] Field ${fieldKey} already matched, looking for alternative...`)
            
            // For High/Medium/Low values, try the other intent field
            if (fieldKey === 'buyingIntent' && requestedFieldSet.has('partnershipIntentLevel') && !matchedFields.has('partnershipIntentLevel')) {
              fieldKey = 'partnershipIntentLevel'
              console.log(`[Enrich] Reassigned to partnershipIntentLevel`)
            } else if (fieldKey === 'partnershipIntentLevel' && requestedFieldSet.has('buyingIntent') && !matchedFields.has('buyingIntent')) {
              fieldKey = 'buyingIntent'
              console.log(`[Enrich] Reassigned to buyingIntent`)
            } else {
              console.log(`[Enrich] No alternative found, skipping duplicate`)
              continue
            }
          }
          
          if (!fieldKey) {
            console.warn(`[Enrich] Could not extract field key from enrichment. Enrichment details:`, {
              id: enrichment.id,
              format: enrichment.format,
              description: enrichment.description,
              metadata: enrichment.metadata,
            })
            continue
          }
          
          console.log(`[Enrich] Extracted field key: ${fieldKey} from enrichment ${enrichment.id}`)
          
          if (!requestedFieldSet.has(fieldKey)) {
            // This enrichment is for a field we didn't request, skip it
            console.log(`[Enrich] Field ${fieldKey} not in requested set: ${Array.from(requestedFieldSet).join(', ')}`)
            continue
          }

          const value = extractEnrichmentValue(enrichment, fieldKey)
          if (!value) {
            console.warn(`[Enrich] No value extracted for field ${fieldKey} from enrichment ${enrichment.id}. Result:`, enrichment.result)
            continue
          }
          
          console.log(`[Enrich] Extracted value for ${fieldKey}:`, value.substring ? value.substring(0, 100) : value)

          // Dynamically set any valid enrichment field
          fieldUpdates[fieldKey] = value
          matchedFields.add(fieldKey)
        }

        if (linkedinUrl) {
          fieldUpdates.linkedinUrl = linkedinUrl
        }

        if (Object.keys(fieldUpdates).length === 0) {
          skippedCount++
          continue
        }

        // Find matching Firebase item by URL (we only need websetId, not individual itemIds)
        const exaItemUrl = exaItem.url || exaItem.properties?.url || ''
        let matchingFirebaseItem = null
        let targetItemId = null

        // Try to match by URL first
        if (exaItemUrl) {
          const normalizedExaUrl = normalizeUrlForMatch(exaItemUrl)
          for (const [url, item] of firebaseItemsByUrl.entries()) {
            if (normalizeUrlForMatch(url) === normalizedExaUrl) {
              matchingFirebaseItem = item
              targetItemId = item.docId
              break
            }
          }
        }

        // Fallback: try to match by Exa item ID if we have it stored
        if (!matchingFirebaseItem && exaItem.id) {
          matchingFirebaseItem = firebaseItemsById.get(exaItem.id)
          if (matchingFirebaseItem) {
            targetItemId = matchingFirebaseItem.docId
          }
        }

        // If no match found, create the item (it should exist, but create it if missing)
        if (!matchingFirebaseItem || !targetItemId) {
          console.warn(`[Enrich] No Firebase item found for Exa item. Creating it now. Exa URL: ${exaItemUrl || 'none'}, Exa ID: ${exaItem.id || 'none'}`)
          
          // Create the item from Exa data
          const newItem = transformExaItem(exaItem, runId, leadsetId)
          targetItemId = newItem.itemId
          
          try {
            await sdk.createFirebaseData('items', targetItemId, {
              ...newItem,
              enrichment: {
                ...fieldUpdates,
                status: 'done',
              },
            })
            console.log(`[Enrich] Created missing item ${targetItemId} with enrichment data`)
            enrichedCount++
            continue
          } catch (createErr) {
            console.error(`[Enrich] Failed to create missing item ${targetItemId}:`, createErr.message)
            skippedCount++
            continue
          }
        }

        try {
          const existingEnrichment = matchingFirebaseItem?.enrichment || {}
          
          // Build complete enrichment object with all fields
          const updatedEnrichment = {
            ...existingEnrichment,
            ...fieldUpdates,
            status: 'done',
          }
          
          // Log what we're about to write (first item only to avoid spam)
          if (enrichedCount === 0) {
            console.log(`[Enrich] Sample enrichment update for item ${targetItemId}:`, {
              existingFields: Object.keys(existingEnrichment),
              newFields: Object.keys(fieldUpdates),
              finalFields: Object.keys(updatedEnrichment),
              sampleValues: Object.entries(fieldUpdates).reduce((acc, [key, val]) => {
                acc[key] = typeof val === 'string' ? val.substring(0, 50) : val
                return acc
              }, {}),
            })
          }
          
          // Update only enrichment fields (using websetId-based approach, no need for individual itemIds)
          await sdk.updateFirebaseData('items', targetItemId, {
            enrichment: updatedEnrichment,
          })
          enrichedCount++
        } catch (err) {
          console.error(`[Enrich] Failed to update item ${targetItemId}:`, err.message)
          // Continue with other items even if one fails
        }
      }

      console.log(`[Enrich] Enrichment processing complete: ${enrichedCount} items enriched, ${skippedCount} items skipped`)
      
      // Log status of items after update
      if (enrichedCount > 0) {
        try {
          const sampleUpdatedItem = await sdk.getFirebaseData('items', firebaseItemsArray[0]?.id || firebaseItemsArray[0]?.itemId).catch(() => null)
          if (sampleUpdatedItem) {
            console.log(`[Enrich] Sample item after update - enrichment status: ${sampleUpdatedItem.enrichment?.status}, fields:`, Object.keys(sampleUpdatedItem.enrichment || {}))
          }
        } catch (err) {
          console.warn(`[Enrich] Could not verify sample item update:`, err.message)
        }
      }

      try {
        await sdk.updateFirebaseData('enrichments', enrichmentId, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          enrichedCount,
        })
        console.log(`[Enrich] Updated enrichment ${enrichmentId} status to completed`)

        // Log current run status before update
        console.log(`[Enrich] Current run ${runId} status before update: ${run.status}`)
        
        const runUpdateResult = await sdk.updateFirebaseData('runs', runId, {
          status: 'idle',
          counters: {
            ...run.counters,
            enriched: (run.counters?.enriched || 0) + enrichedCount,
          },
        })
        console.log(`[Enrich] Updated run ${runId} status to 'idle' in Firebase`)
        
        // Verify the update by reading back
        try {
          const updatedRun = await sdk.getFirebaseData('runs', runId)
          console.log(`[Enrich] Verified run ${runId} status after update: ${updatedRun?.status} (should be 'idle')`)
        } catch (verifyErr) {
          console.warn(`[Enrich] Could not verify run status update:`, verifyErr.message)
        }

        await sdk.updateFirebaseData('leadsets', leadsetId, { status: 'idle' })
        console.log(`[Enrich] Updated leadset ${leadsetId} status to 'idle' in Firebase`)
        
        // Give Firebase a moment to propagate all updates (leadset status + item updates)
        await new Promise(resolve => setTimeout(resolve, 500))
        
        // Re-fetch ALL data fresh to ensure we have the latest leadset status and enrichment data
        // Do NOT use preloaded docs here as the leadset status was just updated
        console.log(`[Enrich] Re-fetching all data to include latest leadset status and enrichment data...`)
        const allDocsAfterEnrich = toArray(await sdk.searchFirebaseData({}, 10000))
        
        // Verify leadset status in fetched data
        const updatedLeadset = allDocsAfterEnrich.find(doc => doc.doc_type === 'leadsets' && doc.id === leadsetId)
        console.log(`[Enrich] Verified leadset ${leadsetId} status in fetched data: ${updatedLeadset?.status}`)
        
        const updatedItems = allDocsAfterEnrich.filter(doc => 
          doc.doc_type === 'items' && doc.runId === runId && doc.leadsetId === leadsetId
        )
        console.log(`[Enrich] Re-fetched ${updatedItems.length} items for feed rebuild`)
        
        // Log sample enrichment data to verify fields are present
        if (updatedItems.length > 0) {
          const sampleItem = updatedItems[0]
          const sampleEnrichment = sampleItem.enrichment || {}
          console.log(`[Enrich] Sample item enrichment fields:`, Object.keys(sampleEnrichment))
        }
        
        // Rebuild feed with freshly fetched docs (includes updated leadset status)
        await rebuildLeadsetFeed(allDocsAfterEnrich).catch((err) => console.warn('[Leadset Feed] Enrichment status rebuild skipped:', err.message))
        console.log(`[Enrich] Rebuilt leadset feed with updated leadset status and items`)
        
        // Trigger docStatus update AFTER feed is rebuilt so frontend gets the new feed
        await updateDocStatus(['runs', 'items', 'enrichments', 'leadsets'], { leadsetId, runId })
        console.log(`[Enrich] Triggered docStatus update for frontend refresh`)
        
        console.log(`[Enrich] Successfully completed enrichment ${enrichmentId} - all Firebase updates complete`)
      } catch (err) {
        console.error(`[Enrich] Error updating enrichment status to completed:`, err.message)
        // Still mark as completed even if update fails
        try {
          await sdk.updateFirebaseData('enrichments', enrichmentId, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            enrichedCount,
          })
        } catch (retryErr) {
          console.error(`[Enrich] Failed to update enrichment status even on retry:`, retryErr.message)
        }
      }
    } else {
      // Enrichment is still pending
      console.log(`[Enrich] Enrichment ${enrichmentId} still pending. Statuses: ${requestStatuses.map(r => `${r.field}:${r.status}`).join(', ')}`)
    }

    const response = {
      id: enrichmentId,
      status: overallStatus,
      requests: requestStatuses.map(({ field, status }) => ({ field, status })),
    }
    
    console.log(`[Enrich] Returning enrichment status: ${overallStatus} for ${enrichmentId}`)
    res.json(response)
  } catch (error) {
    console.error('[Enrichment Status] Error:', error)
    console.error('[Enrichment Status] Stack:', error.stack)
    
    // Return error response instead of throwing to prevent frontend polling from stopping
    res.status(500).json({
      id: enrichmentId,
      status: 'error',
      error: error.message || 'Unknown error',
      requests: [],
    })
  }
})

/**
 * Export run data as CSV
 */
app.get('/leadsets/:leadsetId/runs/:runId/export', async (req, res, next) => {
  const { leadsetId, runId } = req.params
  
  try {
    const allDocs = toArray(await sdk.searchFirebaseData({}, 5000))
    const allItems = allDocs.filter(doc => doc.doc_type === 'items')
    const items = allItems.filter(item => item.runId === runId)
    
    if (items.length === 0) {
      return res.status(404).json({ error: 'No items found for this run' })
    }

    const csvContent = buildCsv(items)
    const filename = `leadset-${leadsetId}-run-${runId}.csv`
    
    // Try to upload to storage
    try {
      const csvBuffer = Buffer.from(csvContent, 'utf-8')
      const [url] = await sdk.uploadToStorage([filename], [csvBuffer], 'exports')
      await sdk.updateFirebaseData('runs', runId, { exportUrl: url })
      res.setHeader('x-export-url', url)
      res.json({ url })
    } catch (storageError) {
      console.warn('[Export] Storage upload failed, sending directly:', storageError.message)
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.send(csvContent)
    }
  } catch (error) {
    next(error)
  }
})

/**
 * Exa webhook handler
 * Receives real-time updates from Exa about webset and enrichment progress
 */
app.post('/webhooks/exa', async (req, res, next) => {
  const signature = req.headers['x-exa-signature']
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}))
  
  try {
    if (!verifyExaSignature(rawBody, signature)) {
      console.warn('[Webhook] Invalid signature')
      return res.status(401).json({ error: 'Invalid signature' })
    }
    
    const payload = req.body
    console.log('[Webhook] Received:', payload.type)

    // Acknowledge immediately
    res.json({ received: true })

    // Process webhook asynchronously
    const { type, data } = payload

    if (type === 'webset.items.created') {
      // New items found by Exa
      const { websetId, items = [] } = data || {}
      
      // Find the run for this webset
      const allDocs = toArray(await sdk.searchFirebaseData({}, 500))
      const allRuns = allDocs.filter(doc => doc.doc_type === 'runs')
      const runs = allRuns.filter(r => r.websetId === websetId)
      const run = runs[0]
      if (!run) {
        console.warn('[Webhook] No run found for webset:', websetId)
        return
      }

      // Transform and save items
      const transformedItems = items.map(item => transformExaItem(item, run.id, run.leadsetId))
      await Promise.all(transformedItems.map(item =>
        sdk.createFirebaseData('items', item.itemId, item).catch(() =>
          sdk.updateFirebaseData('items', item.itemId, item)
        )
      ))

      // Update run counters
      await sdk.updateFirebaseData('runs', run.id, {
        counters: {
          ...run.counters,
          found: increment(items.length),
        },
      })

      await updateDocStatus(['items', 'runs'], { leadsetId: run.leadsetId, runId: run.id })
      console.log(`[Webhook] Added ${items.length} items to run ${run.id}`)
      await rebuildLeadsetFeed().catch((err) => console.warn('[Leadset Feed] Webhook items rebuild skipped:', err.message))

    } else if (type === 'webset.idle') {
      // Webset search completed
      const { websetId } = data || {}
      
      const allDocs = toArray(await sdk.searchFirebaseData({}, 500))
      const allRuns = allDocs.filter(doc => doc.doc_type === 'runs')
      const runs = allRuns.filter(r => r.websetId === websetId)
      const run = runs[0]
      if (!run) return

      await sdk.updateFirebaseData('runs', run.id, { status: 'completed' })
      await sdk.updateFirebaseData('leadsets', run.leadsetId, { status: 'idle' })
      await updateDocStatus(['runs', 'leadsets'], { leadsetId: run.leadsetId, runId: run.id })
      console.log(`[Webhook] Webset ${websetId} completed`)
      await rebuildLeadsetFeed().catch((err) => console.warn('[Leadset Feed] Webhook idle rebuild skipped:', err.message))

    } else if (type === 'webset.enrichment.completed') {
      // Enrichment completed
      const { websetId, enrichmentId, items = [] } = data || {}
      
      const allDocs = toArray(await sdk.searchFirebaseData({}, 500))
      const allRuns = allDocs.filter(doc => doc.doc_type === 'runs')
      const runs = allRuns.filter(r => r.websetId === websetId)
      const run = runs[0]
      if (!run) return

      // Update items with enrichment data
      let enrichedCount = 0
      for (const item of items) {
        const enrichmentsArray = item.enrichments || []
        
        // Extract email and phone from enrichments array
        let email = null
        let phone = null
        let linkedinUrl = null
        
        for (const enrichment of enrichmentsArray) {
          if (enrichment.format === 'email' && enrichment.result && enrichment.result.length > 0) {
            email = enrichment.result[0]
          }
          if (enrichment.format === 'phone' && enrichment.result && enrichment.result.length > 0) {
            phone = enrichment.result[0]
          }
          // Check for LinkedIn URL (uses 'url' format)
          if (enrichment.format === 'url' && enrichment.result && enrichment.result.length > 0) {
            const urlResult = enrichment.result[0]
            if (urlResult && urlResult.toLowerCase().includes('linkedin.com')) {
              linkedinUrl = urlResult
            }
          }
        }
        
        if (email || phone || linkedinUrl) {
          await sdk.updateFirebaseData('items', item.id, {
            enrichment: {
              status: 'done',
              email: email,
              phone: phone,
              linkedinUrl: linkedinUrl,
            },
          })
          enrichedCount++
        }
      }

      await sdk.updateFirebaseData('runs', run.id, {
        status: 'idle',
        counters: {
          ...run.counters,
          enriched: increment(enrichedCount),
        },
      })

      await updateDocStatus(['items', 'runs'], { leadsetId: run.leadsetId, runId: run.id })
      console.log(`[Webhook] Enrichment completed: ${enrichedCount} items enriched`)
      await rebuildLeadsetFeed().catch((err) => console.warn('[Leadset Feed] Webhook enrichment rebuild skipped:', err.message))
    }
  } catch (error) {
    console.error('[Webhook] Error:', error)
    // Don't return error - we already acknowledged
  }
})

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message)
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal server error',
    code: err.code,
  })
})

app.listen(PORT, () => {
  console.log(`🚀 Backend listening on http://localhost:${PORT}`)
  console.log(`📡 Exa API: ${EXA_API_KEY ? 'Configured' : 'Not configured (using mocks)'}`)
  console.log(`🔗 Webhook URL: ${WEBHOOK_URL || 'Not configured'}`)
  rebuildLeadsetFeed().catch((err) => console.warn('[Leadset Feed] Initial rebuild skipped:', err.message))
})
