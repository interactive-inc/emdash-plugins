import { loadPage, type LoadedPage } from './load-page.ts';

import type { SiteBuilderOptions } from '../options.ts';
import type { ComponentExtensions } from '../extensions.ts';

type Result = { page: LoadedPage | null; status: number };
export async function pageResponse(identifier: string, options: SiteBuilderOptions = {}, components: ComponentExtensions = {}): Promise<Result> {
  try {
    const page = await loadPage(identifier, options, components);
    return { page, status: page ? 200 : 404 };
  } catch (error) {
    console.error('[site-builder] Page resolution failed', error);
    return { page: null, status: 503 };
  }
}
