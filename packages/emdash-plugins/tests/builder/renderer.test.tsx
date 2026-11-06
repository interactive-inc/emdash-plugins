import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { SiteRenderer } from '../../src/builder/renderer.tsx';
import { validateDocument } from '../../src/builder/document.ts';
import { resolvePage } from '../../src/builder/resolve-page.ts';

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

test("pageResponse()'s resolved view and a document with state render the same static page", () => {
  const result = validateDocument({ version: 1, data: { posts: { collection: 'posts' } }, spec: { root: 'grid', elements: {
    grid: { type: 'Grid', props: { motion: { effect: 'fade-up', stagger: 'medium' } }, repeat: { statePath: '/data/posts', key: 'id' }, children: ['title'] },
    title: { type: 'Heading', props: { text: { $item: 'title' } } },
  } } });
  assert.equal(result.success, true);
  if (!result.success) return;
  const state = { page: { title: 'Posts', description: '', slug: 'posts' }, data: { posts: [{ id: 'a', title: 'First' }, { id: 'b', title: 'Second' }] } };
  const view = resolvePage(result.document, state);
  assert.equal(view.motion, true);
  const fromView = renderToStaticMarkup(<SiteRenderer view={view} />);
  assert.equal(fromView, renderToStaticMarkup(<SiteRenderer document={result.document} state={state} />));
  assert.match(fromView, />Second<\/h2>/);
  assert.doesNotMatch(fromView, /data-motion|style="opacity/);
});

test('links, images and rich text render exactly the URLs that pass the boundary', () => {
  const result = validateDocument({ version: 1, spec: { root: 'page', elements: {
    page: { type: 'Stack', props: {}, children: ['safe', 'unsafe', 'image', 'insecure', 'body'] },
    safe: { type: 'Link', props: { label: 'Safe', href: 'https://example.com/?a=1&b=2', variant: 'primary' } },
    unsafe: { type: 'Link', props: { label: 'Unsafe', href: 'javascript:alert(1)' } },
    image: { type: 'Image', props: { src: '/a.png', alt: '<a>', ratio: 'square' } },
    insecure: { type: 'Image', props: { src: 'http://example.com/a.png', alt: '' } },
    body: { type: 'PortableText', props: { value: [
      { _type: 'block', _key: 'b', markDefs: [{ _type: 'link', _key: 'ok', href: '/guide' }, { _type: 'link', _key: 'bad', href: 'javascript:alert(1)' }], children: [
        { _type: 'span', _key: 'x', text: 'Guide', marks: ['ok', 'em'] }, { _type: 'span', _key: 'y', text: 'Bad', marks: ['bad'] },
      ] },
      { _type: 'image', _key: 'u', asset: { url: 'https://example.com/i.png' }, alt: '<alt>', caption: 'Cap' },
      { _type: 'image', _key: 'j', asset: { url: 'javascript:alert(1)', _ref: 'media-id' } },
      { _type: 'image', _key: 'r', asset: { _ref: 'media id/2' } },
    ] } },
  } } });
  assert.equal(result.success, true);
  if (!result.success) return;
  const html = renderToStaticMarkup(<SiteRenderer document={result.document} state={{ page: { title: 'Links', description: '', slug: 'links' }, data: {} }} />);
  assert.equal(html.replace(/^<div class="site"[^>]*>/, ''), [
    '<div class="stack direction-vertical gap-md align-start">',
    '<a href="https://example.com/?a=1&amp;b=2" class="link link-primary">Safe</a><span>Unsafe</span>',
    '<img src="/a.png" alt="&lt;a&gt;" class="image ratio-square" loading="lazy" decoding="async"/>',
    '<div class="prose"><p><a href="/guide"><em>Guide</em></a><span>Bad</span></p>',
    '<figure><img src="https://example.com/i.png" alt="&lt;alt&gt;" loading="lazy" decoding="async"/><figcaption>Cap</figcaption></figure>',
    '<figure><img src="/_emdash/api/media/file/media%20id%2F2" alt="" loading="lazy" decoding="async"/></figure>',
    '</div></div></div>',
  ].join(''));
});

test('inline rich-text images stay inside their paragraph, and unsafe ones render nothing', () => {
  const result = validateDocument({ version: 1, spec: { root: 'body', elements: { body: { type: 'PortableText', props: { value: [
    { _type: 'block', _key: 'b', children: [
      { _type: 'span', _key: 'x', text: 'Before ' },
      { _type: 'image', _key: 'safe', asset: { url: 'https://example.com/inline.png' }, alt: 'inline', caption: 'Caption' },
      { _type: 'image', _key: 'unsafe', asset: { url: 'javascript:alert(1)' } },
      { _type: 'span', _key: 'y', text: ' after' },
    ] },
  ] } } } } });
  assert.equal(result.success, true);
  if (!result.success) return;
  const html = renderToStaticMarkup(<SiteRenderer document={result.document} state={{ page: { title: 'Inline', description: '', slug: 'inline' }, data: {} }} />);
  // A figure would make the browser close the paragraph early, so hydration would not match.
  assert.match(html, /<p>Before <img src="https:\/\/example.com\/inline.png" alt="inline" loading="lazy" decoding="async"\/> after<\/p>/);
  assert.doesNotMatch(html, /<figure|Caption/);
  assert.doesNotMatch(html, /javascript:/);
});

test('a document with the host state renders every item, not just the query limit', () => {
  const result = validateDocument({ version: 1, data: { posts: { collection: 'posts' } }, spec: { root: 'grid', elements: {
    grid: { type: 'Grid', props: { motion: { effect: 'fade-up', stagger: 'short' } }, repeat: { statePath: '/data/posts', key: 'id' }, children: ['title'] },
    title: { type: 'Heading', props: { text: { $item: 'title' } } },
  } } });
  assert.equal(result.success, true);
  if (!result.success) return;
  const posts = Array.from({ length: 10 }, (_, index) => ({ id: `p${index}`, title: `Post ${index}` }));
  const html = renderToStaticMarkup(<SiteRenderer document={result.document} state={{ page: { title: 'Posts', description: '', slug: 'posts' }, data: { posts } }} />);
  assert.equal(html.match(/<h2/g)?.length, 10);
  assert.doesNotMatch(html, /data-motion|style="opacity/);
});
