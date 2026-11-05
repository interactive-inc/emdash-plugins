import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = fileURLToPath(new URL('../apps/web/wrangler.production.jsonc', import.meta.url));
await access(config).catch(() => {
  throw new Error('Create apps/web/wrangler.production.jsonc first. See .docs/deployment.md.');
});
const env = { ...process.env, EMDASH_WRANGLER_CONFIG: config, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' };
for (const args of [['run', 'build:cloudflare'], ['run', '--filter', 'web', 'deploy:production']]) {
  const result = spawnSync('vp', args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
