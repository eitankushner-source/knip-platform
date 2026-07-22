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
