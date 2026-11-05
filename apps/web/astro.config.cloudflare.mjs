import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import emdash from 'emdash/astro';
import { d1, r2 } from '@emdash-cms/cloudflare';
import { builderIntegration } from '@interactive-inc/emdash-plugins/builder/astro';
import { builderPlugin } from '@interactive-inc/emdash-plugins/builder';

export default defineConfig({
  output: 'server',
  outDir: './dist-cloudflare',
  adapter: cloudflare({
    imageService: 'passthrough',
    configPath: process.env.EMDASH_WRANGLER_CONFIG ?? './wrangler.jsonc',
  }),
  devToolbar: { enabled: false },
  integrations: [
    react(),
    builderIntegration(),
    emdash({
      database: d1({ binding: 'DB' }),
      storage: r2({ binding: 'MEDIA' }),
      plugins: [builderPlugin()],
      toolbar: false,
    }),
  ],
});
