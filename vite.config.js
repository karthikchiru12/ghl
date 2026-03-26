import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry:   'src/embed/main.js',
      name:    'GhlVoiceAiCopilot',
      formats: ['iife'],
    },
    outDir:      'public',
    emptyOutDir: false, // don't wipe other static assets
    rollupOptions: {
      output: {
        entryFileNames: 'ghl-voice-ai-observability-embed.js',
        assetFileNames: (info) =>
          info.name?.endsWith('.css')
            ? 'ghl-voice-ai-observability-embed.css'
            : info.name,
      },
    },
  },
});
