import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';
import { resolveOptions, type ResolvedOptions } from './options.ts';

const text = z.string().max(20000);
const spacing = z.enum(['none', 'sm', 'md', 'lg', 'xl']);
const alignment = z.enum(['start', 'center', 'end']);

export const componentProps = {
  Section: z.object({ tone: z.enum(['default', 'muted', 'accent', 'dark']).optional(), spacing: spacing.optional(), id: z.string().regex(/^[a-z][a-z0-9-]*$/).optional() }),
  Container: z.object({ width: z.enum(['narrow', 'normal', 'wide']).optional() }),
  Stack: z.object({ direction: z.enum(['vertical', 'horizontal']).optional(), gap: spacing.optional(), align: alignment.optional() }),
  Grid: z.object({ columns: z.number().int().min(1).max(4).optional(), gap: spacing.optional() }),
  Heading: z.object({ text, level: z.enum(['h1', 'h2', 'h3', 'h4']).optional(), size: z.enum(['sm', 'md', 'lg', 'xl']).optional(), align: alignment.optional() }),
  Text: z.object({ text, tone: z.enum(['default', 'muted']).optional(), size: z.enum(['sm', 'md', 'lg']).optional(), align: alignment.optional() }),
  Link: z.object({ label: text, href: z.string().max(2000), variant: z.enum(['text', 'primary', 'secondary']).optional() }),
  Image: z.object({ src: z.string().max(2000), alt: z.string().max(1000), ratio: z.enum(['auto', 'square', 'landscape', 'portrait']).optional() }),
  Card: z.object({ tone: z.enum(['default', 'muted']).optional() }),
  Badge: z.object({ text: z.string().max(200) }),
  Divider: z.object({}),
  PortableText: z.object({ value: z.array(z.looseObject({ _type: z.string(), _key: z.string().optional() })).max(500) }),
} as const;

const descriptions: Record<keyof typeof componentProps, string> = {
  Section: 'Full-width page section with a background tone. Use id for anchor links.',
  Container: 'Centers content and limits width.',
  Stack: 'Vertical or wrapping horizontal arrangement.',
  Grid: 'Responsive grid; columns collapse on small screens. Supports repeat for lists.',
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

/** The MCP guide reflects the host's configured collection and routes. */
export function createPageGuide(options: ResolvedOptions = resolveOptions()): string {
  return `Build pages as a versioned document: {version:1,spec:{root,elements},theme?,data?}.
Elements are {type,props,children?}. Only the supplied catalog components are allowed.
Bind props with {"$state":"/page/title"}, {"$state":"/data/article/title"}, or {"$item":"title"} inside a repeat.
Use {"$template":"/blog/\${slug}"} inside a repeat. A repeat is {statePath:"/data/posts",key:"id"} on a container.
A visible condition is a boolean or {"$state":"/data/article/image"}.
Data sources are named EmDash queries: {posts:{collection:"posts",limit:6}} or {article:{collection:"posts",id:"my-slug"}}.
All data reads use EmDash public/preview rules. A page preview token does not grant access to unrelated drafts.
Theme: {accent:"#hex",background:"#hex",foreground:"#hex",font:"sans"|"serif",radius:"none"|"sm"|"lg"}.
Use ${options.homeSlug} as the home-page slug. Other page slugs form their URL. Save using core content_create/content_update on collection ${options.collection}, with data:{title,description?,document}. Keep _rev for updates and publication.
Public pages use the prefix ${options.basePath || '/'}; signed previews use ${options.previewPath}.
Use the builder validate tool before saving and preview before publishing. Never store executable code, arbitrary CSS, or fetch URLs.`;
}

export const pageGuide = createPageGuide();
