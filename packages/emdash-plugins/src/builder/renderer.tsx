import { resolvePage, type ResolvedView } from './resolve-page.ts';
import { ResolvedSite } from './site-view.tsx';
import type { ComponentExtensions } from './extensions.ts';
import type { PageDocument, PageState } from './document.ts';

type Props = ({ view: ResolvedView } | { document: PageDocument; state: PageState }) & { components?: ComponentExtensions };

/**
 * Server-renders a page for custom routes: pageResponse()'s `page.view`, or a document with
 * the host's own state, resolved and revalidated here. Motion plays only in PageShell's
 * island, so this always renders the final static page.
 */
export function SiteRenderer({ components = {}, ...input }: Props) {
  const view = 'view' in input ? input.view : resolvePage(input.document, input.state, components, { motion: false });
  return <ResolvedSite view={view} components={components} />;
}
