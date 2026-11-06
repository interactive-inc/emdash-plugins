import type { PluginDescriptor } from 'emdash';
import { pluginId, pluginVersion } from './constants.ts';
import { resolveOptions, type BuilderOptions } from './options.ts';
export type { BuilderOptions } from './options.ts';

/** Only serializable metadata is evaluated while Astro loads its configuration. */
export function builderPlugin(options: BuilderOptions = {}): PluginDescriptor {
  const resolved = resolveOptions(options);
  return {
    id: pluginId, version: pluginVersion, format: 'native',
    // Host components need builderIntegration()'s virtual module; with the integration registered, it also
    // serves the plain runtime through a check that both were given the same options.
    entrypoint: resolved.componentsModule ? 'virtual:emdash-plugins/builder/runtime' : '@interactive-inc/emdash-plugins/builder/runtime',
    options: resolved,
    adminEntry: '@interactive-inc/emdash-plugins/builder/admin',
  };
}
