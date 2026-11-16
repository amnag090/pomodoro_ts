import type {
  Phase,
  PhaseCompletionEvent,
  PresetConfig,
  TimerSettings,
  TimerSnapshot,
  TimerStatus,
} from '../types.js';

export const PRESETS: readonly PresetConfig[] = [
  {
    id: 'classic',
    label: 'Classic 25/5',
    tagline: 'Balanced cadence for sustained output',
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    longBreakInterval: 4,
  },
  {
    id: 'deepWork',
    label: 'Deep Work 50/10',
    tagline: 'Extended flow blocks for complex engineering',
    focusMinutes: 50,
    shortBreakMinutes: 10,
    longBreakMinutes: 25,
    longBreakInterval: 3,
  },
  {
    id: 'sprint',
    label: 'Sprint 15/3',
    tagline: 'High-tempo momentum for rapid iteration',
    focusMinutes: 15,
    shortBreakMinutes: 3,
    longBreakMinutes: 10,
    longBreakInterval: 4,
  },
] as const;

export interface PomodoroEngineHooks {
  now?: () => number;
  onTick?: (snapshot: TimerSnapshot) => void;
  onPhaseComplete?: (event: PhaseCompletionEvent, snapshot: TimerSnapshot) => void;
  onOvertimeStart?: (snapshot: TimerSnapshot) => void;
  onSecondBoundary?: (remainingSeconds: number, snapshot: TimerSnapshot) => void;
}

export function formatCountdown(ms: number): string {
  const clampedMs = Math.max(0, ms);
  const totalSeconds = Math.ceil(clampedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatOvertime(ms: number): string {
  const clampedMs = Math.max(0, ms);
  const totalSeconds = Math.floor(clampedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `+${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function getPhaseLabel(phase: Phase): string {
  switch (phase) {
    case 'focus':
      return 'Focus';
    case 'shortBreak':
      return 'Short Break';
    case 'longBreak':
      return 'Long Break';
  }
}

export class PomodoroEngine {
  private settings: TimerSettings;
  private readonly now: () => number;
  private readonly hooks: PomodoroEngineHooks;

  private phase: Phase = 'focus';
  private status: TimerStatus = 'idle';
  private totalMs: number;
  private remainingMs: number;
  private overtimeMs = 0;
  private lastTickAt: number | null = null;
  private completedFocusInCycle = 0;
  private totalFocusCompleted = 0;
  private lastSecondBucket = -1;

  constructor(settings: TimerSettings, hooks: PomodoroEngineHooks = {}) {
    this.settings = { ...settings };
    this.now = hooks.now ?? (() => Date.now());
    this.hooks = hooks;
    this.totalMs = this.getPhaseDurationMs(this.phase);
    this.remainingMs = this.totalMs;
    this.lastSecondBucket = Math.ceil(this.remainingMs / 1000);
  }

  getPhaseDurationMs(phase: Phase): number {
    switch (phase) {
      case 'focus':
        return Math.max(1, this.settings.focusMinutes) * 60_000;
      case 'shortBreak':
        return Math.max(1, this.settings.shortBreakMinutes) * 60_000;
      case 'longBreak':
        return Math.max(1, this.settings.longBreakMinutes) * 60_000;
    }
  }

  getSnapshot(): TimerSnapshot {
    const progress =
      this.totalMs > 0
        ? Math.min(1, Math.max(0, (this.totalMs - this.remainingMs) / this.totalMs))
        : 1;
    return {
      phase: this.phase,
      status: this.status,
      remainingMs: this.remainingMs,
      totalMs: this.totalMs,
      overtimeMs: this.overtimeMs,
      progress,
      completedFocusInCycle: this.completedFocusInCycle,
      longBreakInterval: this.settings.longBreakInterval,
      totalFocusCompleted: this.totalFocusCompleted,
    };
  }

  start(): TimerSnapshot {
    if (this.status === 'running' || this.status === 'overtime') {
      return this.getSnapshot();
    }
    this.status = 'running';
    this.lastTickAt = this.now();
    this.lastSecondBucket = Math.ceil(this.remainingMs / 1000);
    const snap = this.getSnapshot();
    this.hooks.onTick?.(snap);
    return snap;
  }

  pause(): TimerSnapshot {
    if (this.status !== 'running') {
      return this.getSnapshot();
    }
    this.tick();
    if (this.status === 'running') {
      this.status = 'paused';
      this.lastTickAt = null;
    }
    const snap = this.getSnapshot();
    this.hooks.onTick?.(snap);
    return snap;
  }

  toggle(): TimerSnapshot {
    if (this.status === 'running') {
      return this.pause();
    }
    if (this.status === 'overtime') {
      return this.finishOvertime();
    }
    return this.start();
  }

  reset(): TimerSnapshot {
    this.status = 'idle';
    this.totalMs = this.getPhaseDurationMs(this.phase);
    this.remainingMs = this.totalMs;
    this.overtimeMs = 0;
    this.lastTickAt = null;
    this.lastSecondBucket = Math.ceil(this.remainingMs / 1000);
    const snap = this.getSnapshot();
    this.hooks.onTick?.(snap);
    return snap;
  }

  switchPhase(nextPhase: Phase): TimerSnapshot {
    this.phase = nextPhase;
    return this.reset();
  }

  extendSeconds(deltaSeconds: number): TimerSnapshot {
    const deltaMs = deltaSeconds * 1000;
    if (this.status === 'overtime') {
      if (deltaMs > 0) {
        this.status = 'running';
        this.remainingMs = deltaMs;
        this.totalMs = Math.max(this.totalMs, deltaMs);
        this.overtimeMs = 0;
        this.lastTickAt = this.now();
      }
      const snap = this.getSnapshot();
      this.hooks.onTick?.(snap);
      return snap;
    }

    const nextRemaining = Math.max(5_000, this.remainingMs + deltaMs);
    this.remainingMs = nextRemaining;
    if (nextRemaining > this.totalMs) {
      this.totalMs = nextRemaining;
    }
    this.lastSecondBucket = Math.ceil(this.remainingMs / 1000);
    const snap = this.getSnapshot();
    this.hooks.onTick?.(snap);
    return snap;
  }

  finishOvertime(): TimerSnapshot {
    if (this.status !== 'overtime') {
      return this.getSnapshot();
    }
    this.tick();
    return this.completeCurrentPhase(false);
  }

  skip(): TimerSnapshot {
    if (this.status === 'overtime') {
      return this.finishOvertime();
    }
    const nextPhase = this.computeNextPhaseOnAdvance(false);
    if (this.phase === 'longBreak') {
      this.completedFocusInCycle = 0;
    }
    this.phase = nextPhase;
    this.status = 'idle';
    this.totalMs = this.getPhaseDurationMs(this.phase);
    this.remainingMs = this.totalMs;
    this.overtimeMs = 0;
    this.lastTickAt = null;
    this.lastSecondBucket = Math.ceil(this.remainingMs / 1000);
    const snap = this.getSnapshot();
    this.hooks.onTick?.(snap);
    return snap;
  }

  updateSettings(nextSettings: TimerSettings): TimerSnapshot {
    const prevDuration = this.getPhaseDurationMs(this.phase);
    this.settings = { ...nextSettings };
    const newDuration = this.getPhaseDurationMs(this.phase);

    if (this.status === 'idle') {
      this.totalMs = newDuration;
      this.remainingMs = newDuration;
    } else if (prevDuration !== newDuration && this.status !== 'overtime') {
      const elapsed = Math.max(0, this.totalMs - this.remainingMs);
      this.totalMs = newDuration;
      this.remainingMs = Math.max(1000, newDuration - elapsed);
    }

    const snap = this.getSnapshot();
    this.hooks.onTick?.(snap);
    return snap;
  }

  tick(): TimerSnapshot {
    if (this.status !== 'running' && this.status !== 'overtime') {
      return this.getSnapshot();
    }

    const currentNow = this.now();
    const prevNow = this.lastTickAt ?? currentNow;
    const elapsed = Math.max(0, currentNow - prevNow);
    this.lastTickAt = currentNow;

    if (this.status === 'overtime') {
      this.overtimeMs += elapsed;
      const snap = this.getSnapshot();
      this.hooks.onTick?.(snap);
      return snap;
    }

    if (elapsed === 0) {
      return this.getSnapshot();
    }

    if (this.remainingMs > elapsed) {
      this.remainingMs -= elapsed;
      const secBucket = Math.ceil(this.remainingMs / 1000);
      const snap = this.getSnapshot();
      if (secBucket !== this.lastSecondBucket) {
        this.lastSecondBucket = secBucket;
        this.hooks.onSecondBoundary?.(secBucket, snap);
      }
      this.hooks.onTick?.(snap);
      return snap;
    }

    // Reached zero
    const overflow = elapsed - this.remainingMs;
    this.remainingMs = 0;
    this.lastSecondBucket = 0;

    if (this.settings.flowOvertime && this.phase === 'focus') {
      this.status = 'overtime';
      this.overtimeMs = overflow;
      const snap = this.getSnapshot();
      this.hooks.onOvertimeStart?.(snap);
      this.hooks.onTick?.(snap);
      return snap;
    }

    return this.completeCurrentPhase(true);
  }

  private computeNextPhaseOnAdvance(countCompletedFocus: boolean): Phase {
    if (this.phase === 'focus') {
      const projectedCycleCount = countCompletedFocus
        ? this.completedFocusInCycle + 1
        : this.completedFocusInCycle;
      if (projectedCycleCount >= Math.max(1, this.settings.longBreakInterval)) {
        return 'longBreak';
      }
      return 'shortBreak';
    }
    return 'focus';
  }

  private completeCurrentPhase(allowAutoStart: boolean): TimerSnapshot {
    const completedPhase = this.phase;
    const plannedMinutes = Math.round(this.totalMs / 60_000);
    const overtimeMinutes = Math.round((this.overtimeMs / 60_000) * 10) / 10;
    const actualMinutes = Math.round(((this.totalMs + this.overtimeMs) / 60_000) * 10) / 10;

    if (completedPhase === 'focus') {
      this.completedFocusInCycle += 1;
      this.totalFocusCompleted += 1;
    } else if (completedPhase === 'longBreak') {
      this.completedFocusInCycle = 0;
    }

    const nextPhase: Phase =
      completedPhase === 'focus'
        ? this.completedFocusInCycle >= Math.max(1, this.settings.longBreakInterval)
          ? 'longBreak'
          : 'shortBreak'
        : 'focus';

    const shouldAutoStart =
      allowAutoStart &&
      (nextPhase === 'focus' ? this.settings.autoStartFocus : this.settings.autoStartBreaks);

    this.phase = nextPhase;
    this.totalMs = this.getPhaseDurationMs(nextPhase);
    this.remainingMs = this.totalMs;
    this.overtimeMs = 0;
    this.status = shouldAutoStart ? 'running' : 'idle';
    this.lastTickAt = shouldAutoStart ? this.now() : null;
    this.lastSecondBucket = Math.ceil(this.remainingMs / 1000);

    const snap = this.getSnapshot();
    const event: PhaseCompletionEvent = {
      completedPhase,
      nextPhase,
      plannedMinutes,
      actualMinutes,
      overtimeMinutes,
      autoStartedNext: shouldAutoStart,
    };

    this.hooks.onPhaseComplete?.(event, snap);
    this.hooks.onTick?.(snap);
    return snap;
  }
}
