import type { Phase, ThemeId } from '../types.js';

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  swatch: string;
  focusColor: string;
  breakColor: string;
  longBreakColor: string;
  particleColor: string;
  bgMeta: string;
}

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  cyber: {
    id: 'cyber',
    label: 'Cyber Neon',
    swatch: '#38bdf8',
    focusColor: '#38bdf8',
    breakColor: '#34d399',
    longBreakColor: '#a78bfa',
    particleColor: '56, 189, 248',
    bgMeta: '#070b14',
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight Lo-Fi',
    swatch: '#c084fc',
    focusColor: '#c084fc',
    breakColor: '#2dd4bf',
    longBreakColor: '#f472b6',
    particleColor: '192, 132, 252',
    bgMeta: '#0c0916',
  },
  matcha: {
    id: 'matcha',
    label: 'Matcha Zen',
    swatch: '#4ade80',
    focusColor: '#4ade80',
    breakColor: '#60a5fa',
    longBreakColor: '#fbbf24',
    particleColor: '74, 222, 128',
    bgMeta: '#08120e',
  },
  sunset: {
    id: 'sunset',
    label: 'Solar Sunset',
    swatch: '#fb7185',
    focusColor: '#fb7185',
    breakColor: '#38bdf8',
    longBreakColor: '#fbbf24',
    particleColor: '251, 113, 133',
    bgMeta: '#14090d',
  },
};

export function applyTheme(themeId: ThemeId): void {
  const theme = THEMES[themeId];
  document.documentElement.setAttribute('data-theme', theme.id);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme.bgMeta);
  }
}

export function getPhaseAccent(themeId: ThemeId, phase: Phase): string {
  const theme = THEMES[themeId];
  switch (phase) {
    case 'focus':
      return theme.focusColor;
    case 'shortBreak':
      return theme.breakColor;
    case 'longBreak':
      return theme.longBreakColor;
  }
}
