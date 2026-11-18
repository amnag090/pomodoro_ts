import type {
  AppData,
  AudioMixerState,
  BinauralBand,
  FeatureId,
  Phase,
  PresetId,
  SessionRecord,
  SoundLayerId,
  TaskItem,
  ThemeId,
  TimerSettings,
  UiPreferences,
} from '../types.js';

const STORAGE_KEY = 'chronos.pomodoro.v1';

export const DEFAULT_SETTINGS: TimerSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  flowOvertime: true,
  dailyGoal: 8,
  tickSound: false,
  chimeVolume: 0.75,
  desktopNotifications: false,
  preset: 'classic',
};

export const DEFAULT_AUDIO: AudioMixerState = {
  muted: false,
  masterVolume: 0.65,
  layers: {
    rain: 0,
    vinyl: 0,
    space: 0,
    brown: 0,
    binaural: 0,
  },
  binauralBand: 'alpha',
};

/** Zen by default: every optional panel starts off and is switched on from the side drawer. */
export const DEFAULT_UI: UiPreferences = {
  features: {
    tasks: false,
    soundscape: false,
    timeline: false,
    dailyGoal: false,
  },
  flatDesign: false,
};

export function createDefaultAppData(): AppData {
  return {
    version: 1,
    theme: 'amoled',
    settings: { ...DEFAULT_SETTINGS },
    audio: {
      ...DEFAULT_AUDIO,
      layers: { ...DEFAULT_AUDIO.layers },
    },
    ui: {
      ...DEFAULT_UI,
      features: { ...DEFAULT_UI.features },
    },
    tasks: [
      {
        id: 'welcome-task-1',
        title: 'Deep focus sprint: ship core feature',
        estimatedPomodoros: 3,
        completedPomodoros: 0,
        done: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'welcome-task-2',
        title: 'Inbox zero & code review pass',
        estimatedPomodoros: 1,
        completedPomodoros: 0,
        done: false,
        createdAt: new Date().toISOString(),
      },
    ],
    activeTaskId: 'welcome-task-1',
    history: [],
  };
}

const VALID_THEMES: readonly ThemeId[] = ['amoled', 'cyber', 'midnight', 'matcha', 'sunset'];
const VALID_PRESETS: readonly PresetId[] = ['classic', 'deepWork', 'sprint', 'custom'];
const VALID_BANDS: readonly BinauralBand[] = ['alpha', 'beta', 'gamma'];
const VALID_PHASES: readonly Phase[] = ['focus', 'shortBreak', 'longBreak'];
const VALID_LAYERS: readonly SoundLayerId[] = ['rain', 'vinyl', 'space', 'brown', 'binaural'];
const VALID_FEATURES: readonly FeatureId[] = ['tasks', 'soundscape', 'timeline', 'dailyGoal'];

function clampNumber(val: unknown, fallback: number, min: number, max: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.min(max, Math.max(min, val));
}

function asBool(val: unknown, fallback: boolean): boolean {
  return typeof val === 'boolean' ? val : fallback;
}

export function sanitizeAppData(raw: unknown): AppData {
  const defaults = createDefaultAppData();
  if (!raw || typeof raw !== 'object') return defaults;

  const obj = raw as Record<string, unknown>;

  const theme = VALID_THEMES.includes(obj['theme'] as ThemeId)
    ? (obj['theme'] as ThemeId)
    : defaults.theme;

  const rawSettings = (obj['settings'] && typeof obj['settings'] === 'object'
    ? obj['settings']
    : {}) as Record<string, unknown>;

  const settings: TimerSettings = {
    focusMinutes: Math.round(clampNumber(rawSettings['focusMinutes'], defaults.settings.focusMinutes, 1, 180)),
    shortBreakMinutes: Math.round(clampNumber(rawSettings['shortBreakMinutes'], defaults.settings.shortBreakMinutes, 1, 60)),
    longBreakMinutes: Math.round(clampNumber(rawSettings['longBreakMinutes'], defaults.settings.longBreakMinutes, 1, 90)),
    longBreakInterval: Math.round(clampNumber(rawSettings['longBreakInterval'], defaults.settings.longBreakInterval, 2, 10)),
    autoStartBreaks: asBool(rawSettings['autoStartBreaks'], defaults.settings.autoStartBreaks),
    autoStartFocus: asBool(rawSettings['autoStartFocus'], defaults.settings.autoStartFocus),
    flowOvertime: asBool(rawSettings['flowOvertime'], defaults.settings.flowOvertime),
    dailyGoal: Math.round(clampNumber(rawSettings['dailyGoal'], defaults.settings.dailyGoal, 1, 24)),
    tickSound: asBool(rawSettings['tickSound'], defaults.settings.tickSound),
    chimeVolume: clampNumber(rawSettings['chimeVolume'], defaults.settings.chimeVolume, 0, 1),
    desktopNotifications: asBool(rawSettings['desktopNotifications'], defaults.settings.desktopNotifications),
    preset: VALID_PRESETS.includes(rawSettings['preset'] as PresetId)
      ? (rawSettings['preset'] as PresetId)
      : defaults.settings.preset,
  };

  const rawAudio = (obj['audio'] && typeof obj['audio'] === 'object'
    ? obj['audio']
    : {}) as Record<string, unknown>;
  const rawLayers = (rawAudio['layers'] && typeof rawAudio['layers'] === 'object'
    ? rawAudio['layers']
    : {}) as Record<string, unknown>;

  const layers = { ...defaults.audio.layers };
  for (const key of VALID_LAYERS) {
    layers[key] = clampNumber(rawLayers[key], 0, 0, 1);
  }

  const audio: AudioMixerState = {
    muted: asBool(rawAudio['muted'], defaults.audio.muted),
    masterVolume: clampNumber(rawAudio['masterVolume'], defaults.audio.masterVolume, 0, 1),
    layers,
    binauralBand: VALID_BANDS.includes(rawAudio['binauralBand'] as BinauralBand)
      ? (rawAudio['binauralBand'] as BinauralBand)
      : defaults.audio.binauralBand,
  };

  const rawUi = (obj['ui'] && typeof obj['ui'] === 'object' ? obj['ui'] : {}) as Record<string, unknown>;
  const rawFeatures = (rawUi['features'] && typeof rawUi['features'] === 'object'
    ? rawUi['features']
    : {}) as Record<string, unknown>;

  const features = { ...defaults.ui.features };
  for (const key of VALID_FEATURES) {
    features[key] = asBool(rawFeatures[key], defaults.ui.features[key]);
  }

  const ui: UiPreferences = {
    features,
    flatDesign: asBool(rawUi['flatDesign'], defaults.ui.flatDesign),
  };

  const tasks: TaskItem[] = Array.isArray(obj['tasks'])
    ? obj['tasks']
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          id: typeof item['id'] === 'string' && item['id'] ? item['id'] : crypto.randomUUID(),
          title: typeof item['title'] === 'string' && item['title'].trim() ? item['title'].trim() : 'Untitled task',
          estimatedPomodoros: Math.round(clampNumber(item['estimatedPomodoros'], 1, 1, 20)),
          completedPomodoros: Math.round(clampNumber(item['completedPomodoros'], 0, 0, 500)),
          done: asBool(item['done'], false),
          createdAt: typeof item['createdAt'] === 'string' ? item['createdAt'] : new Date().toISOString(),
        }))
    : defaults.tasks;

  const rawActiveId = typeof obj['activeTaskId'] === 'string' ? obj['activeTaskId'] : null;
  const activeTaskId = tasks.some((t) => t.id === rawActiveId) ? rawActiveId : null;

  const history: SessionRecord[] = Array.isArray(obj['history'])
    ? obj['history']
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          id: typeof item['id'] === 'string' && item['id'] ? item['id'] : crypto.randomUUID(),
          phase: VALID_PHASES.includes(item['phase'] as Phase) ? (item['phase'] as Phase) : 'focus',
          plannedMinutes: clampNumber(item['plannedMinutes'], 25, 0, 300),
          actualMinutes: clampNumber(item['actualMinutes'], 25, 0, 600),
          overtimeMinutes: clampNumber(item['overtimeMinutes'], 0, 0, 300),
          completedAt: typeof item['completedAt'] === 'string' ? item['completedAt'] : new Date().toISOString(),
          dateKey: typeof item['dateKey'] === 'string' ? item['dateKey'] : new Date().toISOString().slice(0, 10),
          taskId: typeof item['taskId'] === 'string' ? item['taskId'] : null,
          taskTitle: typeof item['taskTitle'] === 'string' ? item['taskTitle'] : null,
        }))
        .slice(-2000)
    : [];

  return {
    version: 1,
    theme,
    settings,
    audio,
    ui,
    tasks,
    activeTaskId,
    history,
  };
}

export function loadAppData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultAppData();
    return sanitizeAppData(JSON.parse(raw));
  } catch {
    return createDefaultAppData();
  }
}

export function saveAppData(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota / privacy mode storage errors gracefully
  }
}
