import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // The workflow rules are shared with the backend from ../contract.
      allow: [searchForWorkspaceRoot(process.cwd()), '../contract'],
    },
  },
});
