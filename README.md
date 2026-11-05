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

The Vercel Neon integration is attached to the Vercel project and supplies `MYCOMM_DATABASE_URL`; the API and migration runner now recognize that integration variable (as well as standard `DATABASE_URL`). Vercel production/preview builds run the idempotent schema and budget/master upgrade before building the static app. For local setup, put a pooled Neon connection URL in `DATABASE_URL` and apply the schema manually:

```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/upgrade-2026-11-budget-master.sql
psql "$DATABASE_URL" -f db/upgrade-2026-11-portal-tools.sql
```

The base schema creates country-specific currency precision and minimums, optional multi-country communities, masked member identities, admin-only membership approval fields, programs, central monthly GoFund collections, cases, workflow reviews, peer review, member votes, board discussion, vouchers/ledger entries, scheduled statements, notifications, and audit events. It seeds the PCIA Australia community and the four example initiatives from the community post: emergency support, funeral and burial support, a community hall, and legal support/advocacy. The budget/master upgrade adds period-based program budgets, board allocations, per-case allocations, recurring monthly case plans (each generated installment receives a new case number), and configurable portal identity/theme/social links.

Vercel serves the API through `api/[...path].js`, reusing the Express routes in `server/index.js`; the browser never receives database credentials.

API endpoints:

- `GET /api/health` — check Neon connection state
- `GET /api/public/:communitySlug/dashboard` — public-safe, masked community dashboard information
- `GET /api/public/:communitySlug/budgets?from=YYYY-MM-DD&to=YYYY-MM-DD` — program requirements, board allocations, case approvals, and voucher-linked disbursements
- `GET /api/public/:communitySlug/calendar` — scheduled member/public events only; admin follow-ups and marketing are always excluded
- `GET /api/admin/communities/:slug/calendar?memberId=…` and `POST` — admin calendar read/create; requires `ADMIN_API_TOKEN` and an active admin membership
- `GET /api/admin/communities/:slug/close-monitoring?memberId=…` — admin case monitor excludes system-generated monthly installments
- `POST /api/admin/cases/:caseId/repeat-flag` and `/repeat-flag/clear` — record/clear private repeat follow-up with an admin-supplied reason
- `POST /api/admin/communities/:slug/statements` — persist statement-run metadata after PDF generation
- `POST /api/admin/collections/:id/disbursement` — record a disbursement with its voucher (requires server-side `ADMIN_API_TOKEN`)
- `POST /api/admin/statements/run` — claim queued statement jobs by cadence (requires server-side `ADMIN_API_TOKEN`)

Admin routes require both the server-side token and the `memberId` of an active admin membership. Never expose the token to browser code.

Schedule the monthly jobs with your platform scheduler:

```bash
npm run job:collections       # on the final day of each month
npm run job:recurring-cases   # on the first day of each month; creates a fresh request/case number for each due installment
npm run job:notify-statements # after statement artifacts are ready
```

The budget view compares expected program need, board-approved allocation, and actual case-linked disbursements. Recurring payment plans intentionally create a new case each month so each installment returns through review and is auditable separately. Master setup includes community/location/currency controls, program toggles, custom program and case-type editors, and WhatsApp/Facebook URLs; current UI master preferences remain browser-local while the schema provides Neon master-data tables. The new release-notes and demo pages cover application changes and illustrative screen previews. A contextual guide is available across sections; it is deterministic help content, not a connected generative-AI service. The map drills into approximate country/locality views, but detailed state/city/suburb boundary data is not integrated. Calendar entries persist in browser storage in the demo; protected Neon calendar and repeat-flag APIs are available for an authenticated server integration. PDF statements and vouchers are generated in the browser; statement metadata can be recorded via the protected API.

Never put `DATABASE_URL` or `ADMIN_API_TOKEN` in frontend variables. Neon cannot be provisioned or attached from this repository without a project URL and database credentials; this code is ready to connect when those are supplied as environment variables.

## Important production integrations

This repository does not collect or hold donations and does not connect to GoFundMe. Collections are represented as centrally managed monthly campaign records; GoFundMe campaign creation, payment-webhook reconciliation, bank-account verification, identity verification, and actual payouts require approved provider accounts and credentials. No payments should be treated as live through this demo.

Before production, add a real identity provider (OIDC/passkeys), server-verified community membership/roles, encryption key management for names and sensitive request records, privacy/retention controls, rate limiting, CSRF protections, audit review, accessibility and professional translation review, and country-specific legal/charity compliance. Public endpoints must never expose addresses, contact details, raw identities, or private verification notes. Board and reviewer access must be authorized server-side; votes are advisory and do not bypass required approvals. The demo portal's UI actions intentionally provide prototype feedback rather than constituting a secure identity or approval system.
