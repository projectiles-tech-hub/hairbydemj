# Module 1 — Server foundation

**Status:** Not started

## Goal

A plain Node.js (TypeScript) server that serves the website, admin and API on
their own hostnames, with no frameworks.

## Steps

- [ ] Project layout (server/, worker/, public/, db/, shared/) and TypeScript compiler setup
- [ ] HTTP server using Node's built-in `http` module
- [ ] Our own router: routes per hostname (hairbydemj.com, admin., api.)
- [ ] Configuration loaded from environment settings
- [ ] Request logging and error handling
- [ ] Static file serving for public/
- [ ] Health-check route
- [ ] Basic tests and a GitHub Actions check on pull requests

## Done when

The server runs locally, answers on all three hostnames, and checks pass on
every pull request.
