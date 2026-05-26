import { Hono } from 'hono';
import { seedDefaults } from './db';
import { jsonError } from './http';
import { authRoutes } from './routes/auth';
import { chatRoutes } from './routes/chat';
import { dashboardRoutes } from './routes/dashboard';
import { kbRoutes } from './routes/kb';
import { projectRoutes } from './routes/projects';
import { statusRoutes } from './routes/statuses';
import { tagRoutes } from './routes/tags';
import { taskRoutes } from './routes/tasks';
import { userRoutes } from './routes/users';
import type { AppVariables, Env } from './types';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use('*', async (c, next) => {
  await seedDefaults(c.env);
  await next();
});

app.get('/static/*', (c) => {
  const url = new URL(c.req.url);
  url.pathname = url.pathname.replace(/^\/static/, '') || '/';
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
});

app.get('/admin', (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/admin.html';
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
});

app.get('/api/info', (c) => c.json({ model: c.env.OPENAI_MODEL || 'gpt-4o' }));
app.route('/api/auth', authRoutes);
app.route('/api/tasks', taskRoutes);
app.route('/api/tags', tagRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/statuses', statusRoutes);
app.route('/api/users', userRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/kb', kbRoutes);
app.route('/api/chat', chatRoutes);

app.onError((error, c) => jsonError(c, error));

export default app;
