import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { APIContext } from 'astro';
import { onRequest as handler } from '../../src/builder/middleware.ts';

const onRequest = async (context: object, next: () => Promise<Response>) => (await handler(context as APIContext, next))!;

const csp = "frame-ancestors 'self'; object-src 'none'; base-uri 'self'";

function securityHeaders(response: Response) {
  return ['X-Content-Type-Options', 'Referrer-Policy', 'Content-Security-Policy'].map((name) => response.headers.get(name));
}

test('a redirect keeps its status, location and empty body and gains the security headers', async () => {
  const response = await onRequest({}, async () => Response.redirect('https://example.test/_emdash/admin/login', 302));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://example.test/_emdash/admin/login');
  assert.equal(await response.text(), '');
  assert.deepEqual(securityHeaders(response), ['nosniff', 'no-referrer', csp]);
});

test('a fetched response keeps its body and headers and gains the security headers', async () => {
  const response = await onRequest({}, () => fetch('data:text/plain,hello'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/plain');
  assert.equal(await response.text(), 'hello');
  assert.deepEqual(securityHeaders(response), ['nosniff', 'no-referrer', csp]);
});

test('a mutable response is returned as is, keeping headers it already sets', async () => {
  const original = new Response('page', { status: 201, statusText: 'Created', headers: { 'Content-Security-Policy': "default-src 'none'" } });
  const response = await onRequest({}, async () => original);
  assert.equal(response, original);
  assert.equal(response.statusText, 'Created');
  assert.deepEqual(securityHeaders(response), ['nosniff', 'no-referrer', "default-src 'none'"]);
});
