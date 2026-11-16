import { describe, expect, it } from 'vitest';
import { computeAnalytics, toLocalDateKey } from '../stats.js';
import {
  addTask,
  clearCompletedTasks,
  incrementTaskPomodoro,
  moveTask,
  toggleTaskDone,
} from '../tasks.js';
import type { SessionRecord } from '../../types.js';

function makeFocusRecord(date: Date, minutes = 25): SessionRecord {
  return {
    id: crypto.randomUUID(),
    phase: 'focus',
    plannedMinutes: minutes,
    actualMinutes: minutes,
    overtimeMinutes: 0,
    completedAt: date.toISOString(),
    dateKey: toLocalDateKey(date),
    taskId: null,
    taskTitle: null,
  };
}

describe('computeAnalytics', () => {
  it('calculates today totals, current streak, best streak, and 12-week heatmap', () => {
    const now = new Date(2026, 10, 16, 14, 30); // 2026-11-16
    const yesterday = new Date(2026, 10, 15, 10, 0);
    const twoDaysAgo = new Date(2026, 10, 14, 9, 0);
    const oldStart = new Date(2026, 9, 1, 11, 0);
    const oldEnd = new Date(2026, 9, 4, 11, 0);
    const oldMid1 = new Date(2026, 9, 2, 11, 0);
    const oldMid2 = new Date(2026, 9, 3, 11, 0);

    const history: SessionRecord[] = [
      makeFocusRecord(now, 25),
      makeFocusRecord(now, 30),
      makeFocusRecord(yesterday, 25),
      makeFocusRecord(twoDaysAgo, 25),
      makeFocusRecord(oldStart, 25),
      makeFocusRecord(oldMid1, 25),
      makeFocusRecord(oldMid2, 25),
      makeFocusRecord(oldEnd, 25),
      // Breaks should not inflate focus metrics
      {
        id: 'break-1',
        phase: 'shortBreak',
        plannedMinutes: 5,
        actualMinutes: 5,
        overtimeMinutes: 0,
        completedAt: now.toISOString(),
        dateKey: toLocalDateKey(now),
        taskId: null,
        taskTitle: null,
      },
    ];

    const summary = computeAnalytics(history, now, 12);

    expect(summary.todayPomodoros).toBe(2);
    expect(summary.todayMinutes).toBe(55);
    expect(summary.totalPomodoros).toBe(8);
    expect(summary.currentStreak).toBe(3);
    expect(summary.bestStreak).toBe(4);
    expect(summary.hourlyFocusMinutes[14]).toBe(55);
    expect(summary.heatmapDays.length).toBeGreaterThanOrEqual(78);
    expect(summary.heatmapDays.at(-1)?.dateKey).toBe('2026-11-16');
    expect(summary.heatmapDays.at(-1)?.level).toBe(1);
  });
});

describe('task queue helpers', () => {
  it('adds, activates, increments, reorders, toggles, and clears completed tasks', () => {
    const first = addTask([], null, 'Write timer tests', 2);
    const second = addTask(first.tasks, first.activeTaskId, 'Build audio synth', 3);

    expect(second.tasks).toHaveLength(2);
    expect(second.activeTaskId).toBe(first.activeTaskId);

    const incremented = incrementTaskPomodoro(second.tasks, second.activeTaskId);
    const active = incremented.find((t) => t.id === second.activeTaskId);
    expect(active?.completedPomodoros).toBe(1);

    const reordered = moveTask(incremented, active!.id, 'up');
    expect(reordered[0]?.id).toBe(active!.id);

    const toggled = toggleTaskDone(reordered, active!.id, active!.id);
    expect(toggled.activeTaskId).not.toBe(active!.id);

    const cleared = clearCompletedTasks(toggled.tasks, toggled.activeTaskId);
    expect(cleared.tasks).toHaveLength(1);
    expect(cleared.tasks[0]?.title).toBe('Build audio synth');
  });
});
