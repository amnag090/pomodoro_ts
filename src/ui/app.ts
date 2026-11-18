import { SoundEngine } from '../audio/soundEngine.js';
import { computeAnalytics, toLocalDateKey } from '../core/stats.js';
import {
  DEFAULT_SETTINGS,
  loadAppData,
  sanitizeAppData,
  saveAppData,
} from '../core/storage.js';
import {
  addTask,
  clearCompletedTasks,
  deleteTask,
  incrementTaskPomodoro,
  moveTask,
  toggleTaskDone,
} from '../core/tasks.js';
import {
  PRESETS,
  PomodoroEngine,
  formatCountdown,
  formatOvertime,
  getPhaseLabel,
} from '../core/timer.js';
import type {
  AppData,
  AudioMixerState,
  BinauralBand,
  FeatureId,
  Phase,
  PresetId,
  SessionRecord,
  SoundLayerId,
  ThemeId,
  TimerSnapshot,
} from '../types.js';
import { updateDocumentTitleAndFavicon } from './favicon.js';
import { renderHeatmapSvg, renderHourlyChartSvg } from './heatmap.js';
import { NotificationService } from './notifications.js';
import { ParticleBackdrop } from './particles.js';
import { THEMES, applyTheme, getPhaseAccent } from './themes.js';

interface SoundLayerMeta {
  id: SoundLayerId;
  name: string;
  subtitle: string;
  icon: string;
}

const SOUND_LAYERS: readonly SoundLayerMeta[] = [
  { id: 'rain', name: 'Warm Rain', subtitle: 'Soft atmospheric rainfall', icon: '🌧' },
  { id: 'vinyl', name: 'Lo-Fi Vinyl', subtitle: 'Cozy needle crackle', icon: '💿' },
  { id: 'space', name: 'Deep Space', subtitle: 'Evolving harmonic pad', icon: '🌌' },
  { id: 'brown', name: 'Brown Noise', subtitle: 'Deep distraction mask', icon: '🌊' },
  { id: 'binaural', name: 'Binaural Focus', subtitle: 'Stereo brainwave entrainment', icon: '🧠' },
];

interface FeatureMeta {
  id: FeatureId;
  name: string;
  description: string;
}

/** Optional panels, switched on from the side drawer. Everything starts off (zen by default). */
const FEATURES: readonly FeatureMeta[] = [
  { id: 'tasks', name: 'Task queue', description: 'Plan tasks and log focus sessions against them' },
  { id: 'soundscape', name: 'Soundscape', description: 'Rain, vinyl, space, brown noise and binaural layers' },
  { id: 'timeline', name: 'Today’s timeline', description: 'The focus blocks you’ve completed today' },
  { id: 'dailyGoal', name: 'Daily goal', description: 'Progress toward your daily Pomodoro target' },
];

const SILENT_LAYERS: Record<SoundLayerId, number> = { rain: 0, vinyl: 0, space: 0, brown: 0, binaural: 0 };

const RING_RADIUS = 132;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export class PomodoroApp {
  private readonly root: HTMLElement;
  private data: AppData;
  private engine: PomodoroEngine;
  private sound: SoundEngine;
  private notifications!: NotificationService;
  private particles!: ParticleBackdrop;
  private tickIntervalId: number | null = null;
  private zenMode = false;
  private drawerOpen = false;
  private activeModal: 'analytics' | 'settings' | 'shortcuts' | null = null;
  private pipWindow: Window | null = null;
  private miniFloatingVisible = false;

  // Cached DOM refs for smooth tick updates
  private timerStageEl!: HTMLElement;
  private phaseLabelEl!: HTMLElement;
  private countdownEl!: HTMLElement;
  private overtimeBadgeEl!: HTMLElement;
  private progressRingEl!: SVGCircleElement;
  private haloGlowEl!: SVGCircleElement;
  private primaryBtnEl!: HTMLButtonElement;
  private primaryBtnLabelEl!: HTMLElement;
  private cycleDotsEl!: HTMLElement;
  private activeTaskBannerEl!: HTMLElement;
  private dailyGoalEl!: HTMLElement;
  private taskListEl!: HTMLElement;
  private historyListEl!: HTMLElement;
  private audioStatusEl!: HTMLElement;
  private muteBtnEl!: HTMLButtonElement;
  private modalHostEl!: HTMLElement;
  private miniWidgetEl!: HTMLElement;
  private miniWidgetTimeEl!: HTMLElement;
  private miniWidgetPhaseEl!: HTMLElement;
  private miniWidgetBtnEl!: HTMLButtonElement;
  private appShellEl!: HTMLElement;
  private sidePanelsEl!: HTMLElement;
  private menuBtnEl!: HTMLButtonElement;
  private drawerEl!: HTMLElement;
  private drawerBackdropEl!: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.data = loadAppData();
    this.sound = new SoundEngine(this.engineAudio(), this.data.settings.chimeVolume);
    this.engine = new PomodoroEngine(this.data.settings, {
      onTick: (snap) => this.handleTick(snap),
      onSecondBoundary: (remainingSeconds) => {
        if (this.data.settings.tickSound && this.engine.getSnapshot().phase === 'focus') {
          this.sound.playTick(remainingSeconds % 2 === 0);
        }
      },
      onOvertimeStart: (snap) => {
        this.sound.playChime('overtimeStart');
        this.notifications.toast(
          'Planned focus reached — Flow Overtime active',
          'Keep riding the wave or press Finish & Break when ready.',
          'info',
        );
        this.notifications.sendDesktopNotification(
          this.data.settings.desktopNotifications,
          'Focus time complete — Flow Overtime',
          'Keep going or wrap up for your break.',
        );
        this.particles.celebrate();
        this.handleTick(snap);
      },
      onPhaseComplete: (event, snap) => {
        this.handlePhaseComplete(event, snap);
      },
    });
  }

  mount(): void {
    applyTheme(this.data.theme);
    this.renderShell();
    this.bindEvents();
    this.particles.setTheme(this.data.theme);
    this.applyFeatureLayout();
    this.applyFlatDesign();

    const snap = this.engine.getSnapshot();
    this.handleTick(snap);
    this.renderTasks();
    this.renderHistory();
    this.renderDailyGoal();
    this.syncAudioUi();

    this.tickIntervalId = window.setInterval(() => {
      this.engine.tick();
    }, 200);
  }

  destroy(): void {
    if (this.tickIntervalId !== null) {
      clearInterval(this.tickIntervalId);
    }
    this.particles.stop();
    this.sound.dispose();
    if (this.pipWindow && !this.pipWindow.closed) {
      this.pipWindow.close();
    }
  }

  private renderShell(): void {
    const tickMarks = Array.from({ length: 60 }, (_, idx) => {
      const angle = idx * 6;
      const isMajor = idx % 5 === 0;
      const y1 = isMajor ? 14 : 18;
      const y2 = 24;
      return `<line x1="160" y1="${y1}" x2="160" y2="${y2}" transform="rotate(${angle} 160 160)" class="ring-tick ${isMajor ? 'is-major' : ''}" />`;
    }).join('');

    const themeButtons = (Object.keys(THEMES) as ThemeId[])
      .map((id) => {
        const t = THEMES[id];
        const active = id === this.data.theme ? 'is-active' : '';
        return `
          <button
            type="button"
            class="theme-swatch ${active}"
            data-theme-pick="${t.id}"
            title="${t.label}"
            aria-label="Theme: ${t.label}"
            style="--swatch-color: ${t.swatch}"
          ></button>
        `;
      })
      .join('');

    const presetButtons = [
      ...PRESETS.map(
        (p) => `
          <button
            type="button"
            class="preset-chip ${this.data.settings.preset === p.id ? 'is-active' : ''}"
            data-preset="${p.id}"
            title="${p.tagline}"
          >${p.label}</button>
        `,
      ),
      `<button type="button" class="preset-chip ${this.data.settings.preset === 'custom' ? 'is-active' : ''}" data-preset="custom" title="Edit custom intervals">Custom</button>`,
    ].join('');

    const soundSliders = SOUND_LAYERS.map((layer) => {
      const val = Math.round((this.data.audio.layers[layer.id] ?? 0) * 100);
      return `
        <div class="sound-row ${val > 0 ? 'is-active' : ''}" data-sound-row="${layer.id}">
          <div class="sound-row__info">
            <span class="sound-row__icon" aria-hidden="true">${layer.icon}</span>
            <div>
              <div class="sound-row__name">${layer.name}</div>
              <div class="sound-row__sub">${layer.subtitle}</div>
            </div>
          </div>
          <div class="sound-row__control">
            <input
              type="range"
              min="0"
              max="100"
              value="${val}"
              class="slider"
              data-sound-slider="${layer.id}"
              aria-label="${layer.name} volume"
            />
            <span class="sound-row__pct" data-sound-pct="${layer.id}">${val}%</span>
          </div>
        </div>
      `;
    }).join('');

    const switchRow = (name: string, description: string, attrs: string, checked: boolean) => `
      <label class="switch-row">
        <span class="switch-row__text">
          <span class="switch-row__name">${name}</span>
          <span class="switch-row__desc">${description}</span>
        </span>
        <input type="checkbox" class="switch" role="switch" ${attrs} ${checked ? 'checked' : ''} />
      </label>
    `;

    const featureSwitches = FEATURES.map((f) =>
      switchRow(f.name, f.description, `data-feature-toggle="${f.id}"`, this.data.ui.features[f.id]),
    ).join('');

    const flatSwitch = switchRow(
      'Flat design',
      'Solid surfaces: no shadows, glows, blur or particles',
      'id="toggle-flat"',
      this.data.ui.flatDesign,
    );

    this.root.innerHTML = `
      <canvas class="particle-canvas" id="particle-canvas" aria-hidden="true"></canvas>
      <div class="ambient-aurora" aria-hidden="true"></div>

      <div class="app-shell">
        <header class="topbar">
          <div class="brand">
            <span class="brand__dot"></span>
            <span class="brand__name">CHRONOS</span>
            <span class="brand__tag">POMODORO STUDIO</span>
          </div>

          <div class="topbar__actions">
            <button
              type="button"
              class="icon-btn menu-btn"
              id="btn-menu"
              aria-controls="side-drawer"
              aria-expanded="false"
              title="Features, theme & settings"
            >
              <span aria-hidden="true">☰</span>
              <span>Menu</span>
            </button>
          </div>
        </header>

        <main class="workspace">
          <section class="hero-card" id="timer-stage" data-phase="focus" data-status="idle">
            <div class="hero-card__top">
              <div class="phase-tabs" role="tablist" aria-label="Timer Mode">
                <button type="button" class="phase-tab is-active" data-phase-btn="focus">Focus</button>
                <button type="button" class="phase-tab" data-phase-btn="shortBreak">Short Break</button>
                <button type="button" class="phase-tab" data-phase-btn="longBreak">Long Break</button>
              </div>
              <div class="preset-row" aria-label="Cadence presets">
                ${presetButtons}
              </div>
            </div>

            <div class="ring-container">
              <svg class="timer-ring" viewBox="0 0 320 320" aria-hidden="true">
                <defs>
                  <filter id="ring-glow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="6" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <g class="ring-ticks">${tickMarks}</g>
                <circle class="ring-track" cx="160" cy="160" r="${RING_RADIUS}" />
                <circle
                  class="ring-glow"
                  id="ring-halo-glow"
                  cx="160"
                  cy="160"
                  r="${RING_RADIUS}"
                  stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(2)}"
                  stroke-dashoffset="0"
                />
                <circle
                  class="ring-progress"
                  id="ring-progress"
                  cx="160"
                  cy="160"
                  r="${RING_RADIUS}"
                  stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(2)}"
                  stroke-dashoffset="0"
                />
              </svg>

              <div class="ring-center">
                <div class="phase-pill" id="phase-label">FOCUS</div>
                <div class="countdown" id="countdown-display">25:00</div>
                <div class="overtime-badge" id="overtime-badge" hidden>+00:00 FLOW</div>
                <div class="cycle-dots" id="cycle-dots" aria-label="Pomodoro cycle progress"></div>
              </div>
            </div>

            <div class="active-task-banner" id="active-task-banner" data-feature="tasks"></div>

            <div class="controls-bar">
              <button type="button" class="ctrl-btn ctrl-btn--ghost" id="btn-reset" title="Reset (R)">
                ↺ Reset
              </button>
              <button type="button" class="ctrl-btn ctrl-btn--primary" id="btn-primary" title="Start / Pause (Space)">
                <span id="primary-btn-label">Start Focus</span>
              </button>
              <button type="button" class="ctrl-btn ctrl-btn--ghost" id="btn-skip" title="Skip phase (S)">
                Skip ⏭
              </button>
            </div>

            <div class="quick-tools">
              <button type="button" class="mini-pill" data-extend="60">+1 min</button>
              <button type="button" class="mini-pill" data-extend="300">+5 min</button>
              <button type="button" class="mini-pill ${this.data.settings.flowOvertime ? 'is-on' : ''}" id="btn-toggle-flow" title="Keep counting in flow state after timer ends">
                ⚡ Flow Overtime: ${this.data.settings.flowOvertime ? 'ON' : 'OFF'}
              </button>
              <button type="button" class="mini-pill ${this.data.settings.tickSound ? 'is-on' : ''}" id="btn-toggle-tick" title="Clock tick each second during focus sessions">
                🕰 Tick: ${this.data.settings.tickSound ? 'ON' : 'OFF'}
              </button>
            </div>

            <div class="daily-goal" id="daily-goal" data-feature="dailyGoal"></div>
          </section>

          <aside class="side-panels" id="side-panels">
            <section class="panel-card" data-feature="tasks">
              <div class="panel-card__header">
                <div>
                  <h2>Focus Queue</h2>
                  <p class="panel-sub">Select a target to attach to your focus blocks</p>
                </div>
                <button type="button" class="text-btn" id="btn-clear-done">Clear done</button>
              </div>

              <form class="task-form" id="task-form">
                <input
                  type="text"
                  id="task-title-input"
                  class="text-input"
                  placeholder="What are you shipping next?"
                  maxlength="90"
                  required
                />
                <label class="est-picker" title="Estimated Pomodoros">
                  <span>🍅</span>
                  <input
                    type="number"
                    id="task-est-input"
                    min="1"
                    max="12"
                    value="2"
                  />
                </label>
                <button type="submit" class="add-btn">Add</button>
              </form>

              <ul class="task-list" id="task-list"></ul>
            </section>

            <section class="panel-card" data-feature="soundscape">
              <div class="panel-card__header">
                <div>
                  <h2>Soundscape Studio</h2>
                  <p class="panel-sub" id="audio-status">Zero-dependency Web Audio synth</p>
                </div>
                <button type="button" class="text-btn" id="btn-test-chime">Test Chime</button>
              </div>

              <div class="master-audio-row">
                <span>Master Mix</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value="${Math.round(this.data.audio.masterVolume * 100)}"
                  class="slider"
                  id="master-volume-slider"
                  aria-label="Master ambient volume"
                />
                <div class="binaural-bands" role="group" aria-label="Binaural band">
                  ${(['alpha', 'beta', 'gamma'] as BinauralBand[])
                    .map(
                      (band) => `
                        <button
                          type="button"
                          class="band-btn ${this.data.audio.binauralBand === band ? 'is-active' : ''}"
                          data-band="${band}"
                          title="${band === 'alpha' ? '10 Hz Alpha (Calm Focus)' : band === 'beta' ? '14 Hz Beta (Alert)' : '40 Hz Gamma (Peak Cognition)'}"
                        >${band === 'alpha' ? '10Hz α' : band === 'beta' ? '14Hz β' : '40Hz γ'}</button>
                      `,
                    )
                    .join('')}
                </div>
              </div>

              <div class="sound-list">
                ${soundSliders}
              </div>
            </section>

            <section class="panel-card" data-feature="timeline">
              <div class="panel-card__header">
                <div>
                  <h2>Today’s Timeline</h2>
                  <p class="panel-sub">Recent completed blocks</p>
                </div>
                <button type="button" class="text-btn" id="btn-open-stats-inline">Full Heatmap →</button>
              </div>
              <ul class="history-list" id="history-list"></ul>
            </section>
          </aside>
        </main>
      </div>

      <div class="drawer-backdrop" id="drawer-backdrop"></div>
      <aside
        class="side-drawer"
        id="side-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        inert
      >
        <div class="side-drawer__header">
          <h2 id="drawer-title">Customize</h2>
          <button type="button" class="drawer-close" id="btn-drawer-close" aria-label="Close menu">✕</button>
        </div>

        <section class="drawer-section" aria-labelledby="drawer-features-title">
          <h3 class="drawer-section__title" id="drawer-features-title">Features</h3>
          <p class="drawer-section__hint">Switch on what you need. The timer stays front and center.</p>
          ${featureSwitches}
        </section>

        <section class="drawer-section" aria-labelledby="drawer-look-title">
          <h3 class="drawer-section__title" id="drawer-look-title">Appearance</h3>
          <div class="drawer-row">
            <span class="switch-row__name">Theme</span>
            <div class="theme-picker" role="group" aria-label="Color theme">
              ${themeButtons}
            </div>
          </div>
          ${flatSwitch}
        </section>

        <section class="drawer-section" aria-labelledby="drawer-tools-title">
          <h3 class="drawer-section__title" id="drawer-tools-title">Tools</h3>
          <div class="drawer-tools">
            <button type="button" class="icon-btn" id="btn-analytics" title="Analytics & 12-week heatmap">📊 Stats</button>
            <button type="button" class="icon-btn" id="btn-settings" title="Timer settings">⚙ Settings</button>
            <button type="button" class="icon-btn" id="btn-zen" title="Hide everything but the timer (Z)">✦ Zen mode</button>
            <button type="button" class="icon-btn" id="btn-pip" title="Mini floating timer (P)">⧉ Mini timer</button>
            <button type="button" class="icon-btn" id="btn-mute" title="Mute / unmute all audio (M)">🔊 Mute</button>
            <button type="button" class="icon-btn" id="btn-shortcuts" title="Keyboard shortcuts (?)">⌨ Shortcuts</button>
          </div>
        </section>
      </aside>

      <button type="button" class="zen-exit-btn" id="btn-exit-zen" hidden>
        ✕ Exit Zen (Z)
      </button>

      <div class="mini-floating" id="mini-floating" hidden>
        <div class="mini-floating__meta">
          <span class="mini-floating__phase" id="mini-phase">FOCUS</span>
          <button type="button" class="mini-floating__close" id="mini-close" title="Close mini timer">✕</button>
        </div>
        <div class="mini-floating__time" id="mini-time">25:00</div>
        <div class="mini-floating__actions">
          <button type="button" class="mini-pill" id="mini-toggle">Start</button>
          <button type="button" class="mini-pill" id="mini-skip">Skip</button>
        </div>
      </div>

      <div class="modal-backdrop" id="modal-host" hidden></div>
      <div class="toast-stack" id="toast-stack" aria-live="polite"></div>
    `;

    this.timerStageEl = this.q('#timer-stage');
    this.phaseLabelEl = this.q('#phase-label');
    this.countdownEl = this.q('#countdown-display');
    this.overtimeBadgeEl = this.q('#overtime-badge');
    this.progressRingEl = this.q<SVGCircleElement>('#ring-progress');
    this.haloGlowEl = this.q<SVGCircleElement>('#ring-halo-glow');
    this.primaryBtnEl = this.q<HTMLButtonElement>('#btn-primary');
    this.primaryBtnLabelEl = this.q('#primary-btn-label');
    this.cycleDotsEl = this.q('#cycle-dots');
    this.activeTaskBannerEl = this.q('#active-task-banner');
    this.dailyGoalEl = this.q('#daily-goal');
    this.taskListEl = this.q('#task-list');
    this.historyListEl = this.q('#history-list');
    this.audioStatusEl = this.q('#audio-status');
    this.muteBtnEl = this.q<HTMLButtonElement>('#btn-mute');
    this.modalHostEl = this.q('#modal-host');
    this.miniWidgetEl = this.q('#mini-floating');
    this.miniWidgetTimeEl = this.q('#mini-time');
    this.miniWidgetPhaseEl = this.q('#mini-phase');
    this.miniWidgetBtnEl = this.q<HTMLButtonElement>('#mini-toggle');
    this.appShellEl = this.q('.app-shell');
    this.sidePanelsEl = this.q('#side-panels');
    this.menuBtnEl = this.q<HTMLButtonElement>('#btn-menu');
    this.drawerEl = this.q('#side-drawer');
    this.drawerBackdropEl = this.q('#drawer-backdrop');

    this.notifications = new NotificationService(this.q('#toast-stack'));
    this.particles = new ParticleBackdrop(this.q<HTMLCanvasElement>('#particle-canvas'));
  }

  private q<T extends Element = HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) {
      throw new Error(`Missing element: ${selector}`);
    }
    return el;
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.particles.resize());

    // Theme switching
    this.root.querySelectorAll<HTMLButtonElement>('[data-theme-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const themeId = btn.dataset['themePick'] as ThemeId | undefined;
        if (!themeId) return;
        this.setTheme(themeId);
      });
    });

    // Side drawer: open/close
    this.menuBtnEl.addEventListener('click', () => this.setDrawerOpen(!this.drawerOpen));
    this.q('#btn-drawer-close').addEventListener('click', () => this.setDrawerOpen(false));
    this.drawerBackdropEl.addEventListener('click', () => this.setDrawerOpen(false));

    // Feature switches
    this.root.querySelectorAll<HTMLInputElement>('[data-feature-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = input.dataset['featureToggle'] as FeatureId | undefined;
        if (!id) return;
        this.data.ui.features[id] = input.checked;
        this.persist();
        this.applyFeatureLayout();
        if (id === 'soundscape') {
          // Off silences the ambient layers; on brings the saved mix back.
          this.sound.syncMixerState(this.engineAudio(), input.checked);
          this.syncAudioUi();
        }
      });
    });

    // Flat design switch
    this.q<HTMLInputElement>('#toggle-flat').addEventListener('change', (e) => {
      this.data.ui.flatDesign = (e.currentTarget as HTMLInputElement).checked;
      this.persist();
      this.applyFlatDesign();
    });

    // Phase tabs
    this.root.querySelectorAll<HTMLButtonElement>('[data-phase-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const phase = btn.dataset['phaseBtn'] as Phase | undefined;
        if (!phase) return;
        this.sound.playUiClick();
        this.engine.switchPhase(phase);
      });
    });

    // Presets
    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const presetId = btn.dataset['preset'] as PresetId | undefined;
        if (!presetId) return;
        if (presetId === 'custom') {
          this.openModal('settings');
          return;
        }
        const preset = PRESETS.find((p) => p.id === presetId);
        if (!preset) return;
        this.data.settings = {
          ...this.data.settings,
          preset: preset.id,
          focusMinutes: preset.focusMinutes,
          shortBreakMinutes: preset.shortBreakMinutes,
          longBreakMinutes: preset.longBreakMinutes,
          longBreakInterval: preset.longBreakInterval,
        };
        this.persist();
        this.engine.updateSettings(this.data.settings);
        this.syncPresetButtons();
        this.sound.playUiClick();
        this.notifications.toast(`Preset: ${preset.label}`, preset.tagline, 'info');
      });
    });

    // Primary timer controls
    this.primaryBtnEl.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      this.engine.toggle();
    });

    this.q('#btn-reset').addEventListener('click', () => {
      this.sound.playUiClick();
      this.engine.reset();
    });

    this.q('#btn-skip').addEventListener('click', () => {
      this.sound.playUiClick();
      this.engine.skip();
    });

    // Extend buttons
    this.root.querySelectorAll<HTMLButtonElement>('[data-extend]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const secs = Number(btn.dataset['extend'] ?? '60');
        this.sound.playUiClick();
        this.engine.extendSeconds(secs);
      });
    });

    // Flow overtime toggle
    const flowBtn = this.q('#btn-toggle-flow');
    flowBtn.addEventListener('click', () => {
      this.data.settings.flowOvertime = !this.data.settings.flowOvertime;
      this.persist();
      this.engine.updateSettings(this.data.settings);
      flowBtn.classList.toggle('is-on', this.data.settings.flowOvertime);
      flowBtn.textContent = `⚡ Flow Overtime: ${this.data.settings.flowOvertime ? 'ON' : 'OFF'}`;
      this.sound.playUiClick();
    });

    // Tick toggle
    const tickBtn = this.q('#btn-toggle-tick');
    tickBtn.addEventListener('click', () => {
      this.data.settings.tickSound = !this.data.settings.tickSound;
      this.persist();
      tickBtn.classList.toggle('is-on', this.data.settings.tickSound);
      tickBtn.textContent = `🕰 Tick: ${this.data.settings.tickSound ? 'ON' : 'OFF'}`;
      if (!this.data.settings.tickSound) {
        this.sound.playUiClick();
        return;
      }
      // Play a sample right away so it's obvious the tick works.
      this.sound.playTick();
      const snap = this.engine.getSnapshot();
      if (snap.phase !== 'focus' || snap.status !== 'running') {
        this.notifications.toast('Tick on', 'You’ll hear it each second while a focus session is running.', 'info');
      }
    });

    // Tasks
    const taskForm = this.q<HTMLFormElement>('#task-form');
    taskForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const titleInput = this.q<HTMLInputElement>('#task-title-input');
      const estInput = this.q<HTMLInputElement>('#task-est-input');
      const title = titleInput.value.trim();
      if (!title) return;
      const est = Number(estInput.value || '1');
      const result = addTask(this.data.tasks, this.data.activeTaskId, title, est);
      this.data.tasks = result.tasks;
      this.data.activeTaskId = result.activeTaskId;
      this.persist();
      titleInput.value = '';
      this.renderTasks();
      this.renderActiveTaskBanner();
      this.sound.playUiClick();
    });

    this.q('#btn-clear-done').addEventListener('click', () => {
      const res = clearCompletedTasks(this.data.tasks, this.data.activeTaskId);
      this.data.tasks = res.tasks;
      this.data.activeTaskId = res.activeTaskId;
      this.persist();
      this.renderTasks();
      this.renderActiveTaskBanner();
    });

    // Audio mixer
    this.muteBtnEl.addEventListener('click', () => this.toggleMute());

    this.q<HTMLInputElement>('#master-volume-slider').addEventListener('input', (e) => {
      const val = Number((e.currentTarget as HTMLInputElement).value) / 100;
      this.data.audio.masterVolume = val;
      this.data.audio.muted = false;
      this.persist();
      this.sound.syncMixerState(this.engineAudio(), true);
      this.syncAudioUi();
    });

    this.root.querySelectorAll<HTMLInputElement>('[data-sound-slider]').forEach((slider) => {
      slider.addEventListener('input', () => {
        const layerId = slider.dataset['soundSlider'] as SoundLayerId | undefined;
        if (!layerId) return;
        const pct = Number(slider.value);
        this.data.audio.layers[layerId] = pct / 100;
        if (pct > 0 && this.data.audio.muted) {
          this.data.audio.muted = false;
        }
        this.persist();
        this.sound.syncMixerState(this.engineAudio(), true);
        this.syncAudioUi();
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-band]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const band = btn.dataset['band'] as BinauralBand | undefined;
        if (!band) return;
        this.data.audio.binauralBand = band;
        this.persist();
        this.sound.syncMixerState(this.engineAudio(), false);
        this.root.querySelectorAll('[data-band]').forEach((b) =>
          b.classList.toggle('is-active', b === btn),
        );
        this.sound.playUiClick();
      });
    });

    this.q('#btn-test-chime').addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playChime('focusComplete');
    });

    // Topbar modals & modes
    this.q('#btn-analytics').addEventListener('click', () => this.openModal('analytics'));
    this.q('#btn-open-stats-inline').addEventListener('click', () => this.openModal('analytics'));
    this.q('#btn-settings').addEventListener('click', () => this.openModal('settings'));
    this.q('#btn-shortcuts').addEventListener('click', () => this.openModal('shortcuts'));
    this.q('#btn-zen').addEventListener('click', () => this.toggleZenMode());
    this.q('#btn-exit-zen').addEventListener('click', () => this.toggleZenMode(false));
    this.q('#btn-pip').addEventListener('click', () => void this.togglePip());

    // Mini floating widget controls
    this.q('#mini-close').addEventListener('click', () => {
      this.miniFloatingVisible = false;
      this.miniWidgetEl.hidden = true;
    });
    this.miniWidgetBtnEl.addEventListener('click', () => {
      this.sound.unlock();
      this.engine.toggle();
    });
    this.q('#mini-skip').addEventListener('click', () => {
      this.engine.skip();
    });

    // Modal backdrop close
    this.modalHostEl.addEventListener('click', (e) => {
      if (e.target === this.modalHostEl) {
        this.closeModal();
      }
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        if (this.activeModal) {
          this.closeModal();
          return;
        }
        if (this.drawerOpen) {
          this.setDrawerOpen(false);
          return;
        }
        if (this.zenMode) {
          this.toggleZenMode(false);
          return;
        }
      }

      if (isTyping) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.sound.unlock();
        this.engine.toggle();
      } else if (e.key === 'r' || e.key === 'R') {
        this.engine.reset();
      } else if (e.key === 's' || e.key === 'S') {
        this.engine.skip();
      } else if (e.key === '1') {
        this.engine.switchPhase('focus');
      } else if (e.key === '2') {
        this.engine.switchPhase('shortBreak');
      } else if (e.key === '3') {
        this.engine.switchPhase('longBreak');
      } else if (e.key === 'm' || e.key === 'M') {
        this.toggleMute();
      } else if (e.key === 'z' || e.key === 'Z') {
        this.toggleZenMode();
      } else if (e.key === 'p' || e.key === 'P') {
        void this.togglePip();
      } else if (e.key === '?') {
        this.openModal(this.activeModal === 'shortcuts' ? null : 'shortcuts');
      }
    });
  }

  private setTheme(themeId: ThemeId): void {
    this.data.theme = themeId;
    applyTheme(themeId);
    this.particles.setTheme(themeId);
    this.persist();

    this.root.querySelectorAll<HTMLButtonElement>('[data-theme-pick]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset['themePick'] === themeId);
    });

    updateDocumentTitleAndFavicon(this.engine.getSnapshot(), this.data.theme);
  }

  private toggleMute(): void {
    this.data.audio.muted = !this.data.audio.muted;
    this.persist();
    this.sound.syncMixerState(this.engineAudio(), true);
    this.syncAudioUi();
  }

  private toggleZenMode(force?: boolean): void {
    this.setDrawerOpen(false);
    this.zenMode = force ?? !this.zenMode;
    document.body.classList.toggle('is-zen', this.zenMode);
    this.q('#btn-exit-zen').hidden = !this.zenMode;
  }

  /** The mixer state the sound engine should play: ambient layers stay silent while Soundscape is off. */
  private engineAudio(): AudioMixerState {
    if (this.data.ui.features.soundscape) return this.data.audio;
    return { ...this.data.audio, layers: { ...SILENT_LAYERS } };
  }

  /** Show only the panels the user switched on; with no side panels the timer sits alone, zen-style. */
  private applyFeatureLayout(): void {
    const features = this.data.ui.features;
    this.root.querySelectorAll<HTMLElement>('[data-feature]').forEach((el) => {
      const id = el.dataset['feature'] as FeatureId | undefined;
      if (id) el.hidden = !features[id];
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-feature-toggle]').forEach((input) => {
      const id = input.dataset['featureToggle'] as FeatureId | undefined;
      if (id) input.checked = features[id];
    });
    const hasSidePanels = features.tasks || features.soundscape || features.timeline;
    this.sidePanelsEl.hidden = !hasSidePanels;
    this.appShellEl.classList.toggle('is-minimal', !hasSidePanels);
  }

  private applyFlatDesign(): void {
    const flat = this.data.ui.flatDesign;
    document.documentElement.toggleAttribute('data-flat', flat);
    this.q<HTMLInputElement>('#toggle-flat').checked = flat;
    // Particles are decoration: stop the animation loop entirely in flat mode (saves CPU/battery).
    if (flat) {
      this.particles.stop();
    } else {
      this.particles.start();
    }
  }

  private setDrawerOpen(open: boolean): void {
    if (open === this.drawerOpen) return;
    this.drawerOpen = open;
    this.drawerEl.classList.toggle('is-open', open);
    this.drawerBackdropEl.classList.toggle('is-open', open);
    this.drawerEl.inert = !open;
    this.menuBtnEl.setAttribute('aria-expanded', String(open));
    if (open) {
      this.q('#btn-drawer-close').focus();
    } else if (this.drawerEl.contains(document.activeElement)) {
      this.menuBtnEl.focus();
    }
  }

  private async togglePip(): Promise<void> {
    this.setDrawerOpen(false);
    if (this.pipWindow && !this.pipWindow.closed) {
      this.pipWindow.close();
      this.pipWindow = null;
      return;
    }

    const docPip = (
      window as unknown as {
        documentPictureInPicture?: {
          requestWindow: (opts: { width: number; height: number }) => Promise<Window>;
        };
      }
    ).documentPictureInPicture;

    if (docPip) {
      try {
        const pipWin = await docPip.requestWindow({ width: 320, height: 184 });
        this.pipWindow = pipWin;
        this.mountPipWindow(pipWin);
        pipWin.addEventListener('pagehide', () => {
          this.pipWindow = null;
        });
        return;
      } catch {
        // Fallback to in-app floating mini widget
      }
    }

    this.miniFloatingVisible = !this.miniFloatingVisible;
    this.miniWidgetEl.hidden = !this.miniFloatingVisible;
    if (this.miniFloatingVisible) {
      this.notifications.toast(
        'Mini Floating Timer active',
        'Your browser does not support OS Document PiP here, so the in-app mini timer is shown.',
        'info',
      );
    }
  }

  private mountPipWindow(pipWin: Window): void {
    const accent = getPhaseAccent(this.data.theme, this.engine.getSnapshot().phase);
    pipWin.document.head.innerHTML = `
      <title>CHRONOS Mini</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
          background: #090d16;
          color: #f8fafc;
          height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px;
        }
        .phase {
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: ${accent};
          font-weight: 700;
        }
        .time {
          font-size: 46px;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.02em;
        }
        .task {
          font-size: 12px;
          color: #94a3b8;
          max-width: 280px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .row { display: flex; gap: 8px; margin-top: 4px; }
        button {
          background: rgba(255,255,255,0.1);
          color: #f8fafc;
          border: 1px solid rgba(255,255,255,0.18);
          border-radius: 999px;
          padding: 6px 14px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        button.primary {
          background: ${accent};
          color: #06101b;
          border-color: transparent;
        }
      </style>
    `;

    pipWin.document.body.innerHTML = `
      <div class="phase" id="pip-phase">FOCUS</div>
      <div class="time" id="pip-time">25:00</div>
      <div class="task" id="pip-task"></div>
      <div class="row">
        <button class="primary" id="pip-toggle">Start</button>
        <button id="pip-skip">Skip</button>
      </div>
    `;

    pipWin.document.getElementById('pip-toggle')?.addEventListener('click', () => {
      this.sound.unlock();
      this.engine.toggle();
    });
    pipWin.document.getElementById('pip-skip')?.addEventListener('click', () => {
      this.engine.skip();
    });

    this.syncPipWindow(this.engine.getSnapshot());
  }

  private syncPipWindow(snapshot: TimerSnapshot): void {
    const timeText =
      snapshot.status === 'overtime'
        ? formatOvertime(snapshot.overtimeMs)
        : formatCountdown(snapshot.remainingMs);
    const phaseLabel = getPhaseLabel(snapshot.phase).toUpperCase();
    const actionLabel =
      snapshot.status === 'running'
        ? 'Pause'
        : snapshot.status === 'overtime'
          ? 'Finish'
          : snapshot.status === 'paused'
            ? 'Resume'
            : 'Start';

    this.miniWidgetTimeEl.textContent = timeText;
    this.miniWidgetPhaseEl.textContent = phaseLabel;
    this.miniWidgetBtnEl.textContent = actionLabel;

    if (this.pipWindow && !this.pipWindow.closed) {
      const pTime = this.pipWindow.document.getElementById('pip-time');
      const pPhase = this.pipWindow.document.getElementById('pip-phase');
      const pTask = this.pipWindow.document.getElementById('pip-task');
      const pBtn = this.pipWindow.document.getElementById('pip-toggle');
      if (pTime) pTime.textContent = timeText;
      if (pPhase) pPhase.textContent = snapshot.status === 'overtime' ? `${phaseLabel} • FLOW` : phaseLabel;
      if (pBtn) pBtn.textContent = actionLabel;
      if (pTask) {
        const active = this.data.tasks.find((t) => t.id === this.data.activeTaskId);
        pTask.textContent = active ? active.title : 'No active task';
      }
    }
  }

  private handleTick(snapshot: TimerSnapshot): void {
    this.timerStageEl.setAttribute('data-phase', snapshot.phase);
    this.timerStageEl.setAttribute('data-status', snapshot.status);

    this.phaseLabelEl.textContent =
      snapshot.status === 'overtime'
        ? 'FLOW OVERTIME'
        : getPhaseLabel(snapshot.phase).toUpperCase();

    this.countdownEl.textContent = formatCountdown(snapshot.remainingMs);

    if (snapshot.status === 'overtime') {
      this.overtimeBadgeEl.hidden = false;
      this.overtimeBadgeEl.textContent = `${formatOvertime(snapshot.overtimeMs)} FLOW`;
    } else {
      this.overtimeBadgeEl.hidden = true;
    }

    const offset =
      snapshot.status === 'overtime'
        ? 0
        : RING_CIRCUMFERENCE * snapshot.progress;
    this.progressRingEl.style.strokeDashoffset = offset.toFixed(2);
    this.haloGlowEl.style.strokeDashoffset = offset.toFixed(2);

    // Update phase tabs
    this.root.querySelectorAll<HTMLButtonElement>('[data-phase-btn]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset['phaseBtn'] === snapshot.phase);
    });

    // Primary button label
    if (snapshot.status === 'running') {
      this.primaryBtnLabelEl.textContent = 'Pause';
    } else if (snapshot.status === 'overtime') {
      this.primaryBtnLabelEl.textContent = 'Finish & Break';
    } else if (snapshot.status === 'paused') {
      this.primaryBtnLabelEl.textContent = 'Resume';
    } else {
      this.primaryBtnLabelEl.textContent =
        snapshot.phase === 'focus' ? 'Start Focus' : 'Start Break';
    }

    // Cycle dots
    const interval = Math.max(1, snapshot.longBreakInterval);
    const doneInCycle = snapshot.completedFocusInCycle % interval;
    const dotsHtml = Array.from({ length: interval }, (_, i) => {
      const filled = i < doneInCycle;
      const current = i === doneInCycle && snapshot.phase === 'focus' && snapshot.status !== 'idle';
      return `<span class="cycle-dot ${filled ? 'is-done' : ''} ${current ? 'is-current' : ''}"></span>`;
    }).join('');
    this.cycleDotsEl.innerHTML = dotsHtml;

    this.particles.setRunning(snapshot.status === 'running' || snapshot.status === 'overtime');
    updateDocumentTitleAndFavicon(snapshot, this.data.theme);
    this.syncPipWindow(snapshot);
  }

  private handlePhaseComplete(
    event: {
      completedPhase: Phase;
      nextPhase: Phase;
      plannedMinutes: number;
      actualMinutes: number;
      overtimeMinutes: number;
      autoStartedNext: boolean;
    },
    snapshot: TimerSnapshot,
  ): void {
    const nowDate = new Date();
    const activeTask = this.data.tasks.find((t) => t.id === this.data.activeTaskId) ?? null;

    const record: SessionRecord = {
      id: crypto.randomUUID(),
      phase: event.completedPhase,
      plannedMinutes: event.plannedMinutes,
      actualMinutes: event.actualMinutes,
      overtimeMinutes: event.overtimeMinutes,
      completedAt: nowDate.toISOString(),
      dateKey: toLocalDateKey(nowDate),
      taskId: activeTask?.id ?? null,
      taskTitle: activeTask?.title ?? null,
    };

    this.data.history = [...this.data.history, record].slice(-2000);

    if (event.completedPhase === 'focus') {
      if (activeTask) {
        this.data.tasks = incrementTaskPomodoro(this.data.tasks, activeTask.id);
      }
      this.sound.playChime('focusComplete');
      this.particles.celebrate();
      this.notifications.toast(
        'Focus session complete!',
        `+${Math.round(event.actualMinutes)}m logged${activeTask ? ` on "${activeTask.title}"` : ''}. Next: ${getPhaseLabel(event.nextPhase)}.`,
        'success',
      );
      this.notifications.sendDesktopNotification(
        this.data.settings.desktopNotifications,
        'Focus session complete!',
        `Time for a ${getPhaseLabel(event.nextPhase)}.`,
      );
    } else {
      this.sound.playChime('breakComplete');
      this.notifications.toast(
        `${getPhaseLabel(event.completedPhase)} finished`,
        event.autoStartedNext ? 'Focus started automatically.' : 'Ready for your next focus sprint.',
        'info',
      );
      this.notifications.sendDesktopNotification(
        this.data.settings.desktopNotifications,
        'Break complete!',
        'Ready for your next focus sprint.',
      );
    }

    this.persist();
    this.renderTasks();
    this.renderActiveTaskBanner();
    this.renderHistory();
    this.renderDailyGoal();
    this.handleTick(snapshot);
  }

  private renderActiveTaskBanner(): void {
    const active = this.data.tasks.find((t) => t.id === this.data.activeTaskId);
    if (!active) {
      this.activeTaskBannerEl.innerHTML = `<span class="active-task-empty">No task selected — pick or add one in the Focus Queue</span>`;
      return;
    }
    this.activeTaskBannerEl.innerHTML = `
      <span class="active-task-dot"></span>
      <span class="active-task-label">Working on:</span>
      <strong class="active-task-title">${escapeHtml(active.title)}</strong>
      <span class="active-task-count">${active.completedPomodoros}/${active.estimatedPomodoros} 🍅</span>
    `;
  }

  private renderTasks(): void {
    this.renderActiveTaskBanner();

    if (this.data.tasks.length === 0) {
      this.taskListEl.innerHTML = `<li class="empty-state">Your focus queue is clear. Add a task above!</li>`;
      return;
    }

    this.taskListEl.innerHTML = this.data.tasks
      .map((task, idx) => {
        const isActive = task.id === this.data.activeTaskId;
        const pct = Math.min(100, Math.round((task.completedPomodoros / task.estimatedPomodoros) * 100));
        return `
          <li class="task-item ${isActive ? 'is-active' : ''} ${task.done ? 'is-done' : ''}" data-task-id="${task.id}">
            <div class="task-item__main">
              <button type="button" class="task-check" data-task-toggle="${task.id}" aria-label="Toggle done">
                ${task.done ? '✓' : ''}
              </button>
              <button type="button" class="task-select" data-task-select="${task.id}">
                <span class="task-item__title">${escapeHtml(task.title)}</span>
                <span class="task-item__progress">
                  <span>${task.completedPomodoros} / ${task.estimatedPomodoros} 🍅</span>
                  <span class="task-bar"><span style="width:${pct}%"></span></span>
                </span>
              </button>
            </div>
            <div class="task-item__actions">
              <button type="button" class="task-act" data-task-move="up" data-id="${task.id}" ${idx === 0 ? 'disabled' : ''} title="Move up">↑</button>
              <button type="button" class="task-act" data-task-move="down" data-id="${task.id}" ${idx === this.data.tasks.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
              <button type="button" class="task-act task-act--danger" data-task-del="${task.id}" title="Delete task">✕</button>
            </div>
          </li>
        `;
      })
      .join('');

    this.taskListEl.querySelectorAll<HTMLButtonElement>('[data-task-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset['taskToggle'];
        if (!id) return;
        const res = toggleTaskDone(this.data.tasks, this.data.activeTaskId, id);
        this.data.tasks = res.tasks;
        this.data.activeTaskId = res.activeTaskId;
        this.persist();
        this.renderTasks();
        this.sound.playUiClick();
      });
    });

    this.taskListEl.querySelectorAll<HTMLButtonElement>('[data-task-select]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset['taskSelect'];
        if (!id) return;
        this.data.activeTaskId = id;
        this.persist();
        this.renderTasks();
        this.sound.playUiClick();
      });
    });

    this.taskListEl.querySelectorAll<HTMLButtonElement>('[data-task-move]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset['id'];
        const dir = btn.dataset['taskMove'] as 'up' | 'down' | undefined;
        if (!id || !dir) return;
        this.data.tasks = moveTask(this.data.tasks, id, dir);
        this.persist();
        this.renderTasks();
      });
    });

    this.taskListEl.querySelectorAll<HTMLButtonElement>('[data-task-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset['taskDel'];
        if (!id) return;
        const res = deleteTask(this.data.tasks, this.data.activeTaskId, id);
        this.data.tasks = res.tasks;
        this.data.activeTaskId = res.activeTaskId;
        this.persist();
        this.renderTasks();
      });
    });
  }

  private renderHistory(): void {
    const todayKey = toLocalDateKey(new Date());
    const todayFocus = this.data.history
      .filter((r) => r.dateKey === todayKey && r.phase === 'focus')
      .slice(-6)
      .reverse();

    if (todayFocus.length === 0) {
      this.historyListEl.innerHTML = `<li class="empty-state">Complete your first focus block to build today’s timeline.</li>`;
      return;
    }

    this.historyListEl.innerHTML = todayFocus
      .map((item) => {
        const time = new Date(item.completedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        const ot = item.overtimeMinutes > 0 ? ` (+${item.overtimeMinutes}m flow)` : '';
        return `
          <li class="history-item">
            <span class="history-item__time">${time}</span>
            <span class="history-item__title">${escapeHtml(item.taskTitle ?? 'Unlinked focus')}</span>
            <span class="history-item__dur">${Math.round(item.actualMinutes)}m${ot}</span>
          </li>
        `;
      })
      .join('');
  }

  private renderDailyGoal(): void {
    const summary = computeAnalytics(this.data.history);
    const goal = Math.max(1, this.data.settings.dailyGoal);
    const pct = Math.min(100, Math.round((summary.todayPomodoros / goal) * 100));
    const streakLabel = summary.currentStreak > 0 ? `🔥 ${summary.currentStreak}d streak` : '🌱 Start streak';

    this.dailyGoalEl.innerHTML = `
      <div class="daily-goal__row">
        <span>Daily Goal: <strong>${summary.todayPomodoros} / ${goal} 🍅</strong> (${summary.todayMinutes}m)</span>
        <span class="streak-pill">${streakLabel}</span>
      </div>
      <div class="daily-goal__track">
        <div class="daily-goal__fill" style="width: ${pct}%"></div>
      </div>
    `;
  }

  private syncAudioUi(): void {
    const activeNames = SOUND_LAYERS.filter((l) => (this.data.audio.layers[l.id] ?? 0) > 0).map(
      (l) => l.name,
    );

    this.muteBtnEl.textContent = this.data.audio.muted ? '🔇 Unmute' : '🔊 Mute';
    this.muteBtnEl.classList.toggle('is-active', this.data.audio.muted);

    this.audioStatusEl.textContent = this.data.audio.muted
      ? 'Audio muted (press M to unmute)'
      : activeNames.length > 0
        ? `Playing: ${activeNames.join(' + ')}`
        : 'Slide any layer to mix your soundscape';

    for (const layer of SOUND_LAYERS) {
      const pct = Math.round((this.data.audio.layers[layer.id] ?? 0) * 100);
      const row = this.root.querySelector(`[data-sound-row="${layer.id}"]`);
      const pctEl = this.root.querySelector(`[data-sound-pct="${layer.id}"]`);
      row?.classList.toggle('is-active', pct > 0 && !this.data.audio.muted);
      if (pctEl) pctEl.textContent = `${pct}%`;
    }
  }

  private syncPresetButtons(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset['preset'] === this.data.settings.preset);
    });
  }

  private openModal(kind: 'analytics' | 'settings' | 'shortcuts' | null): void {
    this.setDrawerOpen(false);
    this.activeModal = kind;
    if (!kind) {
      this.closeModal();
      return;
    }

    this.modalHostEl.hidden = false;

    if (kind === 'analytics') {
      this.renderAnalyticsModal();
    } else if (kind === 'settings') {
      this.renderSettingsModal();
    } else {
      this.renderShortcutsModal();
    }
  }

  private closeModal(): void {
    this.activeModal = null;
    this.modalHostEl.hidden = true;
    this.modalHostEl.innerHTML = '';
  }

  private renderAnalyticsModal(): void {
    const stats = computeAnalytics(this.data.history);
    const totalHours = (stats.totalMinutes / 60).toFixed(1);

    this.modalHostEl.innerHTML = `
      <div class="modal-card modal-card--wide" role="dialog" aria-modal="true" aria-label="Focus Analytics">
        <div class="modal-header">
          <div>
            <h2>Focus Analytics & Heatmap</h2>
            <p class="panel-sub">Your deep-work consistency across the last 12 weeks</p>
          </div>
          <button type="button" class="icon-btn" id="modal-close">✕</button>
        </div>

        <div class="kpi-grid">
          <div class="kpi-box">
            <span class="kpi-box__val">${stats.todayPomodoros}</span>
            <span class="kpi-box__lbl">Today (${stats.todayMinutes}m)</span>
          </div>
          <div class="kpi-box">
            <span class="kpi-box__val">${stats.currentStreak}d</span>
            <span class="kpi-box__lbl">Current Streak</span>
          </div>
          <div class="kpi-box">
            <span class="kpi-box__val">${stats.bestStreak}d</span>
            <span class="kpi-box__lbl">Best Streak</span>
          </div>
          <div class="kpi-box">
            <span class="kpi-box__val">${totalHours}h</span>
            <span class="kpi-box__lbl">All-Time (${stats.totalPomodoros} 🍅)</span>
          </div>
        </div>

        <div class="analytics-section">
          <h3>12-Week Focus Heatmap</h3>
          <div class="heatmap-wrap">
            ${renderHeatmapSvg(stats)}
          </div>
        </div>

        <div class="analytics-section">
          <h3>Focus Peak Hours (24h)</h3>
          <div class="heatmap-wrap">
            ${renderHourlyChartSvg(stats.hourlyFocusMinutes)}
          </div>
        </div>

        <div class="modal-footer">
          <div class="backup-actions">
            <button type="button" class="mini-pill" id="btn-export-json">⬇ Export JSON Backup</button>
            <label class="mini-pill import-label">
              ⬆ Import JSON
              <input type="file" id="input-import-json" accept="application/json" hidden />
            </label>
          </div>
          <button type="button" class="ctrl-btn ctrl-btn--primary" id="modal-done">Done</button>
        </div>
      </div>
    `;

    this.modalHostEl.querySelector('#modal-close')?.addEventListener('click', () => this.closeModal());
    this.modalHostEl.querySelector('#modal-done')?.addEventListener('click', () => this.closeModal());

    this.modalHostEl.querySelector('#btn-export-json')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chronos-pomodoro-backup-${toLocalDateKey(new Date())}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.notifications.toast('Backup exported', 'Saved tasks, settings, and history as JSON.', 'success');
    });

    this.modalHostEl
      .querySelector<HTMLInputElement>('#input-import-json')
      ?.addEventListener('change', async (e) => {
        const file = (e.currentTarget as HTMLInputElement).files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = sanitizeAppData(JSON.parse(text));
          this.data = parsed;
          this.persist();
          this.setTheme(this.data.theme);
          this.engine.updateSettings(this.data.settings);
          this.sound.setChimeVolume(this.data.settings.chimeVolume);
          this.sound.syncMixerState(this.engineAudio(), false);
          this.applyFeatureLayout();
          this.applyFlatDesign();
          this.syncPresetButtons();
          this.syncAudioUi();
          this.renderTasks();
          this.renderHistory();
          this.renderDailyGoal();
          this.renderAnalyticsModal();
          this.notifications.toast('Backup restored', 'All tasks and history loaded.', 'success');
        } catch {
          this.notifications.toast('Invalid backup file', 'Could not parse the selected JSON file.', 'warn');
        }
      });
  }

  private renderSettingsModal(): void {
    const s = this.data.settings;
    const notifPerm =
      typeof window !== 'undefined' && 'Notification' in window
        ? Notification.permission
        : 'unsupported';

    this.modalHostEl.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Timer Settings">
        <div class="modal-header">
          <div>
            <h2>Timer & Flow Settings</h2>
            <p class="panel-sub">Tune your cadence, automation, and alerts</p>
          </div>
          <button type="button" class="icon-btn" id="modal-close">✕</button>
        </div>

        <form class="settings-form" id="settings-form">
          <div class="settings-grid">
            <label class="field">
              <span>Focus (min)</span>
              <input type="number" name="focusMinutes" min="1" max="180" value="${s.focusMinutes}" />
            </label>
            <label class="field">
              <span>Short Break (min)</span>
              <input type="number" name="shortBreakMinutes" min="1" max="60" value="${s.shortBreakMinutes}" />
            </label>
            <label class="field">
              <span>Long Break (min)</span>
              <input type="number" name="longBreakMinutes" min="1" max="90" value="${s.longBreakMinutes}" />
            </label>
            <label class="field">
              <span>Long Break Every</span>
              <input type="number" name="longBreakInterval" min="2" max="10" value="${s.longBreakInterval}" />
            </label>
            <label class="field">
              <span>Daily Goal (🍅)</span>
              <input type="number" name="dailyGoal" min="1" max="24" value="${s.dailyGoal}" />
            </label>
            <label class="field">
              <span>Chime Volume (%)</span>
              <input type="number" name="chimeVolumePct" min="0" max="100" value="${Math.round(s.chimeVolume * 100)}" />
            </label>
          </div>

          <div class="toggles-list">
            <label class="toggle-row">
              <input type="checkbox" name="autoStartBreaks" ${s.autoStartBreaks ? 'checked' : ''} />
              <span>Auto-start breaks when focus finishes</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" name="autoStartFocus" ${s.autoStartFocus ? 'checked' : ''} />
              <span>Auto-start focus when break finishes</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" name="flowOvertime" ${s.flowOvertime ? 'checked' : ''} />
              <span>Flow Overtime mode (keep counting +MM:SS after 00:00)</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" name="desktopNotifications" ${s.desktopNotifications ? 'checked' : ''} />
              <span>Desktop notifications (${notifPerm})</span>
            </label>
          </div>

          <div class="modal-footer">
            <button type="button" class="mini-pill" id="btn-reset-defaults">Reset Defaults</button>
            <div style="display:flex; gap:10px;">
              <button type="button" class="mini-pill" id="btn-enable-notif">Allow Browser Alerts</button>
              <button type="submit" class="ctrl-btn ctrl-btn--primary">Save Settings</button>
            </div>
          </div>
        </form>
      </div>
    `;

    this.modalHostEl.querySelector('#modal-close')?.addEventListener('click', () => this.closeModal());

    this.modalHostEl.querySelector('#btn-enable-notif')?.addEventListener('click', async () => {
      const perm = await this.notifications.requestDesktopPermission();
      this.notifications.toast(
        `Notification permission: ${perm}`,
        perm === 'granted' ? 'Desktop alerts are ready.' : 'You will still receive in-app toasts & audio chimes.',
        perm === 'granted' ? 'success' : 'info',
      );
      if (perm === 'granted') {
        this.data.settings.desktopNotifications = true;
        this.persist();
        this.renderSettingsModal();
      }
    });

    this.modalHostEl.querySelector('#btn-reset-defaults')?.addEventListener('click', () => {
      this.data.settings = { ...DEFAULT_SETTINGS };
      this.persist();
      this.engine.updateSettings(this.data.settings);
      this.sound.setChimeVolume(this.data.settings.chimeVolume);
      this.syncPresetButtons();
      this.renderDailyGoal();
      this.renderSettingsModal();
      this.notifications.toast('Defaults restored', 'Classic 25/5 cadence applied.', 'info');
    });

    this.modalHostEl
      .querySelector<HTMLFormElement>('#settings-form')
      ?.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget as HTMLFormElement);
        const focusMinutes = Math.min(180, Math.max(1, Number(fd.get('focusMinutes')) || 25));
        const shortBreakMinutes = Math.min(60, Math.max(1, Number(fd.get('shortBreakMinutes')) || 5));
        const longBreakMinutes = Math.min(90, Math.max(1, Number(fd.get('longBreakMinutes')) || 15));
        const longBreakInterval = Math.min(10, Math.max(2, Number(fd.get('longBreakInterval')) || 4));
        const dailyGoal = Math.min(24, Math.max(1, Number(fd.get('dailyGoal')) || 8));
        const chimeVolume = Math.min(1, Math.max(0, (Number(fd.get('chimeVolumePct')) || 75) / 100));

        const matchedPreset = PRESETS.find(
          (p) =>
            p.focusMinutes === focusMinutes &&
            p.shortBreakMinutes === shortBreakMinutes &&
            p.longBreakMinutes === longBreakMinutes &&
            p.longBreakInterval === longBreakInterval,
        );

        this.data.settings = {
          ...this.data.settings,
          focusMinutes,
          shortBreakMinutes,
          longBreakMinutes,
          longBreakInterval,
          dailyGoal,
          chimeVolume,
          autoStartBreaks: fd.get('autoStartBreaks') === 'on',
          autoStartFocus: fd.get('autoStartFocus') === 'on',
          flowOvertime: fd.get('flowOvertime') === 'on',
          desktopNotifications: fd.get('desktopNotifications') === 'on',
          preset: matchedPreset ? matchedPreset.id : 'custom',
        };

        this.persist();
        this.engine.updateSettings(this.data.settings);
        this.sound.setChimeVolume(chimeVolume);
        this.syncPresetButtons();
        this.renderDailyGoal();

        const flowBtn = this.q('#btn-toggle-flow');
        flowBtn.classList.toggle('is-on', this.data.settings.flowOvertime);
        flowBtn.textContent = `⚡ Flow Overtime: ${this.data.settings.flowOvertime ? 'ON' : 'OFF'}`;

        this.closeModal();
        this.notifications.toast('Settings saved', 'Timer cadence updated.', 'success');
      });
  }

  private renderShortcutsModal(): void {
    const shortcuts: Array<[string, string]> = [
      ['Space', 'Start, Pause, or Finish Flow Overtime'],
      ['R', 'Reset current timer'],
      ['S', 'Skip to next phase'],
      ['1 / 2 / 3', 'Switch to Focus / Short Break / Long Break'],
      ['M', 'Mute / Unmute ambient soundscape & chimes'],
      ['Z', 'Toggle Zen full-screen focus mode'],
      ['P', 'Toggle Mini Floating / Picture-in-Picture timer'],
      ['?', 'Open or close this shortcuts guide'],
      ['Esc', 'Close the menu or a dialog, or exit Zen mode'],
    ];

    this.modalHostEl.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Keyboard Shortcuts">
        <div class="modal-header">
          <div>
            <h2>Keyboard Shortcuts</h2>
            <p class="panel-sub">Stay in flow without touching your mouse</p>
          </div>
          <button type="button" class="icon-btn" id="modal-close">✕</button>
        </div>

        <div class="shortcuts-list">
          ${shortcuts
            .map(
              ([key, desc]) => `
                <div class="shortcut-row">
                  <kbd>${key}</kbd>
                  <span>${desc}</span>
                </div>
              `,
            )
            .join('')}
        </div>

        <div class="modal-footer" style="justify-content: flex-end;">
          <button type="button" class="ctrl-btn ctrl-btn--primary" id="modal-done">Got it</button>
        </div>
      </div>
    `;

    this.modalHostEl.querySelector('#modal-close')?.addEventListener('click', () => this.closeModal());
    this.modalHostEl.querySelector('#modal-done')?.addEventListener('click', () => this.closeModal());
  }

  private persist(): void {
    saveAppData(this.data);
  }
}
