import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateDocument } from '@interactive-inc/emdash-plugins/builder/document';

const seed = JSON.parse(await readFile(new URL('../seed/seed.json', import.meta.url), 'utf8'));

test('the page editor presents a preview instead of editable internal fields', () => {
  const fields = seed.collections.find((collection: { slug: string }) => collection.slug === 'pages').fields;
  assert.equal(fields.find((field: { slug: string }) => field.slug === 'document').widget, 'builder:page-preview');
  for (const name of ['title', 'description']) {
    assert.equal(fields.find((field: { slug: string }) => field.slug === name).widget, 'builder:managed');
  }
});

test('the web app pages validate with the distributed package', () => {
  const moving = new Set<string>();
  for (const page of seed.content.pages) {
    const validation = validateDocument(page.data.document);
    assert.equal(validation.success, true, `${page.slug}: ${validation.success ? '' : validation.errors.join('; ')}`);
    if (validation.success && Object.values(validation.document.spec.elements).some(element => element.props.motion)) moving.add(page.slug);
  }
  // The README describes the sample: the home page animates and the guide stays static.
  assert.deepEqual([...moving], ['home']);
});
