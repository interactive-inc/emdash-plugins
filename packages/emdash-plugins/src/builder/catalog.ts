import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';
import { resolveOptions, type ResolvedOptions } from './options.ts';
import { defaultListItems } from './list-limits.ts';
import { maxMotionElements, motionTokens } from './motion-tokens.ts';

const text = z.string().max(20000);
const spacing = z.enum(['none', 'sm', 'md', 'lg', 'xl']);
const alignment = z.enum(['start', 'center', 'end']);

const tokens = <T extends object>(value: T) => Object.keys(value) as [Extract<keyof T, string>, ...Extract<keyof T, string>[]];
const motionShape = {
  effect: z.enum(tokens(motionTokens.effect), { error: issue => issue.input === undefined ? 'effect is required' : undefined }),
  delay: z.enum(tokens(motionTokens.delay)).optional(),
  duration: z.enum(tokens(motionTokens.duration)).optional(),
};
const motionError = (allowed: string[]) => ({ error: (issue: z.core.$ZodRawIssue) => {
  if (issue.code === 'invalid_type') return 'motion must be an object such as {"effect":"fade-up"}';
  if (issue.code !== 'unrecognized_keys') return undefined;
  if (issue.keys.includes('stagger') && !allowed.includes('stagger')) return 'stagger works only on Stack and Grid';
  return `unknown motion setting ${issue.keys.join(', ')}; allowed: ${allowed.join(', ')}`;
} });
/** Entrance motion that plays once when the element first enters the viewport. */
export const motionSchema = z.strictObject(motionShape, motionError(['effect', 'delay', 'duration']))
  .describe('Plays once when the element first enters the viewport.');
/** On Stack and Grid, stagger keeps the container still and reveals its direct children in turn. */
export const groupMotionSchema = z.strictObject({ ...motionShape, stagger: z.enum(tokens(motionTokens.stagger)).optional() }, motionError(['effect', 'delay', 'duration', 'stagger']))
  .describe('Plays once when the element first enters the viewport. With stagger the container stays still and its direct children reveal in turn.');
export type AuthoredMotion = z.infer<typeof groupMotionSchema>;
const motion = motionSchema.optional();
const groupMotion = groupMotionSchema.optional();

export const componentProps = {
  // Section stays still as a full-width band and anchor target, so it has no motion.
  Section: z.object({ tone: z.enum(['default', 'muted', 'accent', 'dark']).optional(), spacing: spacing.optional(), id: z.string().regex(/^[a-z][a-z0-9-]*$/).optional() }),
  Container: z.object({ width: z.enum(['narrow', 'normal', 'wide']).optional(), motion }),
  Stack: z.object({ direction: z.enum(['vertical', 'horizontal']).optional(), gap: spacing.optional(), align: alignment.optional(), motion: groupMotion }),
  Grid: z.object({ columns: z.number().int().min(1).max(4).optional(), gap: spacing.optional(), motion: groupMotion }),
  Heading: z.object({ text, level: z.enum(['h1', 'h2', 'h3', 'h4']).optional(), size: z.enum(['sm', 'md', 'lg', 'xl']).optional(), align: alignment.optional(), motion }),
  Text: z.object({ text, tone: z.enum(['default', 'muted']).optional(), size: z.enum(['sm', 'md', 'lg']).optional(), align: alignment.optional(), motion }),
  Link: z.object({ label: text, href: z.string().max(2000), variant: z.enum(['text', 'primary', 'secondary']).optional(), motion }),
  Image: z.object({ src: z.string().max(2000), alt: z.string().max(1000), ratio: z.enum(['auto', 'square', 'landscape', 'portrait']).optional(), motion }),
  Card: z.object({ tone: z.enum(['default', 'muted']).optional(), motion }),
  Badge: z.object({ text: z.string().max(200), motion }),
  Divider: z.object({ motion }),
  PortableText: z.object({ value: z.array(z.looseObject({ _type: z.string(), _key: z.string().optional() })).max(500), motion }),
} as const;

const descriptions: Record<keyof typeof componentProps, string> = {
  Section: 'Full-width page section with a background tone. Use id for anchor links. Sections do not move; animate their content.',
  Container: 'Centers content and limits width.',
  Stack: 'Vertical or wrapping horizontal arrangement. motion.stagger reveals each child in turn.',
  Grid: 'Responsive grid; columns collapse on small screens. Supports repeat for lists. motion.stagger reveals each item in turn.',
  Heading: 'Semantic heading. Use one h1 per page.',
  Text: 'Plain text paragraph. HTML is never executed.',
  Link: 'Navigation link or call-to-action. Only safe URLs are rendered.',
  Image: 'Image from an HTTPS or same-origin URL. Always provide alt text.',
  Card: 'A bordered content container.',
  Badge: 'A short eyebrow or category label.',
  Divider: 'Horizontal separator.',
  PortableText: 'EmDash rich text rendered as React elements, without raw HTML.',
};
const containers = new Set(['Section', 'Container', 'Stack', 'Grid', 'Card']);
const shapes: Record<string, z.ZodObject> = componentProps;
/** Built-in components whose schema lists motion; their root element moves. */
export const motionComponentNames = new Set(Object.keys(shapes).filter(name => Object.hasOwn(shapes[name]!.shape, 'motion')));
/** Built-in components whose motion may stagger their children. */
export const staggerComponentNames = new Set(Object.keys(shapes).filter(name => shapes[name]!.shape.motion === groupMotion));

export const catalog = defineCatalog(schema, {
  components: {
    Section: { props: componentProps.Section, description: descriptions.Section, slots: ['default'] },
    Container: { props: componentProps.Container, description: descriptions.Container, slots: ['default'] },
    Stack: { props: componentProps.Stack, description: descriptions.Stack, slots: ['default'] },
    Grid: { props: componentProps.Grid, description: descriptions.Grid, slots: ['default'] },
    Heading: { props: componentProps.Heading, description: descriptions.Heading },
    Text: { props: componentProps.Text, description: descriptions.Text },
    Link: { props: componentProps.Link, description: descriptions.Link },
    Image: { props: componentProps.Image, description: descriptions.Image },
    Card: { props: componentProps.Card, description: descriptions.Card, slots: ['default'] },
    Badge: { props: componentProps.Badge, description: descriptions.Badge },
    Divider: { props: componentProps.Divider, description: descriptions.Divider },
    PortableText: { props: componentProps.PortableText, description: descriptions.PortableText },
  },
  actions: {},
});

export const componentNames = Object.keys(componentProps);
export const containerNames = containers;
export const componentSchemas = Object.fromEntries(Object.entries(componentProps).map(([name, props]) => [name, z.toJSONSchema(props)]));

const list = (value: object) => Object.keys(value).map(name => `"${name}"`).join('|');
const motionGuide = `Motion (optional): add props.motion = {effect, delay?, duration?} to ${[...motionComponentNames].join(', ')}, or to a custom component whose schema lists motion.
effect: ${list(motionTokens.effect)}; delay: ${list(motionTokens.delay)}; duration: ${list(motionTokens.duration)}.
Each element plays once when it first enters the viewport; elements on the first screen play as soon as the page is ready. Order siblings with delay.
For lists put stagger: ${list(motionTokens.stagger)} on a Stack or Grid. The container stays still and its direct children, including every repeated item, reveal in turn, so those children must not have their own motion.
Never put motion on a Section, on an element that contains a Section, or inside an element that already moves. motion is a literal object, never a $state/$item binding; there are no custom timings, easing, CSS or scripts. At most ${maxMotionElements} elements may move per page: each staggered child and each repeated copy counts, and a list repeats up to its limit (${defaultListItems} when unset).
Visitors who prefer reduced motion, views without JavaScript and the admin preview show the final static page, so every page must read well without motion.`;

/** The MCP guide reflects the host's configured collection and routes. */
export function createPageGuide(options: ResolvedOptions = resolveOptions()): string {
  return `Build pages as a versioned document: {version:1,spec:{root,elements},theme?,data?}.
Elements are {type,props,children?}. Only the supplied catalog components are allowed.
Bind props with {"$state":"/page/title"}, {"$state":"/data/article/title"}, or {"$item":"title"} inside a repeat.
Use {"$template":"/blog/\${slug}"} inside a repeat. A repeat is {statePath:"/data/posts",key:"id"} on a container; its statePath names a list query, one without id.
A visible condition is a boolean or {"$state":"/data/article/image"}.
Data sources are named EmDash queries: {posts:{collection:"posts",limit:6}} or {article:{collection:"posts",id:"my-slug"}}.
All data reads use EmDash public/preview rules. A page preview token does not grant access to unrelated drafts.
Theme: {accent:"#hex",background:"#hex",foreground:"#hex",font:"sans"|"serif",radius:"none"|"sm"|"lg"}.
Use ${options.homeSlug} as the home-page slug. Other page slugs form their URL. Save using core content_create/content_update on collection ${options.collection}, with data:{title,description?,document}. Keep _rev for updates and publication.
Public pages use the prefix ${options.basePath || '/'}; signed previews use ${options.previewPath}.
Use the builder validate tool before saving and preview before publishing. Never store executable code, arbitrary CSS, or fetch URLs.
${options.motion ? motionGuide : 'Motion is disabled on this site; omit props.motion.'}`;
}

export const pageGuide = createPageGuide();
