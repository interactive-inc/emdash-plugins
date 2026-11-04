import './prepare-local.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Both direct workspace launches and Portless need the compiled plugin entrypoints.
execFileSync('vp', ['run', '--filter', '@open-emdash/site-builder', 'build'], { stdio: 'inherit' });
try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const environment = { ...process.env };
if (environment.PORTLESS_URL) {
  environment.EMDASH_SITE_URL = environment.PORTLESS_URL;
  // Astro 7 otherwise detaches itself in agent sessions, causing Portless to lose its child.
  environment.ASTRO_DEV_BACKGROUND = '1';
}
const astro = fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url));
const server = spawn(process.execPath, [astro, 'dev', '--host', environment.HOST ?? '127.0.0.1', '--port', environment.PORT ?? '4331'], { env: environment, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.on('exit', code => { process.exitCode = code ?? 0; });
