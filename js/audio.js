let ctx;
export function tone(kind, enabled) {
  if (!enabled) return;
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    ctx ??= new C();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const notes =
      kind === 'evolve'
        ? [392, 494, 587, 784, 988]
        : kind === 'level'
          ? [440, 554, 659, 880]
          : [659, 880];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator(),
        g = ctx.createGain();
      const t = ctx.currentTime + i * 0.105;
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.065, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } catch {}
}
let active = [],
  generation = 0;
export function hush() {
  generation++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  active = [];
}
export const voices = () =>
  ('speechSynthesis' in window ? speechSynthesis.getVoices() : []).filter((v) =>
    /^en([-_]|$)/i.test(v.lang),
  );
export function speak(turns, prefs, fail) {
  hush();
  if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) {
    fail('此浏览器无法朗读。可在 Safari 中打开。');
    return;
  }
  const token = generation,
    all = voices(),
    preferred =
      prefs.accent === 'auto'
        ? all
        : all.filter((v) => v.lang.replace('_', '-').toLowerCase() === prefs.accent.toLowerCase());
  const pool = [...preferred, ...all.filter((v) => !preferred.includes(v))];
  const cast = [...new Set(turns.map(turn => turn.speaker))];
  const messages = turns.map(({ text, speaker }) => {
    const u = new SpeechSynthesisUtterance(text);
    const index = cast.indexOf(speaker);
    const voice = pool.length ? pool[index % pool.length] : undefined;
    if (voice) u.voice = voice;
    u.lang = voice?.lang || (prefs.accent === 'auto' ? 'en-US' : prefs.accent);
    u.rate = prefs.rate;
    u.pitch = pool.length < cast.length ? [1, 1.15, 0.85][index] ?? 1 : 1;
    u.onerror = (e) => {
      if (token === generation && !['interrupted', 'canceled'].includes(e.error))
        fail('声音未能播放，请在设置中测试英语语音。');
    };
    return u;
  });
  active = messages;
  messages.forEach((u) => speechSynthesis.speak(u));
}
