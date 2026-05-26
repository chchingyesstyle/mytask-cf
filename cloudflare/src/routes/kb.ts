import { Hono } from 'hono';
import { getCurrentUser } from '../auth';
import { ApiError, intParam, jsonError, parseNullableInt } from '../http';
import type { AppVariables, Env, KBDocumentRow } from '../types';

export const kbRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const allowed = new Set(['pdf', 'docx', 'txt', 'md', 'jpg', 'jpeg', 'png']);
const contentTypes: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

function docDict(doc: KBDocumentRow) {
  return {
    id: doc.id,
    title: doc.title,
    file_type: doc.file_type,
    file_size: doc.file_size,
    task_id: doc.task_id,
    created_at: doc.created_at,
    has_text: Boolean(doc.extracted_text),
  };
}

kbRoutes.post('/', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || !('name' in file) || !('size' in file)) throw new ApiError(400, 'File is required');
    const upload = file as unknown as File;
    const ext = upload.name.includes('.') ? upload.name.split('.').pop()?.toLowerCase() || '' : '';
    if (!allowed.has(ext)) throw new ApiError(400, `File type .${ext} not allowed`);
    if (upload.size > 20 * 1024 * 1024) throw new ApiError(400, 'File exceeds 20 MB limit');
    const taskRaw = form.get('task_id');
    const taskId = typeof taskRaw === 'string' ? parseNullableInt(taskRaw) : null;
    const bytes = await upload.arrayBuffer();
    const key = `${user.id}/${crypto.randomUUID()}.${ext}`;
    await c.env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: contentTypes[ext] || 'application/octet-stream' } });
    const extracted = ext === 'txt' || ext === 'md' ? new TextDecoder().decode(bytes) : null;
    const result = await c.env.DB.prepare('INSERT INTO kb_documents (title, filename, file_type, file_size, extracted_text, task_id, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(upload.name, key, ext, upload.size, extracted, taskId, user.id)
      .run();
    const doc = await c.env.DB.prepare('SELECT * FROM kb_documents WHERE id = ?').bind(result.meta.last_row_id).first<KBDocumentRow>();
    return c.json(docDict(doc as KBDocumentRow), 201);
  } catch (error) {
    return jsonError(c, error);
  }
});

kbRoutes.get('/', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const taskId = parseNullableInt(c.req.query('task_id'));
    const globalOnly = c.req.query('global') === 'true';
    let sql = 'SELECT * FROM kb_documents WHERE owner_id = ?';
    const params: unknown[] = [user.id];
    if (taskId !== null) {
      sql += ' AND task_id = ?';
      params.push(taskId);
    } else if (globalOnly) {
      sql += ' AND task_id IS NULL';
    }
    sql += ' ORDER BY created_at DESC';
    const res = await c.env.DB.prepare(sql).bind(...params).all<KBDocumentRow>();
    return c.json((res.results || []).map(docDict));
  } catch (error) {
    return jsonError(c, error);
  }
});

kbRoutes.get('/:id/download', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const id = intParam(c.req.param('id'), 'document id');
    const doc = await c.env.DB.prepare('SELECT * FROM kb_documents WHERE id = ? AND owner_id = ?').bind(id, user.id).first<KBDocumentRow>();
    if (!doc) throw new ApiError(404, 'Document not found');
    const object = await c.env.UPLOADS.get(doc.filename);
    if (!object) throw new ApiError(404, 'File not found');
    return new Response(object.body, {
      headers: {
        'Content-Type': contentTypes[doc.file_type] || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${doc.title.replace(/"/g, '')}"`,
      },
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

kbRoutes.delete('/:id', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const id = intParam(c.req.param('id'), 'document id');
    const doc = await c.env.DB.prepare('SELECT * FROM kb_documents WHERE id = ? AND owner_id = ?').bind(id, user.id).first<KBDocumentRow>();
    if (!doc) throw new ApiError(404, 'Document not found');
    await c.env.UPLOADS.delete(doc.filename);
    await c.env.DB.prepare('DELETE FROM kb_documents WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(c, error);
  }
});
