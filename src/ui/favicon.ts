import { formatCountdown, formatOvertime, getPhaseLabel } from '../core/timer.js';
import { THEMES, getPhaseAccent } from './themes.js';
import type { ThemeId, TimerSnapshot } from '../types.js';

let lastRenderedFaviconBucket = '';

export function updateDocumentTitleAndFavicon(
  snapshot: TimerSnapshot,
  themeId: ThemeId,
): void {
  const timeText =
    snapshot.status === 'overtime'
      ? formatOvertime(snapshot.overtimeMs)
      : formatCountdown(snapshot.remainingMs);
  const phaseLabel = getPhaseLabel(snapshot.phase);

  if (snapshot.status === 'running' || snapshot.status === 'overtime') {
    document.title = `${timeText} • ${phaseLabel} — CHRONOS`;
  } else if (snapshot.status === 'paused') {
    document.title = `⏸ ${timeText} • ${phaseLabel} — CHRONOS`;
  } else {
    document.title = `CHRONOS // Pomodoro Focus Studio`;
  }

  // Throttle favicon data-URI regeneration to ~2% progress increments or status/phase changes
  const progressStep = Math.round(snapshot.progress * 50);
  const bucket = `${themeId}:${snapshot.phase}:${snapshot.status}:${progressStep}`;
  if (bucket === lastRenderedFaviconBucket) return;
  lastRenderedFaviconBucket = bucket;

  const accent = snapshot.status === 'overtime' ? '#fbbf24' : getPhaseAccent(themeId, snapshot.phase);
  const r = 24;
  const circ = 2 * Math.PI * r;
  const remainingFraction = snapshot.status === 'overtime' ? 1 : Math.max(0, 1 - snapshot.progress);
  const dashOffset = circ * (1 - remainingFraction);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`,
    `<circle cx="32" cy="32" r="30" fill="${THEMES[themeId].bgMeta}"/>`,
    `<circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="6"/>`,
    `<circle cx="32" cy="32" r="${r}" fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${dashOffset.toFixed(1)}" transform="rotate(-90 32 32)"/>`,
    snapshot.status === 'running' || snapshot.status === 'overtime'
      ? `<circle cx="32" cy="32" r="7" fill="${accent}"/>`
      : `<polygon points="27,23 43,32 27,41" fill="${accent}"/>`,
    `</svg>`,
  ].join('');

  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) {
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}
