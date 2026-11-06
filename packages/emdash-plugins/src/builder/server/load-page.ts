import { resolveOptions, type BuilderOptions } from '../options.ts';
import type { ComponentExtensions } from '../extensions.ts';
import { getEmDashCollection, getEmDashEntry } from 'emdash';
import { validateDocument, type PageDocument, type PageState } from '../document.ts';
import { defaultListItems } from '../list-limits.ts';
import { resolvePage, type ResolvedView } from '../resolve-page.ts';

export type LoadedPage = {
  id: string;
  title: string;
  description: string;
  slug: string;
  document: PageDocument;
  state: PageState;
  /** What the page renders; the only page data that reaches the browser. */
  view: ResolvedView;
  isPreview: boolean;
};

/** All reads go through EmDash's published-entry and scoped preview checks. */
export async function loadPage(identifier: string, input: BuilderOptions = {}, components: ComponentExtensions = {}): Promise<LoadedPage | null> {
  const options = resolveOptions(input);
  const { entry, error, isPreview } = await getEmDashEntry(options.collection, identifier);
  if (error) throw new Error('Could not load page');
  if (!entry) return null;
  const validated = validateDocument(entry.data.document, components);
  if (!validated.success) throw new Error('Stored page JSON is invalid');
  const document = validated.document;
  const title = typeof entry.data.title === 'string' ? entry.data.title : '';
  const description = typeof entry.data.description === 'string' ? entry.data.description : '';
  const slug = typeof entry.data.slug === 'string' ? entry.data.slug : identifier;
  const data = Object.fromEntries(await Promise.all(Object.entries(document.data ?? {}).map(async ([name, query]) => {
    if (query.id) {
      const result = await getEmDashEntry(query.collection, query.id);
      if (result.error) throw new Error(`Could not load data source ${name}`);
      return [name, result.entry ? { ...result.entry.data, id: result.entry.id } : null];
    }
    const result = await getEmDashCollection(query.collection, { limit: query.limit ?? defaultListItems });
    if (result.error) throw new Error(`Could not load data source ${name}`);
    return [name, result.entries.map(item => ({ ...item.data, id: item.id }))];
  })));
  const state: PageState = { page: { title, description, slug }, data };
  const view = resolvePage(document, state, components, { motion: options.motion });
  return { id: entry.id, title, description, slug, document, state, view, isPreview };
}
