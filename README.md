# AIMS Backend

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

- `Main` means the meter is on the main line, so it gets no zone.
- **Zone 3 sits inside Zone 2.** Every Zone 3 meter is also under Zone 2, while some meters are under
  Zone 2 only. The import keeps Zone 3 meters in Zone 3 and places Zone 3 inside Zone 2, so Zone 2's
  figures cover both and reports show `Zone 2`, `Zone 2 only` and `Zone 3` on separate rows.
- The layout is set by `SUB_ZONES` at the top of `prisma/import-meter-register.ts`. Use
  `--inside "<zone>=<zone it is inside>"` for a one-off, or add the pair there to keep it.

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
