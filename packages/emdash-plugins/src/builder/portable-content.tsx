import { PortableText } from '@portabletext/react';
import type { TypedObject } from '@portabletext/types';

// A paragraph cannot hold a figure: the browser would close it early and hydration would not match.
function ContentImage({ value, isInline }: { value: { src: string; alt?: string; caption?: string }; isInline: boolean }) {
  const image = <img src={value.src} alt={value.alt ?? ''} loading="lazy" decoding="async" />;
  return isInline ? image : <figure>{image}{value.caption && <figcaption>{value.caption}</figcaption>}</figure>;
}

/** Renders rich text as projectPortableText left it: link hrefs and image sources are already safe. */
export function PortableContent({ value }: { value: TypedObject[] }) {
  return <PortableText value={value} components={{
    marks: { link: ({ value, children }) => value?.href ? <a href={value.href}>{children}</a> : <span>{children}</span> },
    types: { image: ContentImage, 'builder-omitted': () => null },
    unknownType: () => null,
  }} />;
}
