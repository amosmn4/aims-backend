# AIMS Backend

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
