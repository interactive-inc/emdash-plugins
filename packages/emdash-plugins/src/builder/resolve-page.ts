import { evaluateVisibility, resolvePropValue } from '@json-render/core';
import { componentContract, type ComponentExtensions } from './extensions.ts';
import { themeSchema, type PageDocument, type PageState } from './document.ts';
import { listLength } from './list-limits.ts';
import { projectPortableText } from './portable-text.ts';
import { safeUrl } from './safe-url.ts';
import type { AuthoredMotion } from './catalog.ts';
import type { ResolvedMotion } from './motion-tokens.ts';

export type ResolvedElement = { type: string; props: Record<string, unknown>; children?: string[] };
/** Exactly what a page renders: literal props only, no state, bindings, repeats or hidden elements. */
export type ResolvedView = { spec: { root: string; elements: Record<string, ResolvedElement> }; theme: Record<string, string>; motion: boolean };
type Options = { motion?: boolean };

// json-render resolves any `$`-keyed object again while rendering; resolved data must stay literal.
// toJSON first, as JSON does, so EmDash's Dates arrive as ISO strings instead of empty objects.
function literal(value: unknown): unknown {
  const json = typeof (value as { toJSON?: unknown } | null | undefined)?.toJSON === 'function' ? (value as { toJSON(): unknown }).toJSON() : value;
  if (Array.isArray(json)) return json.map(literal);
  if (!json || typeof json !== 'object') return json;
  return Object.fromEntries(Object.entries(json).filter(([key]) => !key.startsWith('$')).map(([key, item]) => [key, literal(item)]));
}

function displayed(type: string, props: Record<string, unknown>): Record<string, unknown> {
  if (type === 'Link') return { ...props, href: safeUrl(props.href) ?? '' };
  if (type === 'Image') return { ...props, src: safeUrl(props.src, true) ?? '' };
  if (type === 'PortableText') return { ...props, value: projectPortableText(props.value as unknown[]) };
  return props;
}

function themeStyle(document: PageDocument): Record<string, string> {
  const theme = themeSchema.parse(document.theme ?? {});
  return {
    '--accent': theme.accent,
    '--background': theme.background,
    '--foreground': theme.foreground,
    '--radius': { none: '0', sm: '0.5rem', lg: '1.5rem' }[theme.radius],
    fontFamily: theme.font === 'serif' ? 'Georgia, "Noto Serif JP", serif' : 'Inter, "Noto Sans JP", system-ui, sans-serif',
  };
}

/**
 * Applies data bindings, visibility and repeats on the server, then revalidates every
 * bound value against the component contract and keeps only the fields it declares, so
 * data cannot inject props. URLs and rich text leave here display-ready. The result is
 * both what the server renders and the only page data sent to the browser.
 */
export function resolvePage(document: PageDocument, state: PageState, extensions: ComponentExtensions = {}, { motion = true }: Options = {}): ResolvedView {
  const { props: schemas } = componentContract(extensions);
  const elements: Record<string, ResolvedElement> = {};
  const errors: string[] = [];
  const visit = (key: string, item: unknown, suffix: string, staggered?: ResolvedMotion): string | null => {
    const element = document.spec.elements[key];
    const context = { stateModel: state, repeatItem: item };
    if (!element || !evaluateVisibility(element.visible, context)) return null;
    const resolved = Object.fromEntries(Object.entries(element.props).map(([name, value]) => [name, name === 'motion' ? value : resolvePropValue(value, context)]));
    // The parsed value, not the bound one: undeclared fields of nested objects are dropped before they reach the browser.
    const parsed = schemas[element.type]?.strict().safeParse(resolved);
    if (!parsed?.success) { errors.push(`${key}: bound data does not match ${element.type}`); return null; }
    const id = `${key}${suffix}`;
    const { motion: authored, ...props } = parsed.data as Record<string, unknown> & { motion?: AuthoredMotion };
    const shown = literal(displayed(element.type, props)) as Record<string, unknown>;
    // An Image without a safe src renders nothing, so neither it nor its alt reaches the browser.
    if (element.type === 'Image' && !shown.src) return null;
    const filled = motion && authored ? { effect: authored.effect, delay: authored.delay ?? 'none', duration: authored.duration ?? 'normal' } as const : undefined;
    const group = filled && authored?.stagger ? { ...filled, stagger: authored.stagger, group: id } : undefined;
    const own = staggered ?? (group ? undefined : filled);
    const children: string[] = [];
    const add = (child: string, childItem: unknown, childSuffix: string) => { const resolvedChild = visit(child, childItem, childSuffix, group); if (resolvedChild) children.push(resolvedChild); };
    if (element.repeat) {
      const source = element.repeat.statePath.slice(6);
      const values = state.data[source];
      if (!Array.isArray(values)) { errors.push(`${key}: repeat source must be a list`); return null; }
      // Nested repeats are rejected by validation, so one index suffix keeps expanded IDs unique.
      // With motion, never more copies than the query asks for, which is what the motion limit counts.
      (motion ? values.slice(0, listLength(document, source)) : values).forEach((value, index) => { for (const child of element.children ?? []) add(child, value, `~${index}`); });
    } else for (const child of element.children ?? []) add(child, item, suffix);
    elements[id] = { type: element.type, props: { ...shown, ...(own ? { motion: own } : {}) }, ...(element.children || element.repeat ? { children } : {}) };
    return id;
  };
  const root = visit(document.spec.root, undefined, '');
  if (errors.length) throw new Error(errors.join('; '));
  // A plain JSON copy is what the browser receives, so the server renders the same value.
  const view: ResolvedView = JSON.parse(JSON.stringify({
    spec: { root: root ?? document.spec.root, elements },
    theme: themeStyle(document),
    motion: Object.values(elements).some(element => element.props.motion),
  }));
  return view;
}
