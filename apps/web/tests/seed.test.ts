import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateDocument, validateResolvedSpec } from '@interactive-inc/emdash-plugins/builder/document';

const seed = JSON.parse(await readFile(new URL('../seed/seed.json', import.meta.url), 'utf8'));

test('the page editor presents a preview instead of editable internal fields', () => {
  const fields = seed.collections.find((collection: { slug: string }) => collection.slug === 'pages').fields;
  assert.equal(fields.find((field: { slug: string }) => field.slug === 'document').widget, 'builder:page-preview');
  for (const name of ['title', 'description']) {
    assert.equal(fields.find((field: { slug: string }) => field.slug === name).widget, 'builder:managed');
  }
});

test('the web app pages validate and resolve with the distributed package', () => {
  for (const page of seed.content.pages) {
    const validation = validateDocument(page.data.document);
    assert.equal(validation.success, true);
    if (!validation.success) continue;
    validateResolvedSpec(validation.document, { page: { title: page.data.title, description: page.data.description, slug: page.slug }, data: {} });
  }
});
