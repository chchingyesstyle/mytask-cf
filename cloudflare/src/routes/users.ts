import { Hono } from 'hono';
import { getCurrentUser, hashPassword, requireAdmin } from '../auth';
import { ApiError, intParam, jsonError, readJson, requireNonEmpty } from '../http';
import type { AppVariables, Env, UserRow } from '../types';

export const userRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function publicUser(user: UserRow) {
  return { id: user.id, username: user.username, role: user.role, created_at: user.created_at };
}

userRoutes.get('/', async (c) => {
  try {
    const currentUser = await getCurrentUser(c.env, c.req.header('Authorization'));
    requireAdmin(currentUser);
    const res = await c.env.DB.prepare('SELECT * FROM users ORDER BY id').all<UserRow>();
    return c.json((res.results || []).map(publicUser));
  } catch (error) {
    return jsonError(c, error);
  }
});

userRoutes.post('/', async (c) => {
  try {
    const currentUser = await getCurrentUser(c.env, c.req.header('Authorization'));
    requireAdmin(currentUser);
    const body = await readJson<{ username?: string; password?: string }>(c);
    const username = requireNonEmpty(body.username, 'username');
    const password = requireNonEmpty(body.password, 'password');
    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (existing) throw new ApiError(400, 'Username already exists');
    const result = await c.env.DB.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .bind(username, await hashPassword(password), 'user')
      .run();
    const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(result.meta.last_row_id).first<UserRow>();
    return c.json(publicUser(user as UserRow), 201);
  } catch (error) {
    return jsonError(c, error);
  }
});

userRoutes.delete('/:id', async (c) => {
  try {
    const currentUser = await getCurrentUser(c.env, c.req.header('Authorization'));
    requireAdmin(currentUser);
    const id = intParam(c.req.param('id'), 'user id');
    if (id === currentUser.id) throw new ApiError(400, 'Cannot delete yourself');
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
    if (!user) throw new ApiError(404, 'User not found');
    await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(c, error);
  }
});
