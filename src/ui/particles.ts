import { THEMES } from './themes.js';
import type { ThemeId } from '../types.js';

interface AmbientParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
}

interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
  color: string;
}

export class ParticleBackdrop {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private ambient: AmbientParticle[] = [];
  private bursts: BurstParticle[] = [];
  private rafId: number | null = null;
  private themeId: ThemeId = 'amoled';
  private activeRunning = false;
  private reducedMotion = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
    this.seedAmbient();
  }

  setTheme(themeId: ThemeId): void {
    this.themeId = themeId;
  }

  setRunning(running: boolean): void {
    this.activeRunning = running;
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  celebrate(originX?: number, originY?: number): void {
    // Skip when the animation loop is stopped (reduced motion or flat design);
    // otherwise bursts would pile up and all fire when it restarts.
    if (this.reducedMotion || this.rafId === null) return;
    const cx = originX ?? window.innerWidth / 2;
    const cy = originY ?? window.innerHeight * 0.36;
    const theme = THEMES[this.themeId];
    const palette = [theme.focusColor, theme.breakColor, theme.longBreakColor, '#ffffff'];

    for (let i = 0; i < 48; i += 1) {
      const angle = (Math.PI * 2 * i) / 48 + (Math.random() - 0.5) * 0.3;
      const speed = 1.6 + Math.random() * 4.8;
      this.bursts.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.2,
        r: 1.8 + Math.random() * 2.6,
        alpha: 1,
        color: palette[i % palette.length] ?? '#38bdf8',
      });
    }
  }

  start(): void {
    if (this.rafId !== null || this.reducedMotion) return;
    const loop = () => {
      this.drawFrame();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.bursts = [];
    this.ctx?.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  private seedAmbient(): void {
    const count = 42;
    const w = window.innerWidth || 1200;
    const h = window.innerHeight || 800;
    this.ambient = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.28,
      vy: -0.1 - Math.random() * 0.25,
      r: 0.9 + Math.random() * 1.8,
      alpha: 0.14 + Math.random() * 0.35,
    }));
  }

  private drawFrame(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    const rgb = THEMES[this.themeId].particleColor;
    const speedFactor = this.activeRunning ? 1.8 : 0.7;

    for (const p of this.ambient) {
      p.x += p.vx * speedFactor;
      p.y += p.vy * speedFactor;

      if (p.y < -10) {
        p.y = h + 10;
        p.x = Math.random() * w;
      }
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb}, ${p.alpha})`;
      ctx.fill();
    }

    // Subtle constellation lines between close particles when running
    if (this.activeRunning) {
      for (let i = 0; i < this.ambient.length; i += 1) {
        const a = this.ambient[i];
        if (!a) continue;
        for (let j = i + 1; j < this.ambient.length; j += 1) {
          const b = this.ambient[j];
          if (!b) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < 13000) {
            const lineAlpha = (1 - distSq / 13000) * 0.1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(${rgb}, ${lineAlpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }
    }

    // Celebratory burst particles
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const b = this.bursts[i];
      if (!b) continue;
      b.x += b.vx;
      b.y += b.vy;
      b.vy += 0.06;
      b.vx *= 0.985;
      b.alpha -= 0.016;
      if (b.alpha <= 0) {
        this.bursts.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = b.alpha;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.restore();
    }
  }
}
