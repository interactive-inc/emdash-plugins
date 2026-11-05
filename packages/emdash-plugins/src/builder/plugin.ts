import type { PluginDescriptor } from 'emdash';
import { pluginId, pluginVersion } from './constants.ts';
import { resolveOptions, type BuilderOptions } from './options.ts';
export type { BuilderOptions } from './options.ts';

/** Only serializable metadata is evaluated while Astro loads its configuration. */
export function builderPlugin(options: BuilderOptions = {}): PluginDescriptor {
  const resolved = resolveOptions(options);
  return {
    id: pluginId, version: pluginVersion, format: 'native',
    entrypoint: resolved.componentsModule ? 'virtual:emdash-plugins/builder/runtime' : '@interactive-inc/emdash-plugins/builder/runtime',
    options: resolved,
    adminEntry: '@interactive-inc/emdash-plugins/builder/admin',
  };
}
