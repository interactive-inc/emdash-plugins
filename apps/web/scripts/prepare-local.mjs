import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

await mkdir('.data', { recursive: true });
let existing = '';
try { existing = await readFile('.env', 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!process.env.EMDASH_PREVIEW_SECRET && !/^EMDASH_PREVIEW_SECRET=.+/m.test(existing)) {
  await appendFile('.env', `\nEMDASH_PREVIEW_SECRET=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  console.log('Created a local preview signing key in .env.');
}
