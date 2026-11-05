import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

const executeFile = promisify(execFile);
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const web = join(repository, 'apps/web');
const fixture = await mkdtemp(join(tmpdir(), 'emdash-plugins-package-'));
const previewSecret = randomBytes(32).toString('hex');
const inheritedEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('EMDASH_') && !['SITE_URL', 'PREVIEW_SECRET', 'AUTH_SECRET'].includes(name)));
const environment = { ...inheritedEnvironment, EMDASH_DATABASE_URL: 'file:./.data/emdash.db', EMDASH_PREVIEW_SECRET: previewSecret };
let productionServer;
let hasDevServer = false;

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
async function waitForServer(origin) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fetch(origin); return; } catch { await delay(250); }
  }
  throw new Error('The isolated host did not start');
}
async function checkPage(origin, path, status, expectedText = null) {
  const response = await fetch(new URL(path, origin));
  assert.equal(response.status, status, 'Unexpected response from the isolated host');
  const html = await response.text();
  if (expectedText !== null) assert.ok(html.includes(expectedText), 'Expected page content is missing');
  return { response, html };
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
try {
  await run('vp', ['pm', 'pack', '--filter', '@interactive-inc/emdash-plugins', '--pack-destination', fixture], repository);
  const manifest = JSON.parse(await readFile(join(repository, 'packages/emdash-plugins/package.json'), 'utf8'));
  const archive = join(fixture, `interactive-inc-emdash-plugins-${manifest.version}.tgz`);
  const contents = await run('tar', ['-tzf', archive]);
  for (const file of ['dist/builder/plugin.js', 'dist/builder/plugin.d.ts', 'dist/builder/runtime.js', 'dist/builder/server/page-response.js', 'src/builder/pages/[...slug].astro', 'src/builder/pages/preview/[id].astro', 'src/builder/styles/site.css', 'src/builder/admin.tsx', 'LICENSE', 'README.md']) {
    assert.ok(contents.includes(`package/${file}`), `Missing packaged file: ${file}`);
  }
  assert.doesNotMatch(contents, /\/(?:\.env(?:\.|\/|$)|\.data\/|\.astro\/|node_modules\/|apps\/|tests\/)/m);
  const localEnvironment = await readFile(join(web, '.env'), 'utf8').catch(() => '');
  const localSecret = localEnvironment.match(/^EMDASH_PREVIEW_SECRET=(.+)$/m)?.[1];
  if (localSecret) assert.ok(!gunzipSync(await readFile(archive)).includes(Buffer.from(localSecret)), 'Local secret found in package');
  console.log('PASS: npm archive includes its runtime, types, routes, admin and CSS, and excludes local state');

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
  await run(process.execPath, [astroCli, 'dev', '--background', '--host', '127.0.0.1', '--port', String(developmentPort)]);
  hasDevServer = true;
  await waitForServer(developmentOrigin);
  const smokeOutput = await run(process.execPath, [join(web, 'scripts/smoke.mjs')], fixture, { ...environment, SMOKE_ORIGIN: developmentOrigin });
  process.stdout.write(smokeOutput);
  await checkPage(developmentOrigin, '/existing', 200, 'Existing host route');
  const setup = await jsonRequest(developmentOrigin, '/_emdash/api/setup/dev-bypass?token=1', '');
  const home = await jsonRequest(developmentOrigin, '/_emdash/api/content/pages/home', setup.token);
  const preview = await jsonRequest(developmentOrigin, '/_emdash/api/plugins/builder/preview', setup.token, { id: home.item.id });
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

  await run(process.execPath, [astroCli, 'dev', 'stop']);
  hasDevServer = false;
  await run(process.execPath, [astroCli, 'build']);
  console.log('PASS: installed package builds with the host and preserves its existing routes');

  const productionPort = await freePort();
  const productionOrigin = `http://127.0.0.1:${productionPort}`;
  productionServer = spawn(process.execPath, ['dist/server/entry.mjs'], { cwd: fixture, env: { ...environment, HOST: '127.0.0.1', PORT: String(productionPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const productionLog = [];
  productionServer.stderr.on('data', chunk => productionLog.push(String(chunk)));
  await waitForServer(productionOrigin);
  const homepage = await checkPage(productionOrigin, '/', 200, '話すたび');
  assert.doesNotMatch(homepage.html, /@vite\/client|data-astro-source-file|astro-island/);
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
  await checkPage(productionOrigin, '/guide', 200, '会話から');
  const previewPage = await checkPage(productionOrigin, preview.url, 200, 'プレビュー — 保存済みの内容を表示しています');
  assert.match(previewPage.response.headers.get('cache-control'), /no-store/);
  await checkPage(productionOrigin, '/_emdash/api/setup/dev-bypass', 403);
  await checkPage(productionOrigin, '/_emdash/api/mcp', 401);
  assert.equal(productionLog.length, 0, 'Production server reported an error');
  console.log('PASS: installed package serves production SSR and previews, and rejects dev login and anonymous MCP');

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
    export default { Notice: defineComponent({ props: z.object({ text: z.string().max(120) }), description: 'A host notice', component: ({ props }) => <aside data-custom="notice">{props.text}</aside> }) };
  `);
  const seed = JSON.parse(await readFile(join(fixture, 'seed/seed.json'), 'utf8'));
  seed.collections.push({ ...seed.collections.find(item => item.slug === 'pages'), slug: 'landing', label: 'Landing', urlPattern: '/site/{slug}' });
  const customDocument = { version: 1, spec: { root: 'notice', elements: { notice: { type: 'Notice', props: { text: 'CUSTOM REGISTERED COMPONENT' } } } } };
  seed.content.landing = [{ id: 'landing-home', slug: 'index', status: 'published', data: { title: 'Custom home', document: customDocument } }];
  await writeFile(join(fixture, 'seed/seed.json'), JSON.stringify(seed));
  await run(process.execPath, [astroCli, 'dev', '--background', '--host', '127.0.0.1', '--port', String(developmentPort)]);
  hasDevServer = true;
  await waitForServer(developmentOrigin);
  const customSetup = await jsonRequest(developmentOrigin, '/_emdash/api/setup/dev-bypass?token=1', '');
  const customCatalog = await jsonRequest(developmentOrigin, '/_emdash/api/plugins/builder/catalog', customSetup.token);
  assert.ok(customCatalog.components.Notice, 'Custom component must be discoverable');
  assert.equal(customCatalog.configuration.collection, 'landing');
  const customValidation = await jsonRequest(developmentOrigin, '/_emdash/api/plugins/builder/validate', customSetup.token, { document: customDocument });
  assert.equal(customValidation.success, true);
  await checkPage(developmentOrigin, '/site', 200, 'CUSTOM REGISTERED COMPONENT');
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
  await run(process.execPath, [astroCli, 'dev', 'stop']);
  hasDevServer = false;
  await run(process.execPath, [astroCli, 'build']);
  productionServer = spawn(process.execPath, ['dist/server/entry.mjs'], { cwd: fixture, env: { ...environment, HOST: '127.0.0.1', PORT: String(productionPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(productionOrigin);
  await checkPage(productionOrigin, '/site', 200, 'CUSTOM REGISTERED COMPONENT');
  await checkPage(productionOrigin, '/site/draft', 404);
  await checkPage(productionOrigin, customPreview.url, 200, 'CUSTOM REGISTERED COMPONENT');
  await checkPage(productionOrigin, '/existing', 200, 'Existing host route');
  console.log('PASS: custom component, collection, home slug, public and preview paths work in an independently installed dev and production host');

} finally {
  if (hasDevServer) await run(process.execPath, [join(fixture, 'node_modules/astro/bin/astro.mjs'), 'dev', 'stop']).catch(() => {});
  if (productionServer && productionServer.exitCode === null) {
    productionServer.kill('SIGTERM');
    await once(productionServer, 'exit');
  }
  console.log(`Isolated test files: ${fixture}`);
}
