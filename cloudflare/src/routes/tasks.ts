import { Hono } from 'hono';
import { buildTaskActionPrompt, openAIText } from '../ai';
import { getCurrentUser } from '../auth';
import { ApiError, intParam, jsonError, parseNullableInt, readJson, requireNonEmpty } from '../http';
import type { AppVariables, Env, StatusRow, TagRow, TaskRow, UserRow } from '../types';

export const taskRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function tagsForTask(env: Env, taskId: number): Promise<TagRow[]> {
  const res = await env.DB.prepare('SELECT tags.* FROM tags JOIN task_tags ON tags.id = task_tags.tag_id WHERE task_tags.task_id = ? ORDER BY tags.name')
    .bind(taskId)
    .all<TagRow>();
  return res.results || [];
}

async function subtaskCounts(env: Env, taskId: number): Promise<{ subtask_count: number; completed_subtasks: number }> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN LOWER(COALESCE(statuses.name, tasks.status)) = 'done' THEN 1 ELSE 0 END) AS done FROM tasks LEFT JOIN statuses ON tasks.status_id = statuses.id WHERE tasks.parent_id = ?")
    .bind(taskId)
    .first<{ total: number; done: number | null }>();
  return { subtask_count: row?.total || 0, completed_subtasks: row?.done || 0 };
}

async function childrenForTask(env: Env, taskId: number, ownerId: number): Promise<unknown[]> {
  const res = await env.DB.prepare(taskSelectSql('WHERE tasks.parent_id = ? AND tasks.owner_id = ? ORDER BY tasks.created_at DESC'))
    .bind(taskId, ownerId)
    .all<TaskRow>();
  return Promise.all((res.results || []).map((task) => taskToDict(env, task, false)));
}

function taskSelectSql(where: string): string {
  return `SELECT tasks.*, projects.name AS project_name, statuses.name AS status_name, statuses.color AS status_color
    FROM tasks
    LEFT JOIN projects ON tasks.project_id = projects.id
    LEFT JOIN statuses ON tasks.status_id = statuses.id
    ${where}`;
}

export async function taskToDict(env: Env, task: TaskRow, includeChildren = true) {
  const counts = await subtaskCounts(env, task.id);
  const tags = await tagsForTask(env, task.id);
  return {
    id: task.id,
    title: task.title,
    status_id: task.status_id,
    status_name: task.status_name || 'Todo',
    status_color: task.status_color || '#6b7280',
    status: task.status,
    priority: task.priority,
    start_date: task.start_date,
    due_date: task.due_date,
    project_id: task.project_id,
    project_name: task.project_name || null,
    notes: task.notes,
    owner_id: task.owner_id,
    parent_id: task.parent_id,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at,
    tags,
    subtask_count: counts.subtask_count,
    completed_subtasks: counts.completed_subtasks,
    children: includeChildren && task.parent_id === null ? await childrenForTask(env, task.id, task.owner_id) : [],
  };
}

async function getTask(env: Env, id: number): Promise<TaskRow | null> {
  return env.DB.prepare(taskSelectSql('WHERE tasks.id = ?')).bind(id).first<TaskRow>();
}

function canAccess(task: TaskRow, user: UserRow): boolean {
  return user.role === 'admin' || task.owner_id === user.id;
}

async function firstStatus(env: Env, projectId: number | null): Promise<StatusRow | null> {
  const stmt = projectId === null
    ? env.DB.prepare('SELECT * FROM statuses WHERE project_id IS NULL ORDER BY position LIMIT 1')
    : env.DB.prepare('SELECT * FROM statuses WHERE project_id = ? ORDER BY position LIMIT 1').bind(projectId);
  return stmt.first<StatusRow>();
}

async function isDoneStatus(env: Env, statusId: number | null): Promise<boolean> {
  if (statusId === null) return false;
  const status = await env.DB.prepare('SELECT name FROM statuses WHERE id = ?').bind(statusId).first<{ name: string }>();
  return (status?.name || '').toLowerCase() === 'done';
}

taskRoutes.get('/', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const parentId = parseNullableInt(c.req.query('parent_id'));
    const tagId = parseNullableInt(c.req.query('tag_id'));
    const projectId = parseNullableInt(c.req.query('project_id'));
    const priority = c.req.query('priority');
    let sql = taskSelectSql('');
    const where: string[] = [];
    const params: unknown[] = [];
    if (tagId !== null) sql += ' JOIN task_tags ON tasks.id = task_tags.task_id';
    if (user.role !== 'admin') {
      where.push('tasks.owner_id = ?');
      params.push(user.id);
    }
    if (parentId === null) where.push('tasks.parent_id IS NULL');
    else {
      where.push('tasks.parent_id = ?');
      params.push(parentId);
    }
    if (tagId !== null) {
      where.push('task_tags.tag_id = ?');
      params.push(tagId);
    }
    if (projectId !== null) {
      where.push('tasks.project_id = ?');
      params.push(projectId);
    }
    if (priority) {
      where.push('tasks.priority = ?');
      params.push(priority);
    }
    sql += ` WHERE ${where.join(' AND ')} ORDER BY tasks.created_at DESC`;
    const res = await c.env.DB.prepare(sql).bind(...params).all<TaskRow>();
    return c.json(await Promise.all((res.results || []).map((task) => taskToDict(c.env, task))));
  } catch (error) {
    return jsonError(c, error);
  }
});

taskRoutes.get('/:id', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const id = intParam(c.req.param('id'), 'task id');
    const task = await getTask(c.env, id);
    if (!task) throw new ApiError(404, 'Task not found');
    if (!canAccess(task, user)) throw new ApiError(403, 'Not authorized');
    return c.json(await taskToDict(c.env, task));
  } catch (error) {
    return jsonError(c, error);
  }
});

taskRoutes.post('/', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const body = await readJson<{ title?: string; status_id?: number | null; priority?: string; start_date?: string | null; due_date?: string | null; project_id?: number | null; notes?: string | null; parent_id?: number | null; tag_ids?: number[] }>(c);
    const title = requireNonEmpty(body.title, 'title');
    const projectId = body.project_id ?? null;
    const parentId = body.parent_id ?? null;
    if (parentId !== null) {
      const parent = await getTask(c.env, parentId);
      if (!parent) throw new ApiError(404, 'Parent task not found');
      if (!canAccess(parent, user)) throw new ApiError(403, 'Not authorized to attach to this parent');
    }
    const statusId = body.status_id ?? (await firstStatus(c.env, projectId))?.id ?? null;
    const done = await isDoneStatus(c.env, statusId);
    const result = await c.env.DB.prepare('INSERT INTO tasks (title, status, priority, start_date, due_date, project_id, notes, owner_id, parent_id, status_id, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(title, done ? 'done' : 'todo', body.priority || 'medium', body.start_date ?? null, body.due_date ?? null, projectId, body.notes ?? null, user.id, parentId, statusId, done ? new Date().toISOString() : null)
      .run();
    const taskId = Number(result.meta.last_row_id);
    if (body.tag_ids?.length) {
      await c.env.DB.batch(body.tag_ids.map((tagId) => c.env.DB.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)').bind(taskId, tagId)));
    }
    const task = await getTask(c.env, taskId);
    return c.json(await taskToDict(c.env, task as TaskRow), 201);
  } catch (error) {
    return jsonError(c, error);
  }
});

taskRoutes.put('/:id', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const id = intParam(c.req.param('id'), 'task id');
    const existing = await getTask(c.env, id);
    if (!existing) throw new ApiError(404, 'Task not found');
    if (!canAccess(existing, user)) throw new ApiError(403, 'Not authorized');
    const body = await readJson<Record<string, unknown>>(c);
    const fields = ['title', 'priority', 'start_date', 'due_date', 'project_id', 'notes', 'status_id'];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        sets.push(`${field} = ?`);
        params.push(body[field] ?? null);
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'status_id')) {
      const statusId = typeof body.status_id === 'number' ? body.status_id : null;
      const done = await isDoneStatus(c.env, statusId);
      sets.push('status = ?', 'completed_at = ?');
      params.push(done ? 'done' : 'todo', done ? new Date().toISOString() : null);
    }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      await c.env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
    }
    if (Array.isArray(body.tag_ids)) {
      await c.env.DB.prepare('DELETE FROM task_tags WHERE task_id = ?').bind(id).run();
      const tagIds = body.tag_ids.filter((value): value is number => typeof value === 'number');
      if (tagIds.length) await c.env.DB.batch(tagIds.map((tagId) => c.env.DB.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)').bind(id, tagId)));
    }
    const task = await getTask(c.env, id);
    return c.json(await taskToDict(c.env, task as TaskRow));
  } catch (error) {
    return jsonError(c, error);
  }
});

taskRoutes.delete('/:id', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const id = intParam(c.req.param('id'), 'task id');
    const task = await getTask(c.env, id);
    if (!task) throw new ApiError(404, 'Task not found');
    if (!canAccess(task, user)) throw new ApiError(403, 'Not authorized');
    await c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(c, error);
  }
});

taskRoutes.post('/:id/tags/:tagId', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const taskId = intParam(c.req.param('id'), 'task id');
    const tagId = intParam(c.req.param('tagId'), 'tag id');
    const task = await getTask(c.env, taskId);
    if (!task) throw new ApiError(404, 'Task not found');
    if (!canAccess(task, user)) throw new ApiError(403, 'Not authorized');
    const tag = await c.env.DB.prepare('SELECT id FROM tags WHERE id = ?').bind(tagId).first();
    if (!tag) throw new ApiError(404, 'Tag not found');
    await c.env.DB.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)').bind(taskId, tagId).run();
    return c.json(await taskToDict(c.env, (await getTask(c.env, taskId)) as TaskRow));
  } catch (error) {
    return jsonError(c, error);
  }
});

taskRoutes.delete('/:id/tags/:tagId', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const taskId = intParam(c.req.param('id'), 'task id');
    const tagId = intParam(c.req.param('tagId'), 'tag id');
    const task = await getTask(c.env, taskId);
    if (!task) throw new ApiError(404, 'Task not found');
    if (!canAccess(task, user)) throw new ApiError(403, 'Not authorized');
    await c.env.DB.prepare('DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?').bind(taskId, tagId).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(c, error);
  }
});


taskRoutes.post('/:id/ai-action', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const id = intParam(c.req.param('id'), 'task id');
    const task = await getTask(c.env, id);
    if (!task) throw new ApiError(404, 'Task not found');
    if (!canAccess(task, user)) throw new ApiError(403, 'Not authorized');
    const body = await readJson<{ action?: string; custom_prompt?: string }>(c);
    const docs = await c.env.DB.prepare('SELECT title, extracted_text FROM kb_documents WHERE owner_id = ? AND (task_id = ? OR task_id IS NULL) AND extracted_text IS NOT NULL ORDER BY created_at DESC LIMIT 8')
      .bind(user.id, id)
      .all<{ title: string; extracted_text: string }>();
    const kbText = (docs.results || []).map((d) => `[${d.title}]\n${d.extracted_text.slice(0, 1600)}`).join('\n\n');
    const taskContext = `Title: ${task.title}\nStatus: ${task.status_name || 'Todo'}\nPriority: ${task.priority}\nDue: ${task.due_date || 'none'}\nNotes: ${task.notes || 'none'}\n\nKnowledge:\n${kbText || 'No extracted KB text.'}`;
    const prompt = buildTaskActionPrompt(body.action || '', taskContext, body.custom_prompt);
    const result = await openAIText(c.env, [{ role: 'user', content: prompt }], 600);
    return c.json({ result });
  } catch (error) {
    return jsonError(c, error);
  }
});
