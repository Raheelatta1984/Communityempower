# Kindred — Community support, made transparent

A community-led support portal prototype for Pakistani communities in Australia and cross-border donor communities. The UI includes private support requests, member voting, layered approvals, a public transparency ledger, monthly campaign progress, reports, community/program controls, and multilingual UI (English, Spanish, Arabic demo strings).

## Run locally

```bash
npm install
cp .env.example .env
npm run dev       # Vite on 0.0.0.0:5173
npm run api       # in another terminal, API on 0.0.0.0:3001
```

The experience falls back to clearly labelled demo data if Neon has not been configured. Vite proxies `/api` to the API. `npm run build` validates and builds the frontend.

## Neon database

Create a Neon PostgreSQL project, put its pooled connection URL in `DATABASE_URL`, and apply the schema:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

This schema creates country-specific currency precision and minimums, optional multi-country communities, masked member identities, admin-only membership approval fields, programs, central monthly GoFund collections, cases, workflow reviews, peer review, member votes, board discussion, vouchers/ledger entries, scheduled statements, notifications, and audit events. It seeds the PCIA Australia community and the four example initiatives from the community post: emergency support, funeral and burial support, a community hall, and legal support/advocacy.

API endpoints:

- `GET /api/health` — check Neon connection state
- `GET /api/public/:communitySlug/dashboard` — public-safe, masked community dashboard information
- `POST /api/admin/collections/:id/disbursement` — record a disbursement with its voucher (requires server-side `ADMIN_API_TOKEN`)
- `POST /api/admin/statements/run` — claim queued statement jobs by cadence (requires server-side `ADMIN_API_TOKEN`)

Never put `DATABASE_URL` or `ADMIN_API_TOKEN` in frontend variables. Neon cannot be provisioned or attached from this repository without a project URL and database credentials; this code is ready to connect when those are supplied as environment variables.

## Important production integrations

This repository does not collect or hold donations and does not connect to GoFundMe. Collections are represented as centrally managed monthly campaign records; GoFundMe campaign creation, payment-webhook reconciliation, bank-account verification, identity verification, and actual payouts require approved provider accounts and credentials. No payments should be treated as live through this demo.

Before production, add a real identity provider (OIDC/passkeys), server-verified community membership/roles, encryption key management for names and sensitive request records, privacy/retention controls, rate limiting, CSRF protections, audit review, accessibility and professional translation review, and country-specific legal/charity compliance. Public endpoints must never expose addresses, contact details, raw identities, or private verification notes. Board and reviewer access must be authorized server-side; votes are advisory and do not bypass required approvals. The demo portal's UI actions intentionally provide prototype feedback rather than constituting a secure identity or approval system.
