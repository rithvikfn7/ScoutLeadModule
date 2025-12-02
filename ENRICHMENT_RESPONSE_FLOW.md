# Enrichment Response Flow

## Overview
After creating an enrichment via Exa API, here's how the response data flows and how we extract it:

## 1. Creating an Enrichment

When you POST to `/websets/v0/websets/{websetId}/enrichments`, Exa returns:

```json
{
  "id": "enrichment_xxx",
  "object": "webset_enrichment",
  "status": "pending",
  "webset_id": "webset_xxx",
  "description": "ScoutField::buyingIntent::...",
  "format": "text",
  "created_at": "2025-01-..."
}
```

This `enrichment_id` is stored in our Firebase `enrichments` document.

## 2. Checking Enrichment Status

When we poll `/websets/v0/websets/{websetId}/enrichments/{enrichmentId}`, Exa returns:

```json
{
  "id": "enrichment_xxx",
  "status": "completed",  // or "pending", "processing", "failed"
  "description": "...",
  "format": "text",
  "metadata": {
    "field": "buyingIntent"
  },
  "created_at": "2025-01-...",
  "completed_at": "2025-01-..."
}
```

**Note:** The status endpoint doesn't contain the actual enriched values. The values are attached to the **items** themselves.

## 3. Getting Enriched Values (The Key Part!)

When an enrichment is completed, the enriched values appear in the **items** when you call `/websets/v0/websets/{websetId}/items`.

Each item's structure:

```json
{
  "id": "item_xxx",
  "url": "https://...",
  "properties": {
    "title": "...",
    "text": "..."
  },
  "enrichments": [
    {
      "id": "enrichment_xxx",
      "description": "ScoutField::buyingIntent::Return exactly one of...",
      "format": "text",
      "metadata": {
        "field": "buyingIntent"
      },
      "result": ["High - The user mentioned they are actively looking for solutions."]
      // OR for text fields: "result" could be a string
      // OR for structured: "result" could be an object
    },
    {
      "id": "enrichment_yyy",
      "description": "ScoutField::employeeCount::Estimate...",
      "format": "text",
      "metadata": {
        "field": "employeeCount"
      },
      "result": ["10-50 employees"]
    },
    {
      "id": "enrichment_zzz",
      "format": "email",
      "metadata": {
        "field": "email"
      },
      "result": ["contact@company.com"]
    }
  ]
}
```

## 4. How We Extract Values

### Step 1: Identify the Field
We use `extractFieldFromEnrichment(enrichment)` which checks:
1. **metadata.field** (most reliable) - `enrichment.metadata.field` → `"buyingIntent"`
2. **description prefix** - `"ScoutField::buyingIntent::..."` → extracts `"buyingIntent"`
3. **format** - for email/phone, `enrichment.format` → `"email"` or `"phone"`
4. **description content** - fallback, searches description text

### Step 2: Extract the Value
We use `extractEnrichmentValue(enrichment)` which handles:
- **Array result**: Takes first non-empty string, or stringifies first object
  ```javascript
  result: ["High - justification"]
  → Returns: "High - justification"
  ```
- **String result**: Returns as-is
  ```javascript
  result: "High"
  → Returns: "High"
  ```
- **Object result**: JSON.stringify it
  ```javascript
  result: { value: "High", confidence: 0.9 }
  → Returns: '{"value":"High","confidence":0.9}'
  ```

### Step 3: Update Firebase Item
We map the extracted field/value pairs to our item structure:

```javascript
// For each Exa item with enrichments:
const fieldUpdates = {}

// After extracting:
fieldUpdates.buyingIntent = "High - justification"
fieldUpdates.employeeCount = "10-50 employees"
fieldUpdates.email = "contact@company.com"
fieldUpdates.phone = "+1234567890"

// Then update Firebase item:
await sdk.updateFirebaseData('items', itemId, {
  buyingIntent: fieldUpdates.buyingIntent,
  employeeCount: fieldUpdates.employeeCount,
  email: fieldUpdates.email,
  phone: fieldUpdates.phone,
})
```

## 5. Current Extraction Logic (Code Reference)

**Location:** `backend/src/index.js` lines 1902-1967

```javascript
// For each Exa item
for (const exaItem of exaItems) {
  const enrichmentsArray = exaItem.enrichments || []
  const fieldUpdates = {}

  for (const enrichment of enrichmentsArray) {
    // 1. Extract field key (buyingIntent, employeeCount, etc.)
    const fieldKey = extractFieldFromEnrichment(enrichment)
    
    // 2. Extract the actual value from enrichment.result
    const value = extractEnrichmentValue(enrichment)
    
    // 3. Map to our field names
    if (fieldKey === 'buyingIntent') {
      fieldUpdates.buyingIntent = value
    } else if (fieldKey === 'employeeCount') {
      fieldUpdates.employeeCount = value
    } else if (fieldKey === 'email') {
      fieldUpdates.email = value
    } else if (fieldKey === 'phone') {
      fieldUpdates.phone = value
    }
  }

  // 4. Update matching Firebase item
  await sdk.updateFirebaseData('items', targetItemId, fieldUpdates)
}
```

## 6. Testing the Response

To see what Exa actually returns, you can:

### A. Check enrichment status:
```bash
curl "https://api.exa.ai/websets/v0/websets/{websetId}/enrichments/{enrichmentId}" \
  -H "x-api-key: YOUR_KEY"
```

### B. List items to see enriched values:
```bash
curl "https://api.exa.ai/websets/v0/websets/{websetId}/items?limit=10" \
  -H "x-api-key: YOUR_KEY"
```

Look for the `enrichments` array in each item - that's where the actual values are!

## 7. Debugging Tips

If enrichments aren't showing up:

1. **Check enrichment status**: Should be `"completed"` not `"pending"`
2. **Check items have enrichments**: Each item should have an `enrichments` array
3. **Check result format**: 
   - If `result` is an array, we take the first string
   - If `result` is empty array `[]`, no value will be extracted
4. **Check field extraction**: Logs show `[Enrich] Extracted field key: ...`
5. **Check value extraction**: Logs show `[Enrich] Extracted value for ...: ...`

## 8. Example Full Flow

```
1. POST /websets/{id}/enrichments
   → Returns: { id: "enrichment_123", status: "pending" }

2. Poll GET /websets/{id}/enrichments/enrichment_123
   → Returns: { id: "enrichment_123", status: "completed" }

3. GET /websets/{id}/items (after status = "completed")
   → Returns items with enrichments array:
     [
       {
         id: "item_1",
         enrichments: [
           {
             id: "enrichment_123",
             metadata: { field: "buyingIntent" },
             result: ["High - actively searching"]
           }
         ]
       }
     ]

4. Extract: fieldKey = "buyingIntent", value = "High - actively searching"

5. Update Firebase: item.buyingIntent = "High - actively searching"
```

