import type { SessionRecord } from '../.js';

export interface HeatmapDay {
  dateKey: string;
  count: number;
  minutes: number;
  level: 0 | 1 | 2 | 3 | 4;
  dayOfWeek: number;
}

export interface AnalyticsSummary {
  todayPomodoros: number;
  todayMinutes: number;
  totalPomodoros: number;
  totalMinutes: number;
  currentStreak: number;
  bestStreak: number;
  hourlyFocusMinutes: number[];
  heatmapDays: HeatmapDay[];
}

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, deltaDays: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + deltaDays);
  return d;
}

function parseDateKey(dateKey: string): Date | null {
  const parts = dateKey.split('-');
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day);
}

function getIntensityLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  if (count <= 7) return 3;
  return 4;
}

export function computeAnalytics(
  history: readonly SessionRecord[],
  now: Date = new Date(),
  heatmapWeeks = 12,
): AnalyticsSummary {
  const focusRecords = history.filter((r) => r.phase === 'focus');
  const todayKey = toLocalDateKey(now);

  const byDate = new Map<string, { count: number; minutes: number }>();
  const hourlyFocusMinutes = Array.from({ length: 24 }, () => 0);

  let totalPomodoros = 0;
  let totalMinutes = 0;

  for (const record of focusRecords) {
    totalPomodoros += 1;
    totalMinutes += record.actualMinutes;

    const existing = byDate.get(record.dateKey) ?? { count: 0, minutes: 0 };
    existing.count += 1;
    existing.minutes += record.actualMinutes;
    byDate.set(record.dateKey, existing);

    const parsedDate = new Date(record.completedAt);
    if (!Number.isNaN(parsedDate.getTime())) {
      const hour = parsedDate.getHours();
      hourlyFocusMinutes[hour] = (hourlyFocusMinutes[hour] ?? 0) + record.actualMinutes;
    }
  }

  const todayStats = byDate.get(todayKey) ?? { count: 0, minutes: 0 };

  // Compute current streak (includes today if active, or up to yesterday if today hasn't started yet)
  let currentStreak = 0;
  const hasToday = byDate.has(todayKey);
  let cursor = hasToday ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : addDays(now, -1);

  while (byDate.has(toLocalDateKey(cursor))) {
    currentStreak += 1;
    cursor = addDays(cursor, -1);
  }

  // Compute best streak across all recorded dates
  const sortedDates = Array.from(byDate.keys()).sort();
  let bestStreak = 0;
  let run = 0;
  let prevDate: Date | null = null;

  for (const key of sortedDates) {
    const parsed = parseDateKey(key);
    if (!parsed) continue;
    if (prevDate) {
      const expectedNext = toLocalDateKey(addDays(prevDate, 1));
      run = key === expectedNext ? run + 1 : 1;
    } else {
      run = 1;
    }
    if (run > bestStreak) {
      bestStreak = run;
    }
    prevDate = parsed;
  }

  // Build heatmap aligned cleanly to Sunday..Saturday columns ending on today's week
  const totalDays = heatmapWeeks * 7;
  const endOfGrid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Align start so the last week includes today and spans heatmapWeeks full weeks back from Sunday
  const todayDow = endOfGrid.getDay();
  const startOfCurrentWeek = addDays(endOfGrid, -todayDow);
  const gridStart = addDays(startOfCurrentWeek, -(heatmapWeeks - 1) * 7);

  const heatmapDays: HeatmapDay[] = [];
  for (let i = 0; i < totalDays; i += 1) {
    const d = addDays(gridStart, i);
    if (d > endOfGrid) break;
    const key = toLocalDateKey(d);
    const stat = byDate.get(key) ?? { count: 0, minutes: 0 };
    heatmapDays.push({
      dateKey: key,
      count: stat.count,
      minutes: Math.round(stat.minutes),
      level: getIntensityLevel(stat.count),
      dayOfWeek: d.getDay(),
    });
  }

  return {
    todayPomodoros: todayStats.count,
    todayMinutes: Math.round(todayStats.minutes),
    totalPomodoros,
    totalMinutes: Math.round(totalMinutes),
    currentStreak,
    bestStreak,
    hourlyFocusMinutes: hourlyFocusMinutes.map((m) => Math.round(m)),
    heatmapDays,
  };
}
