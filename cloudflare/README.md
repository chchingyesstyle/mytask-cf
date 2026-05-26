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

## Local Secrets

For local development, create `cloudflare/.dev.vars` with:

```env
JWT_SECRET_KEY=local-dev-secret
ADMIN_PASSWORD=choose-a-local-admin-password
OPENAI_API_KEY=optional-for-local-ai
OPENAI_BASE_URL=optional-openai-compatible-base-url
```

If `ADMIN_PASSWORD` is missing, the Worker will not seed the `admin` user.

## Verification

Completed locally during implementation:

```bash
npm run typecheck
npm run db:migrate:local
npm run dev -- --ip 127.0.0.1 --port 8787
curl -s http://127.0.0.1:8787/api/info
```

Observed `/api/info` response:

```json
{"model":"gpt-4o"}
```

## Production Handoff

Before deploying, run:

```bash
npx wrangler login
npx wrangler d1 create mytask_cf
npx wrangler r2 bucket create mytask-cf-uploads
npx wrangler secret put JWT_SECRET_KEY
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_BASE_URL
npm run db:migrate
npm run deploy
```

After `npx wrangler d1 create mytask_cf`, copy the returned `database_id` into `wrangler.toml`.

Production smoke checks:

- open `https://cf.cchk.uk`
- log in as `admin`
- create one task, project, tag, and text KB doc
- verify dashboard updates
- verify AI chat and task AI action behavior
