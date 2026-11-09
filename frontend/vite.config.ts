import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The page and the API share one address, so the sign-in renewal
    // cookie (SameSite=Strict, path /api/auth) reaches the API. `ws`
    // forwards the live connection (/api/realtime) too.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        ws: true,
      },
    },
    fs: {
      // The workflow rules are shared with the backend from ../contract.
      allow: [searchForWorkspaceRoot(process.cwd()), '../contract'],
    },
  },
});
