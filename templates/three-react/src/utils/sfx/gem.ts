/** Shiny gem pickup — thin, clean crystalline "ding" with a bright shimmer tail. */
export function sfxGem(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;

  // High pure sine "ding"
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(2200, now);
  osc.frequency.exponentialRampToValueAtTime(1800, now + 0.3);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.12, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  // High-pass to keep it thin and sparkly
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 1200;

  osc.connect(hpf);
  hpf.connect(env);
  env.connect(dest);
  osc.start(now);
  osc.stop(now + 0.45);

  // Shimmer overtone — octave above, quieter, slightly delayed
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(4400, now + 0.02);
  osc2.frequency.exponentialRampToValueAtTime(3600, now + 0.25);

  const env2 = ctx.createGain();
  env2.gain.setValueAtTime(0, now);
  env2.gain.linearRampToValueAtTime(0.06, now + 0.02);
  env2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  osc2.connect(hpf);
  osc2.connect(env2);
  env2.connect(dest);
  osc2.start(now);
  osc2.stop(now + 0.35);
}
