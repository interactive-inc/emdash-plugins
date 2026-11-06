import { JSDOM } from 'jsdom';

/**
 * A browser-like global scope for hydration tests. Import it before anything that loads
 * React DOM or Motion, which detect the browser when they are first evaluated.
 */
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true, url: 'https://site.test/' });
const { window } = dom;

type Rect = { top: number; bottom: number; left?: number; width?: number; clip?: { top: number; bottom: number }; content?: { width?: number; height?: number } };
const rects = new WeakMap<Element, Rect>();
/**
 * Elements are 100px wide at the left edge and below the 768px viewport unless a test places them elsewhere. Width 0
 * with no height means no box. `clip` is the part its containers leave visible vertically: a collapsed accordion clips
 * its content to its edge. `content` is the size of what the element holds where that overflows it, as its scroll size.
 */
export function place(element: Element, rect: Rect) { rects.set(element, rect); }
function rectOf(element: Element): DOMRect {
  const { top, bottom, left = 0, width = 100 } = rects.get(element) ?? { top: 1000, bottom: 1100 };
  return { top, bottom, left, right: left + width, width, height: bottom - top, x: left, y: top, toJSON() {} } as DOMRect;
}
window.Element.prototype.getBoundingClientRect = function (this: Element) { return rectOf(this); };
const size = (get: (rect: DOMRect, content: Rect['content']) => number) => ({ configurable: true, get(this: Element) { return get(rectOf(this), rects.get(this)?.content); } });
Object.defineProperties(window.Element.prototype, {
  clientWidth: size(rect => rect.width),
  clientHeight: size(rect => rect.height),
  scrollWidth: size((rect, content) => Math.max(rect.width, content?.width ?? 0)),
  scrollHeight: size((rect, content) => Math.max(rect.height, content?.height ?? 0)),
});

/**
 * IntersectionObserver over the placed rects and their clips, the viewport grown by rootMargin (top and bottom,
 * in px or % of its height). As the specification puts it, a rect that only touches what is visible intersects
 * with ratio 0. Like the browser it reports each target soon after observing it, then only when it starts or
 * stops intersecting or crosses the threshold. Nothing orders reports across observers, so the newest reports first.
 */
const observers = new Set<FakeIntersectionObserver>();
class FakeIntersectionObserver {
  readonly #reported = new Map<Element, string | undefined>();
  readonly #top: number;
  readonly #bottom: number;
  readonly #threshold: number;
  constructor(private readonly callback: IntersectionObserverCallback, { rootMargin = '0px', threshold = 0 }: IntersectionObserverInit = {}) {
    this.#threshold = Math.min(...[threshold].flat());
    const margins = rootMargin.trim().split(/\s+/);
    const length = (value: string) => value.endsWith('%') ? parseFloat(value) / 100 * window.innerHeight : parseFloat(value);
    [this.#top, this.#bottom] = [length(margins[0]!), length(margins[2] ?? margins[0]!)];
    observers.add(this);
  }
  observe(element: Element) {
    if (this.#reported.has(element)) return;
    this.#reported.set(element, undefined);
    schedule();
  }
  unobserve(element: Element) { this.#reported.delete(element); }
  disconnect() { this.#reported.clear(); }
  takeRecords() { return []; }
  /** Reports the element if its state changed, or as `isIntersecting` when `forced`. */
  report(element: Element, forced?: boolean) {
    if (!this.#reported.has(element)) return;
    const rect = rectOf(element);
    const { clip } = rects.get(element) ?? {};
    const [top, bottom] = [Math.max(-this.#top, clip?.top ?? -Infinity), Math.min(window.innerHeight + this.#bottom, clip?.bottom ?? Infinity)];
    const hasBox = rect.width > 0 || rect.height > 0;
    const isIntersecting = forced ?? (hasBox && top <= bottom && rect.top <= bottom && rect.bottom >= top);
    const shown = Math.max(0, Math.min(rect.bottom, bottom) - Math.max(rect.top, top));
    const intersectionRatio = forced ? 1 : !isIntersecting ? 0 : rect.height ? shown / rect.height : 1;
    const state = `${isIntersecting} ${intersectionRatio >= this.#threshold}`;
    if (this.#reported.get(element) === state) return;
    this.#reported.set(element, state);
    this.callback([{ target: element, isIntersecting, intersectionRatio, boundingClientRect: rect } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  get watchesViewport() { return !this.#top && !this.#bottom; }
  has(element: Element) { return this.#reported.has(element); }
}

let pending = false;
function schedule() {
  if (!pending) queueMicrotask(() => { pending = false; relayout(); });
  pending = true;
}
/** Reports what changed since the last report, as the browser does after scrolling or a layout change. */
export function relayout() {
  for (const observer of [...observers].reverse()) for (const element of window.document.querySelectorAll('*')) observer.report(element);
}
/** Reports elements as intersecting the viewport wherever they are placed, as after scrolling to them. */
export function enter(...elements: Element[]) {
  for (const element of elements) for (const observer of observers) if (observer.watchesViewport) observer.report(element, true);
}
export function isObserved(element: Element) { return [...observers].some(observer => observer.has(element)); }

// jsdom loads no images, so an image with a source never completes; by default it decodes at once.
Object.assign(window.HTMLImageElement.prototype, { decode: () => Promise.resolve() });

/** The timeline of animations that advance with time; scroll-driven ones have another. */
class DocumentTimeline {}
/**
 * The document's animations, which a test sets; jsdom runs none. As in the browser, an element lists its own, not
 * its pseudo-elements', unless asked for its subtree.
 */
export const animations: Partial<Animation>[] = [];
Object.assign(window.Element.prototype, {
  getAnimations(this: Element, options?: GetAnimationsOptions) {
    return animations.filter(({ effect }) => {
      const { target, pseudoElement } = effect as KeyframeEffect;
      return options?.subtree ? !!target && this.contains(target) : target === this && !pseudoElement;
    });
  },
});

const listeners = new Set<() => void>();
let reduced = false;
/** A prefers-reduced-motion query whose answer the test controls. */
export function preferReducedMotion(value: boolean) {
  reduced = value;
  for (const listener of [...listeners]) listener();
}
function matchMedia(query: string) {
  return {
    media: query,
    get matches() { return /prefers-reduced-motion:\s*reduce/.test(query) && reduced; },
    addEventListener(_type: string, listener: () => void, options?: { once?: boolean }) {
      const run = () => { if (options?.once) listeners.delete(run); listener(); };
      listeners.add(run);
    },
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  };
}

Object.assign(window, { IntersectionObserver: FakeIntersectionObserver, matchMedia, DocumentTimeline });
const globals: Record<string, unknown> = {
  window, document: window.document, navigator: window.navigator,
  Node: window.Node, Element: window.Element, ShadowRoot: window.ShadowRoot, HTMLElement: window.HTMLElement, HTMLImageElement: window.HTMLImageElement, SVGElement: window.SVGElement, Event: window.Event,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  addEventListener: (...input: Parameters<typeof window.addEventListener>) => window.addEventListener(...input),
  removeEventListener: (...input: Parameters<typeof window.removeEventListener>) => window.removeEventListener(...input),
  IntersectionObserver: FakeIntersectionObserver, matchMedia, DocumentTimeline,
  IS_REACT_ACT_ENVIRONMENT: true,
};
for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
for (const name of ['innerHeight', 'innerWidth']) Object.defineProperty(globalThis, name, { get: () => window[name as 'innerHeight'], configurable: true });

export { window };
export const frames = (count = 2) => new Promise<void>(resolve => {
  const step = (left: number) => left ? window.requestAnimationFrame(() => step(left - 1)) : resolve();
  step(count);
});
