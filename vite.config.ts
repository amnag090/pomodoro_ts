import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from any folder. GitHub Pages
  // serves this project from /pomodoro_ts/, not the domain root.
  base: './',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
