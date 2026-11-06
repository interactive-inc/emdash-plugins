import { mock, test } from 'node:test';
import assert from 'node:assert/strict';

const document = { version: 1, data: { posts: { collection: 'posts' } }, spec: { root: 'page', elements: {
  page: { type: 'Section', props: {}, children: ['title', 'grid'] },
  title: { type: 'Heading', props: { text: { $state: '/page/title' }, level: 'h1', motion: { effect: 'fade' } } },
  grid: { type: 'Grid', props: { motion: { effect: 'fade-up', stagger: 'short' } }, repeat: { statePath: '/data/posts', key: 'id' }, children: ['name'] },
  name: { type: 'Heading', props: { text: { $item: 'title' }, level: 'h3' } },
} } };
mock.module('emdash', { exports: {
  getEmDashEntry: async () => ({ entry: { id: 'e1', data: { title: 'Title', slug: 'home', document } }, error: null, isPreview: false }),
  getEmDashCollection: async () => ({ entries: [{ id: 'p0', data: { title: 'Post 0' } }, { id: 'p1', data: { title: 'Post 1' } }], error: null }),
} });
// The mock must be in place before load-page imports emdash.
const { loadPage } = await import('../../src/builder/server/load-page.ts');

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
