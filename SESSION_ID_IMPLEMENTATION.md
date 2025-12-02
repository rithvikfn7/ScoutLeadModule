# Session ID Implementation

This document describes the implementation of session-based filtering for leadsets.

## Overview

Each scout provides leadsets with a unique `sessionId`. The module filters leadsets to only show those matching the current session ID. The session ID can be provided via:
1. **URL parameter** (`?sessionId=xxx`) - for sharing links and initial setup
2. **localStorage** - for persistence across page refreshes

The implementation uses a **hybrid approach**: URL parameter takes priority, and when found, it's automatically saved to localStorage for persistence.

## Architecture

### Frontend

1. **`useSessionId` Hook** (`frontend/src/hooks/useSessionId.js`)
   - Manages sessionId state from URL or localStorage
   - Priority: URL parameter → localStorage
   - Automatically saves URL sessionId to localStorage
   - Provides `setSessionId()` and `clearSessionId()` functions

2. **`DataCacheContext`** (`frontend/src/contexts/DataCacheContext.jsx`)
   - Filters leadsets by `sessionId` when provided
   - Only shows leadsets matching the current sessionId
   - Filters both `leadsets` array and `leadsetDetails` object

3. **`LeadsetsDashboard`** (`frontend/src/pages/LeadsetsDashboard.jsx`)
   - Displays current sessionId filter in UI
   - Provides "Clear Filter" button when sessionId is active
   - Automatically sets sessionId from seed response

### Backend

1. **Seed Endpoint** (`backend/src/index.js`)
   - Handles multiple input formats:
     - Collection format: `{ session_id, lead_sets: [...] }`
     - Array format: `{ leadsets: [...] }`
     - Direct array: `[...]`
   - Extracts `session_id` from collection and adds it to each leadset
   - Returns `sessionId` in response for frontend to use

2. **Seed Script** (`backend/scripts/seed.js`)
   - Updated to handle collection format with `session_id`
   - Adds `sessionId` to each leadset document

## Data Structure

### Collection Format (Standardized)
```json
{
  "doc_id": "156dda59-e6c8-453e-8560-21d8f70a0033",
  "doc_type": "LeadSetCollection",
  "session_id": "156dda59-e6c8-453e-8560-21d8f70a0033",
  "workspace_id": "3428444535",
  "lead_sets": [
    {
      "doc_id": "8879331708",
      "name": "Parents Seeking Clean Ingredients",
      ...
    }
  ]
}
```

### Leadset Document in Firebase
Each leadset document includes:
```json
{
  "id": "8879331708",
  "sessionId": "156dda59-e6c8-453e-8560-21d8f70a0033",
  "name": "Parents Seeking Clean Ingredients",
  ...
}
```

## Usage

### Setting Session ID via URL
```
http://localhost:3001/?sessionId=156dda59-e6c8-453e-8560-21d8f70a0033
```

### Setting Session ID via localStorage
```javascript
localStorage.setItem('scout_session_id', '156dda59-e6c8-453e-8560-21d8f70a0033')
```

### Uploading Leadsets with Session ID
When uploading a JSON file with the collection format, the `session_id` is automatically extracted and:
1. Added to each leadset document in Firebase
2. Set in the frontend (via seed response)
3. Saved to localStorage for persistence

### Clearing Session Filter
Users can click the "Clear Filter" button in the dashboard to remove the sessionId filter and see all leadsets.

## Benefits

1. **Multi-scout Support**: Multiple scouts can use the same Firebase instance, each seeing only their own leadsets
2. **Shareable Links**: Session ID can be passed via URL for easy sharing
3. **Persistence**: Session ID persists across page refreshes via localStorage
4. **Flexibility**: Can be set via URL, localStorage, or automatically from seed upload
5. **Backward Compatible**: Still works with leadsets that don't have sessionId (shows all)

## Implementation Details

- Session ID is stored in localStorage with key: `scout_session_id`
- URL parameter name: `sessionId`
- Filtering happens client-side in `DataCacheContext`
- Backend stores all leadsets; frontend filters by sessionId
- When no sessionId is set, all leadsets are shown (backward compatible)

