import type { ComponentType, ReactNode } from 'react';
import { z } from 'zod';
import { componentProps, containerNames, motionSchema } from './catalog.ts';
import type { RootComponent } from './motion-tokens.ts';

export type ComponentDefinition = {
  props: z.ZodObject;
  component: ComponentType<any>;
  description: string;
  container?: boolean;
  /** The component renders its outermost element through `Root`, so documents may give it props.motion. */
  motion?: boolean;
};
export type ComponentExtensions = Record<string, ComponentDefinition>;
export type { RootComponent, RootProps } from './motion-tokens.ts';
export function defineComponent<T extends z.ZodObject>(definition: {
  props: T;
  component: ComponentType<{ props: z.infer<T>; children?: ReactNode; Root: RootComponent }>;
  description: string;
  container?: boolean;
  motion?: boolean;
}): ComponentDefinition { return definition; }

const reservedProps = ['style', 'dangerouslySetInnerHTML', 'innerHTML', 'children', 'motion', '__proto__', 'constructor', 'prototype'];

/** Host code alone can register components; documents cannot add executable code. */
export function componentContract(extensions: ComponentExtensions = {}) {
  const props: Record<string, z.ZodObject> = { ...componentProps };
  const containers = new Set(containerNames);
  if (Object.keys(extensions).length > 100) throw new Error('At most 100 custom components are allowed');
  for (const [name, definition] of Object.entries(extensions)) {
    if (!/^[A-Z][a-zA-Z0-9]{0,59}$/.test(name) || Object.hasOwn(componentProps, name) || ['Object', 'Function'].includes(name)) throw new Error(`Invalid or reserved component name: ${name}`);
    if (!(definition.props instanceof z.ZodObject) || typeof definition.component !== 'function' || !definition.description || !['boolean', 'undefined'].includes(typeof definition.motion)) throw new Error(`Invalid component definition: ${name}`);
    for (const prop of Object.keys(definition.props.shape)) {
      if (/^on/i.test(prop) || reservedProps.includes(prop) || prop.startsWith('$')) throw new Error(`Unsafe component property: ${name}.${prop}`);
    }
    props[name] = definition.motion ? definition.props.extend({ motion: motionSchema.optional() }) : definition.props;
    z.toJSONSchema(props[name]); // MCP must be able to describe every registered schema.
    if (definition.container) containers.add(name);
  }
  // A component moves exactly when its schema lists motion, as validation checks.
  const motion = new Set(Object.keys(props).filter(name => Object.hasOwn(props[name]!.shape, 'motion')));
  return { props, containers, motion };
}

export { safeUrl } from './safe-url.ts';
