# Amsol Ops backend

Ops extends the existing NestJS, Prisma and MySQL backend. Its controllers, services, permissions, sessions and tables are contained under src/ops and ops_*. Water Project, Blog and Ledger have guarded Ops adapters that reuse their existing services and data. Ops owns reporting. The combined backend no longer registers the legacy report modules or their email schedules. See [Ops workflows](ops-workflows.md) for the migration and current permission rules.

## Local setup

The existing backend .env remains the database and shared identity configuration. Do not point development or verification commands at production.

1. Generate the Prisma client with npm run prisma:generate.
2. Review migrations 20261111120000_ops_workspace and 20261111150000_ops_module_grants. They add only ops_* tables and foreign keys from those new tables.
3. Check prisma migrate status. Apply reviewed pending migrations to a development database. Do not run migrate reset or migrate fresh.
4. Link the first Ops owner using an active existing CEO or system administrator with a password:

```powershell
npm.cmd run ops:bootstrap -- existing-ceo@example.com
npm.cmd run start:ops:dev
```

The bootstrap creates the five Ops departments, the core Amsol business and an Ops CEO profile linked to that identity. It imports no existing projects, clients, reports or demo accounts and does not change the user's password or legacy roles. Re-running it preserves configured departments and settings.

For a local admin configured in backend/.env, `npm.cmd run ops:setup:local` creates the missing shared identity using `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` and links its Ops profile as System Admin. This command requires `NODE_ENV=development` and a local MySQL database. It does not reset existing passwords or reactivate accounts. It removes the CEO role from this configured admin and ensures the System Admin role; other users' roles are unchanged. It stops if the existing identity's password differs.

The Prisma seed also ensures the configured `SEED_ADMIN_EMAIL` has the System Admin role and removes CEO from that account. Re-run `npm.cmd run prisma:seed` and `npm.cmd run ops:setup:local` to apply the role correction to an existing local database and Ops profile. Separate CEO accounts are not changed.

The standard backend entry point, src/main.ts and AppModule, includes Ops alongside all existing modules. `npm start` loads backend/.env and uses the source entry point through Nest in development; when `NODE_ENV=production`, it starts the compiled `dist/main.js` build. Build first with `npm run build` for production. `npm run dev` remains the watch-mode development command. Its PORT, API origin, public Blog routes, media routes, payment callbacks, credentials, database and storage remain unchanged.

## Background schedulers

Scheduled jobs run inside the standard NestJS backend process; no separate worker command is
needed. `ScheduleModule.forRoot()` registers the cron and interval providers when `AppModule`
starts. Use `npm run dev` locally and `npm run start:prod` in production, and keep that process
running. The optional `start:ops` entry point is Ops-only and does not start the other application
modules' workers.

The application includes hourly notification sweeps, daily notification digests and website
analytics, 5-second Water import polling, 30-second Water cleanup, staff submission scheduling and payment
ledger synchronization, and 60-second Ops weekly-email delivery checks. Email, gateway, schedule,
and storage configuration gate the jobs that depend on those services. In multi-instance
deployments, use one scheduler-enabled backend instance unless each job has an explicit
distributed lease.

For local development, start npm.cmd run dev in backend and npm.cmd run dev in frontend, then open the URL Vite prints (normally http://127.0.0.1:5173, or the next available port). The frontend renders independently; API calls are proxied to port 4000. Set OPS_API_PROXY when using another local backend port.

Set OPS_FRONTEND_URL to the existing frontend HTTPS origin in production. For local invitations and scheduled report links, set it to the exact origin printed by Vite; Vite starts at port 5173 and selects the next available port if needed. Build the new frontend with the same VITE_API_URL as the old frontend; /api/v1 and /api/v1/ops bases are both accepted. Absolute API addresses retain the same API host. A relative address requires an API reverse proxy at the frontend host.

The separate ops-main.ts entry point and OPS_PORT=4002 are optional. Both backend entry points serve API requests only; host the frontend static build independently and configure its API URL or reverse proxy.

Deployment uses the production database already configured on the server. Never import or upload the local development database. Water, Blog and Ledger adapters use their original records and storage, and their public endpoints keep their existing paths. Initialize Ops once using an existing authorized production identity, then assign module access through Ops Admin.

## Authentication

POST /api/v1/ops/auth/login validates the shared User password and requires an active OpsStaff profile and active shared User. Ops sessions have their own HTTP-only, SameSite=Strict refresh cookie and a distinct signing key derived from the existing secret. Ops tokens are rejected by legacy JWT authentication.

Access tokens last 15 minutes. Sessions expire after two hours of inactivity, with a 12-hour absolute limit, or seven days with Remember me. The server loads current staff role, department and activation on every request. Deactivation, logout, renewed access links and password changes invalidate applicable Ops sessions.

Invitations contain random tokens whose hashes are stored in ops_invitations. They expire after seven days, are claimed atomically and can be used once. SMTP uses the existing email provider; the invitation response reports whether delivery succeeded and also returns a link to the authorized CEO. Invitation acceptance and password changes update the shared User password. Ops role and activation changes affect only OpsStaff.

New staff can exist without a login. Inviting them links or creates a User without granting legacy roles. Existing staff identities are linked deliberately by email; existing operational records are not copied automatically.

## Permission contract

| Action                         | CEO | Staff                                                        |
| ------------------------------ | --- | ------------------------------------------------------------ |
| Read projects                  | All | Team projects and projects involving own department          |
| Create project                 | Yes | Own department, with self as lead                            |
| Edit project/team              | Yes | Current lead; lead transfers require CEO                     |
| Assign/edit/delete tasks       | Yes | Project lead                                                 |
| Create own task                | Yes | Project member, assigned to self                             |
| Update own task status         | Yes | Assigned project member                                      |
| Submit report                  | Yes | Project member or own department; self as author             |
| Review report                  | Yes | No                                                           |
| Edit/delete reviewed report    | No  | No                                                           |
| Manage clients                 | All | Create and edit                                              |
| Manage tenders                 | All | Assigned tenders; new tenders include self                   |
| Manage service requests        | All | Operations staff, or own assigned requests                   |
| Manage monthly finances        | All | Explicit finance manage grant for that business              |
| Read business figures          | All | Explicit finance view or manage grant for that business      |
| Manage staff accounts/settings | Yes | No                                                           |
| Edit own display name          | Yes | Yes                                                          |
| Manage department registers    | All | Own records in own department                                |
| Read/download documents        | All | Owner, all-staff, department, project team or explicit grant |
| Change document access         | All | Owner within permitted department/project scope              |

Personal and department UI views never increase server permissions. Business figures are filtered before leaving the server. Reports retain reviewer identity, timestamps and feedback in ops_report_reviews, and reviewed content is immutable. New updates preserve the earlier review.

Database foreign keys preserve references. Application validation additionally enforces project membership, project departments, consistent completion and one finance entry per business/month. Money uses DECIMAL(16,2).

## API

All endpoints below are prefixed /api/v1/ops. Protected endpoints require an Ops bearer token.

| Method      | Path                                            | Purpose                           |
| ----------- | ----------------------------------------------- | --------------------------------- |
| POST        | /auth/login, /auth/refresh, /auth/logout        | Session lifecycle                 |
| GET         | /auth/me                                        | Current Ops account               |
| GET         | /auth/invitation?token=...                      | Validate setup link               |
| POST        | /auth/accept-invitation, /auth/change-password  | Password actions                  |
| GET         | /workspace                                      | Authorized workspace and revision |
| GET         | /records/:collection?page=1&limit=50&search=... | Authorized paginated records      |
| PUT, DELETE | /records/:collection/:id                        | Validated record changes          |
| POST        | /reports/:id/review                             | Record CEO feedback               |
| GET         | /reports/:id/reviews                            | Authorized review history         |
| PATCH       | /accounts/:id                                   | Ops role/activation               |
| POST        | /invitations, /accounts/:id/invitation          | Issue or renew setup link         |
| PUT         | /settings, /business-permissions/:person        | Ops settings and grants           |
| POST        | /documents                                      | Multipart file and JSON metadata  |
| GET         | /documents/:id/content                          | Authorized original download      |

Collections: departments, people, clients, projects, tasks, reports, tenders, clientRequests, businesses, businessFinance, documents, moduleRecords and templates.

Mutations require the workspace revision in the If-Match header. The server serializes writes through ops_state, validates related records and writes an audit entry in the same transaction. A stale revision returns 409 and does not partially save. Current screens load an authorized workspace snapshot; the paginated endpoint is available for future list-by-list loading.

Document creation uses multipart fields file and metadata. The metadata field contains the document record as JSON. Files are limited to 25 MB, use a generated ops/documents/... storage key and are checked on every download. File keys and MIME metadata cannot be replaced through the generic record endpoint.

## Verification

Normal backend regression tests need no database. Real Ops API tests are opt-in and reject nonlocal databases or names without the _verify suffix.

```powershell
npm.cmd test -- --runInBand
$env:OPS_TEST_DATABASE_URL="mysql://root@127.0.0.1:3308/amsol_ops_verify"
npm.cmd test -- --runInBand src/ops/ops.integration.spec.ts
```

Prepare this separate database by applying migrations to it with DATABASE_URL overridden only for that command. Never overwrite backend/.env to switch test databases. Connected browser verification lives in frontend/e2e-api and uses the same opt-in database variable; run it separately from the API integration suite when sharing a database.

Email invitations are implemented. In-app reminders use saved report dates and Ops settings. Weekly staff reporting includes separate consolidated plan/report emails. General legacy record imports remain a later phase. Water Project, Blog and Payment Ledger are available through the module adapters below.

## Weekly plans and reports

Migration 20261112110000_ops_weekly_reporting adds ops_weekly_settings, ops_weekly_reports and ops_weekly_deliveries, plus ops_staff.created_at for reporting eligibility. It does not alter existing operational tables. Each linked staff member has one versioned record per reporting Monday and phase (plan or report). Saved drafts are private. Submissions are immutable until a CEO returns them for correction. Reviews and returns are audited; submitted and returned snapshots remain in audit history.

Weekly API routes are under /api/v1/ops/weekly and use the existing Ops session guard. Staff read/write their own records only. CEOs read submissions, administer schedules, review/return records and view their own email delivery history. Independent record versions detect stale weekly writes; materializing tasks advances the workspace revision. Mutations recheck current account activation and authority in their transaction. All protected Ops responses use private, no-store caching.

| Method    | Path                              | Purpose                                                     |
| --------- | --------------------------------- | ----------------------------------------------------------- |
| GET, PUT  | /weekly/settings                  | Read the cycle or save CEO-controlled settings and version  |
| GET       | /weekly/reports?week=YYYY-MM-DD   | Own records or CEO staff overview                           |
| GET       | /weekly/reports/:week/:staffId    | Own record details or CEO view                              |
| PUT       | /weekly/reports/:week/:phase      | Save a draft or submit; body version, submit and submission |
| POST      | /weekly/submissions/:id/review    | Review with record version and optional comment             |
| POST      | /weekly/submissions/:id/return    | Return with record version and required correction reason   |
| GET       | /weekly/submissions/:id/history   | Authorized submission/review/correction history             |
| GET       | /weekly/brief?week=...&phase=plan | CEO preview; phase also accepts report                      |
| GET, POST | /weekly/deliveries                | Delivery history or explicit send to the requesting CEO     |
| POST      | /weekly/deliveries/:id/retry      | Confirmed retry of that CEO's failed/unconfirmed delivery   |

The CEO chooses the first reporting week, each submission deadline, and two separate email days/times. Reports may be due in the following week. Delivery is the first chosen time at or after its deadline, always in Africa/Nairobi. The plan and report each cover the selected week, rather than combining different periods in one email. Every active CEO receives one consolidated email per week and phase containing all eligible staff and missing submissions. Uninvited/inactive profiles are not marked overdue; a new profile is expected only for deadlines after it joined Ops.

The scheduler is a singleton within OpsModule; database uniqueness and atomic claims coordinate separate API processes. Successful sends retain a frozen HTML/plain-text snapshot and stable Message-ID. Expired in-flight sends become uncertain and are not automatically repeated, because SMTP acknowledgement cannot guarantee whether a remote inbox received the message. The CEO checks their inbox before explicitly retrying. Pending deliveries resume; due schedules are considered within the previous fourteen days.

Configure SMTP and OPS_FRONTEND_URL, then explicitly set OPS_EMAIL_JOBS_ENABLED=true to permit scheduled email. The default is false, so a local watcher cannot silently mail real staff. This gate does not prevent an authorized CEO from explicitly sending a preview to their own inbox. Production startup requires strong JWT secrets and a valid HTTPS frontend origin, and requires complete SMTP configuration when scheduled delivery is enabled. /api/v1/ops/health verifies database availability and initialization; npm run ops:check performs broader deployment checks without sending messages. See [deployment instructions](../../deploy/ops/README.md).

Run test/ops-weekly.verify.ts against the separate _verify database and test/ops-browser-server.ts with OPS_WEEKLY_TEST_EMAIL=1. This starts local-only SMTP fixtures and a fixed reporting clock, never real delivery. The API verifier checks both schedules, authorization, draft privacy, task snapshots after reassignment, correction history, duplicate suppression and unconfirmed-send recovery. Connected browser tests cover the forms, CEO review, both emails and sign-in redirects from actual preview links.

## Production module adapters

The additive 20261111150000_ops_module_grants migration adds ops_module_grants only. The 20261111170000_ops_ledger_module migration expands its module enum to include ledger. Each linked Ops account has independent water/blog/ledger grants of view or manage; an absent row means no access. CEO accounts administer grants through PUT /api/v1/ops/accounts/:id/modules with If-Match and body {"module":"ledger","access":"view"}; access also accepts none or manage. CEOs have full Water, Blog, Tender and Inventory access. Payment Ledger retains its explicit grant requirement. Grants are audited and returned in account metadata. Every module request reloads the session and grants, including media streams, source downloads and Ledger exports.

New guarded controllers live in src/ops/modules and delegate to the existing Water and Blog services. Provider composition does not mount legacy controllers in the dedicated Ops app. The linked User.id is used for authorship, uploadedBy, reading confirmation signatures and import ownership. Legacy roles and capabilities are not modified. Read-only users cannot create, edit, delete, upload, publish or generate shared insights; personal assistant conversations remain available.

Ops Water assistant contexts are restricted to water and water-report:YYYY-MM. Its data adapter denies other models and documents and limits Expense queries to Water categories in KES. It retains existing Water calculations and reporting semantics. ScheduleModule is enabled in the dedicated Ops application for Water imports and cleanup; existing database claims and leases coordinate workers. It does not import legacy report/email schedule providers.

Use the same database, working directory and storage configuration for the main and Ops API processes. Existing Blog/Water tables, media keys and public Blog endpoints remain unchanged. Keep the main API serving /api/v1/public/blog for the production website while retiring the old frontend.

Ledger is served at /api/v1/ops/payment-ledger. View permits access status, transaction lists, totals, details, CSV export and synchronization status. Manage additionally permits manual synchronization, meter/system lookup, allocation, retry, system registration/editing and credential rotation. Grant administration uses Ops Admin; the legacy /access/people endpoints are not mounted in the Ops adapter. Legacy CEO/system_admin defaults and ResourceAccessGrant records do not grant Ops access.

OpsLedgerAccessService supplies the Ops-specific authorization policy to the existing PaymentLedgerService. The linked User.id is sent as the gateway actor and used in audit logs. The provider-only PaymentLedgerInfrastructureModule exports the gateway and sync services to both modules, registering one sync worker in a unified backend. The dedicated Ops process runs its worker with the same existing database lease as the main API. Existing Ledger tables, snapshots, synchronization protocol, callback URLs and payment processing services remain unchanged. Keep bridge secrets in backend configuration only.

Verify against a separate local database whose name ends in _verify. Apply migrations there, then run test/ops-browser-server.ts and test/ops-modules.verify.ts with OPS_TEST_DATABASE_URL set. The test server disables SMTP, S3 and external AI providers. It exposes legacy guarded controllers only for parity assertions. Run it separately from the production entry points. Browser tests use the same isolated setup via the frontend test:e2e:api script.

For Ledger verification, start the test server with OPS_LEDGER_TEST_GATEWAY=1 and run test/ops-ledger.verify.ts against it using the same OPS_TEST_DATABASE_URL. This flag starts a local mock gateway on port 4003 and seeds only the isolated verification database. Without the flag, the test server disables payment gateway access. Connected browser tests enable the mock automatically. Do not run these verification tools against the development or production application database.
