let context: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!context) context = new AudioContext();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

function tone(freq: number, duration: number, type: OscillatorType, gain = 0.08, slideTo?: number) {
  const ctx = audio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
  vol.gain.setValueAtTime(gain, ctx.currentTime);
  vol.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(vol).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

export const sfx = {
  jump: () => tone(320, 0.12, 'square', 0.05, 620),
  land: () => tone(140, 0.07, 'sine', 0.04),
  collect: () => tone(880, 0.12, 'triangle', 0.07, 1320),
  hit: () => tone(220, 0.25, 'sawtooth', 0.07, 70),
  open: () => tone(520, 0.1, 'triangle', 0.05, 780),
  solved: () => {
    tone(523, 0.12, 'triangle', 0.07);
    setTimeout(() => tone(659, 0.12, 'triangle', 0.07), 110);
    setTimeout(() => tone(784, 0.22, 'triangle', 0.08), 220);
  },
  wrong: () => tone(200, 0.18, 'square', 0.05, 150),
  gate: () => {
    tone(392, 0.15, 'sine', 0.06);
    setTimeout(() => tone(587, 0.3, 'sine', 0.07), 140);
  },
};
