# KNIP RC3 — Approved Dashboard + Live Intelligence

RC3 preserves the RC2 FastAPI, Docker, GDELT, Census, RSS and Research Agent foundation and replaces the Executive Home with the approved KNIP dashboard layout.

## Run

1. Copy `backend/.env.example` to `backend/.env` if `.env` does not exist.
2. Run `docker compose up --build`.
3. Open `http://localhost:8080`.
4. API documentation: `http://localhost:8000/docs`.

## Visible RC3 capability

- Approved dark-navigation Executive Home
- Five since-last-login KPI cards
- Priority Decision workspace
- Full AI Advisory Board panel
- Emerging Intelligence
- Active Campaigns
- Institutional Learning
- Organization Health
- Recommended Next Actions
- Existing modules from RC2 remain available
- Dashboard hydrates through `/api/dashboard` with fallback data

No production persistence, authentication, scheduling, or LLM inference is included yet.

## Baseline Inventory (Phase 0)

This repository currently contains two supported runtime modes that must both be preserved during restoration work.

### Runtime mode A: Node + public workspace

- Entry: `npm start` (Node HTTP server)
- Server: `server.js`
- UI shell: `public/index.html`
- Frontend runtime: `public/app.js`
- Data store: `data/database.json` seeded from `data/seed.json`
- Primary API family: `/api/*` exposed by `server.js`

### Runtime mode B: Docker + FastAPI + root workspace

- Entry: `docker compose up --build`
- UI host: nginx serving repository root (`index.html`, `app.js`, `api.js`)
- API host: FastAPI (`backend/app/main.py`) proxied at `/api/*`
- Proxy: `nginx.conf`
- Compose topology: `docker-compose.yml`

## Runtime-Mode Matrix

| Capability Area | Mode A (Node + public) | Mode B (Docker + FastAPI + root) |
| --- | --- | --- |
| Executive Home | Live, API-backed dashboard | Live dashboard hydration + static RC widgets |
| Decision Center | Live (`#/decisions`) | Static/preview in legacy brief workflow |
| Story Repository | Live CRUD and analysis workflow | Mock RC story controller |
| Audience Intelligence | Live audience-intelligence workflow | Mock RC audience dossier and methodology |
| Advisory Board | Live session and decision linkage | Mock advisory deliberation controls |
| Campaigns | Live campaign planner view | Static kanban command view |
| Institutional Learning | Live learning intelligence | Static learning cards |
| Knowledge Graph | Shortcut/disconnected in Mode A shell | Static graph workspace |
| Platform Architecture | Not exposed in Mode A shell | Static architecture simulation workspace |

## Baseline Regression Checklist

Run these before and after any restoration phase:

1. Node tests: `npm test`
2. Python tests: `pytest backend/tests/test_fastapi_audience_parity.py`
3. Mode A route smoke:
	- `#/executive`
	- `#/stories`
	- `#/decisions`
	- `#/audiences`
	- `#/advisory`
	- `#/campaigns`
	- `#/learning`
4. Mode B route smoke:
	- `home` view
	- `stories` view
	- `audiences` view
	- `advisory` view
	- `campaigns` view
	- `learning` view
	- `platform` view
	- `graph` view
5. Endpoint smoke (Mode A):
	- `/api/health`
	- `/api/dashboard`
	- `/api/stories`
	- `/api/decisions`
	- `/api/advisory-board`
	- `/api/audience-intelligence`
	- `/api/campaign-plans`
	- `/api/learning-intelligence`
	- `/api/audit`
6. Endpoint smoke (Mode B):
	- `/api/health`
	- `/api/dashboard`
	- `/api/connectors`
	- `/api/stories`
	- `/api/audiences`
	- `/api/advisory-board`

Restoration rule: do not remove routes, labels, shortcuts, deep links, or existing endpoint shapes in either mode.
