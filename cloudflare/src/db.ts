import { hashPassword } from './auth';
import type { Env, UserRow } from './types';

export async function seedDefaults(env: Env): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO statuses (id, name, color, position, project_id) VALUES (1, 'Todo', '#6b7280', 0, NULL), (2, 'In Progress', '#4a90d9', 1, NULL), (3, 'Done', '#2ecc71', 2, NULL)"
  ).run();

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind('admin').first();
  if (!existing) {
    const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
    await env.DB.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .bind('admin', passwordHash, 'admin')
      .run();
  }
}

export async function getUserById(env: Env, id: number): Promise<UserRow | null> {
  return await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export async function getUserByUsername(env: Env, username: string): Promise<UserRow | null> {
  return await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<UserRow>();
}
