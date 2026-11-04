import type { PluginDescriptor } from 'emdash';
import { resolveOptions, type SiteBuilderOptions } from './options.ts';
export type { SiteBuilderOptions } from './options.ts';

/** Only serializable metadata is evaluated while Astro loads its configuration. */
export function siteBuilder(options: SiteBuilderOptions = {}): PluginDescriptor {
  const resolved = resolveOptions(options);
  return {
    id: 'site-builder', version: '0.1.0', format: 'native',
    entrypoint: resolved.componentsModule ? 'virtual:site-builder/runtime' : '@open-emdash/site-builder/runtime',
    options: resolved,
    adminEntry: '@open-emdash/site-builder/admin',
  };
}
