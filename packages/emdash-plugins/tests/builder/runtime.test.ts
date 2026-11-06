import { beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';

/** Only the EmDash boundary is replaced; validation, routes and policies remain the real plugin. */
const sign = mock.fn(async (_options: { collection: string; id: string; secret: string; expiresIn: string; pathPattern: string }) => '/signed-preview');
mock.module('emdash', { exports: {
  definePlugin: <T>(descriptor: T) => descriptor,
  ContentSaveRejectedError: class extends Error {},
  getPreviewUrl: sign,
} });
// node:test must install the module mock before importing the plugin.
const { createPlugin } = await import('../../src/builder/runtime.ts');
const plugin = createPlugin({ collection: 'landing', previewPath: '/draft/view' });
const preview = plugin.routes!.preview.handler;
type Context = Parameters<typeof preview>[0];
const document = { version: 1, spec: { root: 'title', elements: { title: { type: 'Heading', props: { text: 'Title' } } } } };

beforeEach(() => sign.mock.resetCalls());

test('anonymous and subscriber previews are denied before any content read or signing', async () => {
  for (const role of [undefined, 0, 10]) {
    const read = mock.fn(async () => ({ id: 'page-id' }));
    // The upstream route context is large; this fixture supplies exactly the APIs this handler may use.
    const context = { input: { id: 'page-id' }, user: role === undefined ? undefined : { role }, content: { get: read } } as unknown as Context;
    await assert.rejects(() => preview(context), /Draft access/);
    assert.equal(read.mock.callCount(), 0);
    assert.equal(sign.mock.callCount(), 0);
  }
});

test('empty and oversized preview IDs fail validation without reading content', async () => {
  for (const id of ['', 'x'.repeat(201)]) {
    const read = mock.fn(async () => ({ id }));
    const context = { input: { id }, user: { role: 50 }, content: { get: read } } as unknown as Context;
    await assert.rejects(() => preview(context));
    assert.equal(read.mock.callCount(), 0);
    assert.equal(sign.mock.callCount(), 0);
  }
});

test('all draft-capable roles sign only the returned entry in the configured collection', async context => {
  const previous = process.env.EMDASH_PREVIEW_SECRET;
  process.env.EMDASH_PREVIEW_SECRET = 'unit-test-only';
  context.after(() => {
    if (previous === undefined) delete process.env.EMDASH_PREVIEW_SECRET;
    else process.env.EMDASH_PREVIEW_SECRET = previous;
  });
  for (const role of [20, 30, 40, 50]) {
    const read = mock.fn(async (_collection: string, _id: string) => ({ id: 'canonical-id' }));
    const routeContext = { input: { id: 'requested-id' }, user: { role }, content: { get: read } } as unknown as Context;
    assert.deepEqual(await preview(routeContext), { url: '/signed-preview', expiresIn: 900 });
    assert.deepEqual(read.mock.calls[0]!.arguments, ['landing', 'requested-id']);
    assert.deepEqual(sign.mock.calls.at(-1)!.arguments, [{ collection: 'landing', id: 'canonical-id', secret: 'unit-test-only', expiresIn: '15m', pathPattern: '/draft/view/{id}' }]);
  }
});

test('missing pages and rejected content reads cannot create signed links', async () => {
  const missing = { input: { id: 'missing' }, user: { role: 50 }, content: { get: async () => null } } as unknown as Context;
  await assert.rejects(() => preview(missing), /not found/);
  const failed = { ...missing, content: { get: async () => { throw new Error('Unavailable'); } } } as unknown as Context;
  await assert.rejects(() => preview(failed), /Unavailable/);
  assert.equal(sign.mock.callCount(), 0);
});

test('save validation rejects unsafe documents while preserving unrelated collections and partial edits', async () => {
  const save = plugin.hooks!['content:beforeSave']!.handler;
  const valid = { collection: 'landing', isNew: true, content: { title: 'Title', document } };
  const saved = await save(valid as never, {} as never);
  assert.equal(saved?.title, 'Title');
  for (const invalid of [undefined, {}, { ...document, version: 999 }]) {
    await assert.rejects(() => save({ ...valid, content: { document: invalid } } as never, {} as never), /Page JSON is invalid/);
  }
  assert.equal(await save({ collection: 'landing', isNew: false, content: { title: 'Renamed' } } as never, {} as never), undefined);
  assert.equal(await save({ collection: 'posts', isNew: true, content: { document: {} } } as never, {} as never), undefined);
});

test('publication validates both EmDash event shapes and cancels invalid documents', async () => {
  const publish = plugin.hooks!['content:beforePublish']!.handler;
  for (const content of [{ document }, { data: { document } }]) {
    assert.equal(await publish({ collection: 'landing', content } as never, {} as never), undefined);
  }
  for (const content of [{ document: {} }, { data: { document: {} } }, {}]) {
    const rejected = await publish({ collection: 'landing', content } as never, {} as never);
    assert.equal(rejected?.cancel, true);
  }
});

test('MCP validation exposes schema failures and never grants write or publish access', async () => {
  const validate = plugin.routes!.validate;
  assert.equal(validate.permission, 'content:read');
  assert.equal(plugin.routes!.preview.permission, 'content:read_drafts');
  const valid = await validate.handler({ input: { document } } as Context);
  assert.ok(valid && typeof valid === 'object' && 'success' in valid);
  assert.equal(valid.success, true);
  const invalid = await validate.handler({ input: { document: {} } } as Context);
  assert.ok(invalid && typeof invalid === 'object' && 'success' in invalid);
  assert.equal(invalid.success, false);
  assert.deepEqual(Object.keys(plugin.mcp!.tools!), ['catalog', 'validate', 'preview']);
});
