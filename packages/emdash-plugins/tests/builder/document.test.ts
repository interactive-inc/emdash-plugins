import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from '../../src/builder/document.ts';
import { resolvePage } from '../../src/builder/resolve-page.ts';
import { safeUrl } from '../../src/builder/safe-url.ts';

const pageState = { page: { title: 'A real title', description: '', slug: 'home' }, data: {} };
const minimal = () => ({ version: 1, spec: { root: 'heading', elements: { heading: { type: 'Heading', props: { text: { $state: '/page/title' }, level: 'h1' } } } } });

test('state bindings are validated after resolution', () => {
  const result = validateDocument(minimal());
  assert.equal(result.success, true);
  if (result.success) {
    resolvePage(result.document, pageState);
    assert.throws(() => resolvePage(result.document, { ...pageState, page: { ...pageState.page, title: 12 } } as never), /bound data/);
  }
});
test('cycles, missing references, shared children, and unreachable nodes are rejected', () => {
  for (const children of [['root'], ['missing'], ['child', 'child']]) {
    assert.equal(validateDocument({ version: 1, spec: { root: 'root', elements: { root: { type: 'Stack', props: {}, children }, child: { type: 'Text', props: { text: 'hello' } } } } }).success, false);
  }
});
test('unregistered components, event handlers, arbitrary CSS, and unknown props are rejected', () => {
  for (const element of [
    { type: 'script', props: {} },
    { type: 'Text', props: { text: 'hello', style: 'color:red' } },
    { type: 'Text', props: { text: 'hello' }, on: { click: { action: 'fetch' } } },
    { type: 'Text', props: { text: 'hello', dangerouslySetInnerHTML: { __html: '<script>' } } },
  ]) assert.equal(validateDocument({ version: 1, spec: { root: 'root', elements: { root: element } } }).success, false);
});
test('computed expressions and undeclared data sources cannot be introduced', () => {
  const doc = minimal();
  doc.spec.elements.heading.props.text = { $computed: 'fetch' } as never;
  assert.equal(validateDocument(doc).success, false);
  assert.equal(validateDocument({ ...minimal(), data: { posts: { collection: 'posts', url: 'https://example.com' } } }).success, false);
});
test('prototype names cannot resolve inherited elements', () => {
  assert.equal(validateDocument({ version: 1, spec: { root: 'toString', elements: {} } }).success, false);
});
test('item bindings require a bounded repeat and resolve within its scope', () => {
  const doc = { version: 1, data: { posts: { collection: 'posts', limit: 2 } }, spec: { root: 'list', elements: {
    list: { type: 'Grid', props: {}, repeat: { statePath: '/data/posts', key: 'id' }, children: ['title'] },
    title: { type: 'Heading', props: { text: { $item: 'title' } } },
  } } };
  const result = validateDocument(doc);
  assert.equal(result.success, true);
  if (result.success) resolvePage(result.document, { ...pageState, data: { posts: [{ id: '1', title: 'First' }] } });
  assert.equal(validateDocument({ version: 1, spec: { root: 'title', elements: { title: doc.spec.elements.title } } }).success, false);
});
test('a repeat lists a query without id, never a single entry', () => {
  const doc = (query: Record<string, unknown>) => validateDocument({ version: 1, data: { posts: query }, spec: { root: 'list', elements: {
    list: { type: 'Grid', props: {}, repeat: { statePath: '/data/posts', key: 'id' }, children: ['title'] },
    title: { type: 'Heading', props: { text: { $item: 'title' } } },
  } } });
  assert.equal(doc({ collection: 'posts' }).success, true);
  assert.deepEqual(doc({ collection: 'posts', id: 'my-slug' }), { success: false, errors: ['list: repeat needs a list query without id'] });
});
test('oversized documents and executable theme values are rejected', () => {
  assert.equal(validateDocument({ ...minimal(), extra: 'a'.repeat(200001) }).success, false);
  assert.equal(validateDocument({ ...minimal(), theme: { accent: 'url(javascript:alert(1))' } }).success, false);
});
test('URL checks reject executable, protocol-relative, credentialed and obfuscated URLs', () => {
  for (const value of ['javascript:alert(1)', '//evil.example', '/\\evil.example', 'https://user:pass@example.com', 'data:text/html,hello', 'java\nscript:alert(1)']) assert.equal(safeUrl(value), undefined);
  for (const value of ['/guide', '/#start', '#features', 'https://example.com', 'mailto:hello@example.com']) assert.equal(safeUrl(value), value);
  assert.equal(safeUrl('mailto:hello@example.com', true), undefined);
});

test('a repeat binds its children, not the container itself', () => {
  const result = validateDocument({ version: 1, data: { posts: { collection: 'posts' } }, spec: { root: 'grid', elements: {
    grid: { type: 'Grid', props: { columns: { $item: 'columns' } }, repeat: { statePath: '/data/posts', key: 'id' }, children: ['text'] },
    text: { type: 'Text', props: { text: { $item: 'title' } } },
  } } });
  assert.equal(result.success, false);
});
test('hidden optional content is not required to resolve its properties', () => {
  const result = validateDocument({ version: 1, spec: { root: 'heading', elements: {
    heading: { type: 'Heading', props: { text: { $state: '/data/article/title' } }, visible: { $state: '/data/article' } },
  } } });
  assert.equal(result.success, true);
  if (result.success) resolvePage(result.document, { ...pageState, data: { article: null } });
});
