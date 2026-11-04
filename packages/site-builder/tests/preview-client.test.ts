import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPagePreview, getPreviewConfiguration } from '../src/admin/get-page-preview.ts';

test('preview client sends the native request header and accepts only the configured local preview route', async () => {
  const original = globalThis.fetch;
  let url = '/draft/view/page?_preview=signed';
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(new Headers(init?.headers).get('X-EmDash-Request'), '1');
    return Response.json({ success: true, data: String(input).endsWith('/configuration') ? { collection: 'landing', previewPath: '/draft/view' } : { url } });
  };
  try {
    const signal = new AbortController().signal;
    assert.deepEqual(await getPreviewConfiguration(signal), { collection: 'landing', previewPath: '/draft/view' });
    assert.equal(await getPagePreview('page', signal, '/draft/view'), url);
    for (const invalid of ['https://evil.test/draft/view/page?_preview=x', '//evil.test/draft/view/page?_preview=x', '/draft/view/../../outside?_preview=x', '/preview/page?_preview=x', '/draft/view/page']) {
      url = invalid;
      await assert.rejects(() => getPagePreview('page', signal, '/draft/view'));
    }
  } finally { globalThis.fetch = original; }
});
