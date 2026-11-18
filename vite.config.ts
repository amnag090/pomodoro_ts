import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Builds dist/sw.js from src/pwa/service-worker.js, filling in every file the app
 * needs offline (the bundle plus everything in public/) and a version hash of
 * their contents. A new hash on each change is what makes browsers update.
 */
function serviceWorker(): Plugin {
  let root = '';
  let publicDir = '';
  return {
    name: 'chronos-service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      root = config.root;
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const template = readFileSync(path.join(root, 'src/pwa/service-worker.js'), 'utf8');
      // The worker's own code is part of the version too, so a change to caching logic
      // alone still gets a fresh cache.
      const hash = createHash('sha256').update(template);
      const files: string[] = [];

      for (const [fileName, item] of Object.entries(bundle)) {
        if (fileName.endsWith('.map')) continue;
        files.push(fileName);
        hash.update(fileName).update(item.type === 'chunk' ? item.code : item.source);
      }

      if (publicDir) {
        for (const entry of readdirSync(publicDir, { recursive: true }) as string[]) {
          const full = path.join(publicDir, entry);
          if (!statSync(full).isFile()) continue;
          const fileName = entry.split(path.sep).join('/');
          files.push(fileName);
          hash.update(fileName).update(readFileSync(full));
        }
      }

      const urls = ['./', ...files.sort().map((f) => `./${f}`)];
      const source = template
        .replace('__CACHE_VERSION__', hash.digest('hex').slice(0, 12))
        .replace(`['__PRECACHE_URLS__']`, JSON.stringify(urls, null, 2));

      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the build works from any folder. GitHub Pages
  // serves this project from /pomodoro_ts/, not the domain root.
  base: './',
  plugins: [serviceWorker()],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
