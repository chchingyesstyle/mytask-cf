import { Hono } from 'hono';
import { openAIResponse, type ChatMessage } from '../ai';
import { getCurrentUser } from '../auth';
import { jsonError, readJson } from '../http';
import type { AppVariables, Env, KBDocumentRow, TaskRow } from '../types';

export const chatRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function encodeEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function transformOpenAIStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = body.getReader();
  let buffer = '';

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) processChunk(buffer, controller, encoder);
          controller.enqueue(encoder.encode(encodeEvent({ type: 'done' })));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const chunk of chunks) processChunk(chunk, controller, encoder);
        if (chunks.length) return;
      }
    },
    cancel() {
      return reader.cancel();
    },
  });
}

function processChunk(chunk: string, controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder): void {
  const lines = chunk.split('\n').filter((line) => line.startsWith('data: '));
  for (const line of lines) {
    const raw = line.slice(6).trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const data = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string } }> };
      const content = data.choices?.[0]?.delta?.content;
      if (content) controller.enqueue(encoder.encode(encodeEvent({ type: 'token', content })));
    } catch {
      controller.enqueue(encoder.encode(encodeEvent({ type: 'error', message: 'Invalid AI stream chunk' })));
    }
  }
}

chatRoutes.post('/', async (c) => {
  try {
    const user = await getCurrentUser(c.env, c.req.header('Authorization'));
    const body = await readJson<{ message?: string; history?: ChatMessage[] }>(c);
    const message = body.message || '';
    const tasks = await c.env.DB.prepare('SELECT title, priority, due_date, notes FROM tasks WHERE owner_id = ? AND parent_id IS NULL ORDER BY created_at DESC LIMIT 80').bind(user.id).all<TaskRow>();
    const docs = await c.env.DB.prepare('SELECT title, extracted_text FROM kb_documents WHERE owner_id = ? AND task_id IS NULL AND extracted_text IS NOT NULL ORDER BY created_at DESC LIMIT 5').bind(user.id).all<KBDocumentRow>();
    const taskLines = (tasks.results || []).map((t) => `- ${t.title} [${t.priority}] due ${t.due_date || 'none'}${t.notes ? `: ${t.notes.slice(0, 300)}` : ''}`).join('\n');
    const kbText = (docs.results || []).map((d) => `[${d.title}]\n${(d.extracted_text || '').slice(0, 2000)}`).join('\n\n');
    const messages: ChatMessage[] = [
      { role: 'system', content: `You are the MyTask assistant. Help the user manage tasks clearly and concisely.\n\nTasks:\n${taskLines || 'No tasks.'}\n\nKnowledge base:\n${kbText || 'No extracted KB text.'}` },
      ...((body.history || []).slice(-10).filter((m) => m.role && typeof m.content === 'string')),
      { role: 'user', content: message },
    ];
    const upstream = await openAIResponse(c.env, messages, true);
    if (!upstream.ok || !upstream.body) {
      return new Response(encodeEvent({ type: 'error', message: await upstream.text() }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }
    return new Response(transformOpenAIStream(upstream.body), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  } catch (error) {
    return jsonError(c, error);
  }
});
