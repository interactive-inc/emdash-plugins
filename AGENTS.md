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
- Host setup: `builderPlugin(options)` in EmDash `plugins` and `builderIntegration(options)` in Astro `integrations`, with identical options. When both are registered, the integration routes EmDash's import of the plugin runtime through a check that throws at startup if the options differ; the plugin alone still works without `componentsModule`. Virtual modules use `virtual:emdash-plugins/builder/*`.
- Pages are entries in the configured collection (`pages` by default). Their `document` field is a versioned JSON document validated against the shared catalog before storage, after data binding and before rendering.
- Host code may register schema-backed React components through `componentsModule`. Validation, MCP and both render paths share that catalog.
- MCP composes registered components and binds EmDash content. It must never introduce executable JavaScript, arbitrary CSS, raw HTML or arbitrary fetch targets.
- Preview and public pages use the same renderer. A preview token authorizes one entry in one collection for 15 minutes. Preview responses are private, uncached and unindexed, and must not expose drafts of other entries.
- `resolvePage()` resolves bindings, visibility and repeats on the server and revalidates the result into a `ResolvedView` that keeps only declared fields. URL checks and rich-text projection (`projectPortableText()`) happen there once; renderers draw the view as given. That view is the only page data serialized to the browser. Never ship state, binding expressions or unrendered entry fields.
- Pages without motion render the view statically: zero JS, markup unchanged by motion support. Pages with motion hydrate one island through `client:builder-motion` and render the same tree. Hydration must produce no mismatches, so rendered markup must survive the HTML parser unchanged (no `<figure>` inside `<p>`, no link inside a link).
- Motion values are tokens from `motion-tokens.ts`. Documents never carry durations, easing, CSS or scripts. The component's own root element moves; never add wrapper elements. Sections never move, not even inside a moving element. A waiting element sits transparent where it ends up (the server renders `opacity:0`), so nothing flickers; the effect's start transform exists only while the entrance plays.
- Motion owns an element's visibility only after it arms it (`data-motion-armed`). Otherwise CSS shows the final state: the 1.5s fallback (its delay lives only in `site.css`), `noscript`, print, `prefers-reduced-motion` and the script-less admin frame. With reduced motion at load or without IntersectionObserver, the directive marks the island `data-motion-static` and never loads it for that visit.
- `MotionStage` decides when an element enters: one IntersectionObserver on the viewport, and one whose `rootMargin` covers everything above it, for elements scrolled past (never inside a fixed box). Because elements wait in place, the browser judges every clip (`.site`, cards, rows, collapsed or closed containers); never reimplement that with geometry or scroll listeners. An image is watched only once `decode()` settles; any other element without area counts wherever it touches, so content overflowing it never stays hidden. Inside a scroll container below `.site` (overflow auto or scroll, or hidden with scroll snapping) the entrance only fades, since moving or scaling would change what it scrolls or where it snaps; this is decided once as the entrance starts (Motion resolves variants on every render). WebKit updates IntersectionObserver only in a rendering update, so while elements wait the stage checks every 250ms and requests a frame when an ancestor runs a time-based animation of its own (a window sliding over content that stays put; scroll-driven ones move only while scrolling, which updates rendering anyway) or a waiting element's box moved (a box follows every carrier, even on the compositor or in a closed shadow root). Poll, never wait for events (resumed and Web Animations API animations fire none), and never request frames while nothing moves (about 1% of a core in WebKit). While the page loads, WebKit holds an observer's first report until a rendering update, so each new observation requests one frame. These checks only trigger a frame; IntersectionObserver still decides. Fixed boxes and scroll containers are found by walking ancestors in the flat tree (through slots, out of shadow roots; content of a closed shadow root continues at its host). Motion only plays the entrance.
- Never hide what is already shown: late hydration keeps CSS-revealed elements on, above or within one viewport below the viewport, as the first IntersectionObserver report after hydration places them (`MotionStage.locate`), never by geometry measured during the commit, while a fling may still be scrolling. Content of a container the visitor can scroll (overflow auto or scroll on an axis it overflows) is placed by the outermost one, since the observer's margin stops at every container and a swipe may bring clipped slides in; the viewport scrolls in place of `<html>`, and of `<body>` unless `<html>` has overflow of its own. Focus shows an element's final state, pinned once hydrated.
- Host components opt in with `motion: true` and render their outermost element through the `Root` render prop; they never import Motion. `PageShell.astro` takes no `components` prop; it reads them from the integration like the island. With `motion: false` the routes use `StaticPageShell.astro` through `virtual:emdash-plugins/builder/page-shell`, so the build emits no island and keeps `componentsModule` out of the browser. `SiteRenderer` takes `view` or `document`/`state` and always renders statically.
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

- During development use `vp run test` (source-level tests with mocked EmDash I/O, no build). `vp run verify` adds package typechecking. Do not run release checks on every edit or commit.
- For a focused change, pass the affected test files to the same command, e.g. `vp run test -- tests/builder/document.test.ts`. Paths are relative to `packages/emdash-plugins`. Choose all relevant callers/consumers; shared changes require the full fast suite. With no arguments, every fast test runs, including in CI. Do not cache test results or disable process isolation for speed.
- `vp run test:integration` covers real EmDash signing/configuration, hydration and sample-host tests. `vp run test:all` runs both test tiers. Preserve the process isolation of module mocks.
- Before release run `vp run release`: all typechecks, both test tiers, Node/Cloudflare builds and the isolated package check. PR/main CI runs only package typechecking and fast tests; the separate release workflow runs manually or for `v*` tags. See [.docs/testing.md](.docs/testing.md).
- `vp run test:package` is a release check: it installs the packed tarball into a temporary host and checks MCP, publication, previews, role permissions and custom configuration in dev and production builds. Changes to exports, routes, options, packaging, or island code and its dependencies must pass it before release, rather than on every edit (it also enforces the island JavaScript budget).
- `vp run smoke` runs against the local dev server only and uses EmDash's official development login. Never run it against production.

## Release and deployment

- Publish from `packages/emdash-plugins` with `vp pm publish` after `vp pm publish --dry-run`. Publishing is a separate, explicit action.
- Cloudflare deployment uses the ignored `apps/web/wrangler.production.jsonc`; `wrangler.jsonc` contains placeholders only. Run `vp run deploy:production`. Never reapply the initial database bootstrap or import local development credentials on redeploy. See [.docs/deployment.md](.docs/deployment.md).
