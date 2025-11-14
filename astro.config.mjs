// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';

import svelte from '@astrojs/svelte';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://leo-baudry.fr',

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [react(), svelte(), sitemap()]
});