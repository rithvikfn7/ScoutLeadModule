# Scout Leadsets Module – Comprehensive Overview

This document explains the entire Scout Leadsets micro module from two perspectives:

- **Product view** – what the experience is for operators using the tool.
- **Technical view** – how the React frontend, Node backend, SDKs, and Exa Websets integration work together.

It also clarifies the role of each SDK and catalogs the relevant data structures, scripts, and operations.

---

## 1. Product View

### 1.1 Primary personas and objectives
- **Growth operators** import or curate *leadsets* (pre-filtered segments of potential buyers) and monitor their freshness.
- **Sales assistants** run Exa searches to pull new buyers into a leadset, then unlock contact details for the most relevant ones.
- **Ops engineers** seed sandboxes, perform factory resets, and troubleshoot webhook/Exa sync issues.

### 1.2 Key surfaces
1. **Leadsets Dashboard (`/`)**
   - Shows every leadset card with segment/intention chips, current status badge, and estimated buyer counts.
   - Includes search, status filters (All/Running/Enriching/Idle/Failed), and sorting controls (Latest, Buyers, Status).
   - “Manage Data” button opens a modal that lets operators upload JSON seeds or trigger a *factory reset* that wipes both Firebase docs and remote Exa websets.

2. **Leadset Detail (`/leadsets/:id`)**
   - Streams live data for a specific leadset: hero section, run stats, enrichment coverage, and intent tier.
   - Buyers table supports search, recency buckets, “has contact info” filter, pagination, row selection, and snippet expansion.
  - Toolbar actions:
    - **Run leadset** – available when zero buyers exist; starts the very first Exa run.
    - **Extend buyers** – once a webset exists, opens a lightweight modal to request more buyers via Exa’s search append endpoint.
    - **Cancel run** – stops an in-flight Exa search/enrichment.
    - **Download CSV** – exports run data (via backend) and either serves a cloud URL or direct CSV download.
    - **Get more details** – launches a checklist modal (Buying Intent, Employee Count, Phone, Email), calculates per-field cost, and requests the selected enrichments from Exa.
   - Inline toasts reflect long-running background work (run start, enrichment progress, refreshes).
  - Buyers table now includes a “Buyer context” column that surfaces any unlocked insights (Buying Intent, Employee Count) alongside contact data.
  - Each buyer row indicates whether Exa classified the entity as a company or a person, helping operators pick the right outreach motion.

3. **System modals**
  - **RunOptionsModal** collects the number of additional buyers to fetch when extending an existing webset.
  - **UnlockModal** now powers the “Get more details” flow: users tick which enrichment fields to pull, see per-field/per-buyer pricing, and confirm before the backend creates the corresponding Exa enrichments.
  - The Manage Data modal handles JSON uploads and the irreversible factory reset action.

### 1.3 Day-in-the-life workflow
1. Operator seeds initial leadsets via JSON or the provided `scripts/seedBuyerItems.js`.
2. Dashboard auto-refreshes (through the `leadsetFeed` listener) and shows each leadset’s triaged metadata.
3. Operator opens a leadset, reviews the latest run stats, and, if needed, kicks off a new run. The UI immediately polls `/webset` for upstream status and shows interim buyer rows sourced straight from Exa while Firebase catches up.
4. Once enough buyers are visible, the operator filters and selects the highest-signal ones, requests enrichment, and watches enrichment statuses transition in-table.
5. After enrichment completes (either via polling or Exa webhook), the operator exports the CSV for handoff.

---

## 2. Technical View

### 2.1 High-level architecture

```
React UI  ──(FN7 Frontend SDK)──► Firebase (tenant collections)
   ▲  │                              ▲
   │  └───── REST (apiClient.js) ────┘
   │                                  \
   │                                   \
   └────────────── Express Backend ──(FN7 Node SDK)──► Firebase writes
                                │
                                ├──► Exa Websets API (search/enrichment)
                                └──► Webhook handler (Exa → Firebase)
```

- **Frontend** performs all reads through the FN7 Frontend SDK (a local Firebase wrapper) and uses REST calls only for *actions* (run, enrich, cancel, export).
- **Backend** is the control plane: it translates leadset definitions into Exa queries, persists runs/items/enrichments with the FN7 Node SDK, and normalizes Exa webhook payloads into Firestore documents.
- **Shared cache doc**: `leadsetFeed/global` aggregates all leadsets, runs, items, and settings into a single doc so the UI can subscribe to one listener instead of many.

### 2.2 Data contracts & collections

| Collection (`doc_type`) | Purpose | Key fields |
| --- | --- | --- |
| `leadsets` | Segment definitions surfaced to operators | `segment`, `intent`, `status`, `websetId`, `lastRunId` |
| `runs` | Exa execution record per leadset revision | `websetId`, `status`, `mode`, `counters`, `searchQuery` |
| `items` | Buyers discovered by Exa | `entity`, `snippet`, `score`, `enrichment` |
| `enrichments` | Multi-step contact unlock jobs | `emailEnrichmentId`, `phoneEnrichmentId`, `itemIds`, `status` |
| `settings` | Product-wide knobs and pricing | `cost.perContact`, `limits.maxSelectionPerEnrichment` |
| `leadsetFeed` | Aggregated cache consumed by frontend | `leadsets`, `leadsetDetails`, `settings`, `counts` |
| `docStatus` | Bump counter used to notify other listeners | `version`, `updated`, `leadsetId`, `runId` |

Documents are stored under tenant-aware paths (`{org_hkey}.{app_id}/{doc_type}.{doc_id}`) so both SDKs can coexist with the broader FN7 multi-tenant schema.

### 2.3 Request/response lifecycle

1. **Dashboard load**
   - `DataCacheProvider` spins up `sdk.startFirebaseListener('leadsetFeed', 'global')`.
   - Backend builds/refreshes this document every time it writes `leadsets`, `runs`, `items`, or `settings`.

2. **Starting a run**
   - Frontend calls `POST /leadsets/:id/run` with the desired mode/count.
   - Backend fetches leadset definition from Firebase, builds a natural-language query, creates an Exa Webset, persists a corresponding `runs` doc, and marks the leadset `status: 'running'`.
   - UI begins polling `/runs/:runId/webset` every 3 seconds until Exa reports `idle`, which also pushes items into Firebase.

3. **Enrichment**
   - UI sends selected item IDs to `POST /runs/:runId/enrich`.
   - Backend creates two Exa enrichments (email + phone), stores an `enrichments` doc, and flips each item’s `enrichment.status` to `enriching`.
   - Completion can be detected either via `/enrichment/:id` polling or Exa webhook `webset.enrichment.completed`, both of which update items with `email/phone/linkedin`.

4. **Exports**
   - UI hits `GET /runs/:runId/export`.
   - Backend derives matching `items`, builds CSV, and tries to upload it to Firebase Storage via the Node SDK for CDN delivery, falling back to inline download.

5. **Factory reset**
   - UI calls `DELETE /seed`.
   - Backend enumerates every run/leadset, deletes remote Exa websets in batches, then deletes every Firebase document via the SDK to leave a pristine tenant.

---

## 3. Frontend Architecture

### 3.1 Routing & shell
- `App.js` wires `ErrorBoundary`, `DataCacheProvider`, and `react-router` routes for `/` and `/leadsets/:leadsetId`.
- Global styles (`App.css`, `index.css`) apply the light theme, Sora typography, and component styles defined in `UI_CONTEXT.md`.

### 3.2 State and data access
- **Context cache** – `DataCacheContext` maintains `feedData`, exposes selectors (`leadsets`, `leadsetDetails`, `settings`, `feedUpdatedAt`), and provides `refreshCache` for manual re-syncs.
- **Leadset-specific hook** – `useLeadsetCache(leadsetId)` derives `leadset`, `run`, `items`, and convenience flags for detail pages (loading, initialization, errors).
- The context ensures the UI remains instant after the first fetch and minimizes Firestore reads by relying on the aggregated `leadsetFeed` document.

### 3.3 Page components
- **LeadsetsDashboard**
  - Consumes context to render cards, manages filters/sorting locally, and handles seed/factory reset flows through `fetch` calls to backend `/seed` endpoints.
  - Uses `LeadsetCard`, `LeadsetCardSkeleton`, and `FN7FactRotator` for states/empty placeholders.

- **LeadsetDetail**
  - Handles Exa polling, table filtering, selection logic, pagination, toast notifications, and interactions with action endpoints (`run`, `webset`, `enrich`, `cancel`, `export`).
  - Maintains ephemeral state for run options modal, unlock modal, enrichment highlights, and snippet expansion.
  - Shows skeleton loaders (`BuyerItemSkeleton`) until the cache is warm, and surfaces status pills for both Firebase (`run.status`) and live Exa responses.

### 3.4 Service layer
- `services/apiClient.js` centralizes REST calls. It automatically stringifies JSON payloads, bubbles up backend error payloads (including custom `code` values like `EXISTING_WEBSET`), and supports blob responses for exports.

### 3.5 Frontend SDK responsibilities
- `frontend/src/sdk.js` instantiates a **Local FN7 SDK** shim that wraps Firebase Web SDK modules.
- Key behavior:
  - Builds tenant-aware document paths (via `buildDocPath`) to match backend naming.
  - Provides CRUD helpers (`getFirebaseData`, `createFirebaseData`, etc.), `searchFirebaseData` with client-side filtering, and a `startFirebaseListener` wrapper that mimics the real SDK’s observable API.
  - Seeds `localStorage.user_context` / `app_context` when running in `local` mode so downstream hooks relying on user/app metadata work without the FN7 platform injecting values.
  - Exposes convenience getters (user ID, roles, application metadata) and Firestore utilities (`increment`) to keep parity with the real SDK.
- Because the front-end only reads, it never stores service-account secrets and can operate in “local mode” with placeholder Firebase config until real credentials are supplied.

---

## 4. Backend Architecture

### 4.1 Express server (`backend/src/index.js`)
- Initializes the official `@fn7/sdk-node` via `getSDK` (singleton) with mode defaulting to `local`. It throws early if `FIREBASE_SERVICE_ACCOUNT_JSON` is absent to avoid partial boot.
- Applies CORS and JSON body parsing with `rawBody` capture, needed for HMAC verification of Exa webhooks.
- Provides helper utilities:
  - `updateDocStatus` bumps `docStatus/status` for clients that prefer coarse-grained invalidation.
  - `rebuildLeadsetFeed` consolidates all `doc_type` groups into `leadsetFeed/global` for the frontend.
  - Exa API wrappers for create/list/get/cancel/delete websets and enrichments with mock fallbacks when `EXA_API_KEY` is missing.

### 4.2 Action endpoints
| Endpoint | Behavior |
| --- | --- |
| `GET /leadsets` | Returns all `leadsets` documents for debugging/non-cached consumers. |
| `GET /leadsets/:id/detail` | Rehydrates a single leadset, latest run, and items; opportunistically syncs live Exa items if the run is mid-flight. |
| `GET /leadsets/:id/run-status` | Used by the UI to decide whether to show `RunOptionsModal`. |
| `POST /leadsets/:id/run` | Validates mode (new/extend/replace), optionally deletes existing Exa webset/items, creates a new webset, persists `runs` doc, and updates leadset status. |
| `GET /leadsets/:id/runs/:runId/webset` | Poll target; fetches Exa state, saves items to Firebase, updates counters/status, and returns live data to the UI. |
| `POST /leadsets/:id/runs/:runId/cancel` | Cancels Exa webset and marks both run and leadset idle. |
| `POST /leadsets/:id/runs/:runId/enrich` | Creates email/phone enrichments, stores an `enrichments` doc, flips selected items to `enriching`, and tracks selections. |
| `GET /leadsets/:id/runs/:runId/enrichment/:enrichmentId` | Polling endpoint that also persists final email/phone/linkedin data once completed. |
| `GET /leadsets/:id/runs/:runId/export` | Builds CSV, tries uploading via FN7 storage helpers, and falls back to direct download response. |
| `POST /seed` | Seeds `leadsets` and `settings` from uploaded JSON; optionally clears existing docs. |
| `DELETE /seed` | Performs factory reset: deletes Exa websets in batches, deletes every Firebase doc via SDK, rebuilds feed. |
| `POST /webhooks/exa` | Verifies HMAC signature, acknowledges immediately, and async-processes events (`webset.items.created`, `webset.idle`, `webset.enrichment.completed`). |

Each endpoint makes extensive use of the Node SDK so auth context is implicit in local mode. Switching to `server` mode simply requires setting `FN7_SDK_MODE=server` and passing JWT-derived `authContext` into SDK calls.

### 4.3 Background synchronization
- **Polling** – Frontend continues to poll `/webset` while Exa is running; backend saves items and updates statuses on each poll.
- **Webhooks** – Provide near-real-time updates: new items trigger `runs` counter increments; `webset.idle` flips run/leadset statuses to `completed/idle`; `webset.enrichment.completed` writes contact info and increments `enriched` counters.
- Both paths end by calling `rebuildLeadsetFeed()` so the UI listener receives a consolidated snapshot without issuing multiple Firestore reads.

### 4.4 Supporting scripts & data
- `backend/scripts/seed.js` reads `data/leadsets.json`/`settings.json` and seeds Firebase via the Node SDK.
- `scripts/seedBuyerItems.js` demonstrates seeding detailed buyer items for a reference leadset using Firebase Admin SDK directly (useful for demos/testing).
- `data/leadsets.json` and `data/settings.json` act as canonical fixtures for local sandboxes or CI resets.

---

## 5. SDK Roles (Frontend vs. Backend)

| Concern | Frontend SDK (`frontend/src/sdk.js`) | Backend SDK (`backend/src/sdk.js` + `@fn7/sdk-node`) |
| --- | --- | --- |
| **Auth context** | Auto-populates `localStorage` with mock `user_context` / `app_context` when `mode: 'local'`; no service credential exposure. | Requires `FIREBASE_SERVICE_ACCOUNT_JSON`; in `local` mode auth context is optional, but in `server` mode endpoints must pass JWT-derived tokens. |
| **Data access** | Read-mostly operations: `getFirebaseData`, `searchFirebaseData`, `startFirebaseListener`. Writes exist but are rarely used (only in seed/modals). | Full CRUD with security enforcement plus storage helpers (`uploadToStorage`, `getFromStorage`) and Firestore utilities (`increment`). |
| **Tenant routing** | Computes tenant prefixes from `localStorage` to keep reads confined to the right org/app. | Uses the FN7 SDK’s built-in tenant awareness (implicitly derived from service account + auth context). |
| **Realtime behavior** | Sets up document listeners (leadset feed) so UI reacts instantly without manual polling. | Pushes aggregated documents (`leadsetFeed/global`, `docStatus/status`) and triggers feed rebuilds whenever writes occur. |
| **External integrations** | None; delegates all heavy lifting to backend via REST. | Wraps Exa Websets API (search, items, enrichments, cancellation) and handles webhook verification. |

Together, they enforce the architectural rule: **frontend reads, backend writes/actions**. This separation protects service credentials, minimizes the number of Firestore listeners, and makes it trivial to swap in the hosted FN7 SDK when moving from local to Atlas environments.

---

## 6. Operational Considerations

- **Configuration**
  - Frontend reads Firebase config from `REACT_APP_FIREBASE_CONFIG` (JSON string) or falls back to placeholders.
  - Backend expects `.env` with `FIREBASE_SERVICE_ACCOUNT_JSON`, `EXA_API_KEY`, `EXA_WEBHOOK_SECRET`, optional `WEBHOOK_URL`, `FIREBASE_STORAGE_BUCKET`, and `FN7_SDK_MODE`.

- **Local mode vs. server mode**
  - Local mode bypasses JWT/token requirements, stubs Exa responses if no API key is set, and allows rapid prototyping without infrastructure.
  - Server mode enforces proper auth contexts and real Exa traffic; the same endpoints work once environment variables are populated.

- **Testing**
  - Use `npm run dev` inside `frontend/` and `backend/` separately.
  - For webhook testing, expose the backend via `ngrok` and set `WEBHOOK_URL` accordingly.
  - The `leadsetFeed` listener makes it easy to validate end-to-end flows: run start, webhook ingestion, enrichment, and exports should all reflect in the dashboard without page refreshes.

- **Recovery**
  - `DELETE /seed` is the nuclear option that ensures Firebase and Exa stay in sync after experiments.
  - `scripts/seedBuyerItems.js` plus `data/*.json` let you repopulate deterministic datasets immediately after a reset.

---

## 7. Quick Reference Checklist

1. **Need more leadsets?** Edit `data/leadsets.json` or upload via dashboard modal → POST `/seed`.
2. **Need to clear everything?** Use factory reset (DELETE `/seed`) – deletes Exa websets *and* Firebase docs.
3. **Seeing stale data?** Confirm backend logs show `updateDocStatus` and `rebuildLeadsetFeed` messages after each mutation.
4. **Frontend fails to load?** Ensure `leadsetFeed/global` exists; otherwise run `backend/scripts/seed.js`.
5. **No contact info after enrichment?** Check `webhooks/exa` signature env vars and verify `/enrichment/:id` polling completes; watch for `enrichments` docs staying `pending`.
6. **Exports failing?** Confirm `FIREBASE_STORAGE_BUCKET` is set; otherwise expect inline CSV download fallback.

With these pieces in place, the Scout Leadsets module provides a full loop: seed → search → triage → enrich → export, all while keeping Firebase as the canonical data store and Exa as the discovery engine.

