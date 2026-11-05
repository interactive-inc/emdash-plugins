import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { SiteRenderer } from '../../src/builder/renderer.tsx';
import { validateDocument } from '../../src/builder/document.ts';

test('SSR resolves text, repeated data and links while escaping HTML', () => {
  const result = validateDocument({ version: 1, data: { posts: { collection: 'posts' } }, spec: { root: 'grid', elements: {
    grid: { type: 'Grid', props: {}, repeat: { statePath: '/data/posts', key: 'id' }, children: ['title', 'link'] },
    title: { type: 'Heading', props: { text: { $item: 'title' } } },
    link: { type: 'Link', props: { label: 'Read', href: { $template: '/posts/${slug}' } } },
  } } });
  assert.equal(result.success, true);
  if (!result.success) return;
  const html = renderToStaticMarkup(<SiteRenderer document={result.document} state={{ page: { title: 'Example', description: '', slug: 'example' }, data: { posts: [{ id: 'a', title: '<script>alert(1)</script>', slug: 'first' }, { id: 'b', title: 'Second', slug: 'second' }] } }} />);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /href="\/posts\/first"/);
  assert.match(html, /href="\/posts\/second"/);
  assert.match(html, />Second<\/h2>/);
});
test('unsafe URLs supplied by data never become navigable links', () => {
  const result = validateDocument({ version: 1, spec: { root: 'link', elements: { link: { type: 'Link', props: { label: 'Unsafe', href: { $state: '/page/title' } } } } } });
  assert.equal(result.success, true);
  if (!result.success) return;
  const html = renderToStaticMarkup(<SiteRenderer document={result.document} state={{ page: { title: 'javascript:alert(1)', description: '', slug: 'test' }, data: {} }} />);
  assert.doesNotMatch(html, /href=/);
});

test('EmDash rich-text images render safely without HTML injection', () => {
  const result = validateDocument({ version: 1, spec: { root: 'body', elements: { body: { type: 'PortableText', props: { value: [
    { _type: 'image', _key: 'safe', asset: { _ref: 'media-id' }, alt: '<example>', caption: 'A caption' },
    { _type: 'image', _key: 'unsafe', asset: { url: 'javascript:alert(1)' } },
  ] } } } } });
  assert.equal(result.success, true);
  if (!result.success) return;
  const html = renderToStaticMarkup(<SiteRenderer document={result.document} state={{ page: { title: 'Images', description: '', slug: 'images' }, data: {} }} />);
  assert.match(html, /src="\/_emdash\/api\/media\/file\/media-id"/);
  assert.match(html, /&lt;example&gt;/);
  assert.match(html, /<figcaption>A caption<\/figcaption>/);
  assert.doesNotMatch(html, /javascript:/);
});
