# EmDash Plugins

Monorepo for `@interactive-inc/emdash-plugins`, Interactive Inc.'s native EmDash plugins.
Design decisions: [.docs/index.md](.docs/index.md). Setup and checks: [README.md](README.md). Package API: [packages/emdash-plugins/README.md](packages/emdash-plugins/README.md).

## Layout

- `packages/emdash-plugins` is the only published package. Each plugin lives in `src/<name>/`, its tests in `tests/<name>/`, and it is exported under `./<name>` and `./<name>/*`.
- `apps/web` is the private sample host. It consumes the package through `workspace:*` and contains no plugin logic.
- `scripts/` holds the isolated install test and the production deploy. `.docs/` holds design notes and deployment steps.
- Rendering, CSS, routes and preview logic belong to the package, never to the sample.

## Stack and boundaries

- Astro + EmDash + React + json-render. Do not add a second rendering framework.
- EmDash is an upstream dependency. Use its public APIs and native-plugin extension points. Never patch `node_modules`, fork EmDash internals or clear its private global state.
- Browser sessions, MCP authorization, revisions and publication belong to EmDash. Do not add a second authentication system or content store.

## builder

- Plugin ID `builder`, defined once in `src/builder/constants.ts` with the plugin version (a test keeps it equal to `package.json`). The ID namespaces widgets (`builder:page-preview`, `builder:managed`), the MCP scope (`mcp:tools:builder`), MCP tools (`builder__*`) and routes (`/_emdash/api/plugins/builder/*`). Renaming it breaks stored schemas and tokens.
- Host setup: `builderPlugin(options)` in EmDash `plugins` and `builderIntegration(options)` in Astro `integrations`, with identical options. Virtual modules use `virtual:emdash-plugins/builder/*`.
- Pages are entries in the configured collection (`pages` by default). Their `document` field is a versioned JSON document validated against the shared catalog before storage, after data binding and before rendering.
- Host code may register schema-backed React components through `componentsModule`. Validation, MCP and both render paths share that catalog.
- MCP composes registered components and binds EmDash content. It must never introduce executable JavaScript, arbitrary CSS, raw HTML or arbitrary fetch targets.
- Preview and public pages use the same renderer. A preview token authorizes one entry in one collection for 15 minutes. Preview responses are private, uncached and unindexed, and must not expose drafts of other entries.
- Admin UI is limited to native field widgets: the document field becomes a preview frame that sizes itself to the page, and chat-managed title/description fields render nothing. Keep raw page JSON out of the editor, keep the frame without `allow-scripts`, and use EmDash's standard publish controls. Do not add Studio pages, sidebars or duplicate previews.
- Admin code uses only React and browser APIs. Do not import EmDash's internal libraries (for example TanStack Query/Router).

## Adding a plugin

1. Create `src/<name>/` and `tests/<name>/`, with its own `constants.ts` for the plugin ID and version.
2. Add `./<name>` entries to `exports`. Server code ships compiled from `dist/<name>/`; React, Astro and CSS ship as source from `src/<name>/` with relative imports only.
3. Extend `scripts/check-package.mjs` so the isolated host installs, builds and exercises the new plugin.
4. Document it as its own `##` section in the package README.

## Workflow

- Use `vp` for every command: `vp install`, `vp run <script>`, `vp pm <command>`. Node comes from `.node-version` through vp; published `engines` follow Astro's minimum.
- Root scripts delegate to the owning workspace (`--filter @interactive-inc/emdash-plugins` or `--filter web`).
- Start the sample with `portless` at `https://emdash-plugins.localhost`. Stop it with `vp run dev:stop` before changing dependencies, Astro config, environment or plugin builds, then start a fresh process. EmDash 1.3.1 keeps its runtime across Vite restarts, and stale runtimes fail writes with `Vite module runner has been closed`.
- Keep signing keys, local databases, uploads, sessions and build output out of version control.
- Write user-facing docs in Japanese. Update README files and `.docs/` in the same change as the behavior they describe.

## Verification

- `vp run check`, `vp run test`, `vp run build` before every commit.
- `vp run test:package` installs the packed tarball into a temporary host and checks MCP, publication, previews, role permissions and custom configuration in dev and production builds. Run it after any change to exports, routes, options or packaging.
- `vp run smoke` runs against the local dev server only and uses EmDash's official development login. Never run it against production.

## Release and deployment

- Publish from `packages/emdash-plugins` with `vp pm publish` after `vp pm publish --dry-run`. Publishing is a separate, explicit action.
- Cloudflare deployment uses the ignored `apps/web/wrangler.production.jsonc`; `wrangler.jsonc` contains placeholders only. Run `vp run deploy:production`. Never reapply the initial database bootstrap or import local development credentials on redeploy. See [.docs/deployment.md](.docs/deployment.md).
