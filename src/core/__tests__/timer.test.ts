import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../.js';
import { PomodoroEngine, formatCountdown, formatOvertime } from '../.js';
import type { PhaseCompletionEvent } from '../.js';

function createTestClock(initial = 1_000_000) {
  let now = initial;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('PomodoroEngine', () => {
  it('counts down without drift and pauses/resumes accurately', () => {
    const clock = createTestClock();
    const engine = new PomodoroEngine(
      { ...DEFAULT_SETTINGS, focusMinutes: 25, flowOvertime: false },
      { now: clock.now },
    );

    expect(formatCountdown(engine.getSnapshot().remainingMs)).toBe('25:00');
    engine.start();

    clock.advance(65_000);
    const runningSnap = engine.tick();
    expect(formatCountdown(runningSnap.remainingMs)).toBe('23:55');
    expect(runningSnap.status).toBe('running');

    engine.pause();
    clock.advance(120_000);
    const pausedSnap = engine.tick();
    expect(pausedSnap.status).toBe('paused');
    expect(formatCountdown(pausedSnap.remainingMs)).toBe('23:55');

    engine.start();
    clock.advance(5_000);
    expect(formatCountdown(engine.tick().remainingMs)).toBe('23:50');
  });

  it('cycles through focus and short breaks into a long break after N sessions', () => {
    const clock = createTestClock();
    const completions: PhaseCompletionEvent[] = [];

    const engine = new PomodoroEngine(
      {
        ...DEFAULT_SETTINGS,
        focusMinutes: 1,
        shortBreakMinutes: 1,
        longBreakMinutes: 5,
        longBreakInterval: 2,
        flowOvertime: false,
        autoStartBreaks: true,
        autoStartFocus: true,
      },
      {
        now: clock.now,
        onPhaseComplete: (e) => completions.push(e),
      },
    );

    engine.start();
    // 1st focus completes -> shortBreak
    clock.advance(60_000);
    let snap = engine.tick();
    expect(snap.phase).toBe('shortBreak');
    expect(snap.status).toBe('running');
    expect(snap.completedFocusInCycle).toBe(1);

    // shortBreak completes -> focus
    clock.advance(60_000);
    snap = engine.tick();
    expect(snap.phase).toBe('focus');

    // 2nd focus completes -> longBreak
    clock.advance(60_000);
    snap = engine.tick();
    expect(snap.phase).toBe('longBreak');
    expect(snap.completedFocusInCycle).toBe(2);

    // longBreak completes -> resets cycle count & returns to focus
    clock.advance(300_000);
    snap = engine.tick();
    expect(snap.phase).toBe('focus');
    expect(snap.completedFocusInCycle).toBe(0);
    expect(completions.map((c) => c.completedPhase)).toEqual([
      'focus',
      'shortBreak',
      'focus',
      'longBreak',
    ]);
  });

  it('enters flow overtime when enabled and logs overtime minutes on finish', () => {
    const clock = createTestClock();
    const onOvertimeStart = vi.fn();
    const completions: PhaseCompletionEvent[] = [];

    const engine = new PomodoroEngine(
      {
        ...DEFAULT_SETTINGS,
        focusMinutes: 10,
        flowOvertime: true,
        autoStartBreaks: false,
      },
      {
        now: clock.now,
        onOvertimeStart,
        onPhaseComplete: (e) => completions.push(e),
      },
    );

    engine.start();
    clock.advance(10 * 60_000 + 90_000); // 10m + 1.5m overtime
    const overtimeSnap = engine.tick();

    expect(overtimeSnap.status).toBe('overtime');
    expect(formatOvertime(overtimeSnap.overtimeMs)).toBe('+01:30');
    expect(onOvertimeStart).toHaveBeenCalledTimes(1);
    expect(completions).toHaveLength(0);

    clock.advance(30_000); // total +2m overtime
    const finishedSnap = engine.finishOvertime();
    expect(finishedSnap.phase).toBe('shortBreak');
    expect(finishedSnap.status).toBe('idle');
    expect(completions[0]).toMatchObject({
      completedPhase: 'focus',
      plannedMinutes: 10,
      overtimeMinutes: 2,
      actualMinutes: 12,
    });
  });

  it('supports extending time during running and overtime states', () => {
    const clock = createTestClock();
    const engine = new PomodoroEngine(
      { ...DEFAULT_SETTINGS, focusMinutes: 1, flowOvertime: true },
      { now: clock.now },
    );

    engine.start();
    clock.advance(70_000); // 10s into overtime
    expect(engine.tick().status).toBe('overtime');

    const extended = engine.extendSeconds(120);
    expect(extended.status).toBe('running');
    expect(formatCountdown(extended.remainingMs)).toBe('02:00');
  });
});
