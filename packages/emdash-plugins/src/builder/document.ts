import { z } from 'zod';
import { componentContract, type ComponentExtensions } from './extensions.ts';
import { listLength, maxListItems } from './list-limits.ts';
import { maxMotionElements } from './motion-tokens.ts';
import type { AuthoredMotion } from './catalog.ts';

const name = z.string().regex(/^[a-z][a-z0-9_]*$/).max(60);
const statePath = z.string().regex(/^\/(page|data)(\/[a-zA-Z0-9_-]+)*$/).max(300);
const binding = z.union([
  z.strictObject({ $state: statePath }),
  z.strictObject({ $item: z.string().regex(/^[a-zA-Z0-9_]+(\/[a-zA-Z0-9_-]+)*$/).max(300) }),
  z.strictObject({ $template: z.string().max(2000) }),
]);
const elementSchema = z.strictObject({
  type: z.string().regex(/^[A-Z][a-zA-Z0-9]{0,59}$/),
  props: z.record(z.string(), z.unknown()),
  children: z.array(z.string().min(1).max(80)).max(100).optional(),
  repeat: z.strictObject({ statePath: z.string().regex(/^\/data\/[a-z][a-z0-9_]*$/), key: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/) }).optional(),
  visible: z.union([z.boolean(), z.strictObject({ $state: statePath })]).optional(),
});
export const themeSchema = z.strictObject({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#d4ff5a'),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#f7f8f2'),
  foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#18221a'),
  font: z.enum(['sans', 'serif']).default('sans'),
  radius: z.enum(['none', 'sm', 'lg']).default('lg'),
});
const documentSchema = z.strictObject({
  version: z.literal(1),
  spec: z.strictObject({ root: z.string().min(1).max(80), elements: z.record(z.string().regex(/^[\w-]{1,80}$/), elementSchema) }),
  theme: themeSchema.optional(),
  data: z.record(name, z.strictObject({
    collection: name,
    id: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(maxListItems).optional(),
  })).refine(value => Object.keys(value).length <= 8, 'At most eight data queries are allowed').optional(),
});
export type PageDocument = z.infer<typeof documentSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type PageState = { page: { title: string; description: string; slug: string }; data: Record<string, unknown> };
export type ValidationResult = { success: true; document: PageDocument } | { success: false; errors: string[] };

function isBinding(value: unknown): boolean {
  return !!value && typeof value === 'object' && Object.keys(value).some(key => key.startsWith('$'));
}

/** Validates both the catalog contract and bounded tree structure before storage or rendering. */
export function validateDocument(input: unknown, extensions: ComponentExtensions = {}): ValidationResult {
  const { props: componentProps, containers: containerNames, motion: motionNames } = componentContract(extensions);
  let serialized: string;
  try { serialized = JSON.stringify(input); } catch { return { success: false, errors: ['Document must be JSON'] }; }
  if (!serialized || serialized.length > 200000) return { success: false, errors: ['Document exceeds 200 KB'] };
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) return { success: false, errors: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) };
  const document = parsed.data;
  const elements = document.spec.elements;
  const errors: string[] = [];
  const keys = Object.keys(elements);
  if (keys.length > 200) errors.push('At most 200 elements are allowed');
  for (const [key, element] of Object.entries(elements)) {
    if (!Object.hasOwn(componentProps, element.type)) { errors.push(`${key}: unregistered component`); continue; }
    const shape = componentProps[element.type]!.shape;
    for (const prop of Object.keys(element.props)) {
      if (prop === 'motion' && !Object.hasOwn(shape, prop)) errors.push(element.type === 'Section'
        ? `${key}.motion: Section stays still; animate the elements inside it`
        : `${key}.motion: ${element.type} does not support motion; animate an element inside or around it`);
      else if (!Object.hasOwn(shape, prop)) errors.push(`${key}.${prop}: unknown property`);
    }
    for (const [prop, validator] of Object.entries(shape)) {
      const value = element.props[prop];
      if (prop === 'motion' && isBinding(value)) { errors.push(`${key}.motion: motion cannot be bound to data`); continue; }
      const result = isBinding(value) ? binding.safeParse(value) : (validator as z.ZodType).safeParse(value);
      if (!result.success) {
        const issue = result.error.issues[0];
        errors.push(`${[key, prop, ...(issue?.path ?? [])].join('.')}: ${issue?.message}`);
      }
    }
    if ((element.children?.length || element.repeat) && !containerNames.has(element.type)) errors.push(`${key}: only containers may have children or repeat`);
    if (element.repeat) {
      const source = element.repeat.statePath.slice(6);
      if (!Object.hasOwn(document.data ?? {}, source)) errors.push(`${key}: repeat data source is missing`);
      // A query with id loads one entry, which a repeat cannot list.
      else if (document.data![source]!.id) errors.push(`${key}: repeat needs a list query without id`);
    }
  }
  const visited = new Set<string>();
  const walk = (key: string, depth: number, repeated: boolean) => {
    if (depth > 24) { errors.push('Tree depth exceeds 24'); return; }
    if (visited.has(key)) { errors.push(`${key}: cycle or shared child`); return; }
    visited.add(key);
    const element = Object.hasOwn(elements, key) ? elements[key] : undefined;
    if (!element) { errors.push(`${key}: missing element`); return; }
    if (repeated && element.repeat) errors.push(`${key}: nested repeats are not supported`);
    const inRepeat = repeated || !!element.repeat;
    for (const value of Object.values(element.props)) {
      if (value && typeof value === 'object' && '$item' in value && !repeated) errors.push(`${key}: $item requires repeat`);
    }
    for (const child of element.children ?? []) walk(child, depth + 1, inRepeat);
  };
  walk(document.spec.root, 0, false);
  for (const key of keys) if (!visited.has(key)) errors.push(`${key}: unreachable element`);
  if (!errors.length) errors.push(...motionErrors(document, motionNames));
  return errors.length ? { success: false, errors: errors.slice(0, 30) } : { success: true, document };
}

/**
 * One element moves at a time: nothing animates inside a moving element, no Section
 * sits inside one, and the children of a staggering container move with it instead
 * of on their own. The limit counts what moves on the page, so every repeated copy counts.
 */
function motionErrors(document: PageDocument, motionNames: Set<string>): string[] {
  const errors: string[] = [];
  let count = 0;
  // `moving` is the element that moves this subtree and, for a staggered child, the container whose stagger moves it.
  const walk = (key: string, copies: number, moving?: { key: string; by?: string }, staggering?: string) => {
    const element = document.spec.elements[key]!;
    const motion = element.props.motion as AuthoredMotion | undefined;
    if (moving && element.type === 'Section') errors.push(`${key}: Section stays still, so ${moving.key} cannot move it; put motion on elements inside the Section`);
    if (staggering) {
      count += copies;
      if (motion) errors.push(`${key}.motion: ${staggering} already staggers its children; remove this motion`);
      else if (!motionNames.has(element.type)) errors.push(`${key}: ${element.type} cannot move, so ${staggering} cannot stagger it`);
    } else if (motion && moving) errors.push(moving.by
      ? `${key}.motion: ${moving.key} already moves with ${moving.by}'s stagger; remove this motion or the stagger on ${moving.by}`
      : `${key}.motion: ${moving.key} already moves this element; keep motion on only one of them`);
    else if (motion && !motion.stagger) count += copies;
    if (motion?.stagger && !element.children?.length) errors.push(`${key}.motion: stagger needs children`);
    const movesWith = moving ?? (staggering ? { key, by: staggering } : motion && !motion.stagger ? { key } : undefined);
    const group = !movesWith && motion?.stagger ? key : undefined;
    // Nested repeats are rejected earlier, so a copy count is at most one list long.
    const items = element.repeat ? listLength(document, element.repeat.statePath.slice(6)) : 1;
    for (const child of element.children ?? []) walk(child, copies * items, movesWith, group);
  };
  walk(document.spec.root, 1);
  if (count > maxMotionElements) errors.push(`At most ${maxMotionElements} elements may move; this page moves up to ${count}, counting each staggered child and each repeated copy`);
  return errors;
}
