/** Resolve only saved Pages entries; new-entry and unrelated editors have no preview. */
export const getEditorPageId = (pathname: string, collection = 'pages'): string | null => {
  const match = /^(?:\/_emdash\/admin)?\/content\/([^/]+)\/([^/]+)\/?$/.exec(pathname);

  if (!match || match[1] !== collection || match[2] === 'new') return null;

  return match[2];
};
