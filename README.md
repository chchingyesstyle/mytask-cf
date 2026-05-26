# MyTask-CF

MyTask-CF is the Cloudflare serverless version of MyTask, a personal AI task manager for tracking tasks, projects, statuses, tags, text knowledge-base notes, and AI-assisted task work.

Production URL:

```text
https://cchk.uk
```

## What This Repo Contains

This repository is Cloudflare-only. The old Python/FastAPI/Docker implementation was removed so the repo is easier to review and maintain.

```text
cloudflare/        Cloudflare Worker API, Wrangler config, D1 migrations
static/            Vanilla HTML/CSS/JS frontend served by Cloudflare Assets
docs/superpowers/  Migration planning/spec notes
PRODUCT.md         Product/design notes
AGENTS.md          Instructions for coding agents working in this repo
```

## Stack

- Cloudflare Workers
- Hono
- TypeScript
- Cloudflare D1
- Cloudflare Assets
- Vanilla HTML/CSS/JS frontend
- OpenAI-compatible AI endpoint

## Features

- Username/password login with JWT
- Admin user seeded from `ADMIN_PASSWORD`
- Tasks and subtasks
- Projects and project-specific statuses
- Tags
- Dashboard summary
- Text/Markdown knowledge base
- AI chat
- Task AI actions

## Current AI Provider

The deployed app currently uses NVIDIA NIM through an OpenAI-compatible API:

```text
OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1
OPENAI_MODEL=meta/llama-3.1-8b-instruct
```

Secrets are stored in Cloudflare Worker secrets, not in git.

## Knowledge Base Storage

This version intentionally does not use Cloudflare R2 to avoid usage-based object-storage billing.

KB support is text-only:

- `.txt`
- `.md`
- 1 MB max per document
- stored directly in D1 as extracted text

PDF, DOCX, image upload, and OCR can be added later if R2 or another storage/extraction service is enabled.

## Cloudflare Resources

Production uses:

```text
Worker: mytask-cf
Route: cchk.uk/*
D1 database: mytask_cf
workers.dev: disabled
R2: not used
```

`workers.dev` is disabled intentionally because the production route is `cchk.uk/*` and the account has not completed workers.dev subdomain onboarding.

## Local Development

Install dependencies:

```bash
cd cloudflare
npm install
```

Create local secrets in `cloudflare/.dev.vars`:

```env
JWT_SECRET_KEY=local-dev-secret
ADMIN_PASSWORD=local-admin-password
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1
```

Run locally:

```bash
npm run db:migrate:local
npm run dev
```

Open the local Wrangler URL and log in as:

```text
username: admin
password: value of ADMIN_PASSWORD
```

If `ADMIN_PASSWORD` is missing, the Worker will not seed the `admin` user.

## Deploy

From `cloudflare/`:

```bash
npm run typecheck
npm run db:migrate
npm run deploy
```

Set production secrets with Wrangler when needed:

```bash
npx wrangler secret put JWT_SECRET_KEY
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_BASE_URL
```

## Verification

Basic production checks:

```bash
curl -A 'Mozilla/5.0' https://cchk.uk/api/info
```

Expected response includes the deployed model name:

```json
{"model":"meta/llama-3.1-8b-instruct"}
```

Manual smoke checks:

- open `https://cchk.uk`
- log in as `admin`
- create a task
- create a project
- create a tag
- create a `.txt` or `.md` KB document
- verify dashboard updates
- test AI chat
- test a task AI action

## Notes

Some non-browser command-line clients may be blocked by Cloudflare security rules unless they use a browser-like user agent. Normal browser access should work.
