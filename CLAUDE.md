# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gardenarr is an AI-powered garden planning app. Users create gardens, select crops, and receive Claude-generated planting schedules and companion planting recommendations. The backend serves both the REST API and the production frontend build from a single Node.js process on port 3700.

## Development Commands

### Backend
```bash
cd backend
npm install
npm run dev       # nodemon with hot reload
npm start         # production
```

### Frontend
```bash
cd frontend
npm install
npm run dev       # Vite dev server (proxies /api → localhost:3700)
npm run build     # outputs to frontend/dist
```

### Docker (production)
```bash
docker compose up --build
```
Requires `ANTHROPIC_API_KEY` set in `.env` (see `.env.example`).

## Architecture

**Stack:** Express backend + React/Vite frontend + SQLite (`better-sqlite3`) + Anthropic SDK

**Single-service deployment:** The backend serves the frontend's static build (`frontend/dist`) in production. In dev, Vite proxies `/api` to the backend at `:3700`.

### Backend (`backend/server.js`)
All backend logic lives in a single file. Key sections:
- **DB schema**: `gardens`, `beds`, `plantings` tables initialized inline with `better-sqlite3`
- **`scheduleForCrops()`**: Calls Claude (`claude-sonnet-4-5` model) in batches of 15 crops, returning structured planting timelines
- **`/api/companion`**: Uses `claude-opus-4-5` for companion planting analysis
- **`/api/schedule`**: Accepts `{ gardenId, crops, zone, zipcode }`, saves results to `plantings` table
- Database path configurable via `DB_PATH` env var (defaults to `./garden.db` locally, `/data/garden.db` in Docker)

### Frontend (`frontend/src/`)
- **`App.jsx`**: Root component — manages `gardens` state, renders two-column layout (sidebar + detail)
- **Component tree**: `App` → `GardenList` (sidebar) + `GardenDetail` (tabs) → `CropScheduler` | `CompanionPlanner` | `PlantingList`
- **State**: React `useState`/`useEffect` only — no external state library
- **Persistence**: Selected crops persisted to `localStorage` in `CropScheduler`

### Data model
```
gardens (id, name, zone, zipcode)
  └── beds (id, garden_id, name, width_ft, length_ft)
  └── plantings (id, garden_id, bed_id, crop, sow_indoors, transplant_or_direct_sow, harvest, tip, notes)
```

## Environment Variables
| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `DB_PATH` | No | `./garden.db` | Path to SQLite database file |
| `PORT` | No | `3700` | Server port |
| `NODE_ENV` | No | — | Set to `production` to enable static file serving |

## No Test Suite
There are currently no automated tests in this project.
