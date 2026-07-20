# KNIP Platform

KNIP is the Knowledge & Narrative Intelligence Platform developed for the Kerem Alliance.

> The purpose of technology is not to automate communications. The purpose of technology is to improve the quality, consistency, and explainability of strategic decisions.

## Release

`v0.1.0-alpha-foundation`

This clean foundation includes:

- Dependency-free Node.js runtime
- One-command Docker startup
- Health endpoint
- Story intake and repository
- Persistent local data
- Audit trail
- Automated tests
- GitHub Actions validation

## Windows 11 quick start

1. Install and start Docker Desktop.
2. Extract the project.
3. Double-click `Run-KNIP.bat`.
4. Open `http://localhost:3000`.

To stop it, run `Stop-KNIP.bat`.

## Developer start

```bash
npm start
```

## Test

```bash
npm run check
npm test
```

## API

- `GET /api/health`
- `GET /api/stories`
- `POST /api/stories`
- `GET /api/audit`
- `POST /api/reset`

## Next milestone

KNIP-1020: Story Intelligence Engine.
