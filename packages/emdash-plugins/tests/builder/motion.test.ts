import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validateDocument } from '../../src/builder/document.ts';
import { componentContract, defineComponent } from '../../src/builder/extensions.ts';
import { componentNames, motionComponentNames, staggerComponentNames } from '../../src/builder/catalog.ts';
import { maxMotionElements } from '../../src/builder/motion-tokens.ts';

type Element = { type: string; props: Record<string, unknown>; children?: string[]; repeat?: { statePath: string; key: string } };
const page = (elements: Record<string, Element>, root = 'page', extra: Record<string, unknown> = {}) => ({ version: 1, ...extra, spec: { root, elements } });
const errors = (input: unknown, extensions = {}) => {
  const result = validateDocument(input, extensions);
  return result.success ? [] : result.errors;
};
const fade = { effect: 'fade-up' };

test('every built-in but Section accepts motion; only Stack and Grid stagger', () => {
  assert.deepEqual([...motionComponentNames], componentNames.filter(name => name !== 'Section'));
  assert.deepEqual([...staggerComponentNames], ['Stack', 'Grid']);
  const required: Record<string, Record<string, unknown>> = {
    Heading: { text: 'Title' }, Text: { text: 'Body' }, Badge: { text: 'New' },
    Link: { label: 'Go', href: '/guide' }, Image: { src: '/a.png', alt: '' }, PortableText: { value: [] },
  };
  const types = [...motionComponentNames];
  const elements: Record<string, Element> = { page: { type: 'Section', props: {}, children: types.map(type => type.toLowerCase()) } };
  for (const type of types) elements[type.toLowerCase()] = { type, props: { ...required[type], motion: { effect: 'zoom-in', delay: 'long', duration: 'slow' } } };
  assert.deepEqual(errors(page(elements)), []);
  assert.deepEqual(errors(page({ page: { type: 'Section', props: { motion: fade } } })), ['page.motion: Section stays still; animate the elements inside it']);
});

test('a Section never moves, not even inside a moving element', () => {
  const section = { type: 'Section', props: {}, children: ['title'] };
  const title = { type: 'Heading', props: { text: 'T' } };
  const inside = (type: string) => errors(page({ page: { type, props: { motion: fade }, children: ['hero'] }, hero: section, title }));
  const message = (moving: string) => [`hero: Section stays still, so ${moving} cannot move it; put motion on elements inside the Section`];
  assert.deepEqual(inside('Stack'), message('page'));
  assert.deepEqual(inside('Container'), message('page'));
  assert.deepEqual(errors(page({
    page: { type: 'Grid', props: { motion: { ...fade, stagger: 'short' } }, children: ['card'] },
    card: { type: 'Card', props: {}, children: ['hero'] }, hero: section, title,
  })), message('card'));
});

test('motion accepts only the named tokens and explains each mistake', () => {
  const text = (motion: unknown) => errors(page({ page: { type: 'Text', props: { text: 'Hello', motion } } }));
  assert.match(text({ effect: 'fade', duration: '2s' }).join(), /^page\.motion\.duration: /);
  assert.match(text({ effect: 'spin' }).join(), /^page\.motion\.effect: /);
  assert.deepEqual(text({ duration: 'fast' }), ['page.motion.effect: effect is required']);
  assert.deepEqual(text('fade'), ['page.motion: motion must be an object such as {"effect":"fade-up"}']);
  assert.deepEqual(text({ effect: 'fade', easing: 'linear' }), ['page.motion: unknown motion setting easing; allowed: effect, delay, duration']);
  assert.deepEqual(text({ effect: 'fade', stagger: 'short' }), ['page.motion: stagger works only on Stack and Grid']);
  for (const motion of [{ $state: '/page/title' }, { $item: 'motion' }, { $template: 'fade' }]) assert.equal(text(motion)[0], 'page.motion: motion cannot be bound to data');
});

test('stagger moves the direct children of a Stack or Grid, which must not move on their own', () => {
  const list = (child: Element, motion: Record<string, unknown> = { ...fade, stagger: 'medium' }) =>
    errors(page({ page: { type: 'Grid', props: { motion }, children: ['item'] }, item: child }));
  assert.deepEqual(list({ type: 'Card', props: {} }), []);
  assert.deepEqual(list({ type: 'Card', props: { motion: fade } }), ['item.motion: page already staggers its children; remove this motion']);
  assert.deepEqual(list({ type: 'Section', props: {} }), ['item: Section cannot move, so page cannot stagger it']);
  assert.deepEqual(errors(page({ page: { type: 'Stack', props: { motion: { ...fade, stagger: 'short' } } } })), ['page.motion: stagger needs children']);
  // A staggered child moves, so nothing inside it may move as well.
  assert.deepEqual(errors(page({
    page: { type: 'Stack', props: { motion: { ...fade, stagger: 'short' } }, children: ['card'] },
    card: { type: 'Card', props: {}, children: ['title'] },
    title: { type: 'Heading', props: { text: 'T', motion: fade } },
  })), ["title.motion: card already moves with page's stagger; remove this motion or the stagger on page"]);
});

test('nothing moves inside a moving element, at any depth', () => {
  assert.deepEqual(errors(page({
    page: { type: 'Container', props: { motion: fade }, children: ['stack'] },
    stack: { type: 'Stack', props: {}, children: ['title'] },
    title: { type: 'Heading', props: { text: 'T', motion: { effect: 'fade' } } },
  })), ['title.motion: page already moves this element; keep motion on only one of them']);
  // A still container may hold several moving siblings.
  assert.deepEqual(errors(page({
    page: { type: 'Section', props: {}, children: ['a', 'b'] },
    a: { type: 'Heading', props: { text: 'A', motion: fade } },
    b: { type: 'Text', props: { text: 'B', motion: fade } },
  })), []);
});

test(`at most ${maxMotionElements} elements may move`, () => {
  const build = (count: number) => {
    const children = Array.from({ length: count }, (_, index) => `t${index}`);
    const elements: Record<string, Element> = { page: { type: 'Stack', props: {}, children } };
    for (const key of children) elements[key] = { type: 'Text', props: { text: key, motion: fade } };
    return page(elements);
  };
  const limit = (count: number) => `At most ${maxMotionElements} elements may move; this page moves up to ${count}, counting each staggered child and each repeated copy`;
  assert.deepEqual(errors(build(maxMotionElements)), []);
  assert.deepEqual(errors(build(maxMotionElements + 1)), [limit(maxMotionElements + 1)]);
  // One authored stagger moves every child.
  const children = Array.from({ length: maxMotionElements + 1 }, (_, index) => `c${index}`);
  const staggered: Record<string, Element> = { page: { type: 'Stack', props: { motion: { effect: 'fade', stagger: 'short' } }, children } };
  for (const key of children) staggered[key] = { type: 'Card', props: {} };
  assert.deepEqual(errors(page(staggered)), [limit(maxMotionElements + 1)]);
  // A repeat moves one copy per item the query can return: its limit, or six when unset.
  const repeated = (limit?: number) => page({
    page: { type: 'Grid', props: {}, repeat: { statePath: '/data/posts', key: 'id' }, children: ['card', 'note'] },
    card: { type: 'Card', props: { motion: fade } },
    note: { type: 'Text', props: { text: { $item: 'title' }, motion: fade } },
  }, 'page', { data: { posts: { collection: 'posts', ...(limit ? { limit } : {}) } } });
  assert.deepEqual(errors(repeated()), []);
  assert.deepEqual(errors(repeated(20)), []);
  assert.deepEqual(errors(repeated(21)), [limit(42)]);
});

test('custom components accept motion only when they declare it, and cannot define their own motion prop', () => {
  const definition = { props: z.object({ text: z.string() }), description: 'Quote', component: () => null };
  const doc = page({ page: { type: 'Quote', props: { text: 'Hi', motion: fade } } });
  assert.deepEqual(errors(doc, { Quote: defineComponent(definition) }), ['page.motion: Quote does not support motion; animate an element inside or around it']);
  assert.deepEqual(errors(doc, { Quote: defineComponent({ ...definition, motion: true }) }), []);
  assert.match(errors(page({ page: { type: 'Quote', props: { text: 'Hi', motion: { effect: 'fade', stagger: 'short' } } } }), { Quote: defineComponent({ ...definition, motion: true }) }).join(), /stagger works only on Stack and Grid/);
  assert.throws(() => componentContract({ Quote: { ...definition, props: z.object({ motion: z.string() }) } }), /Unsafe component property: Quote\.motion/);
  assert.throws(() => componentContract({ Quote: { ...definition, motion: 'yes' as never } }), /Invalid component definition/);
  assert.deepEqual([...componentContract({ Quote: { ...definition, motion: true } }).motion].includes('Quote'), true);
});
