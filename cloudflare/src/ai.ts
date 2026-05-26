import { ApiError } from './http';
import type { Env } from './types';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function apiBase(env: Env): string {
  if (!env.OPENAI_API_KEY || !env.OPENAI_BASE_URL) throw new ApiError(503, 'AI is not configured');
  return env.OPENAI_BASE_URL.replace(/\/$/, '');
}

export async function openAIResponse(env: Env, messages: ChatMessage[], stream: boolean, maxTokens?: number): Promise<Response> {
  const body: Record<string, unknown> = {
    model: env.OPENAI_MODEL || 'gpt-4o',
    messages,
    stream,
  };
  if (maxTokens) body.max_tokens = maxTokens;
  return fetch(`${apiBase(env)}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

export async function openAIText(env: Env, messages: ChatMessage[], maxTokens?: number): Promise<string> {
  const response = await openAIResponse(env, messages, false, maxTokens);
  if (!response.ok) throw new ApiError(response.status, await response.text());
  const data = await response.json<{ choices?: Array<{ message?: { content?: string } }> }>();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

export function buildTaskActionPrompt(action: string, taskContext: string, customPrompt?: string): string {
  if (action === 'meeting_prep') return `Prepare concise meeting notes for this task.\n\n${taskContext}`;
  if (action === 'draft_email') return `Draft a concise professional email for this task.\n\n${taskContext}`;
  if (action === 'summarise') return `Summarise the useful information for this task.\n\n${taskContext}`;
  if (action === 'action_items') return `Extract clear action items for this task.\n\n${taskContext}`;
  if (action === 'custom') return `${customPrompt || 'Help with this task.'}\n\n${taskContext}`;
  throw new ApiError(400, 'Unknown AI action');
}
