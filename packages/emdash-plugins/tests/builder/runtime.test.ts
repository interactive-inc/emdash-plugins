import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { verifyPreviewToken } from 'emdash';
import { createPlugin } from '../../src/builder/runtime.ts';

const plugin = createPlugin({ collection: 'landing', previewPath: '/draft/view' });
const handler = plugin.routes!.preview.handler;
type Context = Parameters<typeof handler>[0];

test('preview denies anonymous and subscriber roles before any content read', async () => {
  for (const role of [undefined, 0, 10]) {
    let read = false;
    const context = { input: { id: 'page-id' }, ...(role === undefined ? {} : { user: { role } }), content: { get: async () => { read = true; return { id: 'page-id' }; } } } as unknown as Context;
    await assert.rejects(() => handler(context), /Draft access/);
    assert.equal(read, false);
  }
  assert.equal(plugin.routes!.preview.permission, 'content:read_drafts');
});

test('contributor, author, editor and admin previews are collection-scoped and expire after 15 minutes', async () => {
  const previous = process.env.EMDASH_PREVIEW_SECRET;
  const secret = randomBytes(32).toString('hex');
  process.env.EMDASH_PREVIEW_SECRET = secret;
  try {
    for (const role of [20, 30, 40, 50]) {
      const context = { input: { id: 'page-id' }, user: { role }, content: { get: async (collection: string, id: string) => { assert.equal(collection, 'landing'); assert.equal(id, 'page-id'); return { id }; } } } as unknown as Context;
      const result = await handler(context) as { url: string; expiresIn: number };
      assert.ok(result.url.startsWith('/draft/view/page-id?'));
      assert.equal(result.expiresIn, 900);
      const verified = await verifyPreviewToken({ url: new URL(result.url, 'https://example.test'), secret });
      assert.equal(verified.valid, true);
      if (verified.valid) { assert.equal(verified.payload.cid, 'landing:page-id'); assert.equal(verified.payload.exp - verified.payload.iat, 900); }
    }
  } finally {
    if (previous === undefined) delete process.env.EMDASH_PREVIEW_SECRET;
    else process.env.EMDASH_PREVIEW_SECRET = previous;
  }
});

test('preview rejects a missing page and a missing signing secret', async () => {
  const context = { input: { id: 'missing' }, user: { role: 50 }, content: { get: async () => null } } as unknown as Context;
  await assert.rejects(() => handler(context), /not found/);
  const previous = process.env.EMDASH_PREVIEW_SECRET;
  delete process.env.EMDASH_PREVIEW_SECRET;
  try {
    await assert.rejects(() => handler({ ...context, content: { get: async () => ({ id: 'page-id' }) } } as unknown as Context), /Configure/);
  } finally { if (previous !== undefined) process.env.EMDASH_PREVIEW_SECRET = previous; }
});

test('save and publish policies validate the configured collection and preserve unrelated collections and partial edits', async () => {
  const { z } = await import('zod');
  const configured = createPlugin({ collection: 'landing' }, {
    Notice: { props: z.object({ text: z.string() }), component: () => null, description: 'Notice' },
  });
  const save = configured.hooks!['content:beforeSave']!.handler;
  const publish = configured.hooks!['content:beforePublish']!.handler;
  const document = { version: 1, spec: { root: 'notice', elements: { notice: { type: 'Notice', props: { text: 'ok' } } } } };
  const valid = { collection: 'landing', isNew: true, content: { title: 'Title', document } };
  const context = {} as never;
  assert.deepEqual(await save(valid as never, context), valid.content);
  await assert.rejects(() => save({ ...valid, content: { document: {} } } as never, context), /Page JSON is invalid/);
  assert.equal(await save({ collection: 'landing', isNew: false, content: { title: 'Renamed' } } as never, context), undefined);
  assert.equal(await save({ collection: 'pages', isNew: true, content: { document: {} } } as never, context), undefined);
  for (const content of [{ document }, { data: { document } }]) {
    assert.equal(await publish({ collection: 'landing', content } as never, context), undefined);
  }
  for (const content of [{ document: {} }, { data: { document: {} } }]) {
    const rejected = await publish({ collection: 'landing', content } as never, context) as { cancel?: boolean };
    assert.equal(rejected.cancel, true);
  }
  assert.equal(await publish({ collection: 'pages', content: { document: {} } } as never, context), undefined);
});
