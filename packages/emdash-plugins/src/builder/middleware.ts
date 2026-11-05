import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  if (!response.headers.has('X-Content-Type-Options')) response.headers.set('X-Content-Type-Options', 'nosniff');
  if (!response.headers.has('Referrer-Policy')) response.headers.set('Referrer-Policy', 'no-referrer');
  // The admin can embed its own site preview; other sites cannot frame this app.
  if (!response.headers.has('Content-Security-Policy')) response.headers.set('Content-Security-Policy', "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
  return response;
});
