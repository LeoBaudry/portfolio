// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';

// 1. IMPORTE L'ADAPTER
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  site: 'https://leo-baudry.fr',

  // 2. DIS À ASTRO QU'IL EST UN SERVEUR
  output: 'server',

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [
    react(), 
    svelte(), 
    sitemap(), 
    
    // 3. AJOUTE L'ADAPTER ICI
    node({
      mode: 'standalone'
    })
  ]
});