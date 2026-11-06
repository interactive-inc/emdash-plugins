import { beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';

const document = { version: 1, data: { posts: { collection: 'posts' } }, spec: { root: 'page', elements: {
  page: { type: 'Section', props: {}, children: ['title', 'grid'] },
  title: { type: 'Heading', props: { text: { $state: '/page/title' }, level: 'h1', motion: { effect: 'fade' } } },
  grid: { type: 'Grid', props: { motion: { effect: 'fade-up', stagger: 'short' } }, repeat: { statePath: '/data/posts', key: 'id' }, children: ['name'] },
  name: { type: 'Heading', props: { text: { $item: 'title' }, level: 'h3' } },
} } };
type Entry = { id: string; data: Record<string, unknown> };
type EntryResult = { entry: Entry | null; error: unknown; isPreview: boolean };
type CollectionResult = { entries: Entry[]; error: unknown };
const entry = { id: 'e1', data: { title: 'Title', slug: 'home', document } };
const posts = [{ id: 'p0', data: { title: 'Post 0', secret: 'UNRENDERED' } }, { id: 'p1', data: { title: 'Post 1' } }];
const getEntry = mock.fn(async (_collection: string, _identifier: string): Promise<EntryResult> => ({ entry, error: null, isPreview: false }));
const getCollection = mock.fn(async (_collection: string, _options: { limit: number }): Promise<CollectionResult> => ({ entries: posts, error: null }));
mock.module('emdash', { exports: { getEmDashEntry: getEntry, getEmDashCollection: getCollection } });
// The mock must be in place before load-page imports emdash.
const { loadPage } = await import('../../src/builder/server/load-page.ts');
const { pageResponse } = await import('../../src/builder/server/page-response.ts');

beforeEach(() => {
  getEntry.mock.resetCalls();
  getCollection.mock.resetCalls();
  getEntry.mock.mockImplementation(async () => ({ entry, error: null, isPreview: false }));
  getCollection.mock.mockImplementation(async () => ({ entries: posts, error: null }));
});

test('loadPage passes the motion option through to the resolved view', async () => {
  const off = await loadPage('home', { motion: false });
  assert.ok(off);
  assert.equal(off.view.motion, false);
  assert.deepEqual(off.view.spec.elements.grid!.children, ['name~0', 'name~1']);
  for (const element of Object.values(off.view.spec.elements)) assert.equal('motion' in element.props, false);
  const on = await loadPage('home', {});
  assert.ok(on);
  assert.equal(on.view.motion, true);
  assert.deepEqual(on.view.spec.elements.title!.props.motion, { effect: 'fade', delay: 'none', duration: 'normal' });
});

test('page reads use the configured collection and list reads use the bounded default', async () => {
  const response = await pageResponse('home', { collection: 'landing' });
  assert.equal(response.status, 200);
  assert.equal(response.page?.id, 'e1');
  assert.deepEqual(getEntry.mock.calls[0]!.arguments, ['landing', 'home']);
  assert.deepEqual(getCollection.mock.calls[0]!.arguments, ['posts', { limit: 6 }]);
  assert.doesNotMatch(JSON.stringify(response.page?.view), /UNRENDERED|secret|\$state|\$item/);
});

test('a missing page returns 404 without reading any bound content', async () => {
  getEntry.mock.mockImplementation(async () => ({ entry: null, error: null, isPreview: false }));
  assert.deepEqual(await pageResponse('missing'), { page: null, status: 404 });
  assert.equal(getCollection.mock.callCount(), 0);
});

test('an upstream page error returns 503, even when an entry was also returned', async context => {
  const logged = context.mock.method(console, 'error', () => {});
  getEntry.mock.mockImplementation(async () => ({ entry, error: new Error('Unavailable'), isPreview: false }));
  assert.deepEqual(await pageResponse('home'), { page: null, status: 503 });
  assert.equal(getCollection.mock.callCount(), 0);
  assert.equal(logged.mock.callCount(), 1);
});

test('a rejected upstream read is a 503, not a missing page or a partial success', async context => {
  context.mock.method(console, 'error', () => {});
  getEntry.mock.mockImplementation(async () => { throw new Error('Connection lost'); });
  assert.deepEqual(await pageResponse('home'), { page: null, status: 503 });
  assert.equal(getCollection.mock.callCount(), 0);
});

test('invalid stored documents are rejected before following their data queries', async context => {
  context.mock.method(console, 'error', () => {});
  getEntry.mock.mockImplementation(async () => ({ entry: { id: 'e1', data: { document: { ...document, version: 999 } } }, error: null, isPreview: false }));
  assert.deepEqual(await pageResponse('home'), { page: null, status: 503 });
  assert.equal(getCollection.mock.callCount(), 0);
});

test('a failed list binding does not return a page with missing or partial content', async context => {
  context.mock.method(console, 'error', () => {});
  getCollection.mock.mockImplementation(async () => ({ entries: posts, error: new Error('Unavailable') }));
  assert.deepEqual(await pageResponse('home'), { page: null, status: 503 });
});

test('a thrown list read fails closed instead of rendering an incomplete page', async context => {
  context.mock.method(console, 'error', () => {});
  getCollection.mock.mockImplementation(async () => { throw new Error('Connection lost'); });
  assert.deepEqual(await pageResponse('home'), { page: null, status: 503 });
});

test('an explicit list limit is forwarded and an empty list renders no repeated items', async () => {
  const limited = { ...document, data: { posts: { collection: 'posts', limit: 2 } } };
  getEntry.mock.mockImplementation(async () => ({ entry: { ...entry, data: { ...entry.data, document: limited } }, error: null, isPreview: false }));
  getCollection.mock.mockImplementation(async () => ({ entries: [], error: null }));
  const loaded = await loadPage('home');
  assert.ok(loaded);
  assert.deepEqual(getCollection.mock.calls[0]!.arguments, ['posts', { limit: 2 }]);
  assert.deepEqual(loaded.view.spec.elements.grid!.children, []);
  assert.equal(loaded.view.spec.elements['name~0'], undefined);
});

const singleDocument = { version: 1, data: { article: { collection: 'posts', id: 'post-id' } }, spec: { root: 'name', elements: {
  name: { type: 'Heading', props: { text: { $state: '/data/article/title' } } },
} } };

test('single-entry bindings preserve the canonical ID and project only the displayed fields', async () => {
  getEntry.mock.mockImplementation(async (collection, identifier) => {
    if (collection === 'posts') return { entry: { id: identifier, data: { id: 'spoofed', title: 'Bound title', secret: 'UNRENDERED' } }, error: null, isPreview: false };
    return { entry: { ...entry, data: { document: singleDocument, title: 123, description: false } }, error: null, isPreview: true };
  });
  const loaded = await loadPage('entry-id');
  assert.ok(loaded);
  assert.equal(loaded.isPreview, true);
  assert.deepEqual(getEntry.mock.calls.map(call => call.arguments), [['pages', 'entry-id'], ['posts', 'post-id']]);
  assert.equal(getCollection.mock.callCount(), 0);
  assert.equal(loaded.title, '');
  assert.equal(loaded.description, '');
  assert.equal(loaded.slug, 'entry-id');
  assert.deepEqual(loaded.state.data.article, { id: 'post-id', title: 'Bound title', secret: 'UNRENDERED' });
  assert.equal(loaded.view.spec.elements.name!.props.text, 'Bound title');
  assert.doesNotMatch(JSON.stringify(loaded.view), /UNRENDERED|spoofed/);
});

test('an error in a single-entry binding returns 503 even if upstream supplied data', async context => {
  context.mock.method(console, 'error', () => {});
  getEntry.mock.mockImplementation(async collection => {
    if (collection === 'posts') return { entry: posts[0]!, error: new Error('Unavailable'), isPreview: false };
    return { entry: { ...entry, data: { document: singleDocument } }, error: null, isPreview: false };
  });
  assert.deepEqual(await pageResponse('home'), { page: null, status: 503 });
});

test('missing optional single-entry content is null without turning a valid page into 404', async () => {
  const optional = { ...singleDocument, spec: { root: 'name', elements: { name: { type: 'Heading', props: { text: 'Still here' } } } } };
  getEntry.mock.mockImplementation(async collection => ({ entry: collection === 'posts' ? null : { ...entry, data: { document: optional } }, error: null, isPreview: false }));
  const response = await pageResponse('home');
  assert.equal(response.status, 200);
  assert.equal(response.page?.state.data.article, null);
});
