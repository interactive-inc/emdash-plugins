declare module 'virtual:emdash-plugins/builder/config' {
  const options: import('./options.ts').ResolvedOptions;
  export default options;
}
declare module 'virtual:emdash-plugins/builder/extensions' {
  const components: import('./extensions.ts').ComponentExtensions;
  export default components;
}
declare module 'virtual:emdash-plugins/builder/page-shell' {
  /** PageShell.astro, or the island-free StaticPageShell.astro with motion: false. */
  const PageShell: typeof import('./PageShell.astro').default;
  export default PageShell;
}
