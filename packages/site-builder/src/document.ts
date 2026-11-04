import { evaluateVisibility, resolvePropValue, type Spec } from '@json-render/core';
import { z } from 'zod';
import { componentContract, type ComponentExtensions } from './extensions.ts';

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
    limit: z.number().int().min(1).max(24).optional(),
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
  const { props: componentProps, containers: containerNames } = componentContract(extensions);
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
      if (!Object.hasOwn(shape, prop)) errors.push(`${key}.${prop}: unknown property`);
    }
    for (const [prop, validator] of Object.entries(shape)) {
      const value = element.props[prop];
      const result = isBinding(value) ? binding.safeParse(value) : (validator as z.ZodType).safeParse(value);
      if (!result.success) errors.push(`${key}.${prop}: ${result.error.issues[0]?.message}`);
    }
    if ((element.children?.length || element.repeat) && !containerNames.has(element.type)) errors.push(`${key}: only containers may have children or repeat`);
    if (element.repeat && !Object.hasOwn(document.data ?? {}, element.repeat.statePath.slice(6))) errors.push(`${key}: repeat data source is missing`);
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
  return errors.length ? { success: false, errors: errors.slice(0, 30) } : { success: true, document };
}

/** Binding results are revalidated so data cannot inject props outside the component contract. */
export function validateResolvedSpec(document: PageDocument, state: PageState, extensions: ComponentExtensions = {}): Spec {
  const { props: componentProps } = componentContract(extensions);
  const errors: string[] = [];
  const walk = (key: string, item?: unknown) => {
    const element = document.spec.elements[key];
    if (!element || !evaluateVisibility(element.visible, { stateModel: state, repeatItem: item })) return;
    const context = { stateModel: state, repeatItem: item };
    const props = Object.fromEntries(Object.entries(element.props).map(([name, value]) => [name, resolvePropValue(value, context)]));
    const result = componentProps[element.type].strict().safeParse(props);
    if (!result.success) errors.push(`${key}: bound data does not match ${element.type}`);
    if (element.repeat) {
      const values = state.data[element.repeat.statePath.slice(6)];
      if (!Array.isArray(values)) { errors.push(`${key}: repeat source must be a list`); return; }
      for (const value of values.slice(0, 24)) {
        for (const child of element.children ?? []) walk(child, value);
      }
      return;
    }
    for (const child of element.children ?? []) walk(child, item);
  };
  walk(document.spec.root);
  if (errors.length) throw new Error(errors.join('; '));
  return document.spec;
}
