# Module 1 — Server foundation

**Status:** Complete (pull request #1 approved by owner 2026-10-29; merged by the owner)

## Goal

A plain Node.js (TypeScript) server that serves the website, admin and API on
their own hostnames, with no frameworks.

## Steps

- [x] Project layout (server/, worker/, public/, db/, shared/) and TypeScript compiler setup
- [x] HTTP server using Node's built-in `http` module
- [x] Our own router: routes per hostname (hairbydemj.com, admin., api.)
- [x] Configuration loaded from environment settings
- [x] Request logging and error handling
- [x] Static file serving for public/
- [x] Health-check route
- [x] Basic tests and a GitHub Actions check on pull requests
- [x] Owner approves the pull request and it is merged into `develop`

## Done when

The server runs locally, answers on all three hostnames, and checks pass on
every pull request.

## Notes

- Packages: only `typescript` and `@types/node` (type definitions the compiler
  needs for Node's built-in modules), both development-only.
- Tests use Node's built-in test runner (`node:test`); no test framework.
- `/health` answers on every hostname with status, version and uptime.
- Unknown hostnames get a 404. API errors are JSON; website and admin errors
  are HTML. Internal error details are hidden in production.

## How to run locally

```
npm install        # installs the TypeScript compiler
npm test           # builds and runs all tests
npm run build && npm start
```

Then open http://localhost:3000, http://admin.localhost:3000 and
http://api.localhost:3000/health (settings in `.env.example`).
