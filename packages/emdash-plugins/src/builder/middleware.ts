import type { MiddlewareHandler } from 'astro';

export const onRequest: MiddlewareHandler = async (_context, next) => {
  const response = await next();
  try {
    addSecurityHeaders(response.headers);
    return response;
  } catch (error) {
    // Response.redirect() and fetch() responses have immutable headers, so copy them into a new response.
    if (!(error instanceof TypeError)) throw error;
    const copy = new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
    addSecurityHeaders(copy.headers);
    return copy;
  }
};

function addSecurityHeaders(headers: Headers) {
  if (!headers.has('X-Content-Type-Options')) headers.set('X-Content-Type-Options', 'nosniff');
  if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'no-referrer');
  // The admin can embed its own site preview; other sites cannot frame this app.
  if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
}
