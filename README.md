# Kindred — Community support, made transparent

A community-led support portal prototype for Pakistani communities in Australia and cross-border donor communities. The UI includes private support requests, one-vote-per-case-per-member voting, layered approvals, a public transparency ledger, a program-and-case budget comparison (expected need vs board approval vs voucher-linked disbursement), **ballpark allocation planning for quick action**, **case-linked fundraising campaigns alongside the monthly $1 collection**, **supporting documents saved to a community Google Drive account**, **case-study walkthroughs for difficult cases**, a **community awareness tab**, **a per-community master setup**, **community and account switching**, and a **256-language catalogue**.

### What changed in release 2.4

| Area | What now works |
| --- | --- |
| Navigation | Every sidebar item opens a real page. The nav is grouped: Community, Governance & money, Community people, Master setup. Nothing dead-ends on a toast. |
| Forecast & allocation planning | The budget page's forecast card now opens a real ballpark planner: funds available, a deliberate reserve, per-program shares, remaining amounts, and a "quick-action ready" flag. |
| Reports | Real period selector, generated PDF statements, statement history, and links into budgets, financials, forecasts, documents, and case studies. |
| Campaign initiation | Create a case-linked go-fund campaign with a target, window, story, business match, and monthly-pool offset. Campaigns start as drafts and need board approval; surplus returns to the pool. |
| Community switch | Sidebar switcher; cases, campaigns, documents, budgets, and currency follow the selected community. |
| Account switch | Sidebar/profile switcher across member, reviewer, board, and admin roles. Votes are stored per member, so switching accounts loads that member's own vote record. |
| Master setup | Its own sidebar section plus new cards for communities, member accounts, languages, Google Drive, and CSV data injection by community. |
| Languages | 256-language catalogue with search; 40 languages translate the full navigation and 13 translate the dashboard copy. RTL languages flip the shell. |
| Data injection | Master setup validates a CSV (programs, program budgets, cases, opening ledger entries) against expected columns before staging rows for one community. |
| Supporting documents | Attach files to a case, mark them restricted, and save them to the community Google Drive account with the `drive.file` scope. Only the Drive file ID and metadata are stored. |
| One vote per case | The vote is written to local storage before the request leaves, then to `case_votes` (unique on request+member). The button locks permanently for that member and case, and a database trigger refuses edits. |
| Awareness | A separate tab explaining the monthly $1 model, six supported causes, a four-week awareness plan, a committee signup, and messages that work versus backfire. |
| Case studies | Three full seven-step walkthroughs: situation → approach → verification → board presentation → what made the board agree → how funds were collected → how they were distributed, with timeline and lessons. |

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
psql "$DATABASE_URL" -f db/upgrade-2026-11-release-2.4.sql
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

Release 2.4 adds:

- `GET /api/public/cases/:caseRef/vote?memberId=…` — read a member's existing vote
- `POST /api/public/cases/:caseRef/vote` — cast the single allowed vote; returns `409` with `reason:"duplicate_vote"` for a repeat attempt, `403` for non-members, `409` for closed cases
- `GET /api/public/:communitySlug/campaigns` — public campaign progress (no donor identities)
- `POST /api/admin/communities/:communitySlug/campaigns` — create a case-linked campaign as `awaiting_board`
- `GET|POST /api/admin/cases/:caseRef/documents` — document metadata, Drive sync state, and restricted visibility
- `GET|POST /api/admin/communities/:communitySlug/ballpark` — ballpark planning figures (explicitly `planning_only`)
- `GET /api/public/communities`, `GET /api/public/languages`, `GET /api/public/:communitySlug/case-studies`

Admin routes require both the server-side token and the `memberId` of an active admin membership. Never expose the token to browser code.

### Single vote enforcement

`case_votes` has a unique index on `(request_id, member_id)` and a trigger that raises on `UPDATE`, so a vote can never be duplicated or rewritten — by two devices, two tabs, or a repeat visit. The browser writes the vote locally first, then mirrors it to the API; a `409` restores the server's record instead of overwriting it.

### Google Drive documents

Set the community Google account in Master setup or `community_master_settings.google_drive_account`. The portal requests only `https://www.googleapis.com/auth/drive.file`, so it can create and manage files it owns and touch nothing else. `case_documents` stores the file name, size, type, restricted visibility, reviewer note, and the Drive file ID. In this prototype, files under 512 KB are also kept in the browser so a download survives a reload; production should upload server-side and store only the Drive reference.

Schedule the monthly jobs with your platform scheduler:

```bash
npm run job:collections       # on the final day of each month
npm run job:recurring-cases   # on the first day of each month; creates a fresh request/case number for each due installment
npm run job:notify-statements # after statement artifacts are ready
```

The budget view compares expected program need, board-approved allocation, and actual case-linked disbursements. Recurring payment plans intentionally create a new case each month so each installment returns through review and is auditable separately. Master setup includes community/location/currency controls, program toggles, custom program and case-type editors, and WhatsApp/Facebook URLs; current UI master preferences remain browser-local while the schema provides Neon master-data tables. The new release-notes and demo pages cover application changes and illustrative screen previews. A contextual guide is available across sections; it is deterministic help content, not a connected generative-AI service. The map drills into approximate country/locality views, but detailed state/city/suburb boundary data is not integrated. Calendar entries persist in browser storage in the demo; protected Neon calendar and repeat-flag APIs are available for an authenticated server integration. PDF statements and vouchers are generated in the browser; statement metadata can be recorded via the protected API.

### Prototype vs production

Community, account, campaign, document-metadata, and language selections persist in browser storage so the flow is demonstrable without credentials; the schema and APIs above are ready for the server-side versions. The vote table, Drive sync state, campaign approval, and ballpark plan all exist in Neon — connecting `DATABASE_URL` switches the vote path from local-only to database-enforced, and the UI says which one it used.

Never put `DATABASE_URL` or `ADMIN_API_TOKEN` in frontend variables. Neon cannot be provisioned or attached from this repository without a project URL and database credentials; this code is ready to connect when those are supplied as environment variables.

## Important production integrations

This repository does not collect or hold donations and does not connect to GoFundMe. Collections are represented as centrally managed monthly campaign records; GoFundMe campaign creation, payment-webhook reconciliation, bank-account verification, identity verification, and actual payouts require approved provider accounts and credentials. No payments should be treated as live through this demo.

Before production, add a real identity provider (OIDC/passkeys), server-verified community membership/roles, encryption key management for names and sensitive request records, privacy/retention controls, rate limiting, CSRF protections, audit review, accessibility and professional translation review, and country-specific legal/charity compliance. Public endpoints must never expose addresses, contact details, raw identities, or private verification notes. Board and reviewer access must be authorized server-side; votes are advisory and do not bypass required approvals. The demo portal's UI actions intentionally provide prototype feedback rather than constituting a secure identity or approval system.
