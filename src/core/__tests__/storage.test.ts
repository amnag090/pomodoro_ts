import { describe, expect, it } from 'vitest';
import { createDefaultAppData, sanitizeAppData } from '../storage.js';

describe('theme persistence', () => {
  it('defaults new users to the AMOLED black theme', () => {
    expect(createDefaultAppData().theme).toBe('amoled');
  });

  it('keeps a saved theme the user picked', () => {
    expect(sanitizeAppData({ theme: 'amoled' }).theme).toBe('amoled');
    expect(sanitizeAppData({ theme: 'sunset' }).theme).toBe('sunset');
  });

  it('falls back to the default for unknown or missing themes', () => {
    expect(sanitizeAppData({ theme: 'neon-pink' }).theme).toBe('amoled');
    expect(sanitizeAppData({}).theme).toBe('amoled');
  });
});

describe('ui preferences', () => {
  it('starts zen: every optional feature off, flat design off', () => {
    expect(createDefaultAppData().ui).toEqual({
      features: { tasks: false, soundscape: false, timeline: false, dailyGoal: false },
      flatDesign: false,
    });
  });

  it('gives older saved data (no ui field) the zen defaults', () => {
    expect(sanitizeAppData({ theme: 'cyber', settings: {} }).ui.features.tasks).toBe(false);
  });

  it('keeps the features and flat design the user switched on', () => {
    const ui = sanitizeAppData({
      ui: { features: { tasks: true, timeline: true }, flatDesign: true },
    }).ui;
    expect(ui.features).toEqual({ tasks: true, soundscape: false, timeline: true, dailyGoal: false });
    expect(ui.flatDesign).toBe(true);
  });

  it('ignores malformed values and unknown feature keys', () => {
    const ui = sanitizeAppData({
      ui: { features: { tasks: 'yes', bogus: true }, flatDesign: 1 },
    }).ui;
    expect(ui.features.tasks).toBe(false);
    expect(ui.features).not.toHaveProperty('bogus');
    expect(ui.flatDesign).toBe(false);
  });
});
