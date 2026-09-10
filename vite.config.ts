import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'path';

// Tableau Extensions must be served over HTTPS (self-signed is fine for local
// dev, Tableau Desktop/Server will prompt to trust it), and need two HTML entry
// points: the main viz (index.html) and the settings dialog (configure.html),
// opened via tableau.extensions.ui.displayDialogAsync.
export default defineConfig({
  // Relative base so the built assets resolve correctly whether the extension
  // ends up served at a domain root or under a GitHub Pages project subpath
  // (https://<user>.github.io/<repo>/).
  base: './',
  plugins: [react(), basicSsl()],
  server: {
    port: 8765,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        configure: resolve(__dirname, 'configure.html'),
      },
    },
  },
});
