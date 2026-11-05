import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import emdash, { local } from 'emdash/astro';
import { sqlite } from 'emdash/db';
import { builderIntegration } from '@interactive-inc/emdash-plugins/builder/astro';
import { builderPlugin } from '@interactive-inc/emdash-plugins/builder';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    react(),
    builderIntegration(),
    emdash({
      database: sqlite({ url: process.env.EMDASH_DATABASE_URL ?? 'file:./.data/emdash.db' }),
      storage: local({ directory: './.data/uploads', baseUrl: '/_emdash/api/media/file' }),
      plugins: [builderPlugin()],
      toolbar: false,
    }),
  ],
});
