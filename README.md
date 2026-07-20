# KNIP Platform

**Version:** 0.2.0 Alpha — Story Intelligence

KNIP is an AI-native decision-intelligence platform for narrative strategy. This release implements the first vertical slice: story intake, evidence cataloguing, transparent first-pass analysis, persistent local data, and audit logging.

## Windows 11 quick start

1. Install and open Docker Desktop.
2. Double-click `Run-KNIP.bat`.
3. Open `http://localhost:3000`.

## Verify locally

```bash
npm run verify
```

## Current analysis model

The Alpha analyzer is deterministic and local. It provides classification, keywords, evidence completeness, reliability, confidence, risks, and a next-step recommendation. It does **not** call an external LLM yet; provider-backed AI orchestration will be added in a later milestone.

## Data

Runtime data is stored in `data/database.json` and is ignored by Git. `data/seed.json` remains the reproducible demo baseline.
