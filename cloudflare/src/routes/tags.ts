import { Hono } from 'hono';
import { getCurrentUser } from '../auth';
import { ApiError, intParam, jsonError, readJson, requireNonEmpty } from '../http';
import type { AppVariables, Env, TagRow } from '../types';

export const tagRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function tagDict(tag: TagRow) {
  return { id: tag.id, name: tag.name, color: tag.color };
}

tagRoutes.get('/', async (c) => {
  try {
    await getCurrentUser(c.env, c.req.header('Authorization'));
    const res = await c.env.DB.prepare('SELECT * FROM tags ORDER BY name').all<TagRow>();
    return c.json((res.results || []).map(tagDict));
  } catch (error) {
    return jsonError(c, error);
  }
});

tagRoutes.post('/', async (c) => {
  try {
    await getCurrentUser(c.env, c.req.header('Authorization'));
    const body = await readJson<{ name?: string; color?: string }>(c);
    const name = requireNonEmpty(body.name, 'name');
    const color = body.color || '#6b7280';
    const existing = await c.env.DB.prepare('SELECT id FROM tags WHERE name = ?').bind(name).first();
    if (existing) throw new ApiError(409, 'Tag name already exists');
    const result = await c.env.DB.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').bind(name, color).run();
    const tag = await c.env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(result.meta.last_row_id).first<TagRow>();
    return c.json(tagDict(tag as TagRow), 201);
  } catch (error) {
    return jsonError(c, error);
  }
});

tagRoutes.put('/:id', async (c) => {
  try {
    await getCurrentUser(c.env, c.req.header('Authorization'));
    const id = intParam(c.req.param('id'), 'tag id');
    const tag = await c.env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(id).first<TagRow>();
    if (!tag) throw new ApiError(404, 'Tag not found');
    const body = await readJson<{ name?: string; color?: string }>(c);
    const name = body.name === undefined ? tag.name : requireNonEmpty(body.name, 'name');
    if (name !== tag.name) {
      const existing = await c.env.DB.prepare('SELECT id FROM tags WHERE name = ?').bind(name).first();
      if (existing) throw new ApiError(409, 'Tag name already exists');
    }
    const color = body.color === undefined ? tag.color : body.color;
    await c.env.DB.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').bind(name, color, id).run();
    return c.json(tagDict({ ...tag, name, color }));
  } catch (error) {
    return jsonError(c, error);
  }
});

tagRoutes.delete('/:id', async (c) => {
  try {
    await getCurrentUser(c.env, c.req.header('Authorization'));
    const id = intParam(c.req.param('id'), 'tag id');
    const tag = await c.env.DB.prepare('SELECT id FROM tags WHERE id = ?').bind(id).first();
    if (!tag) throw new ApiError(404, 'Tag not found');
    await c.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(c, error);
  }
});
