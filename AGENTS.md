# Agent Instructions

This repo is the Cloudflare-only MyTask-CF app. Do not reintroduce the old FastAPI, Docker, Nginx, or Python test stack unless the user explicitly asks for a separate legacy branch.

## Project Shape

- Worker/API code lives in `cloudflare/src/`.
- D1 migrations live in `cloudflare/migrations/`.
- Wrangler config lives in `cloudflare/wrangler.toml`.
- Frontend files live in `static/` and are served by Cloudflare Assets.
- Root `README.md` is the public GitHub overview.
- `cloudflare/README.md` is deployment/operator detail.

## Commands

Run these from `cloudflare/`:

```bash
npm run typecheck
npm run db:migrate:local
npm run dev
npm run db:migrate
npm run deploy
```

Use `npm run typecheck` after Worker code changes.

## Deployment Constraints

- Production route is `cchk.uk/*`.
- `workers_dev = false` is intentional.
- D1 database is `mytask_cf`.
- R2 is intentionally not used.
- KB storage is text-only in D1.
- Production AI uses an OpenAI-compatible NVIDIA endpoint.

## Secrets

Never commit secrets. Production secrets are Cloudflare Worker secrets:

- `JWT_SECRET_KEY`
- `ADMIN_PASSWORD`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`

Local development secrets belong in `cloudflare/.dev.vars`, which is ignored.

## Frontend Compatibility

The frontend still references legacy FastAPI asset paths under `/static/*`. The Worker in `cloudflare/src/index.ts` rewrites `/static/*` to Cloudflare Assets root paths. Keep this compatibility unless the frontend HTML is updated at the same time.

The chat frontend expects SSE events shaped like:

```text
data: {"type":"token","content":"..."}
```

Do not pass raw OpenAI-compatible SSE directly to the browser without adapting it.

## Knowledge Base

The KB API accepts only `.txt` and `.md` files up to 1 MB, or JSON text documents. The text is stored in `kb_documents.extracted_text` in D1. Do not add PDF/DOCX/image upload unless storage and extraction design are revisited.

## Git Hygiene

- Keep `cloudflare/node_modules/`, `cloudflare/.wrangler/`, `cloudflare/.dev.vars`, `.env`, and `.impeccable/` out of git.
- Do not commit generated local state.
- Prefer small commits after a passing `npm run typecheck`.
