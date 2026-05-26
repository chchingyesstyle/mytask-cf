import { Hono } from 'hono';
import { getCurrentUser } from '../auth';
import { openAIText } from '../ai';
import { jsonError } from '../http';
import type { AppVariables, Env } from '../types';

type MiniTask = { id: number; title: string; priority: string; due_date: string | null; project_name: string | null; updated_at?: string };

export const dashboardRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function isoDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

dashboardRoutes.get('/', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const today = isoDate();
    const weekEnd = isoDate(7);
    const thirty = isoDate(30);
    const doneRows = await c.env.DB.prepare("SELECT id FROM statuses WHERE LOWER(name) = 'done'").all<{ id: number }>();
    const doneIds = (doneRows.results || []).map((row) => row.id);
    const doneFilter = doneIds.length ? `AND (tasks.status_id IS NULL OR tasks.status_id NOT IN (${doneIds.map(() => '?').join(',')}))` : '';
    const baseParams: unknown[] = [user.id, ...doneIds];
    const baseSql = `FROM tasks LEFT JOIN projects ON tasks.project_id = projects.id WHERE tasks.owner_id = ? AND tasks.parent_id IS NULL ${doneFilter}`;

    const overdue = await c.env.DB.prepare(`SELECT tasks.id, tasks.title, tasks.priority, tasks.due_date, projects.name AS project_name ${baseSql} AND tasks.due_date < ? ORDER BY tasks.due_date`).bind(...baseParams, today).all<MiniTask>();
    const dueToday = await c.env.DB.prepare(`SELECT tasks.id, tasks.title, tasks.priority, tasks.due_date, projects.name AS project_name ${baseSql} AND tasks.due_date = ? ORDER BY tasks.due_date`).bind(...baseParams, today).all<MiniTask>();
    const week = await c.env.DB.prepare(`SELECT COUNT(*) AS count ${baseSql} AND tasks.due_date > ? AND tasks.due_date <= ?`).bind(...baseParams, today, weekEnd).first<{ count: number }>();
    const upcoming = await c.env.DB.prepare(`SELECT COUNT(*) AS count ${baseSql} AND tasks.due_date > ? AND tasks.due_date <= ?`).bind(...baseParams, weekEnd, thirty).first<{ count: number }>();

    const projectRows = await c.env.DB.prepare('SELECT id, name FROM projects WHERE owner_id = ? ORDER BY name').bind(user.id).all<{ id: number; name: string }>();
    const projects = [];
    for (const project of projectRows.results || []) {
      const total = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND parent_id IS NULL AND project_id = ?').bind(user.id, project.id).first<{ count: number }>();
      if (!total?.count) continue;
      const done = doneIds.length
        ? await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND parent_id IS NULL AND project_id = ? AND status_id IN (${doneIds.map(() => '?').join(',')})`).bind(user.id, project.id, ...doneIds).first<{ count: number }>()
        : { count: 0 };
      projects.push({ id: project.id, name: project.name, total: total.count, done: done?.count || 0 });
    }

    const completed7d = [0, 0, 0, 0, 0, 0, 0];
    const completedRows = await c.env.DB.prepare('SELECT completed_at FROM tasks WHERE owner_id = ? AND parent_id IS NULL AND completed_at IS NOT NULL AND completed_at >= ?').bind(user.id, `${isoDate(-6)}T00:00:00.000Z`).all<{ completed_at: string }>();
    for (const row of completedRows.results || []) {
      const delta = Math.floor((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(row.completed_at.slice(0, 10) + 'T00:00:00.000Z')) / 86400000);
      if (delta >= 0 && delta <= 6) completed7d[6 - delta] += 1;
    }

    const recent = await c.env.DB.prepare('SELECT tasks.id, tasks.title, tasks.priority, tasks.due_date, tasks.updated_at, projects.name AS project_name FROM tasks LEFT JOIN projects ON tasks.project_id = projects.id WHERE tasks.owner_id = ? AND tasks.parent_id IS NULL ORDER BY tasks.updated_at DESC LIMIT 5').bind(user.id).all<MiniTask>();

    let aiBriefing: string | null = null;
    try {
      const taskLines = [...(overdue.results || []), ...(dueToday.results || [])].slice(0, 5).map((t) => `'${t.title}'`).join(', ');
      aiBriefing = await openAIText(c.env, [{ role: 'user', content: `Urgent tasks: ${taskLines || 'none'}. Stats: ${(overdue.results || []).length} overdue, ${(dueToday.results || []).length} due today. In one sentence, what should I focus on first?` }], 80);
    } catch {
      aiBriefing = null;
    }

    return c.json({
      overdue: (overdue.results || []).length,
      due_today: (dueToday.results || []).length,
      due_week: week?.count || 0,
      due_30: upcoming?.count || 0,
      ai_briefing: aiBriefing,
      overdue_tasks: overdue.results || [],
      today_tasks: dueToday.results || [],
      projects,
      completed_7d: completed7d,
      recent_activity: recent.results || [],
    });
  } catch (error) {
    return jsonError(c, error);
  }
});
