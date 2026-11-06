import { z } from 'zod';

const prefix = z.string().regex(/^(?:\/[a-zA-Z0-9_-]+)*$/);
const optionsSchema = z.strictObject({
  collection: z.string().regex(/^[a-z][a-z0-9_]*$/).max(60).default('pages'),
  basePath: prefix.default(''),
  previewPath: prefix.refine(value => value.length > 0 && !value.startsWith('/_emdash'), 'Preview path must be outside EmDash').default('/preview'),
  homeSlug: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200).default('home'),
  componentsModule: z.string().min(1).optional(),
  // false keeps every page script-free and keeps componentsModule out of the browser bundle.
  motion: z.boolean().default(true),
});
export type BuilderOptions = z.input<typeof optionsSchema>;
export type ResolvedOptions = z.output<typeof optionsSchema>;
export function resolveOptions(options: BuilderOptions = {}): ResolvedOptions {
  const result = optionsSchema.parse(options);
  if (result.basePath.startsWith('/_emdash')) throw new Error('Page routes must be outside EmDash');
  if (result.basePath === result.previewPath || result.basePath.startsWith(`${result.previewPath}/`)) throw new Error('Page and preview routes overlap');
  return result;
}
