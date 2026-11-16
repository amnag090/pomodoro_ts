import type { AudioMixerState, BinauralBand, SoundLayerId } from '../types.js';

interface LayerNode {
  gain: GainNode;
  stop: () => void;
  setBand?: (band: BinauralBand) => void;
}

const BINAURAL_OFFSETS: Record<BinauralBand, number> = {
  alpha: 10,
  beta: 14,
  gamma: 40,
};

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeLayers = new Map<SoundLayerId, LayerNode>();
  private state: AudioMixerState;
  private chimeVolume: number;

  constructor(initialAudio: AudioMixerState, chimeVolume = 0.75) {
    this.state = {
      ...initialAudio,
      layers: { ...initialAudio.layers },
    };
    this.chimeVolume = chimeVolume;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.state.muted ? 0 : this.state.masterVolume;
      this.masterGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    return this.ctx;
  }

  setChimeVolume(volume: number): void {
    this.chimeVolume = Math.min(1, Math.max(0, volume));
  }

  syncMixerState(next: AudioMixerState, startAudioIfNeeded = false): void {
    this.state = {
      ...next,
      layers: { ...next.layers },
    };

    const anyLayerActive = Object.values(this.state.layers).some((v) => v > 0.005);
    if (!this.ctx && !startAudioIfNeeded) {
      return;
    }
    if (!this.ctx && anyLayerActive && startAudioIfNeeded) {
      this.ensureContext();
    }
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const targetMaster = this.state.muted ? 0 : this.state.masterVolume;
    this.masterGain.gain.setTargetAtTime(targetMaster, now, 0.05);

    (Object.keys(this.state.layers) as SoundLayerId[]).forEach((layerId) => {
      const vol = this.state.layers[layerId];
      if (vol > 0.005) {
        let node = this.activeLayers.get(layerId);
        if (!node) {
          node = this.createLayer(layerId);
          this.activeLayers.set(layerId, node);
        }
        if (layerId === 'binaural' && node.setBand) {
          node.setBand(this.state.binauralBand);
        }
        node.gain.gain.setTargetAtTime(vol, now, 0.08);
      } else {
        const existing = this.activeLayers.get(layerId);
        if (existing) {
          existing.gain.gain.setTargetAtTime(0, now, 0.05);
          setTimeout(() => {
            if ((this.state.layers[layerId] ?? 0) <= 0.005) {
              existing.stop();
              this.activeLayers.delete(layerId);
            }
          }, 220);
        }
      }
    });
  }

  unlock(): void {
    const anyLayerActive = Object.values(this.state.layers).some((v) => v > 0.005);
    if (anyLayerActive) {
      this.syncMixerState(this.state, true);
    } else {
      this.ensureContext();
    }
  }

  playTick(): void {
    if (this.state.muted || this.chimeVolume <= 0.01) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1600, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.018);

    filter.type = 'bandpass';
    filter.frequency.value = 1400;
    filter.Q.value = 2.5;

    const peak = 0.05 * this.chimeVolume;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.03);
  }

  playUiClick(): void {
    if (this.state.muted || this.chimeVolume <= 0.01) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(540, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.035);

    gain.gain.setValueAtTime(0.03 * this.chimeVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.045);
  }

  playChime(kind: 'focusComplete' | 'breakComplete' | 'overtimeStart'): void {
    if (this.state.muted || this.chimeVolume <= 0.01) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const notes =
      kind === 'focusComplete'
        ? [523.25, 659.25, 783.99, 1174.66] // C5 E5 G5 D6
        : kind === 'breakComplete'
          ? [392.0, 493.88, 587.33, 783.99] // G4 B4 D5 G5
          : [659.25, 880.0]; // E5 A5

    const stepSec = kind === 'overtimeStart' ? 0.16 : 0.13;
    const now = ctx.currentTime;

    notes.forEach((freq, idx) => {
      const t = now + idx * stepSec;
      const osc = ctx.createOscillator();
      const harmonic = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);

      harmonic.type = 'triangle';
      harmonic.frequency.setValueAtTime(freq * 2, t);

      const harmonicGain = ctx.createGain();
      harmonicGain.gain.value = 0.12;

      const peak = 0.18 * this.chimeVolume;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);

      osc.connect(gain);
      harmonic.connect(harmonicGain);
      harmonicGain.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      harmonic.start(t);
      osc.stop(t + 1.45);
      harmonic.stop(t + 1.45);
    });
  }

  dispose(): void {
    for (const node of this.activeLayers.values()) {
      node.stop();
    }
    this.activeLayers.clear();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.masterGain = null;
    }
  }

  private createLayer(id: SoundLayerId): LayerNode {
    const ctx = this.ctx!;
    const master = this.masterGain!;
    const layerGain = ctx.createGain();
    layerGain.gain.value = 0;
    layerGain.connect(master);

    switch (id) {
      case 'rain':
        return this.buildRainLayer(ctx, layerGain);
      case 'vinyl':
        return this.buildVinylLayer(ctx, layerGain);
      case 'space':
        return this.buildSpaceLayer(ctx, layerGain);
      case 'brown':
        return this.buildBrownLayer(ctx, layerGain);
      case 'binaural':
        return this.buildBinauralLayer(ctx, layerGain);
    }
  }

  private createNoiseBuffer(ctx: AudioContext, seconds: number, kind: 'pink' | 'brown' | 'vinyl'): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

    for (let ch = 0; ch < 2; ch += 1) {
      const data = buffer.getChannelData(ch);
      if (kind === 'brown') {
        let lastOut = 0;
        for (let i = 0; i < length; i += 1) {
          const white = Math.random() * 2 - 1;
          lastOut = (lastOut + 0.02 * white) / 1.02;
          data[i] = lastOut * 3.2;
        }
      } else if (kind === 'pink') {
        let b0 = 0;
        let b1 = 0;
        let b2 = 0;
        let b3 = 0;
        let b4 = 0;
        let b5 = 0;
        let b6 = 0;
        for (let i = 0; i < length; i += 1) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
          b6 = white * 0.115926;
        }
      } else {
        // Warm lo-fi vinyl floor + sparse soft crackles
        let smooth = 0;
        for (let i = 0; i < length; i += 1) {
          const white = Math.random() * 2 - 1;
          smooth = smooth * 0.96 + white * 0.04;
          const crackle = Math.random() < 0.00045 ? (Math.random() * 2 - 1) * 0.55 : 0;
          data[i] = smooth * 0.35 + crackle;
        }
      }
    }

    return buffer;
  }

  private buildRainLayer(ctx: AudioContext, dest: GainNode): LayerNode {
    const src = ctx.createBufferSource();
    src.buffer = this.createNoiseBuffer(ctx, 4, 'pink');
    src.loop = true;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.12;
    lfoGain.gain.value = 380;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);

    const trim = ctx.createGain();
    trim.gain.value = 0.55;

    src.connect(hp);
    hp.connect(lp);
    lp.connect(trim);
    trim.connect(dest);

    src.start();
    lfo.start();

    return {
      gain: dest,
      stop: () => {
        try {
          src.stop();
          lfo.stop();
        } catch {
          // ignore
        }
      },
    };
  }

  private buildVinylLayer(ctx: AudioContext, dest: GainNode): LayerNode {
    const src = ctx.createBufferSource();
    src.buffer = this.createNoiseBuffer(ctx, 5, 'vinyl');
    src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;

    const trim = ctx.createGain();
    trim.gain.value = 0.65;

    src.connect(bp);
    bp.connect(trim);
    trim.connect(dest);
    src.start();

    return {
      gain: dest,
      stop: () => {
        try {
          src.stop();
        } catch {
          // ignore
        }
      },
    };
  }

  private buildBrownLayer(ctx: AudioContext, dest: GainNode): LayerNode {
    const src = ctx.createBufferSource();
    src.buffer = this.createNoiseBuffer(ctx, 4, 'brown');
    src.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 460;

    const trim = ctx.createGain();
    trim.gain.value = 0.45;

    src.connect(lp);
    lp.connect(trim);
    trim.connect(dest);
    src.start();

    return {
      gain: dest,
      stop: () => {
        try {
          src.stop();
        } catch {
          // ignore
        }
      },
    };
  }

  private buildSpaceLayer(ctx: AudioContext, dest: GainNode): LayerNode {
    const freqs = [110, 164.81, 220, 277.18];
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 1.4;

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 190;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const trim = ctx.createGain();
    trim.gain.value = 0.18;

    const oscs: OscillatorNode[] = freqs.map((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = (idx - 1.5) * 4;
      osc.connect(filter);
      osc.start();
      return osc;
    });

    filter.connect(trim);
    trim.connect(dest);
    lfo.start();

    return {
      gain: dest,
      stop: () => {
        for (const osc of oscs) {
          try {
            osc.stop();
          } catch {
            // ignore
          }
        }
        try {
          lfo.stop();
        } catch {
          // ignore
        }
      },
    };
  }

  private buildBinauralLayer(ctx: AudioContext, dest: GainNode): LayerNode {
    const carrierHz = 200;
    const leftOsc = ctx.createOscillator();
    const rightOsc = ctx.createOscillator();
    leftOsc.type = 'sine';
    rightOsc.type = 'sine';

    leftOsc.frequency.value = carrierHz;
    rightOsc.frequency.value = carrierHz + BINAURAL_OFFSETS[this.state.binauralBand];

    const leftPan = ctx.createStereoPanner();
    const rightPan = ctx.createStereoPanner();
    leftPan.pan.value = -0.85;
    rightPan.pan.value = 0.85;

    const trim = ctx.createGain();
    trim.gain.value = 0.14;

    leftOsc.connect(leftPan);
    rightOsc.connect(rightPan);
    leftPan.connect(trim);
    rightPan.connect(trim);
    trim.connect(dest);

    leftOsc.start();
    rightOsc.start();

    return {
      gain: dest,
      setBand: (band: BinauralBand) => {
        rightOsc.frequency.setTargetAtTime(carrierHz + BINAURAL_OFFSETS[band], ctx.currentTime, 0.08);
      },
      stop: () => {
        try {
          leftOsc.stop();
          rightOsc.stop();
        } catch {
          // ignore
        }
      },
    };
  }
}
