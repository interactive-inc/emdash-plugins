import { z } from 'zod';
import { pluginId } from '../constants.ts';

const previewResponse = z.object({ success: z.literal(true), data: z.object({ url: z.string() }) });

/** Only the authenticated EmDash route can issue the page-scoped preview token. */
export const getPagePreview = async (id: string, signal: AbortSignal, previewPath = '/preview'): Promise<string> => {
  const response = await fetch(`/_emdash/api/plugins/${pluginId}/preview`, {
    method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', 'X-EmDash-Request': '1' },
    body: JSON.stringify({ id }),
  });
  const parsed = previewResponse.safeParse(await response.json());

  if (!response.ok || !parsed.success) throw new Error('プレビューを読み込めませんでした。もう一度お試しください。');

  const value = parsed.data.data.url;
  const url = new URL(value, 'https://builder.invalid');
  if (!value.startsWith(`${previewPath}/`) || url.origin !== 'https://builder.invalid' || !url.pathname.startsWith(`${previewPath}/`) || !url.searchParams.get('_preview')) throw new Error('プレビューURLが不正です。');
  return value;
};

export async function getPreviewConfiguration(signal: AbortSignal): Promise<{ collection: string; previewPath: string }> {
  const response = await fetch(`/_emdash/api/plugins/${pluginId}/configuration`, { credentials: 'same-origin', signal, headers: { 'X-EmDash-Request': '1' } });
  const result = z.object({ success: z.literal(true), data: z.object({ collection: z.string().regex(/^[a-z][a-z0-9_]*$/), previewPath: z.string().regex(/^(?:\/[a-zA-Z0-9_-]+)+$/) }) }).safeParse(await response.json());
  if (!response.ok || !result.success) throw new Error('プレビュー設定を読み込めませんでした。');
  return result.data.data;
}
