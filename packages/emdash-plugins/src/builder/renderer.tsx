import { JSONUIProvider, Renderer, defineRegistry } from '@json-render/react';
import { PortableContent } from './portable-content.tsx';
import { catalog } from './catalog.ts';
import { componentContract, type ComponentExtensions } from './extensions.ts';
import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { validateResolvedSpec } from './document.ts';
import { themeSchema, type PageDocument, type PageState } from './document.ts';
import { safeUrl } from './safe-url.ts';

const { registry } = defineRegistry(catalog, {
  components: {
    Section: ({ props, children }) => <section id={props.id} className={`section tone-${props.tone ?? 'default'} space-${props.spacing ?? 'lg'}`}>{children}</section>,
    Container: ({ props, children }) => <div className={`container width-${props.width ?? 'normal'}`}>{children}</div>,
    Stack: ({ props, children }) => <div className={`stack direction-${props.direction ?? 'vertical'} gap-${props.gap ?? 'md'} align-${props.align ?? 'start'}`}>{children}</div>,
    Grid: ({ props, children }) => <div className={`grid columns-${props.columns ?? 3} gap-${props.gap ?? 'md'}`}>{children}</div>,
    Heading: ({ props }) => {
      const Tag = props.level ?? 'h2';
      return <Tag className={`heading size-${props.size ?? 'md'} text-${props.align ?? 'start'}`}>{props.text}</Tag>;
    },
    Text: ({ props }) => <p className={`text text-${props.tone ?? 'default'} size-${props.size ?? 'md'} text-${props.align ?? 'start'}`}>{props.text}</p>,
    Link: ({ props }) => {
      const href = safeUrl(props.href);
      return href ? <a href={href} className={`link link-${props.variant ?? 'text'}`}>{props.label}</a> : <span>{props.label}</span>;
    },
    Image: ({ props }) => {
      const src = safeUrl(props.src, true);
      return src ? <img src={src} alt={props.alt} className={`image ratio-${props.ratio ?? 'auto'}`} loading="lazy" decoding="async" /> : null;
    },
    Card: ({ props, children }) => <div className={`card card-${props.tone ?? 'default'}`}>{children}</div>,
    Badge: ({ props }) => <span className="badge">{props.text}</span>,
    Divider: () => <hr className="divider" />,
    PortableText: ({ props }) => <PortableContent value={props.value} />,
  },
});

type Props = { document: PageDocument; state: PageState; components?: ComponentExtensions };

/** One React tree preserves context across all components; Astro server-renders it. */
export function SiteRenderer({ document, state, components = {} }: Props) {
  componentContract(components);
  validateResolvedSpec(document, state, components);
  const customCatalog = defineCatalog(schema, { components: Object.fromEntries(Object.entries(components).map(([name, value]) => [name, { props: value.props, description: value.description, ...(value.container ? { slots: ['default'] } : {}) }])), actions: {} });
  const custom = defineRegistry(customCatalog, { components: Object.fromEntries(Object.entries(components).map(([name, value]) => [name, (context: { props: Record<string, unknown>; children?: import('react').ReactNode }) => { const Component = value.component; return <Component props={context.props} children={context.children} />; }])) });
  const combinedRegistry = { ...registry, ...custom.registry };
  const theme = themeSchema.parse(document.theme ?? {});
  const radius = { none: '0', sm: '0.5rem', lg: '1.5rem' }[theme.radius];
  const style = {
    '--accent': theme.accent,
    '--background': theme.background,
    '--foreground': theme.foreground,
    '--radius': radius,
    fontFamily: theme.font === 'serif' ? 'Georgia, "Noto Serif JP", serif' : 'Inter, "Noto Sans JP", system-ui, sans-serif',
  };
  return <div className="site" style={style}>
    <JSONUIProvider registry={combinedRegistry} initialState={state}>
      <Renderer spec={document.spec} registry={combinedRegistry} />
    </JSONUIProvider>
  </div>;
}
