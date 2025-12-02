# Backend API Routes

Base URL: `http://localhost:3000`

## Health & Debug
- `GET http://localhost:3000/health`
- `GET http://localhost:3000/api/leads/leadset-feed`

## Data Management
- `POST http://localhost:3000/api/leads/seed`
- `DELETE http://localhost:3000/api/leads/seed`

## Leadset Operations
- `GET http://localhost:3000/api/leads/leadsets`
- `GET http://localhost:3000/api/leads/leadsets/:leadsetId/webset-id`
- `GET http://localhost:3000/api/leads/leadsets/:leadsetId/detail`
- `POST http://localhost:3000/api/leads/leadsets/:leadsetId/sync-items`
- `DELETE http://localhost:3000/api/leads/leadsets/:leadsetId/items`

## Run Operations
- `GET http://localhost:3000/api/leads/leadsets/:leadsetId/run-status`
- `POST http://localhost:3000/api/leads/leadsets/:leadsetId/run`
- `GET http://localhost:3000/api/leads/leadsets/:leadsetId/runs/:runId/webset`
- `POST http://localhost:3000/api/leads/leadsets/:leadsetId/runs/:runId/cancel`

## Enrichment Operations
- `POST http://localhost:3000/api/leads/leadsets/:leadsetId/runs/:runId/enrich`
- `GET http://localhost:3000/api/leads/leadsets/:leadsetId/runs/:runId/enrichment/:enrichmentId`

## Export Operations
- `GET http://localhost:3000/api/leads/leadsets/:leadsetId/runs/:runId/export`

## Settings
- `GET http://localhost:3000/api/leads/settings`

## Webhooks
- `POST http://localhost:3000/api/leads/webhooks/exa`
