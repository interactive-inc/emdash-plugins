import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { getEditorPageId } from '../../src/builder/admin/get-editor-page-id.ts';
import { PagePreviewFrame } from '../../src/builder/admin/page-preview-frame.tsx';
import { ManagedPageField } from '../../src/builder/admin/managed-page-field.tsx';

test('page preview targets only the saved Pages entry in the native editor', () => {
  assert.equal(getEditorPageId('/_emdash/admin/content/pages/page-id'), 'page-id');
  assert.equal(getEditorPageId('/_emdash/admin/content/pages/another-id/'), 'another-id');
  assert.equal(getEditorPageId('/content/pages/page-id'), 'page-id');
  for (const path of ['/_emdash/admin/content/pages', '/_emdash/admin/content/pages/new', '/_emdash/admin/content/posts/post-id', '/outside/pages/page-id']) {
    assert.equal(getEditorPageId(path), null);
  }
});

test('internal metadata has no manual input and preview does not enable scripts', () => {
  assert.equal(renderToStaticMarkup(<ManagedPageField />), '');
  const markup = renderToStaticMarkup(<PagePreviewFrame url="/preview/page?_preview=token" />);
  assert.match(markup, /sandbox="allow-same-origin"/);
  assert.doesNotMatch(markup, /allow-scripts|allow-forms|textarea|contenteditable/);
  assert.match(markup, /title="ページの下書きプレビュー"/);
});
