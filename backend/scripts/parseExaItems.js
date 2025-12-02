/**
 * Utility script to parse and validate Exa webset items response
 * 
 * Usage:
 *   node backend/scripts/parseExaItems.js <path-to-json-file>
 *   OR pipe JSON directly:
 *   cat response.json | node backend/scripts/parseExaItems.js
 * 
 * This script:
 * 1. Validates the Exa API response structure
 * 2. Transforms items to internal format
 * 3. Outputs parsed/validated JSON
 */

const fs = require('fs');
const path = require('path');

/**
 * Transform Exa item to internal format (matches backend/src/index.js transformExaItem)
 */
function transformExaItem(exaItem, runId = 'test_run', leadsetId = 'test_leadset') {
  const props = exaItem.properties || {}
  
  // Handle company data
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

  // Extract domain from URL
  let domain = props.domain || company.domain || ''
  const sourceUrl = props.url || exaItem.url || ''
  if (!domain && sourceUrl) {
    try {
      domain = new URL(sourceUrl).hostname.replace(/^www\./, '')
    } catch (e) {
      domain = ''
    }
  }

  // Extract snippet/description
  let snippet = props.description || ''
  if (!snippet && props.content) {
    snippet = typeof props.content === 'string' 
      ? props.content.substring(0, 500).replace(/\s+/g, ' ').trim()
      : ''
  }

  // Process enrichments
  const enrichments = exaItem.enrichments || []
  const enrichmentStatus = enrichments.length > 0 ? 'completed' : 'none'
  const enrichmentData = {}
  
  /**
   * Normalize buying intent to high/medium/low
   */
  function normalizeBuyingIntent(value) {
    if (!value) return null
    const str = typeof value === 'string' ? value.toLowerCase() : String(value).toLowerCase()
    
    if (str.includes('high')) return 'high'
    if (str.includes('medium')) return 'medium'
    if (str.includes('low')) return 'low'
    
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
  
  enrichments.forEach(enrichment => {
    if (enrichment.status === 'completed' && enrichment.result) {
      // Extract field name from enrichmentId or metadata
      let field = null
      if (enrichment.enrichmentId) {
        // enrichmentId format: wenrich_01kb4jc4zwvhswns77fjwhbre5
        // Try to infer from context or use a default
        if (enrichment.format === 'text' && Array.isArray(enrichment.result)) {
          const result = enrichment.result[0]
          if (typeof result === 'string') {
            // Try to detect field type from result content
            if (result.match(/^\d+-\d+$/) || result.match(/\d+/)) field = 'employeeCount'
            else if (result.match(/@/)) field = 'email'
            else if (result.match(/^\d/)) field = 'phone'
            else if (result.toLowerCase().includes('high') || result.toLowerCase().includes('medium') || result.toLowerCase().includes('low') || result.toLowerCase().includes('actively') || result.toLowerCase().includes('evaluating')) field = 'buyingIntent'
          }
        }
      }
      
      if (field && enrichment.result) {
        let value = Array.isArray(enrichment.result) 
          ? enrichment.result[0] 
          : enrichment.result
        
        // Normalize based on field type
        if (field === 'buyingIntent') {
          value = normalizeBuyingIntent(value)
        } else if (field === 'employeeCount') {
          value = normalizeEmployeeCount(value)
        } else {
          value = typeof value === 'string' ? value : JSON.stringify(value)
        }
        
        if (value) {
          enrichmentData[field] = value
        }
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
 * Validate Exa API response structure
 */
function validateExaResponse(data) {
  const errors = []
  const warnings = []

  if (!data) {
    errors.push('Response is null or undefined')
    return { valid: false, errors, warnings }
  }

  if (!data.data || !Array.isArray(data.data)) {
    errors.push('Response missing "data" array')
    return { valid: false, errors, warnings }
  }

  if (data.data.length === 0) {
    warnings.push('Response contains no items')
  }

  // Validate each item
  data.data.forEach((item, index) => {
    if (!item.id) {
      errors.push(`Item ${index}: missing "id"`)
    }
    if (!item.properties) {
      warnings.push(`Item ${index}: missing "properties"`)
    }
    if (!item.properties?.company && !item.properties?.person) {
      warnings.push(`Item ${index}: missing company/person data`)
    }
  })

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    itemCount: data.data.length,
  }
}

/**
 * Main parsing function
 */
function parseExaResponse(inputData) {
  let data
  
  // Try to parse as JSON if it's a string
  if (typeof inputData === 'string') {
    try {
      data = JSON.parse(inputData)
    } catch (e) {
      throw new Error(`Invalid JSON: ${e.message}`)
    }
  } else {
    data = inputData
  }

  // Validate structure
  const validation = validateExaResponse(data)
  
  if (!validation.valid) {
    console.error('Validation errors:', validation.errors)
    throw new Error('Invalid Exa response structure')
  }

  if (validation.warnings.length > 0) {
    console.warn('Validation warnings:', validation.warnings)
  }

  // Transform items
  const transformedItems = data.data.map(item => transformExaItem(item))
  
  return {
    original: data,
    validation,
    transformed: transformedItems,
    summary: {
      totalItems: transformedItems.length,
      itemsWithEvaluations: transformedItems.filter(i => i.evaluations.length > 0).length,
      itemsWithEnrichments: transformedItems.filter(i => i.enrichment.status !== 'none').length,
      averageScore: transformedItems.length > 0
        ? Math.round(transformedItems.reduce((sum, i) => sum + i.score, 0) / transformedItems.length)
        : 0,
    },
  }
}

// CLI usage
if (require.main === module) {
  let input = ''
  
  // Check if file path provided as argument
  const filePath = process.argv[2]
  
  if (filePath) {
    // Read from file
    try {
      input = fs.readFileSync(path.resolve(filePath), 'utf-8')
    } catch (e) {
      console.error(`Error reading file: ${e.message}`)
      process.exit(1)
    }
  } else {
    // Read from stdin
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      input += chunk
    })
    process.stdin.on('end', () => {
      try {
        const result = parseExaResponse(input)
        console.log(JSON.stringify(result, null, 2))
      } catch (e) {
        console.error(`Error parsing response: ${e.message}`)
        process.exit(1)
      }
    })
    return
  }
  
  // Process file input
  try {
    const result = parseExaResponse(input)
    console.log(JSON.stringify(result, null, 2))
  } catch (e) {
    console.error(`Error parsing response: ${e.message}`)
    process.exit(1)
  }
}

module.exports = { parseExaResponse, transformExaItem, validateExaResponse }

