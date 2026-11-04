declare module 'virtual:site-builder/config' {
  const options: import('./options.ts').ResolvedOptions;
  export default options;
}
declare module 'virtual:site-builder/extensions' {
  const components: import('./extensions.ts').ComponentExtensions;
  export default components;
}
