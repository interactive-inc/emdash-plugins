import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validateDocument, type PageDocument, type PageState } from '../../src/builder/document.ts';
import { defineComponent, type ComponentExtensions } from '../../src/builder/extensions.ts';
import { resolvePage } from '../../src/builder/resolve-page.ts';

const state = (data: Record<string, unknown> = {}, title = 'Title'): PageState => ({ page: { title, description: 'DESCRIPTION-SENTINEL', slug: 'home' }, data });
function valid(input: unknown, extensions: ComponentExtensions = {}): PageDocument {
  const result = validateDocument(input, extensions);
  assert.equal(result.success, true, result.success ? '' : result.errors.join('; '));
  return (result as { document: PageDocument }).document;
}
const posts = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `p${index}`, title: `Post ${index}`, secret: 'SECRET-SENTINEL' }));
const list = valid({ version: 1, data: { posts: { collection: 'posts', limit: 24 } }, spec: { root: 'page', elements: {
  page: { type: 'Section', props: {}, children: ['title', 'grid', 'hidden'] },
  title: { type: 'Heading', props: { text: { $state: '/page/title' }, level: 'h1', motion: { effect: 'fade' } } },
  grid: { type: 'Grid', props: { motion: { effect: 'fade-up', duration: 'slow', stagger: 'medium' } }, repeat: { statePath: '/data/posts', key: 'id' }, children: ['card'] },
  card: { type: 'Card', props: {}, children: ['name'] },
  name: { type: 'Heading', props: { text: { $item: 'title' }, level: 'h3' } },
  hidden: { type: 'Text', props: { text: 'HIDDEN-SENTINEL' }, visible: false },
} } });

test('repeats expand to key~index IDs and a staggering container hands its motion to each item', () => {
  const view = resolvePage(list, state({ posts: posts(3) }));
  assert.equal(view.motion, true);
  assert.equal(view.spec.root, 'page');
  assert.deepEqual(view.spec.elements.page!.children, ['title', 'grid']);
  assert.deepEqual(view.spec.elements.grid, { type: 'Grid', props: {}, children: ['card~0', 'card~1', 'card~2'] });
  for (const index of [0, 1, 2]) {
    assert.deepEqual(view.spec.elements[`card~${index}`], { type: 'Card', props: { motion: { effect: 'fade-up', delay: 'none', duration: 'slow', stagger: 'medium', group: 'grid' } }, children: [`name~${index}`] });
    assert.deepEqual(view.spec.elements[`name~${index}`], { type: 'Heading', props: { text: `Post ${index}`, level: 'h3' } });
  }
  assert.deepEqual(view.spec.elements.title!.props, { text: 'Title', level: 'h1', motion: { effect: 'fade', delay: 'none', duration: 'normal' } });
  assert.equal(resolvePage(list, state({ posts: posts(30) })).spec.elements.grid!.children!.length, 24);
  // Never more copies than the query asks for, which is what validation counts toward the motion limit.
  const unlimited = valid({ ...list, data: { posts: { collection: 'posts' } } });
  assert.equal(resolvePage(unlimited, state({ posts: posts(30) })).spec.elements.grid!.children!.length, 6);
  assert.throws(() => resolvePage(list, state({ posts: 'not a list' })), /grid: repeat source must be a list/);
});

test('the view carries only what renders: no state, hidden elements or unrendered fields', () => {
  const view = resolvePage(list, state({ posts: posts(2) }));
  const json = JSON.stringify(view);
  for (const sentinel of ['SECRET-SENTINEL', 'DESCRIPTION-SENTINEL', 'HIDDEN-SENTINEL', '$state', '$item', 'statePath', 'repeat', 'visible']) assert.equal(json.includes(sentinel), false, sentinel);
  assert.deepEqual(Object.keys(view).sort(), ['motion', 'spec', 'theme']);
  assert.equal(view.theme['--accent'], '#d4ff5a');
  assert.deepEqual(JSON.parse(json), view);
});

test('with motion disabled no element carries motion and repeats render every item given', () => {
  const view = resolvePage(list, state({ posts: posts(2) }), {}, { motion: false });
  assert.equal(view.motion, false);
  for (const element of Object.values(view.spec.elements)) assert.equal('motion' in element.props, false);
  // The cap exists only for the motion limit; a host's own state is never cut.
  const unlimited = valid({ ...list, data: { posts: { collection: 'posts' } } });
  assert.equal(resolvePage(unlimited, state({ posts: posts(10) }), {}, { motion: false }).spec.elements.grid!.children!.length, 10);
});

test('unsafe URLs from data never reach the renderer or the browser', () => {
  const document = valid({ version: 1, spec: { root: 'page', elements: {
    page: { type: 'Stack', props: {}, children: ['link', 'image'] },
    link: { type: 'Link', props: { label: 'Go', href: { $state: '/page/title' } } },
    image: { type: 'Image', props: { src: { $state: '/page/title' }, alt: { $state: '/page/title' } } },
  } } });
  const view = resolvePage(document, state({}, 'javascript:alert(1)'));
  // A Link without a safe href still shows its label; an Image without a safe src shows nothing, so it is left out.
  assert.equal(view.spec.elements.link!.props.href, '');
  assert.deepEqual(view.spec.elements.page!.children, ['link']);
  assert.equal(JSON.stringify(view).includes('javascript:'), false);
  const safe = resolvePage(document, state({}, '/guide'));
  assert.equal(safe.spec.elements.link!.props.href, '/guide');
  assert.equal(safe.spec.elements.image!.props.src, '/guide');
});

test('an Image without a safe src is left out, so neither its alt nor its motion reaches the browser', () => {
  const image = (src: string, motion?: object) => ({ type: 'Image', props: { src, alt: 'ALT-SENTINEL', ...(motion ? { motion } : {}) } });
  const own = resolvePage(valid({ version: 1, spec: { root: 'page', elements: {
    page: { type: 'Section', props: {}, children: ['image'] }, image: image('http://example.com/a.png', { effect: 'fade' }),
  } } }), state());
  assert.equal(own.motion, false);
  assert.deepEqual(own.spec.elements.page!.children, []);
  assert.equal(JSON.stringify(own).includes('ALT-SENTINEL'), false);
  const grid = (...sources: string[]) => resolvePage(valid({ version: 1, spec: { root: 'page', elements: {
    page: { type: 'Grid', props: { motion: { effect: 'fade', stagger: 'short' } }, children: sources.map((_, index) => `i${index}`) },
    ...Object.fromEntries(sources.map((src, index) => [`i${index}`, image(src)])),
  } } }), state());
  assert.equal(grid('javascript:alert(1)', 'http://example.com/a.png').motion, false);
  const mixed = grid('javascript:alert(1)', '/a.png');
  assert.deepEqual(mixed.spec.elements.page!.children, ['i1']);
  assert.equal('i0' in mixed.spec.elements, false);
  assert.deepEqual(mixed.spec.elements.i1!.props.motion, { effect: 'fade', delay: 'none', duration: 'normal', stagger: 'short', group: 'page' });
});

test('rich text keeps only displayed fields and the position of unknown blocks', () => {
  const document = valid({ version: 1, spec: { root: 'body', elements: { body: { type: 'PortableText', props: { value: [
    { _type: 'block', _key: 'b', style: 'normal', secret: 'SECRET-SENTINEL', markDefs: [
      { _type: 'link', _key: 'safe', href: 'https://example.com', secret: 'SECRET-SENTINEL' },
      { _type: 'link', _key: 'unsafe', href: 'javascript:alert(1)' },
      { _type: 'link', _key: 'other', href: '/other' },
      { _type: 'link', _key: '', href: '/empty' },
    ], children: [
      { _type: 'span', _key: 's', text: 'Hello', marks: ['safe', 'unsafe', 3], secret: 'SECRET-SENTINEL' },
      // One anchor per span: a second link, or the same one twice, would nest <a> elements.
      { _type: 'span', _key: 'two', text: 'Both', marks: ['em', 'safe', 'em', 'other', 'safe'] },
      { _type: 'span', _key: 'blank', text: 'Blank', marks: ['', 'other'] },
      { _type: 'image', _key: 'ii', asset: { url: 'https://example.com/inline.png' }, alt: 'inline', caption: 'Not shown inline', secret: 'SECRET-SENTINEL' },
      { _type: 'image', _key: 'ij', asset: { url: 'javascript:alert(1)' } },
      { _type: 'mention', _key: 'm', name: 'SECRET-SENTINEL' },
    ] },
    // A style PortableContent does not render would fall back to <p>, which cannot hold a nested list.
    { _type: 'block', _key: 'l', style: 'lead', listItem: 'bullet', level: 1, children: [{ _type: 'span', _key: 'x', text: 'Item' }] },
    { _type: 'code', _key: 'c', code: 'SECRET-SENTINEL' },
    { _type: 'image', _key: 'i', asset: { url: 'javascript:alert(1)', _ref: 'media-id' }, alt: 'A' },
    { _type: 'image', _key: 'r', asset: { _ref: 'media-id' } },
  ] } } } } });
  const value = resolvePage(document, state()).spec.elements.body!.props.value;
  assert.deepEqual(value, [
    { _type: 'block', _key: 'b', style: 'normal', markDefs: [{ _type: 'link', _key: 'safe', href: 'https://example.com' }, { _type: 'link', _key: 'unsafe' }, { _type: 'link', _key: 'other', href: '/other' }, { _type: 'link', _key: '', href: '/empty' }], children: [
      { _type: 'span', _key: 's', text: 'Hello', marks: ['safe', 'unsafe'] },
      { _type: 'span', _key: 'two', text: 'Both', marks: ['em', 'safe'] },
      { _type: 'span', _key: 'blank', text: 'Blank', marks: [''] },
      { _type: 'image', _key: 'ii', src: 'https://example.com/inline.png', alt: 'inline' },
      { _type: 'builder-omitted', _key: 'ij' },
      { _type: 'builder-omitted', _key: 'm' },
    ] },
    { _type: 'block', _key: 'l', listItem: 'bullet', level: 1, markDefs: [], children: [{ _type: 'span', _key: 'x', text: 'Item', marks: [] }] },
    { _type: 'builder-omitted', _key: 'c' },
    { _type: 'builder-omitted', _key: 'i' },
    { _type: 'image', _key: 'r', src: '/_emdash/api/media/file/media-id' },
  ]);
});

test('custom components receive only the fields their nested schemas declare', () => {
  const Posts = defineComponent({
    props: z.object({ posts: z.array(z.object({ title: z.string() })), author: z.object({ name: z.string() }) }),
    description: 'Posts', motion: true, component: () => null,
  });
  const document = valid({ version: 1, data: { posts: { collection: 'posts' }, one: { collection: 'posts', id: 'p0' } }, spec: { root: 'list', elements: {
    list: { type: 'Posts', props: { posts: { $state: '/data/posts' }, author: { $state: '/data/one/nested' }, motion: { effect: 'fade' } } },
  } } }, { Posts });
  const view = resolvePage(document, state({ posts: posts(2), one: { id: 'p0', nested: { name: 'Ada', email: 'SECRET-SENTINEL' } } }), { Posts });
  assert.equal(JSON.stringify(view).includes('SECRET-SENTINEL'), false);
  assert.deepEqual(view.spec.elements.list!.props, {
    posts: [{ title: 'Post 0' }, { title: 'Post 1' }], author: { name: 'Ada' }, motion: { effect: 'fade', delay: 'none', duration: 'normal' },
  });
});

test('$-keyed data is stripped so the browser renderer never resolves it again', () => {
  const List = defineComponent({ props: z.object({ items: z.array(z.looseObject({ label: z.string() })) }), description: 'List', component: () => null });
  const document = valid({ version: 1, spec: { root: 'list', elements: { list: { type: 'List', props: { items: [{ label: 'a', $foo: 'x' }] } } } } }, { List });
  assert.deepEqual(resolvePage(document, state(), { List }).spec.elements.list!.props, { items: [{ label: 'a' }] });
});

test('dates arrive as the ISO strings JSON gives, not as empty objects', () => {
  const Meta = defineComponent({ props: z.object({ when: z.unknown(), post: z.looseObject({ title: z.string() }) }), description: 'Meta', component: () => null });
  const document = valid({ version: 1, data: { posts: { collection: 'posts' } }, spec: { root: 'grid', elements: {
    grid: { type: 'Grid', props: {}, repeat: { statePath: '/data/posts', key: 'id' }, children: ['meta'] },
    meta: { type: 'Meta', props: { when: { $item: 'publishedAt' }, post: { $item: 'meta' } } },
  } } }, { Meta });
  const publishedAt = new Date('2020-01-01T00:00:00.000Z');
  const view = resolvePage(document, state({ posts: [{ id: 'p0', publishedAt, meta: { title: 'Post', updatedAt: publishedAt } }] }), { Meta });
  assert.deepEqual(view.spec.elements['meta~0']!.props, { when: '2020-01-01T00:00:00.000Z', post: { title: 'Post', updatedAt: '2020-01-01T00:00:00.000Z' } });
});
