# AIMS payment ledger module

The central reporting ledger is stored in the AIMS MySQL database, in `payment_ledger_entries`. Its screens live at `/payment-ledger` in the AIMS frontend. Water-System retains operational gateway receipts, vending records, intents, and the delivery queue. Its registered validation and confirmation URLs stay unchanged.

The AIMS backend reads ledger lists, filters, totals, transaction details, and exports from its own database. Transaction snapshots retain provider payloads, notifications, destination, intent/order, water tokens, delivery attempts, callback requests/responses, and gateway audit history. Entries remain readable when the gateway is unavailable.

## Legacy access

- CEO and system administrator: default full module access, including individual access administration.
- Other users: no default access, including finance and water roles.
- Individual View grant: lists, details, totals, and CSV export.
- Individual Manage grant: View plus allocation, delivery replay, payment system registration/editing, and credential rotation.
- Only the CEO and system administrator can grant or revoke access. Their own default access cannot be revoked. View-as sessions remain read only.

Use **Payment Ledger > Module access**, search for an active staff member, and select No access, View, or Manage. This reuses AIMS `ResourceAccessGrant` with the `payment-ledger` resource and a fixed module ID. Grant replacement/revocation and gateway actions are audited. The backend checks each request, independently of navigation visibility.

## Deployment

1. Deploy both applications' source changes. Apply Water-System payments migration `0007` after the existing gateway migrations `0005` and `0006`.
2. In the intended AIMS deployment, run `npx prisma migrate deploy` and `npx prisma generate`. The AIMS migration `20261015120000_payment_ledger` only creates the ledger and sync-state tables. It does not change existing transaction data.
3. Set a new shared random secret of at least 32 characters in server configuration:

| Application | Setting | Value |
| --- | --- | --- |
| Water-System backend | `AIMS_LEDGER_BRIDGE_KEY` | Shared secret |
| AIMS backend | `PAYMENT_GATEWAY_BRIDGE_KEY` | Same shared secret |
| AIMS backend | `PAYMENT_GATEWAY_URL` | `https://WATER_API_HOST/api/payment-gateway` |

4. Restart both backends, the AIMS frontend deployment, and Water-System's Celery worker/Beat. AIMS synchronizes every 30 seconds; a module manager can also select Sync now. HTTP localhost connections are allowed only outside production.

No production migration or production data modification is performed by the implementation or its unit tests. Apply migrations to the intended deployment after normal review and backup procedures.

## Synchronization

The Water-System `AimsLedgerChange` queue records changes to receipts, notifications, dispatches/attempts, linked intents, tokens, SMS delivery, and payment audit records. Migration `0007` queues existing receipts for initial import without vending or forwarding them again.

AIMS fetches batches of up to 100 unacknowledged changes through the dedicated bridge. It validates and saves full snapshots in a local database transaction before acknowledging those exact change IDs. Fetching does not remove records. Failed imports remain pending. An acknowledgement timeout can replay a batch safely. IDs are transferred as strings to preserve 64-bit precision.

A database lease serializes AIMS sync batches. The importer verifies ownership of that lease inside the database transaction before saving snapshots. Each pending change fetches the latest gateway snapshot; queue sequence IDs are retained for traceability, not treated as commit ordering. The bridge uses explicit acknowledgement rather than a high-water cursor, so a transaction that commits late cannot be skipped. Queue acknowledgements do not remove history.

The bridge key is separate from product-system API keys and user JWTs. It remains on the servers. Bridge calls require HTTPS in production and do not follow redirects. The AIMS backend supplies the authenticated actor for allocation, replay, registration, editing, and rotation; gateway audit records preserve that identity and action reason. Product systems continue using their scoped gateway APIs, not the bridge.

## APIs

The AIMS base is `/api/v1/payment-ledger`:

| Endpoint | Purpose |
| --- | --- |
| `GET /access` | Current user's resolved module permissions |
| `GET /access/people`, `PUT /access/people/:id` | CEO/admin individual grants; body `{"level":"read"}`, `"write"`, or `"none"` |
| `GET /entries`, `GET /entries/summary` | Paginated ledger and matching totals |
| `GET /entries/export`, `GET /entries/:id` | CSV export and full transaction snapshot |
| `GET /sync`, `POST /sync` | Connection status and manager-triggered synchronization |
| `POST /entries/:id/allocate`, `POST /entries/:id/retry` | Audited gateway actions for module managers |
| `GET /applications`, `POST /applications`, `PATCH /applications/:id` | Payment systems for module managers |
| `POST /applications/:id/rotate-credentials` | Replace credentials, shown once |
| `GET /meters?paybill=...&search=...` | Paybill-scoped meter lookup for allocation |

Ledger filters are `q`, `system`, `paybill`, `destination`, `channel`, `status`, `paymentStatus`, `direction`, `review`, `from`, and `to`; pagination uses `page` and `pageSize`. Dates cover inclusive Nairobi calendar days. Totals keep currencies and incoming/outgoing money separate. Unit grants have no monetary amount and are excluded from cash totals. CSV export uses the same filters and escapes formula-like values.

## Amsol Ops integration

The Ops frontend exposes the existing Ledger at `/payment-ledger` through `/api/v1/ops/payment-ledger`. It retains the same list, totals, export, detail, synchronization and gateway action contracts above, except legacy individual grant endpoints are omitted. Permissions are assigned in Ops Admin using `PUT /api/v1/ops/accounts/:id/modules` with `If-Match` and a `module: "ledger"` grant of `none`, `view` or `manage`.

Every Ops account, including the CEO, starts without Ledger access. Legacy CEO/system administrator defaults and legacy `ResourceAccessGrant` rows do not confer access through Ops. View permits transactions, totals, details, CSV export and sync status. Manage also permits synchronization, allocation, retry and payment system/key administration. The authenticated shared `User.id` remains the gateway actor and audit owner.

Migration `20261111170000_ops_ledger_module` only expands the Ops grant enum; no Ledger transaction or sync state is copied or converted. Both adapters reuse the existing Ledger services and tables. A shared provider module registers one sync worker in a combined application, while the existing database lease coordinates separate API processes. Gateway endpoints, keys, callback destinations, acknowledgements and delivery behavior retain their existing contracts.

`test/ops-ledger.verify.ts` verifies the adapter against an isolated local `_verify` database and mock gateway, including legacy read parity, individual grants, revocation, audited actions, stored reads during gateway failure and worker registration. The frontend `e2e-api/ledger.spec.ts` exercises the connected Ledger screens and forms with that mock. No live gateway action is required for these tests.

## Validation

Run `npm test -- --runInBand src/payment-ledger` and `npm run build` in the AIMS backend. Run `npm run build` and `npx tsc --noEmit` in the AIMS frontend. The unit tests mock database and gateway operations. Water-System bridge tests use its isolated SQLite test settings and mocked vending/SMS providers. Validate MySQL/PostgreSQL locking and end-to-end synchronization in staging before deployment.
