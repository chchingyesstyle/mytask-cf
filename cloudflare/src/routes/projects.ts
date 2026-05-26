import { Hono } from 'hono';
import { getCurrentUser } from '../auth';
import { ApiError, intParam, jsonError, readJson, requireNonEmpty } from '../http';
import type { AppVariables, Env, ProjectRow, StatusRow } from '../types';

export const projectRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function canAccessProject(project: ProjectRow, userId: number, role: string) {
  return role === 'admin' || project.owner_id === userId;
}

projectRoutes.get('/', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const sql = user.role === 'admin' ? 'SELECT * FROM projects ORDER BY created_at DESC' : 'SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at DESC';
    const stmt = user.role === 'admin' ? c.env.DB.prepare(sql) : c.env.DB.prepare(sql).bind(user.id);
    const res = await stmt.all<ProjectRow>();
    return c.json((res.results || []).map((p) => ({ id: p.id, name: p.name, owner_id: p.owner_id })));
  } catch (error) {
    return jsonError(c, error);
  }
});

projectRoutes.post('/', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const body = await readJson<{ name?: string }>(c);
    const name = requireNonEmpty(body.name, 'name');
    const result = await c.env.DB.prepare('INSERT INTO projects (name, owner_id) VALUES (?, ?)').bind(name, user.id).run();
    const projectId = Number(result.meta.last_row_id);
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO statuses (name, color, position, project_id) VALUES (?, ?, ?, ?)').bind('Todo', '#6b7280', 0, projectId),
      c.env.DB.prepare('INSERT INTO statuses (name, color, position, project_id) VALUES (?, ?, ?, ?)').bind('In Progress', '#4a90d9', 1, projectId),
      c.env.DB.prepare('INSERT INTO statuses (name, color, position, project_id) VALUES (?, ?, ?, ?)').bind('Done', '#2ecc71', 2, projectId),
    ]);
    const statuses = await c.env.DB.prepare('SELECT * FROM statuses WHERE project_id = ? ORDER BY position').bind(projectId).all<StatusRow>();
    return c.json({ id: projectId, name, owner_id: user.id, statuses: statuses.results || [] }, 201);
  } catch (error) {
    return jsonError(c, error);
  }
});

projectRoutes.put('/:id', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const id = intParam(c.req.param('id'), 'project id');
    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>();
    if (!project) throw new ApiError(404, 'Project not found');
    if (!canAccessProject(project, user.id, user.role)) throw new ApiError(403, 'Not authorized');
    const body = await readJson<{ name?: string }>(c);
    const name = requireNonEmpty(body.name, 'name');
    await c.env.DB.prepare('UPDATE projects SET name = ? WHERE id = ?').bind(name, id).run();
    return c.json({ id, name, owner_id: project.owner_id });
  } catch (error) {
    return jsonError(c, error);
  }
});

projectRoutes.delete('/:id', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const id = intParam(c.req.param('id'), 'project id');
    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>();
    if (!project) throw new ApiError(404, 'Project not found');
    if (!canAccessProject(project, user.id, user.role)) throw new ApiError(403, 'Not authorized');
    await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(c, error);
  }
});
