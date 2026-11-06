import type { ComponentPropsWithoutRef, ComponentType, ReactNode } from 'react';

/**
 * Every motion value a document can choose. Documents name a token; seconds, pixels and easing
 * exist only here. Change them together with the README motion table and tests. An effect that
 * animates anything besides opacity and transform also needs the final-state rules in site.css.
 */
export const motionTokens = {
  // Names follow the direction of travel: fade-up moves upward into place.
  effect: {
    fade: { from: { opacity: 0 }, to: { opacity: 1 } },
    'fade-up': { from: { opacity: 0, y: 24 }, to: { opacity: 1, y: 0 } },
    'fade-down': { from: { opacity: 0, y: -24 }, to: { opacity: 1, y: 0 } },
    'fade-left': { from: { opacity: 0, x: 32 }, to: { opacity: 1, x: 0 } },
    'fade-right': { from: { opacity: 0, x: -32 }, to: { opacity: 1, x: 0 } },
    'zoom-in': { from: { opacity: 0, scale: 0.94 }, to: { opacity: 1, scale: 1 } },
  },
  delay: { none: 0, short: 0.1, medium: 0.2, long: 0.4 },
  duration: { fast: 0.3, normal: 0.5, slow: 0.8 },
  stagger: { short: 0.05, medium: 0.08, long: 0.12 },
  maxStaggerOffset: 0.6,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
} as const;

export const maxMotionElements = 40;

export type MotionEffect = keyof typeof motionTokens.effect;
export type MotionDelay = keyof typeof motionTokens.delay;
export type MotionDuration = keyof typeof motionTokens.duration;
export type MotionStagger = keyof typeof motionTokens.stagger;
/** Motion after page resolution: defaults filled in; staggered children carry their group. */
export type ResolvedMotion = { effect: MotionEffect; delay: MotionDelay; duration: MotionDuration; stagger?: MotionStagger; group?: string };

/** Tags a host component may render through `Root`. */
export const rootTags = ['div', 'section', 'article', 'aside', 'header', 'footer', 'figure', 'blockquote', 'ul', 'ol', 'li', 'p', 'span', 'a', 'img', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
export type RootTag = (typeof rootTags)[number];
export type MotionTag = RootTag | 'h1' | 'hr';
export type RootProps = { as?: RootTag; children?: ReactNode } & Omit<ComponentPropsWithoutRef<'div'>, 'children'> & { href?: string; src?: string; alt?: string };
/** Host components render their outermost element through Root so motion animates it without a wrapper. */
export type RootComponent = ComponentType<RootProps>;
