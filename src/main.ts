import './styles/main.css';
import { PomodoroApp } from './ui/app.js';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Root #app element not found');
}

const app = new PomodoroApp(root);
app.mount();

// Offline support. Production only: in dev, a service worker would cache Vite's live modules.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Not fatal: the app works the same, just without offline support.
    });
  });
}
