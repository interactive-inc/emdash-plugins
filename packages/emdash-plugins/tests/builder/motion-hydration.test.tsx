import { animations, enter, frames, isObserved, place, preferReducedMotion, relayout, window } from './helpers/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { LazyMotion, domAnimation } from 'motion/react';
import builderMotion from '../../src/builder/motion-directive.ts';
import { MotionSite } from '../../src/builder/motion-site.tsx';
import { MotionStage, Reveal, StageContext } from '../../src/builder/reveal.tsx';
import { validateDocument, type PageDocument } from '../../src/builder/document.ts';
import { resolvePage, type ResolvedView } from '../../src/builder/resolve-page.ts';
import { hostComponents } from './helpers/host-components.tsx';

const state = { page: { title: 'Title', description: '', slug: 'home' }, data: {} };
function view(input: unknown): ResolvedView {
  const result = validateDocument(input, hostComponents);
  assert.equal(result.success, true, result.success ? '' : result.errors.join('; '));
  return resolvePage((result as { document: PageDocument }).document, state, hostComponents);
}
const page = view({ version: 1, spec: { root: 'hero', elements: {
  hero: { type: 'Section', props: {}, children: ['title', 'photo', 'article', 'cards', 'note', 'cta', 'body'] },
  title: { type: 'Heading', props: { text: 'Hello', level: 'h1', motion: { effect: 'fade-up', duration: 'fast' } } },
  photo: { type: 'Photo', props: { src: '/photo.jpg', motion: { effect: 'fade' } } },
  article: { type: 'Article', props: { title: 'News', motion: { effect: 'fade-up' } } },
  cards: { type: 'Grid', props: { motion: { effect: 'zoom-in', stagger: 'medium' } }, children: ['a', 'b', 'c'] },
  a: { type: 'Card', props: {}, children: ['a-text'] }, 'a-text': { type: 'Text', props: { text: 'A' } },
  b: { type: 'Card', props: {} }, c: { type: 'Card', props: {} },
  note: { type: 'Text', props: { text: 'Still' } },
  cta: { type: 'Link', props: { label: 'Go', href: '/guide', motion: { effect: 'fade' } } },
  // The browser parses the server markup, so rich text must not nest what it would split apart:
  // a figure inside a paragraph, one link inside another, or a list inside a paragraph.
  body: { type: 'PortableText', props: { value: [{ _type: 'block', _key: 'p', markDefs: [
    { _type: 'link', _key: 'a', href: '/a' }, { _type: 'link', _key: 'b', href: '/b' }, { _type: 'link', _key: '', href: '/c' },
  ], children: [
    { _type: 'span', _key: 's', text: 'Inline ' }, { _type: 'image', _key: 'i', asset: { url: '/inline.png' }, alt: '', caption: 'Hidden' },
    { _type: 'span', _key: 'one', text: 'one ', marks: ['a'] }, { _type: 'span', _key: 'two', text: 'two', marks: ['a', 'b'] },
    { _type: 'span', _key: 'three', text: 'three', marks: ['', 'b'] },
  ] },
  { _type: 'block', _key: 'l1', style: 'lead', listItem: 'bullet', level: 1, children: [{ _type: 'span', _key: 'x', text: 'Item' }] },
  { _type: 'block', _key: 'l2', style: 'normal', listItem: 'bullet', level: 2, children: [{ _type: 'span', _key: 'y', text: 'Nested' }] }] } },
} } });

/** The server renders without browser globals, so its markup comes from a separate process. */
const server: { browser: boolean; motion: string; static: string } = JSON.parse(execFileSync(process.execPath, [
  ...process.execArgv.filter(argument => !argument.startsWith('--test')),
  fileURLToPath(new URL('./helpers/render-server.tsx', import.meta.url)),
], { input: JSON.stringify(page), encoding: 'utf8' }));
const parse = (html: string) => { const root = window.document.createElement('div'); root.innerHTML = html; return root; };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Counts the frames requested until `stop`, which restores requestAnimationFrame. */
function spyFrames() {
  const { requestAnimationFrame } = globalThis;
  const spy = { count: 0, stop: () => { globalThis.requestAnimationFrame = requestAnimationFrame; } };
  globalThis.requestAnimationFrame = callback => { spy.count++; return requestAnimationFrame(callback); };
  return spy;
}

/** Hydrates the server markup of `page`; `arrange` runs on the markup before hydration. */
async function hydrate(arrange?: (container: HTMLElement) => void) {
  const container = window.document.createElement('main');
  container.innerHTML = server.motion;
  window.document.body.append(container);
  arrange?.(container);
  let root!: Root;
  await act(async () => { root = hydrateRoot(container, <MotionSite view={page} components={hostComponents} />); });
  await act(() => frames(3));
  const unmount = async () => { await act(async () => root.unmount()); container.remove(); };
  return { container, unmount };
}

test('the server renders each moving element transparent in place on its own tag', () => {
  assert.equal(server.browser, false);
  const root = parse(server.motion);
  const title = root.querySelector('h1')!;
  assert.equal(title.parentElement!.tagName, 'SECTION');
  assert.equal(title.getAttribute('style'), 'opacity:0', 'no start transform: it waits where it ends up');
  assert.equal(title.hasAttribute('data-motion'), true);
  const grid = root.querySelector('.grid')!;
  assert.equal(grid.hasAttribute('style') || grid.hasAttribute('data-motion'), false, 'a staggering container stays still');
  for (const card of grid.children) assert.equal(card.getAttribute('style'), 'opacity:0');
  assert.equal(root.querySelector('a')!.getAttribute('style'), 'opacity:0');
  assert.equal(root.querySelector('.text')!.hasAttribute('data-motion'), false);
  // Host components move their Root alone: a void tag gets no children, and a nested Root stays still.
  assert.equal(root.querySelector('img')!.outerHTML, '<img src="/photo.jpg" alt="" data-motion="" style="opacity:0">');
  const article = root.querySelector('article')!;
  assert.equal(article.getAttribute('style'), 'opacity:0');
  assert.equal(article.innerHTML, '<h2>News</h2>');
  assert.equal(root.querySelectorAll('[data-motion]').length, 7);
  // Apart from that opacity, the island markup is the static markup.
  const stripped = server.motion.replace(/ style="[^"]*" data-motion=""| data-motion="" style="[^"]*"/g, '');
  assert.equal(stripped, server.static);
  assert.doesNotMatch(server.static, /data-motion/);
});

test('hydration matches the server markup, then plays each element once as it enters', async () => {
  const container = window.document.createElement('main');
  container.innerHTML = server.motion;
  window.document.body.append(container);
  const errors: unknown[] = [];
  const consoleError = console.error;
  console.error = (...input: unknown[]) => { errors.push(input); };
  let root!: Root;
  try {
    await act(async () => { root = hydrateRoot(container, <MotionSite view={page} components={hostComponents} />, { onRecoverableError: error => { errors.push(error); } }); });
    await act(() => frames());
  } finally { console.error = consoleError; }
  assert.deepEqual(errors, []);
  const moving = [...container.querySelectorAll<HTMLElement>('[data-motion]')];
  assert.equal(moving.length, 7);
  for (const element of moving) {
    assert.equal(element.hasAttribute('data-motion-armed'), true);
    assert.equal(isObserved(element), true);
    assert.equal(element.style.opacity, '0', 'nothing plays before it enters the viewport');
    assert.equal(element.style.transform, '', 'it waits where it ends up, so the browser judges what shows');
  }
  const title = container.querySelector<HTMLElement>('h1')!;
  await act(async () => { enter(title); });
  await act(() => frames(2));
  assert.match(title.style.transform, /^translateY\((?!0px)[\d.]+px\)$/, 'the entrance starts from the effect\'s start state');
  assert.equal(isObserved(title), false, 'watched no longer');
  await act(() => wait(500));
  assert.equal(title.style.opacity, '1');
  assert.equal(title.style.transform, 'none');
  assert.equal(container.querySelector<HTMLElement>('a')!.style.opacity, '0');
  const cards = [...container.querySelectorAll<HTMLElement>('.card')];
  const hosts = ['img', 'article'].map(selector => container.querySelector<HTMLElement>(selector)!);
  await act(async () => { enter(...cards, ...hosts); });
  await act(() => wait(900));
  for (const element of [...cards, ...hosts]) assert.equal(element.style.opacity, '1');
  assert.equal(container.querySelector('article h2')!.hasAttribute('style'), false);
  // Scrolled past before it ever entered (for example after scroll restoration): shown without playing.
  const link = container.querySelector<HTMLElement>('a')!;
  place(link, { top: -300, bottom: -260 });
  await act(async () => { relayout(); });
  await act(() => frames(3));
  assert.equal(link.style.opacity, '1', 'within three frames, far shorter than the fade');
  assert.equal(isObserved(link), false);
  await act(async () => root.unmount());
  container.remove();
});

test('an element whose animation cannot render stays visible as the plain element', async () => {
  // A view that bypassed validation: the effect has no tokens, so Motion cannot build it.
  const broken: ResolvedView = { theme: {}, motion: true, spec: { root: 'page', elements: {
    page: { type: 'Section', props: {}, children: ['title', 'body'] },
    title: { type: 'Heading', props: { text: 'Kept', level: 'h2', motion: { effect: 'spin', delay: 'none', duration: 'normal' } } },
    body: { type: 'Text', props: { text: 'Moves', motion: { effect: 'fade', delay: 'none', duration: 'normal' } } },
  } } } as unknown as ResolvedView;
  const container = window.document.createElement('main');
  window.document.body.append(container);
  const logged: unknown[] = [];
  const consoleError = console.error;
  console.error = (...input: unknown[]) => { logged.push(input); };
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<MotionSite view={broken} components={{}} />); });
  } finally { console.error = consoleError; }
  const title = container.querySelector('h2')!;
  assert.equal(title.textContent, 'Kept');
  assert.equal(title.hasAttribute('data-motion') || title.hasAttribute('style'), false);
  assert.equal(container.querySelector('p')!.hasAttribute('data-motion'), true, 'the rest of the page still moves');
  assert.doesNotMatch(JSON.stringify(logged.map(String)), /\[json-render\] Rendering error/);
  await act(async () => root.unmount());
  container.remove();
});

test('stagger order counts the items of one group that enter in the same frame', async () => {
  const stage = new MotionStage();
  assert.deepEqual([stage.order('cards'), stage.order('cards'), stage.order('posts'), stage.order('cards')], [0, 1, 0, 2]);
  await frames(1);
  assert.deepEqual([stage.order('cards'), stage.order('posts')], [0, 0]);
});

test('a visible pixel decides, and only an element wholly above the viewport counts as scrolled past', async () => {
  const create = () => window.document.createElement('div');
  const [far, above, edge, straddling, touching, folded, foldedAbove, flat, flatAbove, below, drawer, inDrawer, panel, inPanel, noBox] = Array.from({ length: 15 }, create);
  drawer.style.position = 'fixed';
  drawer.append(inDrawer);
  // A custom element whose shadow root holds the fixed box, with the content assigned to its slot.
  const fixed = create();
  fixed.style.position = 'fixed';
  fixed.append(window.document.createElement('slot'));
  panel.attachShadow({ mode: 'open' }).append(fixed);
  panel.append(inPanel);
  // The document exposes an element named "host" (an iframe here, a form or an image alike) as document.host.
  const named = Object.assign(window.document.createElement('iframe'), { name: 'host' });
  window.document.body.append(far, above, edge, straddling, touching, folded, foldedAbove, flat, flatAbove, below, drawer, panel, noBox, named);
  // A long page restored far down.
  place(far, { top: -50000, bottom: -49900 });
  place(above, { top: -200, bottom: -100 });
  // Touching an edge shows nothing, as when a collapsed accordion holds its first child at its edge.
  place(edge, { top: -40, bottom: 0 });
  place(touching, { top: 768, bottom: 800 });
  place(folded, { top: 100, bottom: 130, clip: { top: 100, bottom: 100 } });
  // No area, its content overflowing it: there is no pixel to wait for.
  place(flat, { top: 100, bottom: 100 });
  place(flatAbove, { top: -100, bottom: -100 });
  place(foldedAbove, { top: -300, bottom: -270, clip: { top: -300, bottom: -300 } });
  place(straddling, { top: -50, bottom: 50 });
  // A drawer hidden above the viewport by its own transform: scrolling never brings it back.
  place(inDrawer, { top: -40, bottom: -1 });
  place(inPanel, { top: -40, bottom: -1 });
  place(noBox, { top: 0, bottom: 0, width: 0 });
  const stage = new MotionStage();
  const calls: string[] = [];
  const forget = Object.entries({ far, above, edge, straddling, touching, folded, foldedAbove, flat, flatAbove, below, inDrawer, inPanel, noBox }).map(([name, element]) =>
    stage.watch(element, { entered: () => calls.push(`${name} entered`), passed: () => calls.push(`${name} passed`) }));
  await frames(1);
  // Partly in the viewport and partly above it: it enters, whichever observer reports first.
  assert.deepEqual(calls.sort(), ['above passed', 'edge passed', 'far passed', 'flat entered', 'flatAbove passed', 'straddling entered']);
  for (const element of [far, above, edge, straddling, flat, flatAbove]) assert.equal(isObserved(element), false);
  for (const element of [touching, folded, foldedAbove]) assert.equal(isObserved(element), true);
  // Opening both accordions shows their content: in the viewport it plays, above it it counts as scrolled past.
  place(touching, { top: 767, bottom: 799 });
  place(folded, { top: 100, bottom: 130 });
  place(foldedAbove, { top: -300, bottom: -270 });
  place(inDrawer, { top: 0, bottom: 40 });
  place(inPanel, { top: 0, bottom: 40 });
  place(below, { top: -300, bottom: -200 });
  relayout();
  await frames(1);
  assert.deepEqual(calls.slice(6).sort(), ['below passed', 'folded entered', 'foldedAbove passed', 'inDrawer entered', 'inPanel entered', 'touching entered'], 'reported once each, and the opened drawers play');
  relayout();
  await frames(1);
  assert.equal(calls.length, 12);
  assert.equal(isObserved(noBox), true, 'without a box, nothing is decided');
  forget.at(-1)!();
  assert.equal(isObserved(noBox), false, 'unmounting stops watching');
  for (const element of [far, above, edge, straddling, touching, folded, foldedAbove, flat, flatAbove, below, drawer, panel, noBox, named]) element.remove();
});

test('an image is watched once its pixels are decoded, so it never enters as an empty box', async () => {
  const [image, folded, cached, broken, gone] = ['/late.jpg', '/folded.jpg', '', '/broken.jpg', '/gone.jpg'].map(src => Object.assign(window.document.createElement('img'), src ? { src } : {}));
  const decoding = new Map<HTMLImageElement, () => void>();
  for (const element of [image, folded, gone]) element!.decode = () => new Promise<void>(resolve => decoding.set(element!, resolve));
  // A complete image needs no decode to play.
  cached!.decode = () => new Promise<void>(() => {});
  broken!.decode = () => Promise.reject(new Error('The source image cannot be decoded.'));
  window.document.body.append(image!, folded!, cached!, broken!, gone!);
  // Still loading, an image without a set ratio has no height.
  for (const element of [image, folded, gone]) place(element!, { top: 100, bottom: 100 });
  place(cached!, { top: 100, bottom: 300 });
  // A failed image shows its alt text.
  place(broken!, { top: 300, bottom: 320 });
  const stage = new MotionStage();
  const calls: string[] = [];
  const forget = Object.entries({ image, folded, cached, broken, gone }).map(([name, element]) => stage.watch(element!, { entered: () => calls.push(name), passed: () => {} }));
  await frames(1);
  assert.deepEqual(calls, ['cached', 'broken'], 'a complete image plays at once, and one that fails is watched as it is');
  for (const element of [image, folded, gone]) assert.equal(isObserved(element!), false);
  forget.at(-1)!();
  place(image!, { top: 100, bottom: 300 });
  // Loaded at the edge of a collapsed accordion, it waits for the accordion to open.
  place(folded!, { top: 100, bottom: 300, clip: { top: 100, bottom: 100 } });
  const spy = spyFrames();
  try {
    for (const element of [image, folded, gone]) decoding.get(element!)!();
    await Promise.resolve();
    // While the page loads, WebKit reports nothing to a new observation until a rendering update.
    assert.equal(spy.count, 2, 'a frame for each image observed, none for the one unmounted');
  } finally { spy.stop(); }
  await frames(1);
  assert.deepEqual(calls, ['cached', 'broken', 'image']);
  assert.equal(isObserved(gone!), false, 'an image unmounted while decoding is never watched');
  place(folded!, { top: 100, bottom: 300 });
  relayout();
  await frames(1);
  assert.deepEqual(calls, ['cached', 'broken', 'image', 'folded']);
  for (const element of [image, folded, cached, broken, gone]) element!.remove();
});

test('inside a scroll container the entrance only fades in place, decided once as it starts', async () => {
  const host = window.document.createElement('main');
  // Outside .site, as body{overflow-x:hidden} makes its overflow-y auto: it scrolls the page, not a container.
  host.style.overflowY = 'auto';
  window.document.body.append(host);
  const root = createRoot(host);
  const stage = new MotionStage();
  const motion = (effect: 'fade-up' | 'fade-left' | 'zoom-in') => ({ effect, delay: 'none', duration: 'normal' }) as const;
  // A custom element whose shadow root scrolls the content assigned to its slot.
  const shadowRow = (node: HTMLDivElement | null) => {
    if (!node || node.shadowRoot) return;
    const row = window.document.createElement('div');
    row.style.overflowX = 'auto';
    row.append(window.document.createElement('slot'));
    node.attachShadow({ mode: 'open' }).append(row);
  };
  const render = (label: string) => root.render(<StageContext value={stage}><LazyMotion features={domAnimation}><div className="site">
    <Reveal as="p" motion={motion('fade-up')}>Free</Reveal>
    <div className="row" style={{ overflowX: 'auto' }}><Reveal as="p" motion={motion('fade-up')}>{label}</Reveal></div>
    <div style={{ overflowY: 'scroll' }}><Reveal as="p" motion={motion('fade-left')}>Side</Reveal></div>
    <div style={{ overflowY: 'scroll' }}><Reveal as="p" motion={motion('zoom-in')}>Zoom</Reveal></div>
    <div ref={shadowRow}><Reveal as="p" motion={motion('fade-up')}>Slotted</Reveal></div>
    {/* jsdom keeps the overflow shorthand from its longhands, which browsers expand. */}
    <div style={{ overflowX: 'hidden', overflowY: 'hidden', scrollSnapType: 'x mandatory' }}><Reveal as="p" motion={motion('zoom-in')}>Snapping</Reveal></div>
    {/* Snapping is for scroll containers alone, and a card clipping its rounded corners scrolls nothing. */}
    <div style={{ overflowX: 'clip', overflowY: 'clip', scrollSnapType: 'y proximity' }}>
      <div style={{ overflowX: 'hidden', overflowY: 'hidden' }}><Reveal as="p" motion={motion('fade-up')}>Clipped</Reveal></div>
    </div>
  </div></LazyMotion></StageContext>);
  await act(async () => { render('Row'); });
  const [free, row, side, zoom, slotted, snapping, clipped] = [...host.querySelectorAll<HTMLElement>('[data-motion]')];
  await act(async () => { enter(free!, row!, side!, zoom!, slotted!, snapping!, clipped!); });
  await act(() => frames(2));
  for (const element of [free, clipped]) assert.match(element!.style.transform, /translateY/);
  for (const element of [row, side, zoom, slotted, snapping]) {
    assert.ok(Number(element!.style.opacity) > 0 && Number(element!.style.opacity) < 1, 'it fades');
    assert.equal(element!.style.transform, '', 'moving or scaling would change what the container scrolls or where it snaps');
  }
  await act(() => wait(600));
  // The row stops scrolling at a wider viewport, then the page renders again: what entered stays put.
  host.querySelector<HTMLElement>('.row')!.style.overflowX = 'visible';
  await act(async () => { render('Row again'); });
  await act(() => frames(2));
  assert.deepEqual([row!.style.opacity, row!.style.transform], ['1', '']);
  await act(async () => root.unmount());
  host.remove();
});

test('a frame is requested while a waiting element moves or an ancestor animates, so IntersectionObserver updates', async () => {
  // WebKit runs IntersectionObserver only in a rendering update, which an animation on the compositor (a marquee
  // carrying waiting elements, say) never requests and no event reliably announces.
  const create = () => window.document.createElement('div');
  const [first, second, view, track, badge, last] = Array.from({ length: 6 }, create);
  view!.append(track!);
  track!.append(badge!);
  window.document.body.append(first!, second!, view!, last!);
  let timers = 0;
  const { setTimeout: schedule } = window;
  window.setTimeout = ((...input: Parameters<typeof schedule>) => { timers++; return schedule.apply(window, input); }) as typeof schedule;
  const spy = spyFrames();
  const count = async (ms = 600) => { const before = spy.count; await wait(ms); return spy.count - before; };
  const each250ms = async (label: string) => { const frames = await count(); assert.ok(frames >= 2 && frames <= 4, `${label}: ${frames}`); };
  // The badge is carried 1px every 50ms, sideways, then down: its box follows even a carrier no API shows.
  let offset = 0;
  let carry = setInterval(() => place(badge!, { top: 2000, bottom: 2040, left: offset -= 1 }), 50);
  const outcomes = { entered: () => {}, passed: () => {} };
  const animation = (playState: AnimationPlayState, { pseudoElement = null as string | null, timeline = new DocumentTimeline() } = {}) =>
    ({ playState, timeline, effect: { target: view, pseudoElement } as unknown as KeyframeEffect });
  try {
    const stage = new MotionStage();
    const forget = [first, second, badge, last].map(element => stage.watch(element!, outcomes));
    await wait(300);
    await each250ms('a frame every 250ms while it moves');
    forget[3]!();
    clearInterval(carry);
    carry = setInterval(() => place(badge!, { top: 2000 + (offset += 1), bottom: 2040 + offset }), 50);
    await each250ms('still checked while it waits');
    clearInterval(carry);
    await wait(300);
    assert.equal(await count(), 0, 'none while nothing moves');
    // A window sliding over a track that stays put: its animation decides, also once resumed.
    const sliding = animation('running');
    animations.push(sliding);
    await each250ms('a frame every 250ms while an ancestor animates');
    sliding.playState = 'paused';
    assert.equal(await count(), 0, 'none while it is paused');
    sliding.playState = 'running';
    await each250ms('again once it resumes');
    sliding.playState = 'finished';
    assert.equal(await count(), 0, 'none once it has finished');
    animations.splice(0, animations.length, animation('running', { pseudoElement: '::before' }));
    assert.equal(await count(), 0, 'a pseudo-element carries nothing');
    animations.splice(0, animations.length, animation('running', { timeline: {} as AnimationTimeline }));
    assert.equal(await count(), 0, 'a scroll-driven animation moves only while the page scrolls');
    for (const stop of forget) stop();
    const stopped = timers;
    await wait(600);
    assert.equal(timers, stopped, 'no timer once nothing waits');
    // An element mounted later on the same stage is checked again.
    animations.splice(0, animations.length, animation('running'));
    forget.splice(0, forget.length, stage.watch(badge!, outcomes));
    await wait(300);
    await each250ms('checked again once something waits');
    forget[0]!();
  } finally {
    clearInterval(carry);
    animations.length = 0;
    window.setTimeout = schedule;
    spy.stop();
    for (const element of [first, second, view, last]) element!.remove();
  }
});

test('locating a scroll container\'s content locates the outermost container scrolling it', async () => {
  const create = () => window.document.createElement('div');
  const [scroller, row, slide, next, cancelled, carousel, card, plain] = Array.from({ length: 8 }, create);
  const { documentElement: html, body } = window.document;
  // A page scrolling inside its own full-height container, holding a carousel row just below what it shows.
  scroller!.style.overflowY = 'auto';
  row!.style.overflowX = 'auto';
  row!.append(slide!, next!, cancelled!);
  scroller!.append(row!);
  // A carousel row on a page the viewport scrolls.
  carousel!.style.overflowX = 'auto';
  carousel!.append(card!);
  body.append(scroller!, carousel!, plain!);
  place(scroller!, { top: 0, bottom: 768, content: { height: 3000 } });
  place(row!, { top: 900, bottom: 1100, clip: { top: 0, bottom: 768 }, content: { width: 900 } });
  // Out of the row's view sideways: an observer clips it without a margin, though a swipe may bring it in.
  for (const element of [slide!, next!, cancelled!]) place(element, { top: 900, bottom: 1100, clip: { top: 0, bottom: -1 } });
  place(carousel!, { top: 1200, bottom: 1400, content: { width: 900 } });
  place(card!, { top: 1200, bottom: 1400, clip: { top: 0, bottom: -1 } });
  place(plain!, { top: 3000, bottom: 3100 });
  const reports: string[] = [];
  const locate = (stage: MotionStage, name: string, element: Element) => stage.locate(element, near => reports.push(`${name} ${near}`));
  try {
    const stage = new MotionStage();
    const spy = spyFrames();
    const settled = [locate(stage, 'slide', slide!), locate(stage, 'next', next!)];
    spy.stop();
    assert.equal(spy.count, 2, 'each request asks for the frame WebKit needs to report while the page loads');
    locate(stage, 'cancelled', cancelled!)();
    locate(stage, 'plain', plain!);
    locate(stage, 'card', card!);
    await frames(1);
    assert.deepEqual(reports.splice(0).sort(), ['card true', 'next true', 'plain false', 'slide true'], 'one report each, from the container the slides share');
    assert.equal(isObserved(scroller!), false);
    // Located again, the container reports again; stopping the settled locates leaves it alone.
    locate(stage, 'again', slide!);
    for (const stop of settled) stop();
    await frames(1);
    assert.deepEqual(reports.splice(0), ['again true']);
    // The viewport scrolls in place of <html>, and of <body> while <html> leaves its overflow visible.
    const overflows: [string, string, string, string, { width?: number; height?: number }, boolean][] = [
      // html,body{height:100%} body{overflow-x:hidden}: <body> computes overflow-y:auto and overflows, yet the viewport scrolls.
      ['', '', 'hidden', 'auto', { height: 3000 }, false],
      ['', 'scroll', '', '', { height: 3000 }, false], // html{overflow-y:scroll} keeps a scrollbar
      // html,body{overflow-x:hidden} with something too wide: <body> clips it, and nothing overflows it vertically.
      ['hidden', 'auto', 'hidden', 'auto', { width: 3000, height: 768 }, false],
      ['', 'hidden', 'hidden', 'auto', { width: 3000 }, false],
      ['', 'hidden', 'auto', 'hidden', { height: 3000 }, false],
      // Once <html> has overflow of its own, <body> is a container the visitor scrolls on any axis it overflows.
      ['', 'hidden', '', 'auto', { height: 3000 }, true],
      ['clip', '', '', 'auto', { height: 3000 }, true],
      ['auto', 'auto', '', 'auto', { height: 3000 }, true],
      ['scroll', 'scroll', 'scroll', '', { width: 3000 }, true],
      ['hidden', '', '', 'scroll', { height: 3000 }, true],
    ];
    // A long page overflows <html> as much as <body>.
    place(html, { top: 0, bottom: 768, content: { height: 3000 } });
    for (const [htmlX, htmlY, bodyX, bodyY, content, near] of overflows) {
      Object.assign(html.style, { overflowX: htmlX, overflowY: htmlY });
      Object.assign(body.style, { overflowX: bodyX, overflowY: bodyY });
      place(body, { top: 0, bottom: 768, content });
      locate(new MotionStage(), 'plain', plain!);
      await frames(1);
      assert.deepEqual(reports.splice(0), [`plain ${near}`], `html ${htmlX} ${htmlY}, body ${bodyX} ${bodyY}`);
    }
  } finally {
    for (const element of [html, body]) place(element, { top: 1000, bottom: 1100 });
    html.style.overflowX = html.style.overflowY = body.style.overflowX = body.style.overflowY = '';
    scroller!.remove();
    carousel!.remove();
    plain!.remove();
  }
});

test('hydrating after the CSS fallback began never hides what it may have revealed', async () => {
  const prototype = window.Element.prototype as unknown as { getAnimations: () => unknown[] };
  const { getAnimations } = prototype;
  try {
    for (const started of [true, false]) {
      // jsdom runs no CSS animations. The fallback stops once Motion arms an element; its delay is read, not assumed.
      prototype.getAnimations = function (this: Element) {
        return this.matches('[data-motion]:not([data-motion-armed])')
          ? [{ animationName: 'builder-motion-fallback', currentTime: started ? 900 : 899, finished: Promise.resolve(), effect: { getTiming: () => ({ delay: 900 }) } }] : [];
      };
      const { container, unmount } = await hydrate(container => {
        // During a fling the main thread still measures the title far below, where the browser no longer shows it.
        const title = container.querySelector('h1')!;
        place(title, { top: 100, bottom: 200 });
        title.getBoundingClientRect = () => ({ top: 3000, bottom: 3100, left: 0, right: 100, width: 100, height: 100, x: 0, y: 3000, toJSON() {} });
        place(container.querySelector('article')!, { top: 1400, bottom: 1500 });
        for (const card of container.querySelectorAll('.card')) place(card, { top: 2000, bottom: 2100 });
        place(container.querySelector('a')!, { top: -300, bottom: -200 });
      });
      const [title, article, card, link] = ['h1', 'article', '.card', 'a'].map(selector => container.querySelector<HTMLElement>(selector)!);
      if (started) {
        for (const element of [title!, article!, link!]) {
          assert.equal(element.hasAttribute('data-motion-armed'), false, `${element.tagName} on screen, above it or just below stays as CSS revealed it`);
          assert.equal(element.style.opacity, '1');
        }
        assert.equal(card!.hasAttribute('data-motion-armed'), true, 'still invisible far below the viewport, so it plays on scroll');
        assert.equal(card!.style.opacity, '0');
      } else {
        for (const element of [title!, article!, card!, link!]) assert.equal(element.hasAttribute('data-motion-armed'), true, 'CSS has not revealed anything yet');
        assert.ok(Number(title!.style.opacity) < 1, 'on screen, so it plays rather than appearing at once');
        assert.equal(card!.style.opacity, '0');
        assert.equal(link!.style.opacity, '1', 'scrolled past: shown without playing');
      }
      await unmount();
    }
  } finally { prototype.getAnimations = getAnimations; }
  // Unmounted before the browser reports where it is: nothing is decided, and nothing is left watching.
  const element = window.document.createElement('div');
  window.document.body.append(element);
  const reports: boolean[] = [];
  new MotionStage().locate(element, near => reports.push(near))();
  await frames(1);
  assert.deepEqual(reports, []);
  assert.equal(isObserved(element), false);
  element.remove();
});

test('hydrating mid-fade leaves the CSS fallback to finish before Motion shows the element', async () => {
  const prototype = window.Element.prototype as unknown as { getAnimations: () => unknown[] };
  const { getAnimations } = prototype;
  const fades = new Map<Element, { finished: Promise<void>; end: (cancelled: boolean) => void }>();
  prototype.getAnimations = function (this: Element) {
    if (!this.matches('[data-motion]:not([data-motion-armed])')) return [];
    if (!fades.has(this)) {
      let end!: (cancelled: boolean) => void;
      const finished = new Promise<void>((resolve, reject) => { end = cancelled => cancelled ? reject(new Error('AbortError')) : resolve(); });
      fades.set(this, { finished, end });
    }
    return [{ animationName: 'builder-motion-fallback', currentTime: 1600, finished: fades.get(this)!.finished, effect: { getTiming: () => ({ delay: 1500 }) } }];
  };
  try {
    const { container, unmount } = await hydrate(container => {
      for (const selector of ['h1', 'a']) place(container.querySelector(selector)!, { top: 100, bottom: 200 });
    });
    const [title, link] = ['h1', 'a'].map(selector => container.querySelector<HTMLElement>(selector)!);
    // Entering the viewport must not play over the fade either.
    await act(async () => { enter(title!, link!); });
    await act(() => wait(600));
    for (const element of [title!, link!]) {
      assert.equal(element.hasAttribute('data-motion-armed'), false, 'CSS keeps fading it');
      assert.equal(element.style.opacity, '0', 'the opacity the fade interpolates from stays in place');
      assert.equal(element.style.transform, '');
    }
    await act(async () => { fades.get(title!)!.end(false); fades.get(link!)!.end(true); });
    await act(() => frames(2));
    for (const element of [title!, link!]) {
      assert.equal(element.style.opacity, '1', 'shown at once when the fade ends or is cancelled');
      assert.equal(element.hasAttribute('data-motion-armed'), false);
    }
    await unmount();
  } finally { prototype.getAnimations = getAnimations; }
});

test('items entering together play in order, and an item entering alone plays at once', async () => {
  const keys = Array.from({ length: 10 }, (_, index) => `card-${index}`);
  const grid = view({ version: 1, spec: { root: 'page', elements: {
    page: { type: 'Section', props: {}, children: ['grid'] },
    grid: { type: 'Grid', props: { motion: { effect: 'fade', duration: 'slow', stagger: 'long' } }, children: keys },
    ...Object.fromEntries(keys.map(key => [key, { type: 'Card', props: {} }])),
  } } });
  const container = window.document.createElement('main');
  window.document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<MotionSite view={grid} components={{}} />); });
  await act(() => frames());
  const cards = [...container.querySelectorAll<HTMLElement>('.card')];
  assert.equal(cards.length, 10);
  // 0.12s apart, each fading for 0.8s.
  await act(async () => { enter(cards[0]!, cards[1]!, cards[2]!); });
  await act(() => wait(300));
  const [first, second, third] = cards.map(card => Number(card.style.opacity));
  assert.ok(first! > second! && second! > third!, `staggered in the order they entered: ${first}, ${second}, ${third}`);
  // Mounted tenth, but alone in its frame: no stagger delay (0.6s at most).
  await act(async () => { enter(cards[9]!); });
  await act(() => wait(150));
  assert.ok(Number(cards[9]!.style.opacity) > 0);
  await act(async () => root.unmount());
  container.remove();
});

test('focus shows an element in its final state for good', async () => {
  // Focused before hydration, for example by an early Tab.
  const { container, unmount } = await hydrate(container => container.querySelector('a')!.focus());
  const link = container.querySelector('a')!;
  assert.equal(link.hasAttribute('data-motion-shown'), true);
  await act(async () => link.blur());
  assert.equal(link.hasAttribute('data-motion-shown'), true, 'blur never returns it to a half-played frame');
  await unmount();

  // Focus moving into a container after hydration; the host's own handler still runs.
  const host = window.document.createElement('main');
  window.document.body.append(host);
  const calls: string[] = [];
  const root = createRoot(host);
  await act(async () => {
    root.render(<StageContext value={new MotionStage()}><LazyMotion features={domAnimation}>
      <Reveal as="div" motion={{ effect: 'fade', delay: 'none', duration: 'normal' }} onFocusCapture={() => calls.push('host')}><a href="/guide">Go</a></Reveal>
    </LazyMotion></StageContext>);
  });
  const card = host.querySelector('[data-motion]')!;
  assert.equal(card.hasAttribute('data-motion-shown'), false);
  await act(async () => host.querySelector('a')!.focus());
  await act(async () => host.querySelector('a')!.blur());
  assert.equal(card.hasAttribute('data-motion-shown'), true);
  assert.deepEqual(calls, ['host']);
  await act(async () => root.unmount());
  host.remove();
});

test('an element without a box is not taken as scrolled past and plays once it enters', async () => {
  // For example inside display:none, where every side of its rect is 0.
  const { container, unmount } = await hydrate(container => place(container.querySelector('a')!, { top: 0, bottom: 0, width: 0 }));
  const link = container.querySelector<HTMLElement>('a')!;
  await act(async () => { relayout(); await frames(2); });
  assert.equal(link.hasAttribute('data-motion-armed'), true);
  assert.equal(link.style.opacity, '0');
  place(link, { top: 300, bottom: 340 });
  await act(async () => { relayout(); });
  await act(() => frames(2));
  assert.ok(Number(link.style.opacity) < 1, 'it plays rather than appearing at once');
  await act(() => wait(600));
  assert.equal(link.style.opacity, '1');
  await unmount();
});

test('the client directive leaves the page static for reduced motion and without IntersectionObserver', async () => {
  const runs: string[] = [];
  const load = (name: string) => async () => async () => { runs.push(name); };
  const [moving, reduced, legacy] = [0, 1, 2].map(() => window.document.createElement('astro-island'));
  builderMotion(load('default'), {} as never, moving!);
  preferReducedMotion(true);
  builderMotion(load('reduced'), {} as never, reduced!);
  preferReducedMotion(false);
  const { IntersectionObserver } = window as unknown as Record<string, unknown>;
  delete (window as unknown as Record<string, unknown>).IntersectionObserver;
  try { builderMotion(load('legacy'), {} as never, legacy!); } finally { Object.assign(window, { IntersectionObserver }); }
  await frames(1);
  assert.deepEqual(runs, ['default'], 'turning the preference off keeps this visit static');
  assert.deepEqual([moving, reduced, legacy].map(island => island!.hasAttribute('data-motion-static')), [false, true, true]);
});
