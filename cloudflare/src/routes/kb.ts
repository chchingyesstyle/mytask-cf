import { Hono } from 'hono';
import { getCurrentUser } from '../auth';
import { ApiError, intParam, jsonError, parseNullableInt, readJson, requireNonEmpty } from '../http';
import type { AppVariables, Env, KBDocumentRow } from '../types';

export const kbRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const allowed = new Set(['txt', 'md']);
const contentTypes: Record<string, string> = {
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
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

async function parseTextDoc(c: { req: { header(name: string): string | undefined; formData(): Promise<FormData> } }): Promise<{ title: string; text: string; fileType: string; taskId: number | null }> {
  const contentType = c.req.header('Content-Type') || '';
  if (contentType.includes('application/json')) {
    const body = await readJson<{ title?: string; text?: string; file_type?: string; task_id?: number | null }>(c as never);
    const title = requireNonEmpty(body.title, 'title');
    const text = requireNonEmpty(body.text, 'text');
    const fileType = body.file_type === 'md' ? 'md' : 'txt';
    return { title, text, fileType, taskId: body.task_id ?? null };
  }

  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || !('name' in file) || !('size' in file)) {
    throw new ApiError(400, 'Text or markdown file is required');
  }
  const upload = file as unknown as File;
  const ext = upload.name.includes('.') ? upload.name.split('.').pop()?.toLowerCase() || '' : '';
  if (!allowed.has(ext)) throw new ApiError(400, 'Only .txt and .md files are supported without R2');
  if (upload.size > 1024 * 1024) throw new ApiError(400, 'Text document exceeds 1 MB limit');
  const taskRaw = form.get('task_id');
  const taskId = typeof taskRaw === 'string' ? parseNullableInt(taskRaw) : null;
  const text = new TextDecoder().decode(await upload.arrayBuffer());
  if (!text.trim()) throw new ApiError(400, 'Text document is empty');
  return { title: upload.name, text, fileType: ext, taskId };
}

kbRoutes.post('/', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const doc = await parseTextDoc(c);
    const result = await c.env.DB.prepare('INSERT INTO kb_documents (title, filename, file_type, file_size, extracted_text, task_id, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(doc.title, `d1://${crypto.randomUUID()}`, doc.fileType, new TextEncoder().encode(doc.text).byteLength, doc.text, doc.taskId, user.id)
      .run();
    const row = await c.env.DB.prepare('SELECT * FROM kb_documents WHERE id = ?').bind(result.meta.last_row_id).first<KBDocumentRow>();
    return c.json(docDict(row as KBDocumentRow), 201);
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
    return new Response(doc.extracted_text || '', {
      headers: {
        'Content-Type': contentTypes[doc.file_type] || 'text/plain; charset=utf-8',
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
    const doc = await c.env.DB.prepare('SELECT id FROM kb_documents WHERE id = ? AND owner_id = ?').bind(id, user.id).first();
    if (!doc) throw new ApiError(404, 'Document not found');
    await c.env.DB.prepare('DELETE FROM kb_documents WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(c, error);
  }
});
