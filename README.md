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
