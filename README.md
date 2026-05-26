# MyTask-CF

Cloudflare serverless version of MyTask, deployed at:

```text
https://cf.cchk.uk
```

## Stack

- Cloudflare Workers
- Hono
- TypeScript
- Cloudflare D1
- Cloudflare Assets
- Existing vanilla HTML/CSS/JS frontend in `static/`
- OpenAI-compatible AI endpoint, currently NVIDIA NIM

## Current AI

```text
OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1
OPENAI_MODEL=meta/llama-3.1-8b-instruct
```

Secrets are stored in Cloudflare Worker secrets, not in git.

## Repository Layout

```text
cloudflare/        Worker API, Wrangler config, D1 migrations
static/            Frontend HTML/CSS/JS served by Cloudflare Assets
docs/superpowers/  Planning/spec notes used during the migration
PRODUCT.md         Product/design notes
```

## Knowledge Base

This version does not use R2 to avoid usage-based storage billing. KB support is text-only:

- `.txt`
- `.md`
- 1 MB max per document
- stored directly in D1

PDF, DOCX, and image extraction can be added later if R2 or another storage service is enabled.

## Local Development

```bash
cd cloudflare
npm install
npm run db:migrate:local
npm run dev
```

Create `cloudflare/.dev.vars` for local secrets:

```env
JWT_SECRET_KEY=local-dev-secret
ADMIN_PASSWORD=local-admin-password
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1
```

## Deploy

```bash
cd cloudflare
npm run typecheck
npm run db:migrate
npm run deploy
```

The Worker deploys only to the configured route:

```text
cf.cchk.uk/*
```

`workers.dev` is disabled intentionally.
