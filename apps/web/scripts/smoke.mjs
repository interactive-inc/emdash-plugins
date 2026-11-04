import assert from 'node:assert/strict';
import { getPreviewUrl } from 'emdash';
if (!process.env.EMDASH_PREVIEW_SECRET) { try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
const previewSecret = process.env.EMDASH_PREVIEW_SECRET;
assert.ok(previewSecret, 'Set EMDASH_PREVIEW_SECRET to verify expired signed previews');

const origin = process.env.SMOKE_ORIGIN ?? process.env.PORTLESS_URL ?? 'https://emdash-home.open.localhost';
const hostname = new URL(origin).hostname;
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost'), 'Smoke tests only run against a local development server');
let cookie = '';
let bearer = '';
let toolTokenId;
const extraTokenIds = [];
const created = [];

async function request(path, body, method = body === undefined ? 'GET' : 'POST', authenticated = true) {
  const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'X-EmDash-Request': '1', Origin: origin };
  if (authenticated && cookie) headers.Cookie = cookie;
  if (authenticated && bearer) headers.Authorization = `Bearer ${bearer}`;
  const response = await fetch(new URL(path, origin), { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); } catch {
    const data = text.split('\n').find(line => line.startsWith('data: '));
    value = data ? JSON.parse(data.slice(6)) : text;
  }
  return { response, value };
}
function success(result, label) {
  assert.equal(result.response.ok, true, `${label}: ${result.response.status} ${JSON.stringify(result.value).slice(0,500)}`);
  assert.equal(result.value.success, true, label);
  return result.value.data;
}
function pageDocument(text) { return { version: 1, spec: { root: 'heading', elements: { heading: { type: 'Heading', props: { text, level: 'h1' } } } } }; }
async function create(collection, data, slug) {
  const result = success(await request(`/_emdash/api/content/${collection}`, { data, slug }), 'create');
  created.push([collection, result.item.id]);
  return result;
}
async function read(collection, id) { return success(await request(`/_emdash/api/content/${collection}/${id}`), 'read'); }
async function publish(collection, id) {
  const entry = await read(collection, id);
  return success(await request(`/_emdash/api/content/${collection}/${id}/publish`, { _rev: entry._rev }), 'publish');
}
async function publicPage(path) { return request(path, undefined, 'GET', false); }
async function mcp(name, args = {}) {
  const result = await request('/_emdash/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  assert.equal(result.response.ok, true, JSON.stringify(result.value));
  assert.notEqual(result.value.result?.isError, true, JSON.stringify(result.value));
  return JSON.parse(result.value.result.content.find(block => block.type === 'text').text);
}
try {
  const login = await request('/_emdash/api/setup/dev-bypass?token=1', undefined, 'GET', false);
  const setup = success(login, 'development login');
  cookie = login.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  bearer = setup.token;
  assert.ok(cookie && bearer, 'development session and token');
  const priorTokens = success(await request('/_emdash/api/admin/api-tokens'), 'list test tokens');
  for (const item of priorTokens.items.filter(item => item.name === 'site-builder-smoke')) {
    await request(`/_emdash/api/admin/api-tokens/${item.id}`, undefined, 'DELETE');
  }
  success(await request('/_emdash/api/admin/plugins/site-builder/mcp', { enabled: true }, 'PUT'), 'enable declared MCP tools');
  // Plugin tools require their own scope, independently of the core admin scope.
  const originalBearer = bearer;
  bearer = '';
  const token = success(await request('/_emdash/api/admin/api-tokens', { name: 'site-builder-smoke', scopes: ['content:read', 'content:write', 'mcp:tools:site-builder'] }), 'scoped token');
  bearer = token.token;
  toolTokenId = token.info.id;
  const list = await request('/_emdash/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  assert.ok(list.value.result?.tools, JSON.stringify(list.value));
  const tools = list.value.result.tools;
  const catalog = tools.find(tool => /catalog$/.test(tool.name) && /site.builder/.test(tool.name));
  const preview = tools.find(tool => /preview$/.test(tool.name) && /site.builder/.test(tool.name));
  const validate = tools.find(tool => /validate$/.test(tool.name) && /site.builder/.test(tool.name));
  assert.ok(catalog && preview && validate, `Missing plugin tools: ${tools.map(tool => tool.name).join(', ')}`);
  await mcp(catalog.name);
  await mcp(validate.name, { document: pageDocument('Valid') });
  bearer = '';
  const limited = success(await request('/_emdash/api/admin/api-tokens', { name: 'site-builder-smoke-no-plugin-scope', scopes: ['content:read'] }), 'limited token');
  extraTokenIds.push(limited.info.id);
  bearer = limited.token;
  const deniedTool = await request('/_emdash/api/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: catalog.name, arguments: {} } });
  assert.ok(!deniedTool.response.ok || deniedTool.value.error || deniedTool.value.result?.isError, 'A token without plugin scope cannot invoke plugin tools');
  console.log('PASS: MCP discovery, catalog, validation and scoped authorization');
  bearer = originalBearer;

  const invalid = await request('/_emdash/api/content/pages', { slug: 'invalid-smoke', data: { title: 'Invalid', document: { version: 1, spec: { root: 'bad', elements: { bad: { type: 'script', props: {} } } } } } });
  assert.equal(invalid.response.ok, false, 'invalid JSON must not be stored through the core REST API');
  const unauthorized = await request('/_emdash/api/plugins/site-builder/preview', { id: 'anything' }, 'POST', false);
  assert.equal(unauthorized.response.ok, false, 'anonymous caller cannot mint preview tokens');
  console.log('PASS: core save hook rejects invalid JSON; anonymous preview creation is denied');

  bearer = token.token;
  const mcpPage = await mcp('content_create', { collection: 'pages', slug: `mcp-${Date.now()}`, data: { title: 'MCP created page', document: pageDocument('CREATED OVER MCP') } });
  created.push(['pages', mcpPage.item.id]);
  const mcpRead = await mcp('content_get', { collection: 'pages', id: mcpPage.item.id });
  await mcp('content_publish', { collection: 'pages', id: mcpPage.item.id, _rev: mcpRead._rev });
  assert.match((await publicPage(`/${mcpPage.item.slug}`)).value, /CREATED OVER MCP/);
  console.log('PASS: a page created and published entirely over MCP is rendered publicly');
  bearer = originalBearer;
  const slug = `smoke-${Date.now()}`;
  const entry = await create('pages', { title: 'Smoke page', document: pageDocument('FIRST DRAFT') }, slug);
  const id = entry.item.id;
  bearer = token.token;
  const mcpPreview = await mcp(preview.name, { id });
  assert.ok(mcpPreview.url.startsWith('/preview/'));
  bearer = originalBearer;
  assert.equal((await publicPage(`/${slug}`)).response.status, 404);
  assert.equal((await publicPage(`/preview/${id}`)).response.status, 404);
  const standardPreview = success(await request(`/_emdash/api/content/pages/${id}/preview-url`, {}), 'standard EmDash preview');
  assert.match((await publicPage(standardPreview.url)).value, /FIRST DRAFT/);
  const previewData = success(await request('/_emdash/api/plugins/site-builder/preview', { id }), 'preview');
  const draft = await publicPage(previewData.url);
  assert.equal(draft.response.status, 200, 'The signed preview should render the draft');
  assert.match(draft.value, /FIRST DRAFT/);
  assert.match(draft.response.headers.get('cache-control'), /no-store/);
  assert.match(draft.response.headers.get('x-robots-tag'), /noindex/);
  assert.equal((await publicPage(previewData.url.replace(/_preview=./, '_preview=x'))).response.status, 404);
  const expiredUrl = await getPreviewUrl({ collection: 'pages', id, secret: previewSecret, expiresIn: -60, pathPattern: '/preview/{id}' });
  const expired = await publicPage(expiredUrl);
  assert.equal(expired.response.status, 404, 'A correctly signed but expired token must be rejected');
  assert.doesNotMatch(expired.value, /FIRST DRAFT/);
  assert.match(expired.response.headers.get('cache-control'), /no-store/);
  assert.match(expired.response.headers.get('x-robots-tag'), /noindex/);
  const wrongCollection = await getPreviewUrl({ collection: 'posts', id, secret: previewSecret, expiresIn: 900, pathPattern: '/preview/{id}' });
  assert.equal((await publicPage(wrongCollection)).response.status, 404, 'A token for another collection must be rejected');
  console.log('PASS: valid previews work; unsigned, tampered, expired and wrong-collection tokens are denied');

  await publish('pages', id);
  assert.match((await publicPage(`/${slug}`)).value, /FIRST DRAFT/);
  let current = await read('pages', id);
  success(await request(`/_emdash/api/content/pages/${id}`, { _rev: current._rev, data: { document: pageDocument('SECOND DRAFT') } }, 'PUT'), 'update draft');
  const publicHtml = (await publicPage(`/${slug}`)).value;
  assert.match(publicHtml, /FIRST DRAFT/);
  assert.doesNotMatch(publicHtml, /SECOND DRAFT/);
  assert.match((await publicPage(previewData.url)).value, /SECOND DRAFT/);
  await publish('pages', id);
  assert.match((await publicPage(`/${slug}`)).value, /SECOND DRAFT/);
  console.log('PASS: publish, edit, preview and republish preserve the live/draft boundary');

  const post = await create('posts', { title: 'BOUND POST', excerpt: 'Public data binding' }, `post-${Date.now()}`);
  await publish('posts', post.item.id);
  current = await read('pages', id);
  const bound = pageDocument({ $state: '/data/article/title' });
  bound.data = { article: { collection: 'posts', id: post.item.id } };
  success(await request(`/_emdash/api/content/pages/${id}`, { _rev: current._rev, data: { document: bound } }, 'PUT'), 'bind content');
  assert.match((await publicPage(previewData.url)).value, /BOUND POST/);
  console.log('PASS: json-render binds actual EmDash content during SSR');
  await create('posts', { title: 'UNRELATED POST DRAFT' }, `draft-post-${Date.now()}`);
  current = await read('pages', id);
  const listDocument = { version: 1, data: { posts: { collection: 'posts', limit: 24 } }, spec: { root: 'list', elements: { list: { type: 'Stack', props: {}, repeat: { statePath: '/data/posts', key: 'id' }, children: ['title'] }, title: { type: 'Heading', props: { text: { $item: 'title' } } } } } };
  success(await request(`/_emdash/api/content/pages/${id}`, { _rev: current._rev, data: { document: listDocument } }, 'PUT'), 'list binding');
  const listPreview = await publicPage(previewData.url);
  assert.equal(listPreview.response.status, 200);
  assert.match(listPreview.value, /BOUND POST/);
  assert.doesNotMatch(listPreview.value, /UNRELATED POST DRAFT/);
  console.log('PASS: a page preview cannot expose unrelated content drafts through list bindings');

  const other = await create('pages', { title: 'Other draft', document: pageDocument('UNRELATED SECRET DRAFT') }, `other-${Date.now()}`);
  const cross = new URL(previewData.url, origin);
  cross.pathname = `/preview/${other.item.id}`;
  const otherResult = await publicPage(cross.pathname + cross.search);
  assert.equal(otherResult.response.status, 404);
  assert.doesNotMatch(otherResult.value, /UNRELATED SECRET DRAFT/);
  console.log('PASS: one page preview token cannot read another draft');
} finally {
  for (const [collection, id] of created.reverse()) {
    const entry = await read(collection, id).catch(() => null);
    if (entry) await request(`/_emdash/api/content/${collection}/${id}`, { _rev: entry._rev }, 'DELETE');
  }
  bearer = '';
  for (const tokenId of [...extraTokenIds, toolTokenId].filter(Boolean)) await request(`/_emdash/api/admin/api-tokens/${tokenId}`, undefined, 'DELETE');
}
