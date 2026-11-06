import type { AstroIntegration } from 'astro';
import { resolveOptions, type BuilderOptions } from './options.ts';
import { fileURLToPath } from 'node:url';

const packageName = '@interactive-inc/emdash-plugins';
// The page island imports these from the package's own source; prebundling them avoids hundreds of dev requests.
const islandDependencies = ['motion/react', '@json-render/react', '@json-render/core', '@portabletext/react', 'zod'];
const virtualModules = ['config', 'extensions', 'runtime', 'page-shell'].map(name => `virtual:emdash-plugins/builder/${name}`);
const runtime = `${packageName}/builder/runtime`;
// Astro and route sources ship uncompiled, next to the compiled dist/builder.
const source = (path: string) => fileURLToPath(new URL(`../../src/builder/${path}`, import.meta.url));

/** Serves builderPlugin()'s runtime, checks both received the same options, and adds the page routes. */
export function builderIntegration(input: BuilderOptions = {}): AstroIntegration {
  const options = resolveOptions(input);
  return {
    name: '@interactive-inc/emdash-plugins/builder',
    hooks: {
      'astro:config:setup': setup => {
        const extensionModule = options.componentsModule ? fileURLToPath(new URL(options.componentsModule, setup.config.root)) : null;
        setup.updateConfig({ vite: {
          plugins: [{
            name: 'emdash-plugins:builder',
            // Before Vite's resolver, so EmDash's import of the plain runtime reaches the options check too.
            enforce: 'pre',
            resolveId(id, importer) {
              if (virtualModules.includes(id)) return `\0${id}`;
              if (id === runtime && importer !== '\0virtual:emdash-plugins/builder/runtime') return '\0virtual:emdash-plugins/builder/runtime';
            },
            load(id) {
              if (id === '\0virtual:emdash-plugins/builder/config') return `export default ${JSON.stringify(options)};`;
              if (id === '\0virtual:emdash-plugins/builder/extensions') {
                // Without motion no page hydrates, so host components stay out of the browser bundle.
                const browser = this.environment?.config.consumer === 'client';
                return extensionModule && (options.motion || !browser) ? `export { default } from ${JSON.stringify(extensionModule)};` : 'export default {};';
              }
              if (id === '\0virtual:emdash-plugins/builder/runtime') return `import { createPlugin as create } from '${runtime}'; import components from 'virtual:emdash-plugins/builder/extensions'; export function createPlugin(options) { if (JSON.stringify(options) !== ${JSON.stringify(JSON.stringify(options))}) throw new Error('builderPlugin and builderIntegration must use the same options'); return create(options, components); }`;
              // Astro builds every island an imported .astro file contains, whichever branch renders.
              if (id === '\0virtual:emdash-plugins/builder/page-shell') return `export { default } from ${JSON.stringify(source(options.motion ? 'PageShell.astro' : 'StaticPageShell.astro'))};`;
            },
          }],
          // One copy of React and Motion for the island; an externalized Motion would load a second React.
          ssr: { noExternal: [packageName, 'motion', 'framer-motion', 'motion-dom', 'motion-utils'] },
          optimizeDeps: { include: islandDependencies.map(name => `${packageName} > ${name}`) },
        } });
        setup.addClientDirective({ name: 'builder-motion', entrypoint: fileURLToPath(new URL('./motion-directive.js', import.meta.url)) });
        setup.addMiddleware({ entrypoint: '@interactive-inc/emdash-plugins/builder/middleware', order: 'post' });
        setup.injectRoute({ pattern: `${options.basePath}/[...slug]`, entrypoint: source('pages/[...slug].astro'), prerender: false });
        setup.injectRoute({ pattern: `${options.previewPath}/[id]`, entrypoint: source('pages/preview/[id].astro'), prerender: false });
      },
    },
  };
}
