import { PortableText } from '@portabletext/react';
import type { TypedObject } from '@portabletext/types';
import { z } from 'zod';
import { safeUrl } from './safe-url.ts';

const imageSchema = z.object({
  asset: z.object({ _ref: z.string().min(1).max(300).optional(), url: z.string().optional() }),
  alt: z.string().optional(),
  caption: z.string().optional(),
});

function ContentImage({ value }: { value: unknown }) {
  const image = imageSchema.safeParse(value);
  if (!image.success) return null;
  const asset = image.data.asset;
  const src = safeUrl(asset.url ?? (asset._ref ? `/_emdash/api/media/file/${encodeURIComponent(asset._ref)}` : ''), true);
  if (!src) return null;
  return <figure><img src={src} alt={image.data.alt ?? ''} loading="lazy" decoding="async" />{image.data.caption && <figcaption>{image.data.caption}</figcaption>}</figure>;
}

/** Render rich text structurally. Links and media use the same URL boundary as page components. */
export function PortableContent({ value }: { value: TypedObject[] }) {
  return <div className="prose"><PortableText value={value} components={{
    marks: { link: ({ value, children }) => {
      const href = safeUrl(value?.href);
      return href ? <a href={href}>{children}</a> : <span>{children}</span>;
    } },
    types: { image: ContentImage },
    unknownType: () => null,
  }} /></div>;
}
