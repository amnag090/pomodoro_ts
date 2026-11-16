import './styles/main.css';
import { PomodoroApp } from './.js';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Root #app element not found');
}

const app = new PomodoroApp(root);
app.mount();
