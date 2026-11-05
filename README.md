# Kindred — Community support, made transparent

A community-led support portal prototype for Pakistani communities in Australia and cross-border donor communities. The UI includes private support requests, member voting, layered approvals, a public transparency ledger, a program-and-case budget comparison (expected need vs board approval vs voucher-linked disbursement), monthly installment case histories, reports, editable master branding/theme/community settings, program toggles, social community links, and multilingual UI (English, Spanish, Arabic demo strings).

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
psql "$DATABASE_URL" -f db/upgrade-2026-11-budget-master.sql
```

The base schema creates country-specific currency precision and minimums, optional multi-country communities, masked member identities, admin-only membership approval fields, programs, central monthly GoFund collections, cases, workflow reviews, peer review, member votes, board discussion, vouchers/ledger entries, scheduled statements, notifications, and audit events. It seeds the PCIA Australia community and the four example initiatives from the community post: emergency support, funeral and burial support, a community hall, and legal support/advocacy. The budget/master upgrade adds period-based program budgets, board allocations, per-case allocations, recurring monthly case plans (each generated installment receives a new case number), and configurable portal identity/theme/social links.

API endpoints:

- `GET /api/health` — check Neon connection state
- `GET /api/public/:communitySlug/dashboard` — public-safe, masked community dashboard information
- `GET /api/public/:communitySlug/budgets?from=YYYY-MM-DD&to=YYYY-MM-DD` — program requirements, board allocations, case approvals, and voucher-linked disbursements
- `POST /api/admin/collections/:id/disbursement` — record a disbursement with its voucher (requires server-side `ADMIN_API_TOKEN`)
- `POST /api/admin/statements/run` — claim queued statement jobs by cadence (requires server-side `ADMIN_API_TOKEN`)

Schedule the monthly jobs with your platform scheduler:

```bash
npm run job:collections       # on the final day of each month
npm run job:recurring-cases   # on the first day of each month; creates a fresh request/case number for each due installment
npm run job:notify-statements # after statement artifacts are ready
```

The budget view compares expected program need, board-approved allocation, and actual case-linked disbursements. Recurring payment plans intentionally create a new case each month so each installment returns through review and is auditable separately. Master setup supports editable portal identity/logo/theme, community and country settings, minimum contribution, program switches, and WhatsApp/Facebook URLs; prototype settings are saved in the browser until secured admin persistence is wired to Neon.

Never put `DATABASE_URL` or `ADMIN_API_TOKEN` in frontend variables. Neon cannot be provisioned or attached from this repository without a project URL and database credentials; this code is ready to connect when those are supplied as environment variables.

## Important production integrations

This repository does not collect or hold donations and does not connect to GoFundMe. Collections are represented as centrally managed monthly campaign records; GoFundMe campaign creation, payment-webhook reconciliation, bank-account verification, identity verification, and actual payouts require approved provider accounts and credentials. No payments should be treated as live through this demo.

Before production, add a real identity provider (OIDC/passkeys), server-verified community membership/roles, encryption key management for names and sensitive request records, privacy/retention controls, rate limiting, CSRF protections, audit review, accessibility and professional translation review, and country-specific legal/charity compliance. Public endpoints must never expose addresses, contact details, raw identities, or private verification notes. Board and reviewer access must be authorized server-side; votes are advisory and do not bypass required approvals. The demo portal's UI actions intentionally provide prototype feedback rather than constituting a secure identity or approval system.
