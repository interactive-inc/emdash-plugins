import { JSONUIProvider, Renderer, type ComponentRegistry } from '@json-render/react';
import type { Spec } from '@json-render/core';
import { useMemo, type ReactNode } from 'react';
import { PortableContent } from './portable-content.tsx';
import type { z } from 'zod';
import { HostMotionContext, Reveal, Root } from './reveal.tsx';
import type { componentProps } from './catalog.ts';
import type { ComponentExtensions } from './extensions.ts';
import type { ResolvedMotion } from './motion-tokens.ts';
import type { ResolvedView } from './resolve-page.ts';

// Client module: zod, catalog, document and extension code is imported for types only.
type Props = Record<string, any> & { motion?: ResolvedMotion };
type Builtin = (input: { props: Props; children?: ReactNode }) => ReactNode;
type Builtins = { [K in keyof typeof componentProps]: (input: { props: Omit<z.infer<(typeof componentProps)[K]>, 'motion'> & { motion?: ResolvedMotion }; children?: ReactNode }) => ReactNode };

/**
 * Each component's own root element moves, so motion never adds wrappers that change layout.
 * resolvePage has already emptied unsafe URLs, so an empty href or src is all that is checked here.
 */
const builtins: Builtins = {
  Section: ({ props, children }) => <section id={props.id} className={`section tone-${props.tone ?? 'default'} space-${props.spacing ?? 'lg'}`}>{children}</section>,
  Container: ({ props, children }) => <Reveal as="div" motion={props.motion} className={`container width-${props.width ?? 'normal'}`}>{children}</Reveal>,
  Stack: ({ props, children }) => <Reveal as="div" motion={props.motion} className={`stack direction-${props.direction ?? 'vertical'} gap-${props.gap ?? 'md'} align-${props.align ?? 'start'}`}>{children}</Reveal>,
  Grid: ({ props, children }) => <Reveal as="div" motion={props.motion} className={`grid columns-${props.columns ?? 3} gap-${props.gap ?? 'md'}`}>{children}</Reveal>,
  Heading: ({ props }) => <Reveal as={props.level ?? 'h2'} motion={props.motion} className={`heading size-${props.size ?? 'md'} text-${props.align ?? 'start'}`}>{props.text}</Reveal>,
  Text: ({ props }) => <Reveal as="p" motion={props.motion} className={`text text-${props.tone ?? 'default'} size-${props.size ?? 'md'} text-${props.align ?? 'start'}`}>{props.text}</Reveal>,
  Link: ({ props }) => props.href
    ? <Reveal as="a" motion={props.motion} href={props.href} className={`link link-${props.variant ?? 'text'}`}>{props.label}</Reveal>
    : <Reveal as="span" motion={props.motion}>{props.label}</Reveal>,
  Image: ({ props }) => props.src ? <Reveal as="img" motion={props.motion} src={props.src} alt={props.alt} className={`image ratio-${props.ratio ?? 'auto'}`} loading="lazy" decoding="async" /> : null,
  Card: ({ props, children }) => <Reveal as="div" motion={props.motion} className={`card card-${props.tone ?? 'default'}`}>{children}</Reveal>,
  Badge: ({ props }) => <Reveal as="span" motion={props.motion} className="badge">{props.text}</Reveal>,
  Divider: ({ props }) => <Reveal as="hr" motion={props.motion} className="divider" />,
  PortableText: ({ props }) => <Reveal as="div" motion={props.motion} className="prose"><PortableContent value={props.value} /></Reveal>,
};

function createRegistry(components: ComponentExtensions): ComponentRegistry {
  const registry: ComponentRegistry = {};
  for (const [name, Builtin] of Object.entries(builtins as unknown as Record<string, Builtin>)) registry[name] = ({ element, children }) => <Builtin props={element.props as Props} children={children} />;
  for (const [name, definition] of Object.entries(components)) {
    const Component = definition.component;
    registry[name] = ({ element, children }) => {
      const { motion, ...props } = element.props as Props;
      return <HostMotionContext value={motion ?? null}><Component props={props} Root={Root} children={children} /></HostMotionContext>;
    };
  }
  return registry;
}

type SiteProps = { view: ResolvedView; components?: ComponentExtensions };
/** Renders a resolved page. The server and the page island render the same tree. */
export function ResolvedSite({ view, components = {} }: SiteProps) {
  const registry = useMemo(() => createRegistry(components), [components]);
  return <div className="site" style={view.theme}>
    <JSONUIProvider registry={registry} initialState={{}}>
      <Renderer spec={view.spec as Spec} registry={registry} />
    </JSONUIProvider>
  </div>;
}
