import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react(), {
    name: 'development-react-preamble-csp',
    transformIndexHtml(html, context) {
      // React's Vite refresh preamble is inline only in development. Production keeps script-src 'self'.
      return context.server ? html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';") : html;
    }
  }],
  base: './', server: { host: '127.0.0.1', port: 5173, strictPort: true }
});
