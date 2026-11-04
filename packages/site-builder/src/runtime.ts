import { ContentSaveRejectedError, definePlugin, getPreviewUrl } from 'emdash';
import { z } from 'zod';
import { componentSchemas, pageGuide } from './catalog.ts';
import { validateDocument } from './document.ts';
import { resolveOptions, type SiteBuilderOptions } from './options.ts';
import { componentContract, type ComponentExtensions } from './extensions.ts';

export function createPlugin(input: SiteBuilderOptions = {}, components: ComponentExtensions = {}) {
  const options = resolveOptions(input);
  const contract = componentContract(components);
  const validate = (document: unknown) => validateDocument(document, components);
  const guide = pageGuide.replaceAll('collection pages', `collection ${options.collection}`).replace('Use home as', `Use ${options.homeSlug} as`) + ` Public pages use the prefix ${options.basePath || '/'}; signed previews use ${options.previewPath}.`;
  const schemas = Object.fromEntries(Object.entries(contract.props).map(([name, props]) => [name, { props: z.toJSONSchema(props), ...(components[name] ? { description: components[name].description, container: !!components[name].container } : {}) }]));
  return definePlugin({
    id: 'site-builder', version: '0.1.0',
    capabilities: ['content:read', 'content:write', 'hooks.content-policy:register'],
    admin: {
      entry: '@open-emdash/site-builder/admin',
      fieldWidgets: [
        { name: 'page-preview', label: 'ページプレビュー', fieldTypes: ['json'] },
        { name: 'managed', label: 'チャットで管理', fieldTypes: ['string', 'text'] },
      ],
    },
    hooks: {
      'content:beforeSave': {
        errorPolicy: 'abort',
        handler: async event => {
          if (event.collection !== options.collection) return;
          if (!event.isNew && !Object.hasOwn(event.content, 'document')) return;
          const result = validate(event.content.document);
          if (!result.success) throw new ContentSaveRejectedError(`Page JSON is invalid: ${result.errors.join('; ')}`);
          return { ...event.content, document: result.document };
        },
      },
      'content:beforePublish': {
        errorPolicy: 'abort',
        handler: async event => {
          if (event.collection !== options.collection) return;
          const data = event.content.data;
          const document = data && typeof data === 'object' && 'document' in data ? data.document : event.content.document;
          const result = validate(document);
          if (!result.success) return { cancel: true, reason: `Invalid page JSON: ${result.errors.join('; ')}` };
        },
      },
    },
    routes: {
      configuration: { permission: 'content:read', handler: async () => ({ collection: options.collection, previewPath: options.previewPath }) },
      catalog: {
        permission: 'content:read',
        handler: async () => ({ version: 1, components: { ...componentSchemas, ...Object.fromEntries(Object.entries(components).map(([name]) => [name, schemas[name].props])) }, descriptions: schemas, guide, configuration: options }),
      },
      validate: {
        permission: 'content:read',
        input: z.object({ document: z.unknown() }),
        handler: async ctx => validate(z.object({ document: z.unknown() }).parse(ctx.input).document),
      },
      preview: {
        permission: 'content:read_drafts',
        input: z.object({ id: z.string().min(1).max(200) }),
        handler: async ctx => {
          // Defense in depth: plugin capabilities must not widen a caller's draft access.
          if (!ctx.user || ctx.user.role < 20) throw new Error('Draft access is required');
          const page = await ctx.content?.get(options.collection, z.object({ id: z.string().min(1).max(200) }).parse(ctx.input).id);
          if (!page) throw new Error('Page not found');
          const previewSecret = process.env.EMDASH_PREVIEW_SECRET;
          if (!previewSecret) throw new Error('Configure EMDASH_PREVIEW_SECRET before creating preview links');
          return {
            url: await getPreviewUrl({ collection: options.collection, id: page.id, secret: previewSecret, expiresIn: '15m', pathPattern: `${options.previewPath}/{id}` }),
            expiresIn: 900,
          };
        },
      },
    },
    mcp: { tools: {
      catalog: { description: 'Read the supported site components, JSON property schemas, data bindings, theme tokens, and the page creation workflow.', route: 'catalog', input: z.object({}) },
      validate: { description: 'Validate a complete page document before saving it with EmDash content_create or content_update. Does not save or publish.', route: 'validate', input: z.object({ document: z.unknown() }) },
      preview: { description: 'Create a 15-minute signed preview URL for one saved page. Use after saving a draft, before content_publish.', route: 'preview', input: z.object({ id: z.string().min(1).max(200) }) },
    } },
  });
}
