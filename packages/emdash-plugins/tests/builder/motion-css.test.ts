import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(`../../src/builder/${path}`, import.meta.url), 'utf8');
const css = source('styles/site.css').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selectors: selector!.trim().split(','),
  declarations: body!.split(';').filter(Boolean).map(item => [item.slice(0, item.indexOf(':')).trim(), item.slice(item.indexOf(':') + 1).trim()] as const),
}));
const finalState = '[data-motion]{opacity:1!important;transform:none!important;animation:none!important}';

test('the island recognises the CSS fallback and reads its delay', () => {
  const fallback = rules.find(rule => rule.selectors.includes('[data-motion]:not([data-motion-armed])'));
  const animation = fallback?.declarations.find(([name]) => name === 'animation')?.[1].split(/\s+/) ?? [];
  assert.equal(animation[0], 'builder-motion-fallback');
  assert.equal(animation.filter(token => /^[\d.]+m?s$/.test(token)).length, 2, 'a duration and a delay');
  // The server renders a waiting element only transparent, so the fallback fades it in place.
  assert.match(css, /@keyframes builder-motion-fallback\{to\{opacity:1\}\}/);
  assert.match(source('reveal.tsx'), /animationName === 'builder-motion-fallback'/);
});

test('without scripts, in print, with reduced motion and on a static island every element shows its final state', () => {
  assert.ok(css.includes(`@media(scripting:none),print,(prefers-reduced-motion:reduce){${finalState}}`));
  assert.ok(source('PageShell.astro').includes(`<noscript><style is:inline>${finalState}</style></noscript>`));
  const staticIsland = css.indexOf(`[data-motion-static] ${finalState}`);
  const before = css.slice(0, staticIsland);
  assert.ok(staticIsland > 0);
  assert.equal(before.split('{').length, before.split('}').length, 'outside every media query, so it holds when the preference changes after load');
  assert.ok(css.includes('[data-motion]:focus-within,[data-motion][data-motion-shown]{opacity:1!important;transform:none!important}'));
});

test('moving elements never change the scroll height of the page', () => {
  // A transform still in progress at the end of the page would otherwise extend it, then shrink it.
  const site = rules.find(rule => rule.selectors.includes('.site'));
  assert.deepEqual(site?.declarations.filter(([name]) => name.startsWith('overflow')), [['overflow', 'clip']]);
});

test('component root styles never set what Motion animates', () => {
  const roots = ['container', 'stack', 'grid', 'heading', 'text', 'link', 'image', 'card', 'badge', 'divider', 'prose'];
  const modifiers = ['size-', 'direction-', 'gap-', 'align-', 'columns-', 'width-', 'ratio-', ...roots.map(root => `${root}-`)];
  const targetsRoot = (selector: string) => {
    const last = selector.trim().split(/\s*[\s>+~]\s*/).at(-1) ?? '';
    return [...last.matchAll(/\.([\w-]+)/g)].some(([, name]) => roots.includes(name!) || modifiers.some(prefix => name!.startsWith(prefix)));
  };
  const moving = ['opacity', 'transform', 'translate', 'scale', 'rotate', 'transition', 'animation', 'will-change'];
  const checked = rules.filter(rule => rule.selectors.some(targetsRoot));
  assert.ok(checked.length > 40, 'the selector parser found the component rules');
  for (const rule of checked) {
    for (const [name] of rule.declarations) assert.equal(moving.includes(name), false, `${rule.selectors.join(',')} sets ${name}`);
  }
});
