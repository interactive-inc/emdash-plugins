import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { builderIntegration } from '../../../src/builder/astro.ts';
import { builderPlugin } from '../../../src/builder/plugin.ts';
import type { BuilderOptions } from '../../../src/builder/options.ts';

type Plugin = { enforce?: string; resolveId(id: string, importer?: string): string | undefined; load(this: unknown, id: string): string | undefined };
function setup(options: BuilderOptions) {
  const calls = { directives: [] as { name: string; entrypoint: string }[], vite: [] as Record<string, any>[], routes: [] as { pattern: string; entrypoint: string }[] };
  const hook = builderIntegration(options).hooks['astro:config:setup'] as (input: unknown) => void;
  hook({
    config: { root: new URL('file:///host/') },
    updateConfig: (config: { vite: Record<string, any> }) => calls.vite.push(config.vite),
    addClientDirective: (directive: { name: string; entrypoint: string }) => calls.directives.push(directive),
    addMiddleware: () => {},
    injectRoute: (route: { pattern: string; entrypoint: string }) => calls.routes.push(route),
  });
  const vite = calls.vite[0]!;
  const plugin = vite.plugins[0] as Plugin;
  const load = (id: string, consumer: 'client' | 'server' = 'server') => plugin.load.call({ environment: { config: { consumer } } }, plugin.resolveId(id)!);
  const extensions = (consumer: 'client' | 'server') => load('virtual:emdash-plugins/builder/extensions', consumer);
  return { ...calls, vite, load, extensions };
}
const source = (path: string) => fileURLToPath(new URL(`../../../src/builder/${path}`, import.meta.url));

/** Evaluates the virtual runtime as EmDash imports it, with the package runtime from source. */
async function virtualRuntime(options: BuilderOptions) {
  const code = setup(options).load('virtual:emdash-plugins/builder/runtime')!
    .replace('@interactive-inc/emdash-plugins/builder/runtime', new URL('../../../src/builder/runtime.ts', import.meta.url).href)
    .replace('virtual:emdash-plugins/builder/extensions', 'data:text/javascript,export%20default%20%7B%7D');
  return await import(`data:text/javascript,${encodeURIComponent(code)}`) as { createPlugin(options: unknown): { id: string } };
}

test('with the integration registered, both entrypoints run the options check', async () => {
  assert.equal(builderPlugin().entrypoint, '@interactive-inc/emdash-plugins/builder/runtime', 'the plugin works on its own');
  assert.equal(builderPlugin({ componentsModule: './src/components.tsx' }).entrypoint, 'virtual:emdash-plugins/builder/runtime');
  const { vite } = setup({});
  const plugin = vite.plugins[0] as Plugin;
  assert.equal(plugin.enforce, 'pre');
  assert.equal(plugin.resolveId('@interactive-inc/emdash-plugins/builder/runtime', 'virtual:emdash/plugins'), '\0virtual:emdash-plugins/builder/runtime');
  assert.equal(plugin.resolveId('@interactive-inc/emdash-plugins/builder/runtime', '\0virtual:emdash-plugins/builder/runtime'), undefined, 'the check itself loads the plain runtime');
  for (const componentsModule of [undefined, './src/components.tsx']) {
    const options = componentsModule ? { componentsModule } : {};
    const descriptor = builderPlugin(options);
    assert.equal((await virtualRuntime(options)).createPlugin(descriptor.options).id, 'builder');
    const disabled = await virtualRuntime({ ...options, motion: false });
    assert.throws(() => disabled.createPlugin(descriptor.options), /must use the same options/);
    assert.throws(() => disabled.createPlugin(builderPlugin({ ...options, motion: false, collection: 'landing' }).options), /must use the same options/);
    assert.equal(disabled.createPlugin(builderPlugin({ ...options, motion: false }).options).id, 'builder');
  }
});

test('the routes render the island shell only when motion is enabled', () => {
  const shell = (options: BuilderOptions) => setup(options).load('virtual:emdash-plugins/builder/page-shell');
  assert.equal(shell({}), `export { default } from ${JSON.stringify(source('PageShell.astro'))};`);
  assert.equal(shell({ motion: false }), `export { default } from ${JSON.stringify(source('StaticPageShell.astro'))};`);
  // Astro builds the island of any .astro file in the server graph, so the static shell must not reach it.
  for (const file of ['StaticPageShell.astro', 'PageDocument.astro']) assert.doesNotMatch(readFileSync(source(file), 'utf8'), /\.\/island|client:/, file);
  const { routes } = setup({ basePath: '/site', previewPath: '/draft/view' });
  assert.deepEqual(routes.map(route => [route.pattern, route.entrypoint]), [['/site/[...slug]', source('pages/[...slug].astro')], ['/draft/view/[id]', source('pages/preview/[id].astro')]]);
  for (const { entrypoint } of routes) {
    const route = readFileSync(entrypoint, 'utf8');
    assert.match(route, /import PageShell from 'virtual:emdash-plugins\/builder\/page-shell';/);
    // Both shells read host components from the integration; the routes pass them only to pageResponse().
    assert.doesNotMatch(route, /<PageShell[^>]*components=/);
  }
});

test('the page island hydrates through the packaged client directive', () => {
  const { directives } = setup({});
  assert.equal(directives.length, 1);
  assert.equal(directives[0]!.name, 'builder-motion');
  // The integration ships compiled from dist, where the directive is compiled next to it.
  assert.equal(directives[0]!.entrypoint, fileURLToPath(new URL('../../../src/builder/motion-directive.js', import.meta.url)));
  assert.ok(existsSync(fileURLToPath(new URL('../../../src/builder/motion-directive.ts', import.meta.url))));
});

test('host components reach the browser only when motion can hydrate a page', () => {
  const module = 'export { default } from "/host/src/components.tsx";';
  const enabled = setup({ componentsModule: './src/components.tsx' });
  assert.equal(enabled.extensions('server'), module);
  assert.equal(enabled.extensions('client'), module);
  const disabled = setup({ componentsModule: './src/components.tsx', motion: false });
  assert.equal(disabled.extensions('server'), module);
  assert.equal(disabled.extensions('client'), 'export default {};');
  assert.equal(setup({}).extensions('client'), 'export default {};');
  assert.equal(setup({}).extensions('server'), 'export default {};');
});

test('Motion and React resolve to one copy in SSR and are prebundled for the island', () => {
  const { vite } = setup({});
  for (const name of ['@interactive-inc/emdash-plugins', 'motion', 'framer-motion', 'motion-dom', 'motion-utils']) assert.ok(vite.ssr.noExternal.includes(name), name);
  assert.ok(vite.optimizeDeps.include.includes('@interactive-inc/emdash-plugins > motion/react'));
});
