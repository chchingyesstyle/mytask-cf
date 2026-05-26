# Cloudflare Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parallel Cloudflare Workers/D1/R2 version of MyTask at `cf.cchk.uk` while keeping the current FastAPI app intact.

**Architecture:** Add a new `cloudflare/` TypeScript Worker target using Hono. The Worker serves the existing static frontend, implements the current `/api/...` contract, stores relational data in D1, stores KB files in R2, and calls the existing OpenAI-compatible endpoint for AI features.

**Tech Stack:** Cloudflare Workers, Wrangler, TypeScript, Hono, D1, R2, WebCrypto, existing vanilla JS frontend, OpenAI-compatible HTTP API.

---

## File Structure

- `cloudflare/package.json`: npm scripts and Worker dependencies.
- `cloudflare/tsconfig.json`: strict TypeScript config for Workers.
- `cloudflare/wrangler.toml`: Worker, assets, D1, R2, and `cf.cchk.uk` bindings.
- `cloudflare/migrations/0001_initial.sql`: D1 schema matching the current SQLite tables.
- `cloudflare/src/types.ts`: shared environment, row, and request types.
- `cloudflare/src/http.ts`: JSON/error/request helpers.
- `cloudflare/src/auth.ts`: password hashing, JWT signing/verification, auth helpers.
- `cloudflare/src/db.ts`: D1 helpers, seed logic, response mapping.
- `cloudflare/src/ai.ts`: OpenAI-compatible API calls and prompts.
- `cloudflare/src/routes/*.ts`: route modules for auth, tasks, projects, statuses, tags, users, dashboard, KB, and chat.
- `cloudflare/src/index.ts`: Hono app assembly and route registration.
- `cloudflare/README.md`: setup, secrets, migration, deploy, and verification instructions.

## Task 1: Scaffold Worker Project

**Files:**
- Create: `cloudflare/package.json`
- Create: `cloudflare/tsconfig.json`
- Create: `cloudflare/wrangler.toml`
- Create: `cloudflare/README.md`

- [ ] **Step 1: Create `cloudflare/package.json`**

```json
{
  "name": "mytask-cf",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "db:migrate:local": "wrangler d1 migrations apply mytask_cf --local",
    "db:migrate": "wrangler d1 migrations apply mytask_cf --remote"
  },
  "dependencies": {
    "hono": "^4.7.10"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250525.0",
    "typescript": "^5.8.3",
    "wrangler": "^4.17.0"
  }
}
```

- [ ] **Step 2: Create `cloudflare/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types"],
    "skipLibCheck": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `cloudflare/wrangler.toml`**

```toml
name = "mytask-cf"
main = "src/index.ts"
compatibility_date = "2026-05-26"
workers_dev = true

routes = [
  { pattern = "cf.cchk.uk", custom_domain = true }
]

[assets]
directory = "../static"
binding = "ASSETS"
not_found_handling = "single-page-application"

[[d1_databases]]
binding = "DB"
database_name = "mytask_cf"
database_id = "REPLACE_WITH_D1_DATABASE_ID"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "UPLOADS"
bucket_name = "mytask-cf-uploads"

[vars]
OPENAI_MODEL = "gpt-4o"
```

- [ ] **Step 4: Create `cloudflare/README.md`**

Include setup commands:

```bash
npm install
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

Also document that the returned D1 `database_id` must replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.toml`.

- [ ] **Step 5: Verify**

```bash
test -f cloudflare/package.json
test -f cloudflare/tsconfig.json
test -f cloudflare/wrangler.toml
test -f cloudflare/README.md
```

Expected: each command exits `0`.

- [ ] **Step 6: Commit**

```bash
git add cloudflare/package.json cloudflare/tsconfig.json cloudflare/wrangler.toml cloudflare/README.md
git commit -m "feat: add Cloudflare worker scaffold"
```

## Task 2: Add D1 Schema

**Files:**
- Create: `cloudflare/migrations/0001_initial.sql`

- [ ] **Step 1: Create schema migration**

Create `cloudflare/migrations/0001_initial.sql` with tables:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(name, project_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  start_date TEXT,
  due_date TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  notes TEXT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  status_id INTEGER REFERENCES statuses(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS kb_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  extracted_text TEXT,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_owner_parent ON tasks(owner_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_due ON tasks(owner_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_project ON tasks(owner_id, project_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_kb_owner_task ON kb_documents(owner_id, task_id);

INSERT OR IGNORE INTO statuses (id, name, color, position, project_id) VALUES
  (1, 'Todo', '#6b7280', 0, NULL),
  (2, 'In Progress', '#4a90d9', 1, NULL),
  (3, 'Done', '#2ecc71', 2, NULL);
```

- [ ] **Step 2: Verify migration text**

```bash
rg "CREATE TABLE IF NOT EXISTS tasks" cloudflare/migrations/0001_initial.sql
rg "INSERT OR IGNORE INTO statuses" cloudflare/migrations/0001_initial.sql
```

Expected: both commands print matching lines.

- [ ] **Step 3: Commit**

```bash
git add cloudflare/migrations/0001_initial.sql
git commit -m "feat: add D1 schema"
```

## Task 3: Add Shared Worker Helpers

**Files:**
- Create: `cloudflare/src/types.ts`
- Create: `cloudflare/src/http.ts`
- Create: `cloudflare/src/auth.ts`
- Create: `cloudflare/src/db.ts`

- [ ] **Step 1: Add `types.ts`**

Define `Env` with `DB`, `UPLOADS`, `ASSETS`, `JWT_SECRET_KEY`, `ADMIN_PASSWORD`, optional OpenAI values, and row types for `UserRow`, `TaskRow`, `ProjectRow`, `TagRow`, `StatusRow`, and `KBDocumentRow`.

- [ ] **Step 2: Add `http.ts`**

Define:

```ts
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function jsonError(c, error) { /* return { detail } with status */ }
export async function readJson(c) { /* parse JSON or throw ApiError(400) */ }
export function requireNonEmpty(value, field) { /* trim or throw ApiError(400) */ }
export function parseNullableInt(value) { /* null or integer */ }
```

- [ ] **Step 3: Add `auth.ts`**

Implement Worker-compatible:

- `hashPassword(password)` using PBKDF2 via WebCrypto
- `verifyPassword(password, stored)`
- `createToken(env, user)` using HMAC SHA-256 JWT
- `verifyToken(env, token)`
- `bearerToken(header)`

- [ ] **Step 4: Add `db.ts`**

Implement:

- `seedDefaults(env)` to insert default statuses and seed `admin` from `ADMIN_PASSWORD`
- `getUserById(env, id)`
- `getUserByUsername(env, username)`

- [ ] **Step 5: Commit**

```bash
git add cloudflare/src/types.ts cloudflare/src/http.ts cloudflare/src/auth.ts cloudflare/src/db.ts
git commit -m "feat: add Cloudflare shared runtime helpers"
```

## Task 4: Bootstrap App And Auth API

**Files:**
- Create: `cloudflare/src/index.ts`
- Create: `cloudflare/src/routes/auth.ts`

- [ ] **Step 1: Add `routes/auth.ts`**

Implement:

- `POST /api/auth/login`: verify username/password and return `{ access_token, token_type: "bearer" }`
- `GET /api/auth/me`: return `{ id, username, role }`
- `PUT /api/auth/password`: verify current password, require new password length >= 6, update hash

- [ ] **Step 2: Add `index.ts`**

Create Hono app, seed defaults in middleware, export `requireUser(c)` and `requireAdmin(user)`, register:

```ts
app.get('/api/info', (c) => c.json({ model: c.env.OPENAI_MODEL || 'gpt-4o' }));
app.route('/api/auth', authRoutes);
```

- [ ] **Step 3: Typecheck**

```bash
cd cloudflare
npm install
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add cloudflare/package-lock.json cloudflare/src/index.ts cloudflare/src/routes/auth.ts
git commit -m "feat: add Cloudflare auth API"
```

## Task 5: Implement Core Data APIs

**Files:**
- Create: `cloudflare/src/routes/tasks.ts`
- Create: `cloudflare/src/routes/tags.ts`
- Create: `cloudflare/src/routes/projects.ts`
- Create: `cloudflare/src/routes/statuses.ts`
- Modify: `cloudflare/src/index.ts`

- [ ] **Step 1: Implement tasks API**

Implement:

- `GET /api/tasks`
- `POST /api/tasks`
- `PUT /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `POST /api/tasks/:id/tags/:tagId`
- `DELETE /api/tasks/:id/tags/:tagId`

Preserve response fields used by the frontend: `tags`, `subtask_count`, `completed_subtasks`, `project`, `status_name`, and `status_color`.

- [ ] **Step 2: Implement tags API**

Implement:

- `GET /api/tags`
- `POST /api/tags`
- `PUT /api/tags/:id`
- `DELETE /api/tags/:id`

- [ ] **Step 3: Implement projects API**

Implement:

- `GET /api/projects`
- `POST /api/projects`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`

Seed Todo/In Progress/Done statuses for each new project.

- [ ] **Step 4: Implement statuses API**

Implement:

- `GET /api/statuses`
- `POST /api/statuses`
- `PUT /api/statuses/:id`
- `DELETE /api/statuses/:id`
- `POST /api/statuses/reorder`

Support optional `project_id` query and project ownership checks.

- [ ] **Step 5: Register routes in `index.ts`**

```ts
app.route('/api/tasks', taskRoutes);
app.route('/api/tags', tagRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/statuses', statusRoutes);
```

- [ ] **Step 6: Typecheck and commit**

```bash
cd cloudflare
npm run typecheck
git add cloudflare/src/index.ts cloudflare/src/routes/tasks.ts cloudflare/src/routes/tags.ts cloudflare/src/routes/projects.ts cloudflare/src/routes/statuses.ts
git commit -m "feat: add Cloudflare core data APIs"
```

## Task 6: Implement Admin And Dashboard APIs

**Files:**
- Create: `cloudflare/src/routes/users.ts`
- Create: `cloudflare/src/routes/dashboard.ts`
- Modify: `cloudflare/src/index.ts`

- [ ] **Step 1: Implement users API**

Implement admin-only:

- `GET /api/users`
- `POST /api/users`
- `DELETE /api/users/:id`

Never return `password_hash`.

- [ ] **Step 2: Implement dashboard API**

Implement `GET /api/dashboard` returning:

```ts
{
  overdue,
  due_today,
  due_week,
  due_30,
  ai_briefing,
  overdue_tasks,
  today_tasks,
  projects,
  completed_7d,
  recent_activity
}
```

If AI briefing fails, return dashboard data with `ai_briefing: null`.

- [ ] **Step 3: Register routes, typecheck, and commit**

```bash
cd cloudflare
npm run typecheck
git add cloudflare/src/index.ts cloudflare/src/routes/users.ts cloudflare/src/routes/dashboard.ts
git commit -m "feat: add Cloudflare admin and dashboard APIs"
```

## Task 7: Implement R2 Knowledge Base API

**Files:**
- Create: `cloudflare/src/routes/kb.ts`
- Modify: `cloudflare/src/index.ts`

- [ ] **Step 1: Implement KB API**

Implement:

- `POST /api/kb`: multipart upload, 20 MB max, allowed extensions, store object in R2
- `GET /api/kb`: list user's docs, support `?global=true` and `?task_id=N`
- `GET /api/kb/:id/download`: stream object from R2
- `DELETE /api/kb/:id`: delete object and row

Use object keys:

```ts
const key = `${user.id}/${crypto.randomUUID()}.${ext}`;
```

Extract text only for `.txt` and `.md`.

- [ ] **Step 2: Register route, typecheck, and commit**

```bash
cd cloudflare
npm run typecheck
git add cloudflare/src/index.ts cloudflare/src/routes/kb.ts
git commit -m "feat: add Cloudflare KB storage API"
```

## Task 8: Implement AI Chat And Task Actions

**Files:**
- Create: `cloudflare/src/ai.ts`
- Create: `cloudflare/src/routes/chat.ts`
- Modify: `cloudflare/src/routes/tasks.ts`
- Modify: `cloudflare/src/index.ts`

- [ ] **Step 1: Add AI helper**

Implement `openAIChat(env, messages, stream)` to call:

```ts
fetch(`${env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-4o', messages, stream })
});
```

Return a clear `503` JSON response when OpenAI secrets are missing.

- [ ] **Step 2: Implement chat route**

Implement `POST /api/chat`:

- authenticate user
- load user's tasks
- load up to five global KB docs with extracted text
- build task-aware system prompt
- append last ten history messages
- call OpenAI-compatible API with streaming enabled
- return `text/event-stream`

- [ ] **Step 3: Implement task AI actions**

Add `POST /api/tasks/:id/ai-action` supporting:

- `meeting_prep`
- `draft_email`
- `summarise`
- `action_items`
- `custom`

Return `{ result: text }`.

- [ ] **Step 4: Register route, typecheck, and commit**

```bash
cd cloudflare
npm run typecheck
git add cloudflare/src/index.ts cloudflare/src/routes/tasks.ts cloudflare/src/routes/chat.ts cloudflare/src/ai.ts
git commit -m "feat: add Cloudflare AI APIs"
```

## Task 9: Local Verification

**Files:**
- Modify: `cloudflare/README.md`

- [ ] **Step 1: Run local checks**

```bash
cd cloudflare
npm install
npm run typecheck
npm run db:migrate:local
```

Expected: all commands pass.

- [ ] **Step 2: Start local Worker**

```bash
cd cloudflare
npm run dev
```

Expected: Wrangler prints a local URL.

- [ ] **Step 3: Manual smoke test**

Verify in browser:

- login screen loads
- `admin` login works using local `ADMIN_PASSWORD`
- create/update/delete task works
- project/status/tag flows work
- dashboard loads
- `.txt` KB upload/download works
- AI chat/action either returns provider output or a clear configuration error

- [ ] **Step 4: Commit verification notes**

```bash
git add cloudflare/README.md
git commit -m "docs: add Cloudflare verification notes"
```

## Task 10: Deployment Handoff

**Files:**
- Modify: `cloudflare/README.md`

- [ ] **Step 1: Confirm deployment instructions**

Ensure README includes:

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

- [ ] **Step 2: Document production verification**

Add production checks:

- open `https://cf.cchk.uk`
- log in as `admin`
- create one task, project, tag, and text KB doc
- verify dashboard updates
- verify AI route behavior

- [ ] **Step 3: Commit**

```bash
git add cloudflare/README.md
git commit -m "docs: add Cloudflare deployment handoff"
```
