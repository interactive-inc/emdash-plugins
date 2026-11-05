import type { ComponentType, ReactNode } from 'react';
import { z } from 'zod';
import { componentProps, containerNames } from './catalog.ts';

export type ComponentDefinition = {
  props: z.ZodObject;
  component: ComponentType<any>;
  description: string;
  container?: boolean;
};
export type ComponentExtensions = Record<string, ComponentDefinition>;
export function defineComponent<T extends z.ZodObject>(definition: {
  props: T;
  component: ComponentType<{ props: z.infer<T>; children?: ReactNode }>;
  description: string;
  container?: boolean;
}): ComponentDefinition { return definition; }

/** Host code alone can register components; documents cannot add executable code. */
export function componentContract(extensions: ComponentExtensions = {}) {
  const props: Record<string, z.ZodObject> = { ...componentProps };
  const containers = new Set(containerNames);
  if (Object.keys(extensions).length > 100) throw new Error('At most 100 custom components are allowed');
  for (const [name, definition] of Object.entries(extensions)) {
    if (!/^[A-Z][a-zA-Z0-9]{0,59}$/.test(name) || Object.hasOwn(componentProps, name) || ['Object', 'Function'].includes(name)) throw new Error(`Invalid or reserved component name: ${name}`);
    if (!(definition.props instanceof z.ZodObject) || typeof definition.component !== 'function' || !definition.description) throw new Error(`Invalid component definition: ${name}`);
    for (const prop of Object.keys(definition.props.shape)) {
      if (/^on/i.test(prop) || ['style', 'dangerouslySetInnerHTML', 'innerHTML', 'children', '__proto__', 'constructor', 'prototype'].includes(prop) || prop.startsWith('$')) throw new Error(`Unsafe component property: ${name}.${prop}`);
    }
    z.toJSONSchema(definition.props); // MCP must be able to describe every registered schema.
    props[name] = definition.props;
    if (definition.container) containers.add(name);
  }
  return { props, containers };
}

export { safeUrl } from './safe-url.ts';
