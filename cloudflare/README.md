# MyTask Cloudflare

Cloudflare Workers/D1/R2 deployment target for MyTask.

## Setup

```bash
npm install
npx wrangler login
npx wrangler d1 create mytask_cf
npx wrangler r2 bucket create mytask-cf-uploads
```

Copy the returned D1 `database_id` into `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

Set secrets:

```bash
npx wrangler secret put JWT_SECRET_KEY
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_BASE_URL
```

Apply schema and deploy:

```bash
npm run db:migrate
npm run deploy
```

## Local Development

```bash
npm install
npm run db:migrate:local
npm run dev
```

Open the local Wrangler URL and log in as `admin` with `ADMIN_PASSWORD`.
