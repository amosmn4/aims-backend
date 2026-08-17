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
npm run seed:water    # Water Project meters/customers import from meters csv.csv
```

Both are safe to re-run — everything is upserted or deduped, so running them again (e.g. after `meters csv.csv` gets new rows appended) only creates what's actually new.

`seed:water` reads `backend/meters csv.csv`, which is gitignored (real customer data — never committed). `git pull` will never bring it in, so copy it to the server yourself before running the seed, e.g. from your machine:

```bash
scp "meters csv.csv" bitnami@<server>:/opt/bitnami/projects/aims-backend/
```

To use a different location/filename instead, set `WATER_CSV_PATH`:

```bash
WATER_CSV_PATH=/path/to/meters.csv npm run seed:water
```
