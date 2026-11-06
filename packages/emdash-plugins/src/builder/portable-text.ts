import { z } from 'zod';
import { safeUrl } from './safe-url.ts';

const portableImageSchema = z.object({
  asset: z.object({ _ref: z.string().min(1).max(300).optional(), url: z.string().optional() }),
  alt: z.string().optional(),
  caption: z.string().optional(),
});

type Item = Record<string, unknown>;
const isItem = (value: unknown): value is Item => !!value && typeof value === 'object' && !Array.isArray(value);
const keyOf = (value: Item) => typeof value._key === 'string' ? { _key: value._key } : {};
const strings = (value: Item, names: string[]) => Object.fromEntries(names.filter(name => typeof value[name] === 'string').map(name => [name, value[name]]));

/**
 * A span's distinct marks with at most one link that renders an anchor. Two would nest <a> elements,
 * which the browser splits apart, so the island's hydration would not match the server markup.
 */
function spanMarks(marks: unknown, anchors: Set<string>): string[] {
  if (!Array.isArray(marks)) return [];
  let anchored = false;
  return [...new Set(marks.filter(mark => typeof mark === 'string'))].filter(mark => !anchors.has(mark) || (!anchored && (anchored = true)));
}

/**
 * Styles PortableContent renders. Any other falls back to <p>, which a list item wraps around its nested
 * list; the browser splits a list out of a paragraph, so the island's hydration would not match.
 */
const blockStyles = new Set(['normal', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);

function projectBlock(block: Item) {
  const markDefs = Array.isArray(block.markDefs) ? block.markDefs.filter(isItem).map(definition => ({
    _type: String(definition._type), ...keyOf(definition),
    ...(definition._type === 'link' && safeUrl(definition.href) ? { href: definition.href } : {}),
  })) : [];
  const anchors = new Set(markDefs.flatMap(definition => 'href' in definition && typeof definition._key === 'string' ? [definition._key] : []));
  const children = Array.isArray(block.children) ? block.children.filter(isItem).map(child => child._type === 'span'
    ? { _type: 'span', ...keyOf(child), text: typeof child.text === 'string' ? child.text : '', marks: spanMarks(child.marks, anchors) }
    : child._type === 'image' ? projectImage(child, true) : { _type: 'builder-omitted', ...keyOf(child) }) : [];
  return { _type: 'block', ...keyOf(block), ...(blockStyles.has(block.style as string) ? { style: block.style } : {}), ...strings(block, ['listItem']), ...(typeof block.level === 'number' ? { level: block.level } : {}), markDefs, children };
}

/** An inline image sits inside a paragraph, which cannot hold a caption, so it keeps none. */
function projectImage(block: Item, inline = false) {
  const image = portableImageSchema.safeParse(block);
  const asset = image.data?.asset;
  // An unsafe url renders nothing; it never falls back to _ref.
  const src = asset && safeUrl(asset.url ?? (asset._ref ? `/_emdash/api/media/file/${encodeURIComponent(asset._ref)}` : ''), true);
  if (!src) return { _type: 'builder-omitted', ...keyOf(block) };
  const { alt, caption } = image.data!;
  return { _type: 'image', ...keyOf(block), src, ...(alt !== undefined ? { alt } : {}), ...(caption !== undefined && !inline ? { caption } : {}) };
}

/**
 * Keeps only what the renderer displays, so rich text sent to the browser never
 * carries hidden fields or unknown block content. Link hrefs and image sources leave
 * here display-ready; anything that would render nothing keeps only its position.
 */
export function projectPortableText(value: unknown[]): Item[] {
  return value.filter(isItem).map(block => block._type === 'block' ? projectBlock(block)
    : block._type === 'image' ? projectImage(block)
      : { _type: 'builder-omitted', ...keyOf(block) });
}
