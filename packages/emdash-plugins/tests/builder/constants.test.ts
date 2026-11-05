import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pluginId, pluginVersion } from '../../src/builder/constants.ts';
import { builderPlugin } from '../../src/builder/plugin.ts';

test('the plugin descriptor uses the package version and the stable plugin ID', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pluginVersion, manifest.version);
  assert.deepEqual([builderPlugin().id, builderPlugin().version], [pluginId, pluginVersion]);
});
