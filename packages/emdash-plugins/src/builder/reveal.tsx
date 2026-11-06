import { Component, createContext, createElement, useContext, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { m, type Variants } from 'motion/react';
import { motionTokens, type MotionTag, type ResolvedMotion, type RootProps } from './motion-tokens.ts';

type Outcomes = { entered: () => void; passed: () => void };

/**
 * Any visible pixel counts, a bare edge does not: content folded into a collapsed accordion touches its edge with
 * no area, which IntersectionObserver may report as intersecting. The tiny threshold reports the first real pixel.
 * An element without area has no pixel to wait for: it counts wherever it touches, so content overflowing it shows.
 */
const visible = { threshold: Number.EPSILON };
/** Everything above the viewport: 10^7px taller than any page, yet within every engine's layout range. */
const aboveViewport = '10000000px 0px -100% 0px';
/** Everything above the viewport, the viewport, and one more viewport below it. */
const nearViewport = '10000000px 0px 100% 0px';
/** Milliseconds between checks whether something may carry a waiting element. */
const carryingCheck = 250;

/** While the page loads, WebKit holds an observer's first report until a rendering update, for up to 2s: request one. */
function firstReport() {
  requestAnimationFrame(() => {});
}

/**
 * The element's ancestors as the browser renders them: through the slot it is assigned to, and out of shadow roots.
 * A closed shadow root keeps its slots to itself, so content assigned to one continues at the host.
 */
function* ancestors(element: Element): Generator<Element> {
  let node: Element | null = element;
  // Only a shadow root has a host: the document above <html> exposes any element named "host" under that name.
  while ((node = node.assignedSlot ?? node.parentElement ?? (node.parentNode instanceof ShadowRoot ? node.parentNode.host : null))) yield node;
}

function overflow(node: Element): string {
  const { overflowX, overflowY } = getComputedStyle(node);
  return `${overflowX} ${overflowY}`;
}
/**
 * Whether moving the node's content could change what it scrolls or where it snaps: it scrolls (overflow auto or
 * scroll, whether or not it overflows yet), or it clips and snaps (a carousel moved by buttons).
 */
function scrollContainer(node: Element): boolean {
  const clips = overflow(node);
  return /auto|scroll/.test(clips) || (/hidden/.test(clips) && getComputedStyle(node).scrollSnapType !== 'none');
}
/** Whether the visitor can scroll the node: its content overflows it on an axis whose overflow is auto or scroll. */
function scrollable(node: Element): boolean {
  const { overflowX, overflowY } = getComputedStyle(node);
  return (/auto|scroll/.test(overflowX) && node.scrollWidth > node.clientWidth)
    || (/auto|scroll/.test(overflowY) && node.scrollHeight > node.clientHeight);
}

/** Whether scrolling the page moves the element. Content in a fixed box (a drawer, say) stays where it is. */
function scrollsWithPage(element: Element): boolean {
  return [element, ...ancestors(element)].every(node => getComputedStyle(node).position !== 'fixed');
}

/** Whether a container inside .site scrolls the element, so that moving it would change what that container scrolls. */
function insideScroller(element: Element): boolean {
  for (const node of ancestors(element)) {
    if (node.classList.contains('site')) return false;
    if (scrollContainer(node)) return true;
  }
  return false;
}

/**
 * The outermost container the visitor can scroll around the element, if any. The viewport scrolls in place of <html>,
 * and of <body> unless <html> has overflow of its own (body{overflow-x:hidden} still scrolls the viewport).
 */
function outermostScroller(element: Element): Element | undefined {
  const { documentElement: html, body } = element.ownerDocument;
  let outermost: Element | undefined;
  for (const node of ancestors(element)) {
    if (node === html || (node === body && !/hidden|clip|auto|scroll/.test(overflow(html)))) break;
    if (scrollable(node)) outermost = node;
  }
  return outermost;
}

/** Coordinates the moving elements of one island. Only used in the browser after hydration. */
export class MotionStage {
  #groups = new Map<string, { count: number; open: boolean }>();
  #waiting = new Map<Element, Outcomes>();
  #view: IntersectionObserver | undefined;
  #above: IntersectionObserver | undefined;
  #near: IntersectionObserver | undefined;
  #locating = new Map<Element, Set<(near: boolean) => void>>();
  #places = new WeakMap<Element, string>();
  #carrying = 0;
  /** Position among the children of one stagger group that enter the viewport in the same frame. */
  order(group: string): number {
    let entry = this.#groups.get(group);
    if (!entry) this.#groups.set(group, entry = { count: 0, open: false });
    if (!entry.open) {
      const current = entry;
      current.open = true;
      requestAnimationFrame(() => { current.open = false; current.count = 0; });
    }
    return entry.count++;
  }
  /**
   * Reports once that the element enters the viewport (`entered`), or that the page was scrolled past it
   * before it ever did, for example by scroll restoration (`passed`: wholly above the viewport). The element
   * waits invisible in the place it ends up, so the browser judges what shows: a container that clips it
   * (.site, a card, a scrolled row, a collapsed accordion, a closed <details>) keeps it waiting either way.
   * An image is watched once its pixels are decoded, so that its entrance never plays on an empty box.
   * The returned function stops watching; call it on unmount.
   */
  watch(element: Element, outcomes: Outcomes): () => void {
    this.#waiting.set(element, outcomes);
    this.#view ??= new IntersectionObserver(entries => this.#report(entries, 'entered'), visible);
    this.#above ??= new IntersectionObserver(entries => this.#report(entries, 'passed'), { ...visible, rootMargin: aboveViewport });
    const observe = () => {
      if (!this.#waiting.has(element)) return;
      this.#view!.observe(element);
      this.#above!.observe(element);
      firstReport();
    };
    // Still loading, an image has no pixels and often no height: it would enter wherever it merely touches.
    if (element instanceof HTMLImageElement && !element.complete) element.decode().then(observe, observe);
    else observe();
    this.#checkCarrying();
    return () => this.#forget(element);
  }
  /**
   * Reports once whether the element could be on screen a frame or two from now: whether it, or the outermost
   * container the visitor can scroll around it, lies on, above, or within one viewport below the viewport where the
   * browser next lays it out. During hydration the main thread may not know how far a fling has scrolled the page or a container,
   * and what it decides shows a frame or two later. Hence the observer and its margin, and the container as a
   * whole, since an observer clips at every container without a margin. The returned function stops locating;
   * call it on unmount.
   */
  locate(element: Element, report: (near: boolean) => void): () => void {
    const target = outermostScroller(element) ?? element;
    const reports = this.#locating.get(target) ?? new Set<(near: boolean) => void>();
    this.#locating.set(target, reports.add(report));
    this.#near ??= new IntersectionObserver(entries => {
      for (const { target, isIntersecting } of entries) {
        const located = this.#locating.get(target);
        if (!located) continue;
        this.#locating.delete(target);
        this.#near!.unobserve(target);
        // Settled, a locate stops nothing: the target may be located again.
        const settled = [...located];
        located.clear();
        for (const report of settled) report(isIntersecting);
      }
    }, { rootMargin: nearViewport });
    this.#near.observe(target);
    firstReport();
    return () => {
      if (!reports.delete(report) || reports.size) return;
      this.#locating.delete(target);
      this.#near!.unobserve(target);
    };
  }
  #report(entries: IntersectionObserverEntry[], outcome: keyof Outcomes) {
    for (const { target, intersectionRatio, boundingClientRect } of entries) {
      if (!intersectionRatio) continue;
      if (outcome === 'entered' || (boundingClientRect.bottom <= 0 && scrollsWithPage(target))) this.#settle(target, outcome);
    }
  }
  /**
   * WebKit updates IntersectionObserver only in a rendering update, and an animation running on the compositor
   * requests none, so a marquee could carry a waiting element into view unseen. While elements wait, check every
   * `carryingCheck` ms and request a frame while an ancestor animates or a waiting element moved. Checking, not
   * events: resuming a paused animation or starting one through the Web Animations API fires none. An ancestor's
   * animation also covers a clipping window sliding over content that stays put; a moving box also reveals what a
   * closed shadow root hides. Only animations that advance with time count: a scroll-driven one moves only while
   * the page scrolls, which updates rendering anyway. A page where nothing moves requests no frames.
   */
  #checkCarrying() {
    if (this.#carrying) return;
    this.#carrying = window.setTimeout(() => {
      this.#carrying = 0;
      if (this.#carried()) requestAnimationFrame(() => {});
      this.#checkCarrying();
    }, carryingCheck);
  }
  #carried(): boolean {
    let moved = false;
    for (const element of this.#waiting.keys()) {
      const { x, y, width, height } = element.getBoundingClientRect();
      const place = `${x} ${y} ${width} ${height}`;
      if (this.#places.get(element) !== place) moved = true;
      this.#places.set(element, place);
    }
    if (moved) return true;
    const carriers = new Set<Element>();
    for (const element of this.#waiting.keys()) {
      for (const node of ancestors(element)) {
        if (carriers.has(node)) break;
        carriers.add(node);
      }
    }
    // An element's own animations, never those of its pseudo-elements, which carry none of its children.
    return [...carriers].some(node => node.getAnimations?.().some(({ playState, timeline }) =>
      playState === 'running' && timeline instanceof DocumentTimeline));
  }
  #settle(element: Element, outcome: keyof Outcomes) {
    const outcomes = this.#waiting.get(element);
    if (!outcomes) return;
    this.#forget(element);
    outcomes[outcome]();
  }
  #forget(element: Element) {
    if (!this.#waiting.delete(element)) return;
    this.#view?.unobserve(element);
    this.#above?.unobserve(element);
    if (this.#waiting.size) return;
    window.clearTimeout(this.#carrying);
    this.#carrying = 0;
  }
}

/** Present only inside the page island; elements render as plain tags everywhere else. */
export const StageContext = createContext<MotionStage | null>(null);
/** Motion of the host component currently rendering; consumed once by its Root. */
export const HostMotionContext = createContext<ResolvedMotion | null>(null);

const waiting = 'builder-waiting';
const shown = 'builder-shown';

/** The CSS fallback animation if it has already started revealing this element. Its delay comes from site.css. */
function revealedByCss(element: Element): Animation | undefined {
  const fallback = element.getAnimations?.().find(animation => 'animationName' in animation && animation.animationName === 'builder-motion-fallback');
  return fallback && Number(fallback.currentTime ?? 0) >= (fallback.effect?.getTiming().delay ?? 0) ? fallback : undefined;
}

type MovingProps = { as: MotionTag; motion: ResolvedMotion; stage: MotionStage; children?: ReactNode } & Record<string, unknown>;
function Moving({ as, motion, stage, children, ...attributes }: MovingProps) {
  const element = useRef<HTMLDivElement>(null); // any tag; typed as the m.div it renders through
  // Decided when the entrance starts: Motion resolves the variant again on every render.
  const slot = useRef<number | null>(null);
  const moves = useRef<boolean | null>(null);
  // `armed`: Motion owns visibility and CSS stops its fallback. `show`: play the entrance, or show it at once.
  const [state, setState] = useState<{ armed: boolean; show?: 'play' | 'instant' }>({ armed: false });
  // Once focus lands inside, CSS keeps the final state for good, so blur never reveals a half-played frame.
  const [focused, setFocused] = useState(false);
  const variants = useMemo<Variants>(() => {
    const { from, to }: { from: Partial<Record<string, number>>; to: Record<string, number> } = motionTokens.effect[motion.effect];
    return {
      [waiting]: { opacity: 0 },
      // Resolved when the element enters the viewport, so stagger order follows what the visitor sees.
      [shown]: (instant: boolean) => {
        if (instant) return { ...to, transition: { duration: 0 } };
        slot.current ??= motion.group ? stage.order(motion.group) : 0;
        const stagger = motion.stagger ? Math.min(slot.current * motionTokens.stagger[motion.stagger], motionTokens.maxStaggerOffset) : 0;
        // Only the entrance starts from the effect's start state. Inside a scroll container it only fades, since
        // moving or scaling would change what that container scrolls or where it snaps (.site clips its edges instead).
        moves.current ??= !insideScroller(element.current!);
        const entrance = Object.fromEntries(Object.entries(to).filter(([key]) => moves.current || key === 'opacity').map(([key, value]) => [key, [from[key] ?? value, value]]));
        return { ...entrance, transition: { duration: motionTokens.duration[motion.duration], ease: motionTokens.ease, delay: motionTokens.delay[motion.delay] + stagger } };
      },
    };
  }, [motion.effect, motion.delay, motion.duration, motion.stagger, motion.group, stage]);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    if (node.matches(':focus-within')) setFocused(true);
    const watch = () => {
      setState({ armed: true });
      return stage.watch(node, {
        entered: () => setState({ armed: true, show: 'play' }),
        passed: () => setState({ armed: true, show: 'instant' }),
      });
    };
    const fallback = revealedByCss(node);
    if (!fallback) return watch();
    // Hydration after the CSS fallback began: never hide what may be on screen. Content far below the
    // viewport is invisible, so Motion can take it back and reveal it on scroll.
    let live = true;
    let forget = stage.locate(node, near => {
      if (!near) {
        forget = watch();
        return;
      }
      // The keyframes fade from the inline opacity, so Motion writing the final state mid-fade would jump
      // to its end, and playing the entrance would override the fade. Unarmed, Motion leaves it alone until it ends.
      const settle = () => { if (live) setState({ armed: false, show: 'instant' }); };
      fallback.finished.then(settle, settle);
    });
    return () => {
      live = false;
      forget();
    };
  }, [stage]);
  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    setFocused(true);
    (attributes.onFocusCapture as ((event: FocusEvent<HTMLDivElement>) => void) | undefined)?.(event);
  };
  const Tag = m[as as keyof typeof m] as typeof m.div;
  return <Tag ref={element} {...attributes} onFocusCapture={onFocusCapture} data-motion="" data-motion-armed={state.armed ? '' : undefined} data-motion-shown={focused ? '' : undefined}
    variants={variants} custom={state.show === 'instant'} initial={waiting} animate={state.show ? shown : undefined}>{children}</Tag>;
}

/** Sits inside json-render's own per-element boundary, so a failing animation keeps its content. */
class StaticOnError extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

type RevealProps = { as: MotionTag; motion?: ResolvedMotion; children?: ReactNode } & Record<string, unknown>;
/** Renders exactly one element: the plain tag outside the island, the same tag through Motion inside it. */
export function Reveal({ as, motion, children, ...attributes }: RevealProps) {
  const stage = useContext(StageContext);
  const plain = createElement(as, attributes, children);
  if (!stage || !motion) return plain;
  return <StaticOnError fallback={plain}><Moving as={as} motion={motion} stage={stage} {...attributes}>{children}</Moving></StaticOnError>;
}

/** Passed to host components so their outermost element moves; hosts never import Motion. */
export function Root({ as = 'div', children, ...attributes }: RootProps) {
  const motion = useContext(HostMotionContext);
  // Void tags such as img must not receive a provider as a child.
  const content = children == null ? undefined : <HostMotionContext value={null}>{children}</HostMotionContext>;
  return <Reveal as={as} motion={motion ?? undefined} {...attributes}>{content}</Reveal>;
}
