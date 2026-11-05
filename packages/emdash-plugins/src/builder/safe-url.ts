/** A final render-time check also covers URLs produced by data bindings. */
export function safeUrl(value: unknown, image = false): string | undefined {
  if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u0020\u007f\\]/.test(value)) return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (!image && /^#[a-zA-Z][\w-]*$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    if (url.protocol === 'https:') return value;
    if (!image && ['mailto:', 'tel:'].includes(url.protocol)) return value;
  } catch { /* Invalid URLs are displayed without navigation. */ }
  return undefined;
}
