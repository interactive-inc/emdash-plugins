import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

const executeFile = promisify(execFile);
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const web = join(repository, 'apps/web');
const fixture = await mkdtemp(join(tmpdir(), 'emdash-plugins-package-'));
const previewSecret = randomBytes(32).toString('hex');
// Measured at 148 KB gzip: React DOM 65, json-render + Motion + the page view 52, zod 26 (imported by
// @json-render/core). The budget leaves about 25% headroom so growth is a deliberate decision.
const islandBudget = 185_000;
// Only the page island's code contains these; site.css names the fallback too, so search JavaScript only.
const islandCode = /builder-motion-fallback|data-motion-armed/;
const inheritedEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('EMDASH_') && !['SITE_URL', 'PREVIEW_SECRET', 'AUTH_SECRET'].includes(name)));
const environment = { ...inheritedEnvironment, EMDASH_DATABASE_URL: 'file:./.data/emdash.db', EMDASH_PREVIEW_SECRET: previewSecret };
let productionServer;
let developmentServer;

async function run(command, args, cwd = fixture, env = environment) {
  try {
    const result = await executeFile(command, args, { cwd, env, maxBuffer: 8 * 1024 * 1024, timeout: 180000 });
    return result.stdout;
  } catch (error) {
    // Do not print inherited env or signed preview URLs in command failures.
    console.error((error.stdout ?? '').slice(-4000), (error.stderr ?? '').slice(-4000));
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function waitForServer(origin, server = null) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (server && (!server.pid || server.exitCode !== null || server.signalCode !== null)) throw new Error('The isolated server exited before becoming ready; inspect the fixture logs');
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(Math.min(30_000, deadline - Date.now())) });
      await response.body?.cancel();
      if (response.status < 500) return;
    } catch {}
    await delay(250);
  }
  throw new Error('The isolated host did not become ready within 180s; inspect the fixture logs');
}
/** Own the child directly: Astro's detached launcher has a fixed 30s cold-start timeout. */
async function startDevelopment(astroCli, port, origin) {
  const log = openSync(join(fixture, 'test-dev.log'), 'w');
  try {
    developmentServer = spawn(process.execPath, [astroCli, 'dev', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: fixture, env: { ...environment, ASTRO_DEV_BACKGROUND: '1' }, stdio: ['ignore', log, log],
    });
    developmentServer.on('error', () => {}); // waitForServer reports spawn failure without exposing environment values.
  } finally { closeSync(log); }
  await waitForServer(origin, developmentServer);
}
async function stopDevelopment() {
  const server = developmentServer;
  developmentServer = undefined;
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  const force = setTimeout(() => server.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(force); }
}
async function checkPage(origin, path, status, expectedText = null) {
  const response = await fetch(new URL(path, origin));
  assert.equal(response.status, status, 'Unexpected response from the isolated host');
  const html = await response.text();
  if (expectedText !== null) assert.ok(html.includes(expectedText), 'Expected page content is missing');
  return { response, html };
}
function islands(html) { return html.match(/<astro-island\b[^>]*>/g) ?? []; }
function assertStatic(html, label) {
  assert.equal(islands(html).length, 0, `${label} must not hydrate`);
  assert.doesNotMatch(html, /data-motion=""/, `${label} must not render motion`);
}
function assertMoving(html, label) {
  const found = islands(html);
  assert.equal(found.length, 1, `${label} must render exactly one island`);
  assert.match(found[0], /\bclient="builder-motion"/, `${label} must hydrate through the motion directive`);
  assert.match(html, /<noscript><style>\[data-motion\]\{opacity:1!important/, `${label} must stay readable without JavaScript`);
}
// Follows the island's entry points through their relative imports, as the browser would.
async function islandScripts(origin, html) {
  const [island] = islands(html);
  const entries = ['component-url', 'renderer-url', 'before-hydration-url'].map(name => island.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1]).filter(Boolean);
  const sources = new Map();
  const visit = async path => {
    if (sources.has(path)) return;
    sources.set(path, '');
    const response = await fetch(new URL(path, origin));
    assert.equal(response.status, 200, `Island script is missing: ${path}`);
    const source = await response.text();
    sources.set(path, source);
    for (const [, specifier] of source.matchAll(/\b(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) await visit(new URL(specifier, new URL(path, origin)).pathname);
  };
  for (const entry of entries) await visit(entry);
  const files = [...sources.values()];
  return { files: files.length, bytes: files.reduce((sum, source) => sum + Buffer.byteLength(source), 0), gzip: files.reduce((sum, source) => sum + gzipSync(source).length, 0), code: files.join('\n') };
}
// Every browser asset the build emitted, including EmDash's own admin bundle.
async function clientCode() {
  const root = join(fixture, 'dist/client');
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.js'));
  return (await Promise.all(files.map(file => readFile(join(root, file), 'utf8')))).join('\n');
}
async function jsonRequest(origin, path, token, body = null) {
  const response = await fetch(new URL(path, origin), {
    method: body === null ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(response.ok, 'Isolated host API request failed');
  return (await response.json()).data;
}
async function publishEntry(origin, collection, id, token) {
  const entry = await jsonRequest(origin, `/_emdash/api/content/${collection}/${id}`, token);
  await jsonRequest(origin, `/_emdash/api/content/${collection}/${id}/publish`, token, { _rev: entry._rev });
}
try {
  await run('vp', ['pm', 'pack', '--filter', '@interactive-inc/emdash-plugins', '--pack-destination', fixture], repository);
  const manifest = JSON.parse(await readFile(join(repository, 'packages/emdash-plugins/package.json'), 'utf8'));
  const archive = join(fixture, `interactive-inc-emdash-plugins-${manifest.version}.tgz`);
  const contents = await run('tar', ['-tzf', archive]);
  for (const file of [
    'dist/builder/plugin.js', 'dist/builder/plugin.d.ts', 'dist/builder/runtime.js', 'dist/builder/server/page-response.js',
    'dist/builder/resolve-page.js', 'dist/builder/motion-directive.js', 'dist/builder/motion-tokens.js', 'dist/builder/portable-text.js',
    'src/builder/pages/[...slug].astro', 'src/builder/pages/preview/[id].astro', 'src/builder/PageShell.astro', 'src/builder/StaticPageShell.astro', 'src/builder/PageDocument.astro',
    'src/builder/styles/site.css', 'src/builder/admin.tsx',
    'src/builder/island.tsx', 'src/builder/site-view.tsx', 'src/builder/reveal.tsx', 'src/builder/motion-site.tsx', 'src/builder/motion-tokens.ts', 'src/builder/portable-text.ts',
    'LICENSE', 'README.md',
  ]) {
    assert.ok(contents.includes(`package/${file}`), `Missing packaged file: ${file}`);
  }
  assert.doesNotMatch(contents, /\/(?:\.env(?:\.|\/|$)|\.data\/|\.astro\/|node_modules\/|apps\/|tests\/)/m);
  const localEnvironment = await readFile(join(web, '.env'), 'utf8').catch(() => '');
  const localSecret = localEnvironment.match(/^EMDASH_PREVIEW_SECRET=(.+)$/m)?.[1];
  if (localSecret) assert.ok(!gunzipSync(await readFile(archive)).includes(Buffer.from(localSecret)), 'Local secret found in package');
  console.log('PASS: npm archive includes its runtime, types, routes, admin, island sources and CSS, and excludes local state');

  const webManifest = JSON.parse(await readFile(join(web, 'package.json'), 'utf8'));
  const dependencies = { '@interactive-inc/emdash-plugins': `file:${archive}`, zod: manifest.dependencies.zod };
  for (const name of Object.keys(webManifest.dependencies)) {
    if (name === '@interactive-inc/emdash-plugins') continue;
    const installed = JSON.parse(await readFile(join(web, 'node_modules', name, 'package.json'), 'utf8'));
    dependencies[name] = installed.version;
  }
  await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'isolated-emdash-host', private: true, type: 'module', dependencies, emdash: { seed: 'seed/seed.json' } }, null, 2));
  // The isolated consumer needs explicit build-script approval and the same
  // security fixes for upstream's exact transitive dependency pins.
  await cp(join(repository, 'pnpm-workspace.yaml'), join(fixture, 'pnpm-workspace.yaml'));
  await mkdir(join(fixture, 'src/pages'), { recursive: true });
  await mkdir(join(fixture, '.data'));
  await cp(join(web, 'astro.config.mjs'), join(fixture, 'astro.config.mjs'));
  await cp(join(web, 'tsconfig.json'), join(fixture, 'tsconfig.json'));
  await cp(join(web, 'src/live.config.ts'), join(fixture, 'src/live.config.ts'));
  await cp(join(web, 'seed'), join(fixture, 'seed'), { recursive: true });
  await writeFile(join(fixture, 'src/pages/existing.astro'), `---
Astro.response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
---
<html><body><h1>Existing host route</h1></body></html>`);
  await run('vp', ['install', '--prefer-offline']);
  const installedPlugin = await realpath(join(fixture, 'node_modules/@interactive-inc/emdash-plugins'));
  assert.ok(!installedPlugin.startsWith(repository), 'Consumer must use the archive, not a workspace link');
  await run(process.execPath, ['--input-type=module', '-e', `import { builderPlugin } from '@interactive-inc/emdash-plugins/builder'; import { validateDocument } from '@interactive-inc/emdash-plugins/builder/document'; if (builderPlugin().id !== 'builder' || validateDocument(null).success) process.exit(1);`]);
  console.log('PASS: a separate project installs and imports the package without workspace sources');

  const developmentPort = await freePort();
  const developmentOrigin = `http://127.0.0.1:${developmentPort}`;
  const astroCli = join(fixture, 'node_modules/astro/bin/astro.mjs');
  await startDevelopment(astroCli, developmentPort, developmentOrigin);
  const smokeOutput = await run(process.execPath, [join(web, 'scripts/smoke.mjs')], fixture, { ...environment, SMOKE_ORIGIN: developmentOrigin });
  process.stdout.write(smokeOutput);
  await checkPage(developmentOrigin, '/existing', 200, 'Existing host route');
  const setup = await jsonRequest(developmentOrigin, '/_emdash/api/setup/dev-bypass?token=1', '');
  const home = await jsonRequest(developmentOrigin, '/_emdash/api/content/pages/home', setup.token);
  const preview = await jsonRequest(developmentOrigin, '/_emdash/api/plugins/builder/preview', setup.token, { id: home.item.id });
  assertMoving((await checkPage(developmentOrigin, '/', 200, '話すたび')).html, 'The development home page');
  assertStatic((await checkPage(developmentOrigin, '/guide', 200, '会話から')).html, 'The development guide page');
  // A bound entry field the page never renders must not reach the island's serialized props.
  const sentinel = `UNRENDERED-${randomBytes(8).toString('hex')}`;
  const boundPost = await jsonRequest(developmentOrigin, '/_emdash/api/content/posts', setup.token, { slug: 'bound-motion', data: { title: 'BOUND MOVING TITLE', excerpt: sentinel } });
  await publishEntry(developmentOrigin, 'posts', boundPost.item.id, setup.token);
  const boundDocument = { version: 1, data: { article: { collection: 'posts', id: boundPost.item.id } }, spec: { root: 'title', elements: { title: { type: 'Heading', props: { text: { $state: '/data/article/title' }, level: 'h1', motion: { effect: 'fade-up' } } } } } };
  const boundPage = await jsonRequest(developmentOrigin, '/_emdash/api/content/pages', setup.token, { slug: 'bound-motion', data: { title: 'Bound motion', document: boundDocument } });
  await publishEntry(developmentOrigin, 'pages', boundPage.item.id, setup.token);
  const developmentBound = await checkPage(developmentOrigin, '/bound-motion', 200, 'BOUND MOVING TITLE');
  assertMoving(developmentBound.html, 'A bound page with motion');
  assert.ok(!developmentBound.html.includes(sentinel), 'Unrendered entry data must not reach the browser');
  console.log('PASS: motion pages hydrate one island without unrendered data, and static pages stay script-free');
  // Seed real EmDash users/PATs only in this disposable SQLite host. Requests
  // still go through EmDash authentication, RBAC and plugin route dispatch.
  const roleTokens = JSON.parse(await run(process.execPath, ['--input-type=module', '-e', `
    import { DatabaseSync } from 'node:sqlite';
    import { randomBytes, createHash } from 'node:crypto';
    const db = new DatabaseSync('.data/emdash.db');
    db.exec('PRAGMA busy_timeout = 5000');
    const tokens = [];
    for (const role of [10, 20, 30, 40, 50]) {
      const id = 'package-role-' + role;
      const token = 'ec_pat_' + randomBytes(32).toString('base64url');
      const now = new Date().toISOString();
      db.prepare('INSERT INTO users (id, email, name, role, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(id, id + '@example.test', id, role, now, now);
      db.prepare('INSERT INTO _emdash_api_tokens (id, name, token_hash, prefix, user_id, scopes) VALUES (?, ?, ?, ?, ?, ?)').run(id, id, createHash('sha256').update(token).digest('base64url'), token.slice(0, 15), id, JSON.stringify(['admin', 'content:read', 'content:write', 'mcp:tools:builder']));
      tokens.push({ role, token });
    }
    db.close();
    console.log(JSON.stringify(tokens));
  `]));
  for (const { role, token } of roleTokens) {
    const response = await fetch(new URL('/_emdash/api/plugins/builder/preview', developmentOrigin), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: home.item.id }),
    });
    assert.equal(response.status, role < 20 ? 403 : 200, `Unexpected preview permission for role ${role}`);
    if (role < 20) assert.ok(!(await response.text()).includes('_preview='), 'Denied role must not receive a signed URL');
  }
  console.log('PASS: real subscriber, contributor, author, editor and admin tokens obey EmDash preview permissions');

  await stopDevelopment();
  await run(process.execPath, [astroCli, 'build']);
  console.log('PASS: installed package builds with the host and preserves its existing routes');

  const productionPort = await freePort();
  const productionOrigin = `http://127.0.0.1:${productionPort}`;
  productionServer = spawn(process.execPath, ['dist/server/entry.mjs'], { cwd: fixture, env: { ...environment, HOST: '127.0.0.1', PORT: String(productionPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const productionLog = [];
  productionServer.stderr.on('data', chunk => productionLog.push(String(chunk)));
  await waitForServer(productionOrigin);
  const homepage = await checkPage(productionOrigin, '/', 200, '話すたび');
  assert.doesNotMatch(homepage.html, /@vite\/client|data-astro-source-file/);
  assertMoving(homepage.html, 'The production home page');
  // The server paints each element transparent in place, so nothing flashes before hydration.
  assert.match(homepage.html, /<h1 class="heading[^"]*" data-motion="" style="opacity:0">/);
  const island = await islandScripts(productionOrigin, homepage.html);
  console.log(`Island JavaScript: ${island.files} files, ${island.bytes} bytes, ${island.gzip} bytes gzip (budget ${islandBudget})`);
  assert.ok(island.gzip <= islandBudget, `Island JavaScript exceeds its budget: ${island.gzip} > ${islandBudget} bytes gzip`);
  assert.match(island.code, islandCode, 'The island bundle must contain the motion code the disabled build is checked for');
  assert.match(homepage.response.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  const existingPage = await checkPage(productionOrigin, '/existing', 200, 'Existing host route');
  assert.equal(existingPage.response.headers.get('content-security-policy'), "frame-ancestors 'none'");
  const inlineStylesheets = [...homepage.html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
  const hasInlineStylesheet = inlineStylesheets.some(stylesheet => stylesheet[1].includes('.section') && stylesheet[1].includes('--accent'));
  if (!hasInlineStylesheet) {
    const stylesheetPath = homepage.html.match(/href="([^"]+\.css)"/)?.[1];
    assert.ok(stylesheetPath, 'Packaged page must include its stylesheet');
    const stylesheet = await checkPage(productionOrigin, stylesheetPath, 200);
    assert.ok(stylesheet.html.includes('--accent'), 'Packaged stylesheet is missing');
  }
  const guidePage = await checkPage(productionOrigin, '/guide', 200, '会話から');
  assertStatic(guidePage.html, 'The production guide page');
  assert.doesNotMatch(guidePage.html, /<script\b/, 'A page without motion must ship no JavaScript');
  const productionBound = await checkPage(productionOrigin, '/bound-motion', 200, 'BOUND MOVING TITLE');
  assertMoving(productionBound.html, 'A bound production page with motion');
  assert.ok(!productionBound.html.includes(sentinel), 'Unrendered entry data must not reach the browser');
  const previewPage = await checkPage(productionOrigin, preview.url, 200, 'プレビュー — 保存済みの内容を表示しています');
  assert.match(previewPage.response.headers.get('cache-control'), /no-store/);
  await checkPage(productionOrigin, '/_emdash/api/setup/dev-bypass', 403);
  await checkPage(productionOrigin, '/_emdash/api/mcp', 401);
  assert.equal(productionLog.length, 0, 'Production server reported an error');
  console.log('PASS: installed package serves production SSR, motion islands within budget and previews, and rejects dev login and anonymous MCP');

  productionServer.kill('SIGTERM');
  await once(productionServer, 'exit');
  productionServer = undefined;
  // Reconfigure the same isolated consumer to exercise all supported extension
  // points through a packaged install, including production bundling.
  const configured = { collection: 'landing', basePath: '/site', previewPath: '/draft/view', homeSlug: 'index', componentsModule: './src/components.tsx' };
  const configSource = await readFile(join(fixture, 'astro.config.mjs'), 'utf8');
  await writeFile(join(fixture, 'astro.config.mjs'), configSource.replace('builderIntegration()', `builderIntegration(${JSON.stringify(configured)})`).replace('builderPlugin()', `builderPlugin(${JSON.stringify(configured)})`));
  await writeFile(join(fixture, 'src/components.tsx'), `
    import { z } from 'zod';
    import { defineComponent } from '@interactive-inc/emdash-plugins/builder/extensions';
    export default {
      Notice: defineComponent({ props: z.object({ text: z.string().max(120) }), description: 'A host notice', component: ({ props }) => <aside data-custom="notice">{props.text}</aside> }),
      Callout: defineComponent({ props: z.object({ text: z.string().max(120) }), description: 'A host callout that can move', motion: true, component: ({ props, Root }) => <Root as="aside" data-custom="callout">{props.text}</Root> }),
    };
  `);
  const seed = JSON.parse(await readFile(join(fixture, 'seed/seed.json'), 'utf8'));
  seed.collections.push({ ...seed.collections.find(item => item.slug === 'pages'), slug: 'landing', label: 'Landing', urlPattern: '/site/{slug}' });
  const customDocument = { version: 1, spec: { root: 'stack', elements: {
    stack: { type: 'Stack', props: {}, children: ['notice', 'callout'] },
    notice: { type: 'Notice', props: { text: 'CUSTOM REGISTERED COMPONENT' } },
    callout: { type: 'Callout', props: { text: 'CUSTOM MOVING COMPONENT', motion: { effect: 'fade' } } },
  } } };
  // The host component's own root moves; motion adds no wrapper around it.
  const movingCallout = /<div class="stack[^"]*"><aside data-custom="notice">CUSTOM REGISTERED COMPONENT<\/aside><aside data-custom="callout" data-motion="" style="opacity:0">CUSTOM MOVING COMPONENT<\/aside><\/div>/;
  seed.content.landing = [{ id: 'landing-home', slug: 'index', status: 'published', data: { title: 'Custom home', document: customDocument } }];
  await writeFile(join(fixture, 'seed/seed.json'), JSON.stringify(seed));
  await startDevelopment(astroCli, developmentPort, developmentOrigin);
  const customSetup = await jsonRequest(developmentOrigin, '/_emdash/api/setup/dev-bypass?token=1', '');
  const customCatalog = await jsonRequest(developmentOrigin, '/_emdash/api/plugins/builder/catalog', customSetup.token);
  assert.ok(customCatalog.components.Notice, 'Custom component must be discoverable');
  assert.equal(customCatalog.descriptions.Callout.motion, true);
  assert.ok(customCatalog.motion.components.includes('Callout') && !customCatalog.motion.components.includes('Notice'), 'Only opted-in host components accept motion');
  assert.equal(customCatalog.configuration.collection, 'landing');
  const customValidation = await jsonRequest(developmentOrigin, '/_emdash/api/plugins/builder/validate', customSetup.token, { document: customDocument });
  assert.equal(customValidation.success, true);
  const unsupportedMotion = await jsonRequest(developmentOrigin, '/_emdash/api/plugins/builder/validate', customSetup.token, { document: { version: 1, spec: { root: 'notice', elements: { notice: { type: 'Notice', props: { text: 'Still', motion: { effect: 'fade' } } } } } } });
  assert.equal(unsupportedMotion.success, false);
  assert.ok(unsupportedMotion.errors.some(error => error.includes('does not support motion')), 'Motion on a host component that did not opt in must be rejected');
  const customHome = await checkPage(developmentOrigin, '/site', 200, 'CUSTOM REGISTERED COMPONENT');
  assertMoving(customHome.html, 'A custom page with motion');
  assert.match(customHome.html, movingCallout);
  await checkPage(developmentOrigin, '/site/index', 200, 'data-custom="notice"');
  await checkPage(developmentOrigin, '/index', 404);
  const draft = await jsonRequest(developmentOrigin, '/_emdash/api/content/landing', customSetup.token, { slug: 'draft', data: { title: 'Draft notice', document: customDocument } });
  const customPreview = await jsonRequest(developmentOrigin, '/_emdash/api/plugins/builder/preview', customSetup.token, { id: draft.item.id });
  assert.ok(customPreview.url.startsWith('/draft/view/'));
  await checkPage(developmentOrigin, '/site/draft', 404);
  await checkPage(developmentOrigin, `/draft/view/${draft.item.id}`, 404);
  const customPreviewPage = await checkPage(developmentOrigin, customPreview.url, 200, 'CUSTOM REGISTERED COMPONENT');
  assert.match(customPreviewPage.response.headers.get('cache-control'), /no-store/);
  // The save hook must use the extended catalog on the configured collection.
  const invalidCustom = await fetch(new URL('/_emdash/api/content/landing', developmentOrigin), {
    method: 'POST', headers: { Authorization: `Bearer ${customSetup.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'invalid-custom', data: { title: 'Invalid', document: { version: 1, spec: { root: 'notice', elements: { notice: { type: 'Notice', props: { text: 123 } } } } } } }),
  });
  assert.equal(invalidCustom.status, 422);
  await stopDevelopment();
  await run(process.execPath, [astroCli, 'build']);
  productionServer = spawn(process.execPath, ['dist/server/entry.mjs'], { cwd: fixture, env: { ...environment, HOST: '127.0.0.1', PORT: String(productionPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(productionOrigin);
  const productionCustom = await checkPage(productionOrigin, '/site', 200, 'CUSTOM REGISTERED COMPONENT');
  assertMoving(productionCustom.html, 'A custom production page with motion');
  assert.match(productionCustom.html, movingCallout);
  assert.match((await islandScripts(productionOrigin, productionCustom.html)).code, /"data-custom"/, 'With motion, host components render inside the island bundle');
  await checkPage(productionOrigin, '/site/draft', 404);
  await checkPage(productionOrigin, customPreview.url, 200, 'CUSTOM REGISTERED COMPONENT');
  await checkPage(productionOrigin, '/existing', 200, 'Existing host route');
  console.log('PASS: custom component, collection, home slug, public and preview paths work in an independently installed dev and production host');

  productionServer.kill('SIGTERM');
  await once(productionServer, 'exit');
  productionServer = undefined;
  // motion: false keeps every page static and host component code out of the browser.
  const still = { ...configured, motion: false };
  await writeFile(join(fixture, 'astro.config.mjs'), configSource.replace('builderIntegration()', `builderIntegration(${JSON.stringify(still)})`).replace('builderPlugin()', `builderPlugin(${JSON.stringify(still)})`));
  await rm(join(fixture, 'dist'), { recursive: true, force: true });
  await run(process.execPath, [astroCli, 'build']);
  productionServer = spawn(process.execPath, ['dist/server/entry.mjs'], { cwd: fixture, env: { ...environment, HOST: '127.0.0.1', PORT: String(productionPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(productionOrigin);
  const stillPage = await checkPage(productionOrigin, '/site', 200, 'CUSTOM MOVING COMPONENT');
  assertStatic(stillPage.html, 'A page with motion when motion is disabled');
  assert.doesNotMatch(stillPage.html, /<script\b/, 'Disabled motion must ship no JavaScript');
  assert.match(stillPage.html, /<aside data-custom="callout">CUSTOM MOVING COMPONENT<\/aside>/);
  const stillClient = await clientCode();
  assert.doesNotMatch(stillClient, /"data-custom"/, 'Disabled motion must keep host components out of the browser');
  assert.doesNotMatch(stillClient, islandCode, 'Disabled motion must not build the page island');
  const administrator = roleTokens.find(({ role }) => role === 50).token;
  const stillCatalog = await jsonRequest(productionOrigin, '/_emdash/api/plugins/builder/catalog', administrator);
  assert.equal(stillCatalog.motion.enabled, false);
  assert.match(stillCatalog.guide, /Motion is disabled/);
  console.log('PASS: motion: false renders static pages and builds neither the island nor host components into client bundles');

} finally {
  await stopDevelopment();
  if (productionServer && productionServer.exitCode === null) {
    productionServer.kill('SIGTERM');
    await once(productionServer, 'exit');
  }
  console.log(`Isolated test files: ${fixture}`);
}
