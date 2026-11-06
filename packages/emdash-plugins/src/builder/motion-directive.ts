import type { ClientDirective } from 'astro';

declare module 'astro' {
  interface AstroClientDirectives { 'client:builder-motion'?: boolean }
}

/**
 * Hydrates the page island at once. Without IntersectionObserver, or when the visitor prefers
 * reduced motion at load, the island never starts and downloads nothing: `data-motion-static`
 * keeps the page final for this visit, even if the preference changes later.
 */
const builderMotion: ClientDirective = (load, _options, island) => {
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    island.setAttribute('data-motion-static', '');
    return;
  }
  void load().then(run => run());
};
export default builderMotion;
