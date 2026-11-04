import type { AstroIntegration } from 'astro';
import { resolveOptions, type SiteBuilderOptions } from './options.ts';
import { fileURLToPath } from 'node:url';

/** Opt-in routes let the host use the packaged renderer without copying page code. */
export function siteBuilderPages(input: SiteBuilderOptions = {}): AstroIntegration {
  const options = resolveOptions(input);
  return {
    name: '@open-emdash/site-builder/pages',
    hooks: {
      'astro:config:setup': setup => {
        const extensionModule = options.componentsModule ? fileURLToPath(new URL(options.componentsModule, setup.config.root)) : null;
        setup.updateConfig({ vite: { plugins: [{
          name: 'site-builder-configuration',
          resolveId(id) { if (['virtual:site-builder/config', 'virtual:site-builder/extensions', 'virtual:site-builder/runtime'].includes(id)) return `\0${id}`; },
          load(id) {
            if (id === '\0virtual:site-builder/config') return `export default ${JSON.stringify(options)};`;
            if (id === '\0virtual:site-builder/extensions') return extensionModule ? `export { default } from ${JSON.stringify(extensionModule)};` : 'export default {};';
            if (id === '\0virtual:site-builder/runtime') return `import { createPlugin as create } from '@open-emdash/site-builder/runtime'; import components from 'virtual:site-builder/extensions'; export function createPlugin(options) { if (JSON.stringify(options) !== ${JSON.stringify(JSON.stringify(options))}) throw new Error('siteBuilder and siteBuilderPages must use the same options'); return create(options, components); }`;
          },
        }], ssr: { noExternal: ['@open-emdash/site-builder'] } } });
        setup.addMiddleware({ entrypoint: '@open-emdash/site-builder/middleware', order: 'post' });
        setup.injectRoute({
          pattern: `${options.basePath}/[...slug]`,
          entrypoint: fileURLToPath(new URL('../src/pages/[...slug].astro', import.meta.url)),
          prerender: false,
        });
        setup.injectRoute({
          pattern: `${options.previewPath}/[id]`,
          entrypoint: fileURLToPath(new URL('../src/pages/preview/[id].astro', import.meta.url)),
          prerender: false,
        });
      },
    },
  };
}
