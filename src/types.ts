export type Phase = 'focus' | 'shortBreak' | 'longBreak';

export type TimerStatus = 'idle' | 'running' | 'paused' | 'overtime';

export type PresetId = 'classic' | 'deepWork' | 'sprint' | 'custom';

export type ThemeId = 'cyber' | 'midnight' | 'matcha' | 'sunset';

export type SoundLayerId = 'rain' | 'vinyl' | 'space' | 'brown' | 'binaural';

export type BinauralBand = 'alpha' | 'beta' | 'gamma';

export interface TimerSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  flowOvertime: boolean;
  dailyGoal: number;
  tickSound: boolean;
  chimeVolume: number;
  desktopNotifications: boolean;
  preset: PresetId;
}

export interface PresetConfig {
  id: Exclude<PresetId, 'custom'>;
  label: string;
  tagline: string;
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
}

export interface TaskItem {
  id: string;
  title: string;
  estimatedPomodoros: number;
  completedPomodoros: number;
  done: boolean;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  phase: Phase;
  plannedMinutes: number;
  actualMinutes: number;
  overtimeMinutes: number;
  completedAt: string;
  dateKey: string;
  taskId: string | null;
  taskTitle: string | null;
}

export interface AudioMixerState {
  muted: boolean;
  masterVolume: number;
  layers: Record<SoundLayerId, number>;
  binauralBand: BinauralBand;
}

export interface AppData {
  version: number;
  theme: ThemeId;
  settings: TimerSettings;
  audio: AudioMixerState;
  tasks: TaskItem[];
  activeTaskId: string | null;
  history: SessionRecord[];
}

export interface TimerSnapshot {
  phase: Phase;
  status: TimerStatus;
  remainingMs: number;
  totalMs: number;
  overtimeMs: number;
  progress: number;
  completedFocusInCycle: number;
  longBreakInterval: number;
  totalFocusCompleted: number;
}

export interface PhaseCompletionEvent {
  completedPhase: Phase;
  nextPhase: Phase;
  plannedMinutes: number;
  actualMinutes: number;
  overtimeMinutes: number;
  autoStartedNext: boolean;
}
