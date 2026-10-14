# AIMS Backend

## Household usage and prepaid reconciliation

Household readings capture two separate values at one timestamp: `value` is prepaid units
remaining, and `cumulativeUsage` is the lifetime usage counter. Counter movement measures
consumption; opening prepaid balance plus purchases minus closing balance cross-checks it.
For example, 519 to 525 measures 6 m³ used, while a balance of 10 falling to 4 confirms 6 m³.

Apply `20261013160000_water_cumulative_usage` and regenerate Prisma before deploying this
release. The migration adds a nullable column only. Existing balances are preserved and older
captures have no invented counter value. Add historical counter readings only when they are known.

`GET /water/household-reconciliation?month=YYYY-MM` returns counter usage, usage from credit,
opening and closing balances, purchases for the matched meters, differences and reading coverage.
It follows the existing Water role permissions. Readings also feed the overview, zone loss
assessment, monthly reports, downloads and subscribed CEO monthly emails.

Monthly reading and purchase windows use Nairobi time. Date-only expense dates remain calendar
dates. Periods crossing a month boundary are allocated by elapsed time and marked as estimates.
Purchases outside the captured intervals remain purchase-based estimates rather than measured
usage. Partial coverage is provisional; a single capture cannot establish consumption. Counter
decreases and mismatches with prepaid credit are flagged for checking. Meter replacement keeps
the old meter's ending counter and the new meter's starting counter separate.

## Water operating expenses

Water expenses use the existing Finance expense records with an optional `waterCategory`.
Apply the additive `20261013120000_water_expenses` migration and regenerate Prisma before
deploying this release. No existing expenses are automatically classified as Water costs.

The `/water/expenses` API supports monthly paginated lists, creation, editing and marking bills
paid. `/water/expenses/summary?month=YYYY-MM` returns collections, recorded costs, paid costs,
unpaid bills and category totals. Access follows the Water role, CEO and administrator rules;
View As remains read-only. Water records are in KES and cannot be switched to another currency
through Finance.

Recorded costs use the expense date; payments use the payment date, including older bills.
Unpaid amounts are bills recorded in the selected month that are currently unpaid. Collections
less paid expenses is a cash movement figure before opening balances and unrecorded costs.
The overview, monthly Water reports, PDF/Word exports and subscribed CEO monthly emails use
these totals. Costs belong to the whole Water project and are not allocated to individual zones.

## Shared department reports and CEO dashboard figures

Department monthly reports are shared drafts for authorised report writers. Starting an existing
period opens the same report; editing, refresh and submission follow department write permission
and retain optimistic version checks. CEO feedback reaches active authorised teammates, including
staff with explicit write grants. Read-only users cannot see another person's draft. Personal
reports retain their existing privacy rules; Water report behaviour is preserved.

Department report attachments inherit the report audience, including legacy files with private
grants. Submitted and approved report attachments cannot be modified. No schema migration or data
backfill is needed for these rules.

GET /api/v1/executive-overview adds chart counts for project status, open work by team and monthly
report coverage. Completed projects use recorded completion timestamps in the reporting month,
with Nairobi calendar boundaries. Overdue tasks exclude completed tasks and closed projects.
The overview keeps bounded review, risk and update previews and excludes Water from work figures.

## Shared company projects

Any active staff member can create a company project and add colleagues from any department.
Every team member can manage the project, tasks, team, updates and files, including historical
members recorded as viewers. The creator has the same access as everyone else. At least one
team member must remain; removing someone also removes their access to project work and files.
The CEO and system administrators retain company oversight.

A company project has one shared report per reporting period. All team members can open the
draft, edit it and send it directly to the CEO. Saving requires `expectedUpdatedAt`; a competing
edit returns HTTP 409. Existing legacy shared reports follow CEO review when next submitted.
Project, task and report files inherit the project team audience; individual file sharing cannot
restrict the team or grant outsiders access. Company work stays out of individual reports.
These changes use the existing schema and require no additional migration.

## Tender workflow, CEO overview and access checks

The Tender home uses `GET /api/v1/tenders/work-queue` for bounded daily work lists.
The default CEO dashboard uses `GET /api/v1/executive-overview` for aggregate counts,
review decisions, department reporting coverage and recent work updates.
Both endpoints enforce the signed-in user's server-side access.

Run regression tests with `npm test -- --runInBand`. Use Node.js 20 or newer.
See [the implementation and security review](docs/tender-ceo-review.md) for workflow,
sharing rules, dependency findings and remaining rollout checks.

## Work updates and completion dates

HR delivers services to clients. Work updates stay on the relevant client or company project;
department reports include dated updates from projects visible to the department. Personal reports
include the author's own updates from department-visible projects. Restricted and company project
updates remain in their project reports, whose audience follows the project's access.

Apply the `20261008120000_work_completion_dates` migration before deploying the updated API,
then regenerate Prisma using the deployment steps below. It adds nullable completion timestamps
to tasks and milestones without changing existing records. Later edits preserve these timestamps;
reopening work clears them and completing it again records a new timestamp.
Report date ranges include the whole final calendar day.

Older completed tasks and milestones have no reliable completion date and are excluded from
period-specific completion lists. They still count towards overall progress and appear in
whole-project completion reports. No historical dates are inferred from the last edit time.

Recruitment application figures are labelled as totals recorded to date. Existing funnel data
cannot establish how many applications arrived in a particular month.

## Before the reports migration (one time)

The migration that turns `department_reports` into `reports` is the only one that
renames a table holding live data. Run this first — it only reads:

```bash
node scripts/check-reports-migration.cjs
```

It stops you if two reports exist for the same department and period, which the new
rule forbids. Run it again after deploying to confirm every row came through.

To prove the migration itself on a throwaway copy of the old shape — it builds a
scratch database, runs the migration against it, checks the result and drops it:

```bash
node scripts/dry-run-reports-migration.cjs
```

If a deploy stops part way, the migration is safe to run again. Recover with:

```bash
git pull
npx prisma migrate resolve --rolled-back 20260921090000_reports_generalised
npx prisma migrate deploy
```

## Deploying to production (after `git pull`)

Run these from the `backend/` folder, in order:

```bash
# 1. Install dependencies
npm install

# 2. Apply any new database migrations
npx prisma migrate deploy

# 3. Regenerate the Prisma client
npx prisma generate

# 4. Build
npm run build

# 5. Restart the app with PM2
pm2 restart aims-backend
```

**First-time setup only** — if the app isn't running under PM2 yet:

```bash
pm2 start dist/main.js --name aims-backend
pm2 save
```

**Useful PM2 commands:**

```bash
pm2 logs aims-backend      # tail logs
pm2 status                 # check it's online
pm2 restart aims-backend   # restart after a deploy
```

Make sure `backend/.env` is present and populated on the server before starting the app — it is not committed to git.

## Seeding (manual — never runs automatically)

`prisma migrate deploy` never seeds data. Seeding is a separate, one-off step you run yourself:

```bash
npm run prisma:seed   # departments, service lines, office, bootstrap System Admin
npm run water:seed    # Water Project payments: Amsol meters CSV + mPaya payments export
```

### Water seed files

The water files hold real customer names and payments, so they are git-ignored. Copy them to the
server by hand into `backend/prisma/seed-data/water/`:

- `meters csv.csv` — Amsol payments (Meter, Customer, Amount, Units, Created At)
- `payments_*.xlsx` — mPaya payments export (Date, Customer, Meter, Amount, Units, TOTAL row); the newest one is used
- `accounts_*.xlsx` — optional mPaya account list, only used with `--accounts`

### Replacing the water data

```bash
npm run water:clear-seed            # shows what would be removed; changes nothing
npm run water:clear-seed -- --yes   # removes seeded/uploaded payments and the meters/customers they created
npm run water:seed -- --dry-run     # shows what the new files would add
npm run water:seed                  # loads the new files (safe to re-run; duplicates are skipped)
npm run water:seed -- --accounts    # also registers mPaya accounts that have no payments yet
```

### Meter register

`Meter_Register.xlsx` (Meter Number, Customer, Plot No, Zone, Status, Notes) matches each meter to
its customer, plot and zone, and takes the meters marked "Not in use" out of use. It is git-ignored;
copy it into `backend/` by hand. Payments and readings are never changed.

```bash
npm run water:import-register -- --dry-run   # shows what would change; changes nothing
npm run water:import-register                # applies it (safe to re-run)
npm run water:import-register -- --file "C:\path\to\Other_Register.xlsx"   # use another register file
npm run water:import-register -- --inside "5=1"   # also put Zone 5 inside Zone 1
```

Run the dry run first and read the `CHECK` lists it prints (meters taken out of use that are still
buying water, unclear zones, notes written on the register) before applying.

**Zones.** The register's Zone column is `1`, `2`, `3` or `Main`:

```
Main Zone            the whole estate: every meter is under it
├─ (main line)       meters in no inner zone = "Main Zone only"
├─ Zone 1
└─ Zone 2            Zone 2 and everything inside it
   ├─ (Zone 2 only)  Zone 2 minus Zone 3
   └─ Zone 3
```

- **Main Zone is the whole estate.** When there is exactly one top-level zone, every meter counts
  under it. The import creates `Main Zone` if it is missing.
- **`Main` in the register** means the meter is on the main line: under the main meter and in none
  of Zones 1, 2 or 3. The import places it in `Main Zone` itself, and the app shows these as
  `Main Zone only`.
- **A blank zone in the register** means the meter is no longer in use. It is taken out of use and
  given no zone. These meters show on their own line, `No zone recorded`, and are never counted as
  in use. If any of them still buys water, the report says so. No out-of-use date is invented.
- **Zone 3 sits inside Zone 2.** Every Zone 3 meter is also under Zone 2, while some meters are under
  Zone 2 only. Zone 2 (whole) = Zone 2 only + Zone 3.
- A zone with zones inside it is always shown twice: the whole zone, then the zone only. The zone
  only is the whole zone less the zones inside it, for meters, water and loss alike.
- The layout is set by `SUB_ZONES` at the top of `prisma/import-meter-register.ts`. Use
  `--inside "<zone>=<zone it is inside>"` for a one-off, or add the pair there to keep it.

**The meters, in the order water reaches them:**

| Meter                      | Type in the app            | What it measures                                     |
| -------------------------- | -------------------------- | ---------------------------------------------------- |
| Borehole meter             | Main (the only main meter) | Water pumped into the tanks.                         |
| Main Zone bulk meter       | Bulk, zone = Main Zone     | Everything leaving the tanks into the estate.        |
| Zone 1, Zone 2 bulk meters | Bulk                       | Everything entering that zone, inner zones included. |
| Zone 3 bulk meter          | Bulk, inside Zone 2        | Everything entering Zone 3.                          |
| Household meters           | Household                  | One plot each.                                       |

- Borehole − Main Zone bulk meter = water still in the tanks (stock, not loss).
- Main Zone bulk meter − (Zone 1 + Zone 2 bulk meters) = water for the main line, compared with the
  household meters in no inner zone. Zone 3 is not subtracted again: it is already inside Zone 2.
- Zone 2 bulk meter − Zone 3 bulk meter = water for Zone 2 only, compared with Zone 2's own meters.
- Every table and chart keeps both sides on the same set: whole zone against all household meters
  under it, or zone only against its own household meters. The two are never mixed.
- Household meter counts and household averages use household meters only. Bulk and main meters
  are listed separately and never added into a zone's or the estate's meter count.

**How loss is worked out** (the same rule for the estate and for every zone):

- A meter's figure is how far its dial moved between two readings. With fewer than two readings the
  app shows "Not read", never zero.
- Readings rarely fall on the 1st, so a gap between two readings that crosses a month end is split
  by its days. Months then add up to the dial's total, and a reading taken on the 1st never hands
  last month's water to this month (`src/water/meter-flow.ts`).
- Households are counted over the same dates the bulk or main meter was read, so both sides cover
  the same days. A meter read on the 10th and 20th is compared with households on the 10th to 20th.
- Zone only = its bulk meter − the bulk meters of the zones inside it − its own households.
- Household figures are water paid for until household balances are read. Water is paid for before
  it is used, so when households bought more than the meter passed the app says "bought ahead", not
  a negative loss. One month on paid-for water is provisional.

**When a gap is called a loss** (`src/water/loss-assessment.ts`). Purchases are not use, so a gap
between a meter and its households is weighed before it is named:

| What the app says    | When                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Within the limit     | The gap is 8% or less. The 8% allows for water sitting in the short pipe runs and for dials that round. |
| May be unused credit | The gap is over 8%, but typical use plus credit left from earlier purchases could cover it.             |
| Likely loss          | Even with typical use and leftover credit allowed for, more than 8% is unexplained.                     |
| Bought ahead         | Households bought more than the meter passed: credit on their meters, not a loss.                       |
| Check the readings   | Balances were read and show more used than the meter passed.                                            |
| Not read             | The meter has fewer than two readings.                                                                  |

- **Typical use** is predicted from each zone's own purchases: the daily average over the 90 days
  before the period, times the days in the period.
- **Leftover credit** is what was bought in the 30 days before the period beyond that typical use.
- Once household balances are read, actual use replaces both estimates and the verdict is firm.
- A meter that **rises sharply** (30% or more per day against the period before) is called out with
  whether household purchases rose with it, e.g. "Zone 2 only rose from 500 m³ to 900 m³, while its
  households paid for 272 m³ against 368 m³ before".

```bash
npx jest --preset ts-jest src/water   # tests for the dial, balance and loss rules
```

- Meters count for a month if they were in use at any time in it, whatever their status today.
- Water pumped into the tank but not yet sent out is stock in the tank, not loss.

**Customers.** Meter numbers are unique. Customer names are not: two people can share a name, so
each meter gets its own customer unless the name and plot both match.

**Meters not in use.** They are taken out of use, never deleted; their payments and readings stay
in reports. If one turns out to be in use, edit the meter in the app and switch it back to Active.

On the server, after copying the register into `backend/`:

```bash
cd backend
npx prisma migrate deploy                    # only if the code was just updated
npm run water:import-register -- --dry-run
npm run water:import-register
```

If a command stops with `Property 'waterAiInsight' does not exist on type 'PrismaClient'` (or a
similar unknown-table error), this server's Prisma client is older than the schema. Run steps 2
and 3 of the deploy above first:

```bash
npx prisma migrate deploy
npx prisma generate
```

Both commands print the database host and name first — check it before using `--yes`. The clear
keeps zones, main and bulk meters, dial readings, hand-entered payments, AI chat history, and any
household meter staff have put in a zone or given readings. Mpaya dates are read as Nairobi time.

## Alerts by email, SMS and WhatsApp

Each person chooses, per type of alert, whether it also reaches them by email, SMS or WhatsApp
(**My notifications**). A channel stays switched off for everyone until its keys are set in
`backend/.env`; nothing breaks when they're missing, the alert just stays in AIMS.

### SMS — Africa's Talking

1. Create an account at [africastalking.com](https://africastalking.com) and add an app.
2. Copy the app's **username** and an **API key** (Settings → API Key).
3. Ask Africa's Talking to approve a **sender ID** (e.g. `AMSOL`) or use a short code. Without one,
   messages come from their shared number.
4. Put them in `backend/.env` and restart the app:

```bash
AT_USERNAME="your-app-username"   # "sandbox" for the test environment
AT_API_KEY="..."
AT_SENDER_ID="AMSOL"              # optional
```

5. In AIMS, add a phone number in **My profile**, switch on SMS for an alert type in
   **My notifications**, then click **Send me a test SMS**.

Numbers can be written `0712 345 678`, `712345678`, `254712345678` or `+254712345678`; other
countries need their own `+` code. Each alert is trimmed to one 160-character SMS, so one alert
costs one message. Africa's Talking reports delivery per number, and a refusal (bad number, no
credit, unapproved sender ID) is written to the server log and shown when you send a test.

With `AT_USERNAME="sandbox"`, messages go to Africa's Talking's simulator instead of real phones.

### WhatsApp — Cloud API

Set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`. Messages AIMS starts need an approved
template with one body variable; name it in `WHATSAPP_TEMPLATE_NAME` (and
`WHATSAPP_TEMPLATE_LANGUAGE`, default `en`).

### Email

Set the `SMTP_*` values. Email also carries invitations, password resets and the daily digest, so
set these first: without them, a person who forgets their password can't reset it themselves.
