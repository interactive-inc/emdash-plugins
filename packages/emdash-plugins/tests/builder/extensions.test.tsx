import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { z } from 'zod';
import { defineComponent, componentContract } from '../../src/builder/extensions.ts';
import { validateDocument, validateResolvedSpec } from '../../src/builder/document.ts';
import { SiteRenderer } from '../../src/builder/renderer.tsx';
import { resolveOptions } from '../../src/builder/options.ts';
import { getEditorPageId } from '../../src/builder/admin/get-editor-page-id.ts';

const components = { Notice: defineComponent({ props: z.object({ text: z.string().max(80) }), description: 'A notice', component: ({ props }) => <aside>{props.text}</aside> }) };
const input = { version: 1, spec: { root: 'notice', elements: { notice: { type: 'Notice', props: { text: { $state: '/page/title' } } } } } };
const state = { page: { title: '<script>hello</script>', description: '', slug: 'home' }, data: {} };

test('host components share validation, bindings and rendering without changing the default catalog', () => {
  assert.equal(validateDocument(input).success, false);
  const result = validateDocument(input, components);
  assert.equal(result.success, true);
  if (!result.success) return;
  validateResolvedSpec(result.document, state, components);
  const html = renderToStaticMarkup(<SiteRenderer document={result.document} state={state} components={components} />);
  assert.match(html, /<aside>&lt;script&gt;hello&lt;\/script&gt;<\/aside>/);
  assert.throws(() => validateResolvedSpec(result.document, { ...state, page: { ...state.page, title: 'x'.repeat(81) } }, components), /bound data/);
  assert.equal(validateDocument({ ...input, spec: { ...input.spec, elements: { notice: { type: 'Notice', props: { text: 'ok', unknown: true } } } } }, components).success, false);
  assert.equal(validateDocument(input).success, false);
});

test('custom containers support children and cannot replace builtins or introduce unsafe properties', () => {
  const panel = defineComponent({ props: z.object({}), description: 'Panel', container: true, component: ({ children }) => <aside>{children}</aside> });
  const input = { version: 1, spec: { root: 'panel', elements: { panel: { type: 'Panel', props: {}, children: ['text'] }, text: { type: 'Text', props: { text: 'child' } } } } };
  assert.equal(validateDocument(input, { Panel: panel }).success, true);
  assert.equal(validateDocument(input, { Panel: { ...panel, container: false } }).success, false);
  assert.throws(() => componentContract({ Text: panel }), /reserved/);
  for (const key of ['onClick', 'style', 'dangerouslySetInnerHTML', 'constructor']) {
    assert.throws(() => componentContract({ Panel: { ...panel, props: z.object({ [key]: z.string() }) } }), /Unsafe/);
  }
});

test('collection and URL options reject conflicting or nonlocal routes; editors match the configured collection', () => {
  const options = resolveOptions({ collection: 'landing', basePath: '/site', previewPath: '/draft/view', homeSlug: 'index' });
  assert.equal(options.collection, 'landing');
  for (const value of ['https://evil.test', '//evil', '/a/../b', '/a?x=1', '/a/', '/_emdash/admin']) assert.throws(() => resolveOptions({ basePath: value }));
  assert.throws(() => resolveOptions({ basePath: '/draft/view', previewPath: '/draft' }));
  assert.equal(getEditorPageId('/_emdash/admin/content/landing/page-id', 'landing'), 'page-id');
  assert.equal(getEditorPageId('/_emdash/admin/content/pages/page-id', 'landing'), null);
});
