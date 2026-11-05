import type { AstroIntegration } from 'astro';
import { resolveOptions, type BuilderOptions } from './options.ts';
import { fileURLToPath } from 'node:url';

/** Opt-in routes let the host use the packaged renderer without copying page code. */
export function builderIntegration(input: BuilderOptions = {}): AstroIntegration {
  const options = resolveOptions(input);
  return {
    name: '@interactive-inc/emdash-plugins/builder',
    hooks: {
      'astro:config:setup': setup => {
        const extensionModule = options.componentsModule ? fileURLToPath(new URL(options.componentsModule, setup.config.root)) : null;
        setup.updateConfig({ vite: { plugins: [{
          name: 'emdash-plugins:builder',
          resolveId(id) { if (['virtual:emdash-plugins/builder/config', 'virtual:emdash-plugins/builder/extensions', 'virtual:emdash-plugins/builder/runtime'].includes(id)) return `\0${id}`; },
          load(id) {
            if (id === '\0virtual:emdash-plugins/builder/config') return `export default ${JSON.stringify(options)};`;
            if (id === '\0virtual:emdash-plugins/builder/extensions') return extensionModule ? `export { default } from ${JSON.stringify(extensionModule)};` : 'export default {};';
            if (id === '\0virtual:emdash-plugins/builder/runtime') return `import { createPlugin as create } from '@interactive-inc/emdash-plugins/builder/runtime'; import components from 'virtual:emdash-plugins/builder/extensions'; export function createPlugin(options) { if (JSON.stringify(options) !== ${JSON.stringify(JSON.stringify(options))}) throw new Error('builderPlugin and builderIntegration must use the same options'); return create(options, components); }`;
          },
        }], ssr: { noExternal: ['@interactive-inc/emdash-plugins'] } } });
        setup.addMiddleware({ entrypoint: '@interactive-inc/emdash-plugins/builder/middleware', order: 'post' });
        setup.injectRoute({
          pattern: `${options.basePath}/[...slug]`,
          entrypoint: fileURLToPath(new URL('../../src/builder/pages/[...slug].astro', import.meta.url)),
          prerender: false,
        });
        setup.injectRoute({
          pattern: `${options.previewPath}/[id]`,
          entrypoint: fileURLToPath(new URL('../../src/builder/pages/preview/[id].astro', import.meta.url)),
          prerender: false,
        });
      },
    },
  };
}
