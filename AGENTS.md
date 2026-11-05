# Open EmDash Home

- Project context and decisions: [.docs/index.md](.docs/index.md). Development and MCP workflow: [README.md](README.md).
- The monorepo contains the distributable plugin in `packages/emdash-plugins` and its consuming app in `apps/web`. Shared rendering, CSS, routes and preview logic belong to the package.
- This project uses Astro + EmDash + React + json-render. Do not introduce a second rendering framework.
- EmDash is an upstream npm dependency. Use its public APIs and native-plugin extension points; do not patch `node_modules` or fork its internals.
- Pages are EmDash entries in the configured collection (`pages` by default). Their `document` field is a versioned JSON document; validate it against the shared catalog before storage and again before rendering.
- Browser sessions, MCP authorization, revisions and publication belong to EmDash. Do not add a second authentication or content store.
- Pages use native field widgets: `document` uses `builder:page-preview`; chat-managed title/description use `builder:managed`. Keep raw page JSON out of the normal editor. Preview appears in the main editor and publication uses EmDash's standard controls; do not reintroduce duplicate Studio/sidebar previews.
- Preview and public pages use the same renderer. Preview tokens authorize one page only; all preview responses are private, uncached and unindexed.
- Host code may register schema-backed React components using `componentsModule`; use the same options for `builderPlugin()` and `builderIntegration()`. Validation, MCP and both render paths must share that catalog.
- MCP can compose registered components and bind EmDash content. It cannot introduce executable JavaScript, arbitrary CSS, raw HTML or arbitrary fetch targets.
- Use `vp run check`, `vp run test`, `vp run build`; with the local dev server running, `vp run smoke` checks MCP, content binding and draft/public isolation. Smoke tests are local-only and use EmDash's official development login.
- Keep signing keys, local databases, uploads, sessions and generated build output out of version control.
- Stop this app's process before dependency, Astro config, environment or plugin build changes, and start a fresh process afterward. EmDash 1.3.1 retains its runtime across Vite's internal restarts; stale runtimes can fail writes with `Vite module runner has been closed`. Do not patch EmDash internals or clear its private global state to work around this.
- Root commands delegate to the owning workspace. `vp run test:package` verifies installation in an isolated host using temporary files only. Publishing to npm is a separate action.
- Cloudflare deployment uses an ignored `apps/web/wrangler.production.jsonc`; `wrangler.jsonc` contains placeholders only. Use `vp run deploy:production`. Never reapply the initial database bootstrap or import local development credentials on redeploy. See [.docs/deployment.md](.docs/deployment.md).
