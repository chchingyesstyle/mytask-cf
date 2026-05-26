# MyTask Cloudflare Migration Design

## Goal

Move MyTask to a Cloudflare serverless deployment at `cf.cchk.uk` while keeping the current FastAPI/Docker app intact during development.

The first Cloudflare version should attempt the full app surface:

- current username/password login
- tasks, subtasks, projects, statuses, tags
- dashboard
- admin user management
- KB upload/download
- AI chat and task AI actions using the existing OpenAI-compatible provider

The first deployment starts with a clean D1 database. Existing SQLite data migration is out of scope for this first release.

## Selected Approach

Use a parallel Cloudflare rewrite under `cloudflare/`.

The existing Python app remains untouched and can continue running until the Cloudflare version is verified. The Cloudflare app will serve the same frontend and expose the same `/api/...` route shape so `static/app.js` and `static/admin.js` need minimal changes.

## Cloudflare Architecture

- Cloudflare Worker `mytask-cf` handles API routes and serves static assets.
- Cloudflare D1 database `mytask_cf` replaces the local SQLite file.
- Cloudflare R2 bucket `mytask-cf-uploads` replaces `./data/uploads`.
- Custom domain `cf.cchk.uk` points to the Worker.
- Secrets are configured through Wrangler, not committed:
  - `JWT_SECRET_KEY`
  - `ADMIN_PASSWORD`
  - `OPENAI_API_KEY`
  - `OPENAI_BASE_URL`

## Worker Code Layout

The Cloudflare target should use TypeScript and Hono:

- `cloudflare/src/index.ts`: Worker bootstrap, middleware, static fallback, route registration.
- `cloudflare/src/auth.ts`: password hashing, JWT signing/verification, current-user lookup, admin guard.
- `cloudflare/src/db.ts`: D1 query helpers, response mapping, transaction helpers where needed.
- `cloudflare/src/routes/auth.ts`: login, current user, password change.
- `cloudflare/src/routes/tasks.ts`: CRUD, subtasks, tag assignment, AI actions.
- `cloudflare/src/routes/projects.ts`: project CRUD.
- `cloudflare/src/routes/statuses.ts`: status CRUD and reorder.
- `cloudflare/src/routes/tags.ts`: tag CRUD.
- `cloudflare/src/routes/users.ts`: admin user management.
- `cloudflare/src/routes/dashboard.ts`: summary counts, projects, recent activity, AI briefing.
- `cloudflare/src/routes/kb.ts`: R2 upload/download/list/delete.
- `cloudflare/src/routes/chat.ts`: streaming AI chat.
- `cloudflare/src/ai.ts`: OpenAI-compatible chat calls and tool execution.

## Data Model

D1 mirrors the current SQLite tables:

- `users`
- `projects`
- `tags`
- `statuses`
- `tasks`
- `task_tags`
- `kb_documents`

The schema keeps existing field names where possible so frontend response mapping stays close to the FastAPI version.

On first use or deployment setup:

- default statuses are created: `Todo`, `In Progress`, `Done`
- admin user `admin` is seeded using `ADMIN_PASSWORD`

## Authentication

The Cloudflare version keeps the current app login model:

- login screen remains in the existing frontend
- `/api/auth/login` returns a bearer JWT
- `/api/auth/me` returns the current user
- `/api/auth/password` allows password changes
- admin-only routes check `role === "admin"`

The Worker signs JWTs with `JWT_SECRET_KEY`. Password hashes should use a Worker-compatible bcrypt implementation unless replaced by a stronger WebCrypto-based scheme with a compatibility migration.

## API Compatibility

The Worker should preserve the frontend contract for:

- `/api/info`
- `/api/auth/*`
- `/api/tasks`
- `/api/tasks/{id}`
- `/api/tasks/{id}/tags/{tag_id}`
- `/api/tasks/{id}/ai-action`
- `/api/projects`
- `/api/projects/{id}`
- `/api/statuses`
- `/api/statuses/{id}`
- `/api/statuses/reorder`
- `/api/tags`
- `/api/tags/{id}`
- `/api/dashboard`
- `/api/chat`
- `/api/kb`
- `/api/kb/{id}`
- `/api/kb/{id}/download`
- `/api/users`
- `/api/users/{id}`

Responses should match the current FastAPI shapes closely enough that the frontend does not need a rewrite.

## KB Uploads

R2 stores uploaded files. `kb_documents.filename` stores the R2 object key.

Allowed file types remain:

- `pdf`
- `docx`
- `txt`
- `md`
- `jpg`
- `jpeg`
- `png`

Initial text extraction behavior:

- `.txt` and `.md`: extract text inside the Worker and store it in `extracted_text`
- PDF, DOCX, and image files: store and download successfully, but leave `extracted_text` empty

AI context includes only documents with `extracted_text`.

## AI Behavior

The Cloudflare Worker calls the existing OpenAI-compatible API endpoint using `fetch`.

The first implementation should preserve:

- `/api/chat` streaming responses where practical
- task-aware system prompt
- global KB context from extracted text documents
- tool-style operations for creating and updating tasks where practical
- task AI actions: meeting prep, draft email, summarize docs, action items, custom

If exact Python agent parity is too large for the first implementation, the Worker should still return useful AI responses and keep CRUD APIs stable. Any reduced AI behavior must be explicit in implementation notes.

## Dashboard

The dashboard route computes:

- overdue count and task list
- due today count and task list
- due this week
- coming up in 8-30 days
- project progress
- completed tasks over the last 7 days
- recent activity
- optional AI briefing using the existing OpenAI-compatible provider

If the AI briefing call fails, the route should still return dashboard data with `ai_briefing: null`.

## Deployment

Wrangler is used for deployment:

1. install Cloudflare dependencies in `cloudflare/`
2. create D1 database `mytask_cf`
3. create R2 bucket `mytask-cf-uploads`
4. replace D1 `database_id` in `wrangler.toml`
5. set secrets with `wrangler secret put`
6. apply D1 migrations
7. deploy Worker
8. configure `cf.cchk.uk`

The old server can be shut down only after the Cloudflare version is verified.

## Testing And Verification

The Cloudflare target should include focused tests or documented verification for:

- admin seed and login
- authenticated and unauthenticated route behavior
- task CRUD
- subtasks
- tag assignment
- project/status behavior
- dashboard calculations
- KB upload/download for text files
- AI endpoint failure handling

Local verification should use Wrangler local dev and D1 local migrations where possible.

## Out Of Scope For First Release

- Migrating existing SQLite data to D1
- Full PDF/DOCX text extraction
- Image OCR
- Replacing app login with Cloudflare Access
- Removing the FastAPI app from the repo
- Deleting the current Docker/Nginx deployment files
