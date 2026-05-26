import { Hono } from 'hono';
import { getCurrentUser } from '../auth';
import { ApiError, intParam, jsonError, parseNullableInt, readJson, requireNonEmpty } from '../http';
import type { AppVariables, Env, ProjectRow, StatusRow } from '../types';

export const statusRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function checkStatusOwnership(env: Env, status: StatusRow, userId: number, role: string): Promise<void> {
  if (status.project_id === null) {
    if (role !== 'admin') throw new ApiError(403, 'Only admins can modify the default status set');
    return;
  }
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(status.project_id).first<ProjectRow>();
  if (!project || (role !== 'admin' && project.owner_id !== userId)) throw new ApiError(403, 'Not authorized');
}

async function checkProjectAccess(env: Env, projectId: number | null, userId: number, role: string): Promise<void> {
  if (projectId === null) {
    if (role !== 'admin') throw new ApiError(403, 'Only admins can modify the default status set');
    return;
  }
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<ProjectRow>();
  if (!project) throw new ApiError(404, 'Project not found');
  if (role !== 'admin' && project.owner_id !== userId) throw new ApiError(403, 'Not authorized');
}

statusRoutes.get('/', async (c) => {
  try {
    await getCurrentUser(c.env, c.req.header('Authorization'));
    const projectId = parseNullableInt(c.req.query('project_id'));
    const stmt = projectId === null
      ? c.env.DB.prepare('SELECT * FROM statuses WHERE project_id IS NULL ORDER BY position')
      : c.env.DB.prepare('SELECT * FROM statuses WHERE project_id = ? ORDER BY position').bind(projectId);
    const res = await stmt.all<StatusRow>();
    return c.json(res.results || []);
  } catch (error) {
    return jsonError(c, error);
  }
});

statusRoutes.post('/', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const body = await readJson<{ name?: string; color?: string; project_id?: number | null }>(c);
    const projectId = body.project_id ?? null;
    await checkProjectAccess(c.env, projectId, user.id, user.role);
    const name = requireNonEmpty(body.name, 'name');
    const color = body.color || '#6b7280';
    const maxRow = projectId === null
      ? await c.env.DB.prepare('SELECT MAX(position) AS max_position FROM statuses WHERE project_id IS NULL').first<{ max_position: number | null }>()
      : await c.env.DB.prepare('SELECT MAX(position) AS max_position FROM statuses WHERE project_id = ?').bind(projectId).first<{ max_position: number | null }>();
    const position = (maxRow?.max_position ?? -1) + 1;
    const result = await c.env.DB.prepare('INSERT INTO statuses (name, color, position, project_id) VALUES (?, ?, ?, ?)').bind(name, color, position, projectId).run();
    return c.json({ id: result.meta.last_row_id, name, color, position, project_id: projectId }, 201);
  } catch (error) {
    return jsonError(c, error);
  }
});

statusRoutes.put('/reorder', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const body = await readJson<{ ids?: number[]; status_ids?: number[] }>(c);
    const ids = body.ids || body.status_ids || [];
    for (let idx = 0; idx < ids.length; idx += 1) {
      const status = await c.env.DB.prepare('SELECT * FROM statuses WHERE id = ?').bind(ids[idx]).first<StatusRow>();
      if (!status) throw new ApiError(404, `Status ${ids[idx]} not found`);
      await checkStatusOwnership(c.env, status, user.id, user.role);
      await c.env.DB.prepare('UPDATE statuses SET position = ? WHERE id = ?').bind(idx, ids[idx]).run();
    }
    return c.json({ reordered: ids.length });
  } catch (error) {
    return jsonError(c, error);
  }
});

statusRoutes.put('/:id', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const id = intParam(c.req.param('id'), 'status id');
    const status = await c.env.DB.prepare('SELECT * FROM statuses WHERE id = ?').bind(id).first<StatusRow>();
    if (!status) throw new ApiError(404, 'Status not found');
    await checkStatusOwnership(c.env, status, user.id, user.role);
    const body = await readJson<{ name?: string; color?: string }>(c);
    const name = body.name === undefined ? status.name : requireNonEmpty(body.name, 'name');
    const color = body.color === undefined ? status.color : body.color;
    await c.env.DB.prepare('UPDATE statuses SET name = ?, color = ? WHERE id = ?').bind(name, color, id).run();
    return c.json({ ...status, name, color });
  } catch (error) {
    return jsonError(c, error);
  }
});

statusRoutes.delete('/:id', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const id = intParam(c.req.param('id'), 'status id');
    const status = await c.env.DB.prepare('SELECT * FROM statuses WHERE id = ?').bind(id).first<StatusRow>();
    if (!status) throw new ApiError(404, 'Status not found');
    await checkStatusOwnership(c.env, status, user.id, user.role);
    const countStmt = status.project_id === null
      ? c.env.DB.prepare('SELECT COUNT(*) AS count FROM statuses WHERE project_id IS NULL')
      : c.env.DB.prepare('SELECT COUNT(*) AS count FROM statuses WHERE project_id = ?').bind(status.project_id);
    const count = await countStmt.first<{ count: number }>();
    if ((count?.count || 0) <= 1) throw new ApiError(400, 'Cannot delete the last status of a project');
    const nextStmt = status.project_id === null
      ? c.env.DB.prepare('SELECT id FROM statuses WHERE project_id IS NULL AND id != ? ORDER BY position LIMIT 1').bind(id)
      : c.env.DB.prepare('SELECT id FROM statuses WHERE project_id = ? AND id != ? ORDER BY position LIMIT 1').bind(status.project_id, id);
    const next = await nextStmt.first<{ id: number }>();
    await c.env.DB.prepare('UPDATE tasks SET status_id = ? WHERE status_id = ?').bind(next?.id || null, id).run();
    await c.env.DB.prepare('DELETE FROM statuses WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(c, error);
  }
});
