import { Hono } from 'hono';
import { bearerToken, createToken, hashPassword, verifyPassword, verifyToken } from '../auth';
import { getUserById, getUserByUsername } from '../db';
import { ApiError, jsonError, readJson } from '../http';
import type { AppVariables, Env } from '../types';

export const authRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

authRoutes.post('/login', async (c) => {
  try {
    const body = await readJson<{ username?: string; password?: string }>(c);
    const user = body.username ? await getUserByUsername(c.env, body.username) : null;
    if (!user || !body.password || !(await verifyPassword(body.password, user.password_hash))) {
      throw new ApiError(401, 'Invalid credentials');
    }
    return c.json({ access_token: await createToken(c.env, user), token_type: 'bearer' });
  } catch (error) {
    return jsonError(c, error);
  }
});

authRoutes.get('/me', async (c) => {
  try {
    const token = bearerToken(c.req.header('Authorization'));
    const payload = await verifyToken(c.env, token);
    const user = await getUserById(c.env, Number(payload.sub));
    if (!user) throw new ApiError(401, 'User not found');
    return c.json({ id: user.id, username: user.username, role: user.role });
  } catch (error) {
    return jsonError(c, error);
  }
});

authRoutes.put('/password', async (c) => {
  try {
    const token = bearerToken(c.req.header('Authorization'));
    const payload = await verifyToken(c.env, token);
    const user = await getUserById(c.env, Number(payload.sub));
    if (!user) throw new ApiError(401, 'User not found');

    const body = await readJson<{ current_password?: string; new_password?: string }>(c);
    if (!body.current_password || !(await verifyPassword(body.current_password, user.password_hash))) {
      throw new ApiError(400, 'Current password is incorrect');
    }
    if (!body.new_password || body.new_password.length < 6) {
      throw new ApiError(400, 'New password must be at least 6 characters');
    }
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(body.new_password), user.id)
      .run();
    return c.json({ message: 'Password changed successfully' });
  } catch (error) {
    return jsonError(c, error);
  }
});
