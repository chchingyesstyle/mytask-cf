import { Hono } from 'hono';
import { bearerToken, verifyToken } from './auth';
import { getUserById, seedDefaults } from './db';
import { ApiError, jsonError } from './http';
import { authRoutes } from './routes/auth';
import type { AppVariables, Env, UserRow } from './types';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use('*', async (c, next) => {
  await seedDefaults(c.env);
  await next();
});

export async function currentUserFromRequest(env: Env, authorization: string | undefined): Promise<UserRow> {
  const token = bearerToken(authorization);
  const payload = await verifyToken(env, token);
  const user = await getUserById(env, Number(payload.sub));
  if (!user) throw new ApiError(401, 'User not found');
  return user;
}

export async function requireUser(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<UserRow> {
  return currentUserFromRequest(c.env, c.req.header('Authorization'));
}

export function requireAdmin(user: UserRow): void {
  if (user.role !== 'admin') throw new ApiError(403, 'Admin access required');
}

app.get('/api/info', (c) => c.json({ model: c.env.OPENAI_MODEL || 'gpt-4o' }));
app.route('/api/auth', authRoutes);

app.onError((error, c) => jsonError(c, error));

export default app;
