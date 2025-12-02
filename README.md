# Scout Leadsets Module

A micro module for discovering, enriching, and managing leadsets powered by Exa Websets API and Firebase.

## Overview

Scout Leadsets Module enables growth operators to:
- **Discover leads** by running targeted searches using Exa Websets API
- **Enrich contact details** including email, phone, LinkedIn, and intent signals
- **Manage leadsets** with real-time status updates and filtering
- **Export data** for sales outreach and CRM integration

The module supports multi-scout deployments where each scout can have isolated leadsets filtered by session ID.

## Features

### 🎯 Lead Discovery
- Run targeted searches based on leadset criteria (segment, intent, geography)
- Real-time polling of Exa Websets for live lead updates
- Extend existing leadsets with additional buyers
- Cancel running searches

### 📊 Lead Enrichment
- Unlock contact details: email, phone, LinkedIn profiles
- Extract intent signals: buying intent, partnership intent, audience overlap
- Get classification data: lead type, location, company size, role seniority
- Investor and category fit scoring for specialized leadsets

### 🔍 Filtering & Search
- Filter by session ID (multi-scout support)
- Search by company name, domain, or snippet content
- Filter by recency (Last 7/30/90 days, Older)
- Filter by contact info availability
- Real-time status updates for running leadsets

### 📥 Export & Integration
- Download enriched leads as CSV
- Real-time status tracking
- Firebase-backed data persistence

## Architecture

```
┌─────────────────────────────────────────┐
│         React Frontend                  │
│  ┌──────────────────────────────────┐   │
│  │  FN7 SDK (Firebase Direct Read) │   │
│  │  - Real-time listeners           │   │
│  │  - Session ID filtering          │   │
│  │  - Reads leadsetFeed/global      │   │
│  └──────────────┬───────────────────┘   │
│                 │                        │
│                 │ Direct Firebase Read   │
│                 │ (via SDK)              │
│                 ▼                        │
│  ┌──────────────────────────────────┐   │
│  │  REST API (Actions Only)          │   │
│  │  - Run, Enrich, Cancel, Export    │   │
│  └──────────────┬───────────────────┘   │
└─────────────────┼────────────────────────┘
                  │
                  ▼
    ┌──────────────────────────────────┐
    │  Express Backend                 │
    │  - Exa Websets integration       │
    │  - Firebase writes               │
    │  - Webhook handlers              │
    └──────────────┬───────────────────┘
                   │                    │
        ┌──────────┴──────────┐         │
        ▼                     ▼         ▼
┌─────────────┐      ┌──────────────┐  ┌──────────────┐
│  Firebase   │      │ Exa Websets  │  │   Frontend   │
│  Firestore  │◄─────│     API      │  │  (Read Only) │
│             │      │              │  └──────────────┘
│  (Writes)   │      │  (Search &   │
│             │      │  Enrichment) │
└─────────────┘      └──────────────┘
```

### Data Flow

**Reads (Frontend → Firebase):**
- Frontend uses FN7 SDK to read directly from Firebase
- Real-time listeners on `leadsetFeed/global` document
- No backend involved for data reads

**Writes & Actions (Frontend → Backend → Firebase/Exa):**
- Frontend calls REST API for actions (run, enrich, cancel)
- Backend handles Exa API calls and Firebase writes
- Backend updates `leadsetFeed/global` which triggers frontend listeners

### Key Components

- **Frontend**: React app with real-time Firebase listeners
- **Backend**: Node.js/Express server handling Exa API calls
- **SDK**: FN7 SDK for Firebase operations (local mode for development)
- **Data Flow**: Frontend reads from Firebase, backend writes and handles actions

## Quick Start

### Prerequisites

- Node.js 16+ and npm
- Firebase project with Firestore enabled
- Exa API key (for lead discovery and enrichment)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/rithvikfn7/ScoutLeadModule.git
   cd ScoutLeadModule
   ```

2. **Install frontend dependencies**
   ```bash
   cd frontend
   npm install
   ```

3. **Install backend dependencies**
   ```bash
   cd ../backend
   npm install
   ```

4. **Configure environment variables**

   **Frontend** (`frontend/.env`):
   ```env
   REACT_APP_FIREBASE_CONFIG={"apiKey":"...","authDomain":"...","projectId":"...","storageBucket":"...","messagingSenderId":"...","appId":"..."}
   REACT_APP_BACKEND_URL=http://localhost:3000
   ```

   **Backend** (`backend/.env`):
   ```env
   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
   EXA_API_KEY=your_exa_api_key
   EXA_WEBHOOK_SECRET=your_webhook_secret
   WEBHOOK_URL=https://your-domain.com/webhooks/exa
   FIREBASE_STORAGE_BUCKET=your-bucket.appspot.com
   FN7_SDK_MODE=local
   PORT=3000
   ```

5. **Start the backend**
   ```bash
   cd backend
   npm start
   ```

6. **Start the frontend**
   ```bash
   cd frontend
   npm start
   ```

The app will be available at `http://localhost:3001`

## Session ID Filtering

The module supports multi-scout deployments where each scout has isolated leadsets.

### How It Works

1. **Session ID Sources** (priority order):
   - URL parameter: `?sessionId=xxx`
   - localStorage: `scout_session_id` key
   - Automatically extracted from uploaded leadset collections

2. **Filtering**: Only leadsets matching the current session ID are displayed

3. **Persistence**: Session ID from URL is saved to localStorage automatically

### Usage

**Via URL:**
```
http://localhost:3001/?sessionId=156dda59-e6c8-453e-8560-21d8f70a0033
```

**Via localStorage:**
```javascript
localStorage.setItem('scout_session_id', 'your-session-id')
```

**From Leadset Upload:**
When uploading a JSON file with `session_id` in the collection format, it's automatically extracted and applied.

See [SESSION_ID_IMPLEMENTATION.md](./SESSION_ID_IMPLEMENTATION.md) for detailed documentation.

## Leadset Format

The module supports multiple leadset input formats:

### Standard Format (Recommended)
```json
{
  "leadset_documents": [
    {
      "doc_id": "5359248498",
      "session_id": "Brain_3428444535",
      "name": "Organic & Health Food Retailers",
      "description": "Specialty stores focusing on organic products",
      "prompt": "Find retailers specializing in organic food...",
      "target": "retailer",
      "intent_type": "buyer",
      "enrichment_fields": [
        "contact_email",
        "contact_phone",
        "geo_location",
        "lead_type",
        "buying_intent_level"
      ],
      "status": "idle"
    }
  ]
}
```

### Collection Format (Legacy)
```json
{
  "session_id": "156dda59-e6c8-453e-8560-21d8f70a0033",
  "lead_sets": [...]
}
```

## API Endpoints

### Leadset Management
- `GET /leadsets` - List all leadsets
- `GET /leadsets/:id/detail` - Get leadset with runs and items
- `GET /leadsets/:id/run-status` - Check if leadset has active run

### Run Operations
- `POST /leadsets/:id/run` - Start a new search run
- `GET /leadsets/:id/runs/:runId/webset` - Get webset status and items
- `POST /leadsets/:id/runs/:runId/cancel` - Cancel running search

### Enrichment
- `POST /leadsets/:id/runs/:runId/enrich` - Request enrichment for selected items
- `GET /leadsets/:id/runs/:runId/enrichment/:enrichmentId` - Get enrichment status

### Export
- `GET /leadsets/:id/runs/:runId/export` - Download leads as CSV

### Data Management
- `POST /seed` - Upload leadsets from JSON
- `DELETE /seed` - Factory reset (deletes all data)

## Data Structure

### Firebase Collections

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `leadsets` | Leadset definitions | `id`, `name`, `prompt`, `sessionId`, `status`, `websetId` |
| `runs` | Execution records | `id`, `leadsetId`, `websetId`, `status`, `counters`, `mode` |
| `items` | Discovered leads | `itemId`, `leadsetId`, `entity`, `snippet`, `score`, `enrichment` |
| `enrichments` | Enrichment jobs | `id`, `runId`, `status`, `itemIds`, `fields` |
| `settings` | Module configuration | `cost`, `limits` |
| `leadsetFeed` | Aggregated cache | `leadsets`, `leadsetDetails`, `settings`, `updatedAt` |

### Enrichment Fields

**Contact Information:**
- `contact_email` → `email`
- `contact_phone` → `phone`
- `has_linkedin_messaging` → `linkedinUrl`
- `primary_contact_channel` → `primaryContactChannel`

**Classification:**
- `lead_type` → `leadType`
- `geo_location` → `geoLocation`
- `company_size_band` → `employeeCount`
- `role_seniority_band` → `roleSeniorityBand`

**Intent Signals:**
- `buying_intent_level` → `buyingIntent`
- `buying_intent_reason` → `buyingIntentReason`
- `partnership_intent_level` → `partnershipIntentLevel`
- `partnership_intent_reason` → `partnershipIntentReason`
- `audience_overlap_score` → `audienceOverlapScore`
- `audience_overlap_reason` → `audienceOverlapReason`

**Specialized Fields:**
- `investor_intent_level` → `investorIntentLevel`
- `investor_intent_reason` → `investorIntentReason`
- `category_fit_score` → `categoryFitScore`
- `category_fit_reason` → `categoryFitReason`
- `estimated_reach_band` → `estimatedReachBand`

## Development

### Local Mode

The module runs in **local mode** by default, which:
- Uses hardcoded Firebase credentials (no service account needed)
- Bypasses authentication requirements
- Works offline for development

Set `FN7_SDK_MODE=local` in backend `.env` (default).

### Real-time Updates

- Frontend subscribes to `leadsetFeed/global` document
- Backend rebuilds feed on every data change
- Auto-refresh every 5 seconds for running leadsets
- Webhook support for near-instant updates from Exa

### Testing

1. **Seed test data:**
   ```bash
   cd backend
   node scripts/seed.js
   ```

2. **Start both servers:**
   ```bash
   # Terminal 1: Backend
   cd backend && npm start
   
   # Terminal 2: Frontend
   cd frontend && npm start
   ```

3. **Test webhooks locally:**
   Use `ngrok` to expose backend and set `WEBHOOK_URL` in `.env`

## Project Structure

```
ScoutLeadModule/
├── frontend/
│   ├── src/
│   │   ├── components/          # React components
│   │   ├── contexts/            # DataCacheContext
│   │   ├── hooks/               # useSessionId hook
│   │   ├── pages/               # Dashboard & Detail pages
│   │   ├── services/            # API client
│   │   └── sdk.js              # FN7 SDK wrapper
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── index.js            # Express server & routes
│   │   └── sdk.js              # SDK initialization
│   ├── scripts/
│   │   └── seed.js             # Seed script
│   └── package.json
├── data/
│   ├── leadsets.json           # Sample leadsets
│   └── settings.json          # Module settings
└── README.md
```

## Troubleshooting

### Leadsets not showing
- Check if `leadsetFeed/global` document exists in Firebase
- Run seed script: `cd backend && node scripts/seed.js`
- Verify session ID filter isn't hiding leadsets

### Enrichment not working
- Verify `EXA_API_KEY` is set in backend `.env`
- Check webhook signature verification (`EXA_WEBHOOK_SECRET`)
- Monitor backend logs for Exa API errors

### Real-time updates not working
- Ensure Firebase listener is active (check browser console)
- Verify backend is calling `rebuildLeadsetFeed()` after writes
- Check `docStatus/status` document updates

### Export failing
- Set `FIREBASE_STORAGE_BUCKET` in backend `.env`
- Check Firebase Storage permissions
- Fallback to inline CSV download if storage unavailable

## Documentation

- [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) - Detailed architecture and data flow
- [SESSION_ID_IMPLEMENTATION.md](./SESSION_ID_IMPLEMENTATION.md) - Session filtering guide
- [ENRICHMENT_RESPONSE_FLOW.md](./ENRICHMENT_RESPONSE_FLOW.md) - Enrichment workflow
- [UI_CONTEXT.md](./UI_CONTEXT.md) - UI guidelines and design system

## License

[Add your license here]

## Support

For issues and questions, please open an issue on GitHub or contact the development team.
