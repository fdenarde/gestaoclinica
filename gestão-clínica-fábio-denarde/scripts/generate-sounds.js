/**
 * Gera arquivos WAV de alta qualidade para o sistema de alarme.
 * Usa síntese matemática (seno, quadrada, dente de serra) — sem dependências externas.
 * Executar: node scripts/generate-sounds.js
 */

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'sounds');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function writeWav(filename, samples) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = SAMPLE_RATE * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  function writeStr(offset, str) { buffer.write(str, offset, 'ascii'); }
  function writeU32(offset, val) { buffer.writeUInt32LE(val, offset); }
  function writeU16(offset, val) { buffer.writeUInt16LE(val, offset); }
  function writeI16(offset, val) { buffer.writeInt16LE(val, offset); }

  writeStr(0, 'RIFF');
  writeU32(4, 36 + dataSize);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  writeU32(16, 16);
  writeU16(20, 1); // PCM
  writeU16(22, numChannels);
  writeU32(24, SAMPLE_RATE);
  writeU32(28, byteRate);
  writeU16(32, blockAlign);
  writeU16(34, bitsPerSample);
  writeStr(36, 'data');
  writeU32(40, dataSize);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
    writeI16(44 + i * 2, clamped);
  }

  fs.writeFileSync(path.join(OUT_DIR, filename), buffer);
  console.log(`  ✓ ${filename} (${(samples.length / SAMPLE_RATE).toFixed(1)}s)`);
}

// ── Geradores de onda ──
function sine(t, freq) { return Math.sin(2 * Math.PI * freq * t); }
function square(t, freq) { return Math.sign(Math.sin(2 * Math.PI * freq * t)); }
function saw(t, freq) { return 2 * ((t * freq) % 1) - 1; }

function envelope(t, totalDuration, attack = 0.005, release = 0.02) {
  if (t < attack) return t / attack;
  if (t > totalDuration - release) return (totalDuration - t) / release;
  return 1;
}

function adsr(t, total, a, d, s, r) {
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < total - r) return s;
  if (t < total) return s * (total - t) / r;
  return 0;
}

function mix(sec, genFn) {
  const len = Math.floor(sec * SAMPLE_RATE);
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    buf[i] = genFn(i / SAMPLE_RATE);
  }
  return buf;
}

function silence(sec) {
  const len = Math.floor(sec * SAMPLE_RATE);
  return new Float32Array(len);
}

function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function repeat(pattern, count) {
  const arrs = [];
  for (let i = 0; i < count; i++) arrs.push(pattern);
  return concat(...arrs);
}

// ═══════════════════════════════════════════
// SONS
// ═══════════════════════════════════════════

// 1. nokia_classic.mp3 — Nokia 3310 ringtone
function nokiaClassic() {
  const notes = [1468, 1234, 987, 1108, 987, 1234, 1468, 1234, 987, 1108, 987, 880, 987, 1108, 1234, 1468];
  const noteLen = 0.12;
  const gap = 1.0;
  const pattern = concat(
    ...notes.map(f => mix(noteLen, t => square(t, f) * adsr(t, noteLen, 0.002, 0.01, 0.7, 0.01))),
  );
  const full = concat(pattern, silence(gap));
  return repeat(full, 4);
}

// 2. nokia_tune.mp3 — Nokia original tune
function nokiaTune() {
  const notes = [784, 659, 659, 698, 659, 587, 523, 587, 659, 698, 784, 880, 784, 880, 784];
  const lens = [0.18, 0.18, 0.36, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.5];
  const parts = notes.map((f, i) => mix(lens[i], t => sine(t, f) * adsr(t, lens[i], 0.005, 0.02, 0.6, 0.02)));
  const pattern = concat(...parts);
  return repeat(concat(pattern, silence(1.0)), 3);
}

// 3. motorola_classic.mp3 — Motorola ringtone
function motorolaClassic() {
  const notes = [1174, 1318, 1568, 1318, 1174, 1046, 1174, 1318];
  const lens = [0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.4];
  const parts = notes.map((f, i) => mix(lens[i], t => square(t, f) * adsr(t, lens[i], 0.002, 0.01, 0.7, 0.01)));
  const pattern = concat(...parts);
  return repeat(concat(pattern, silence(0.8)), 4);
}

// 4. digital_alarm.mp3 — Digital alarm clock
function digitalAlarm() {
  const beep = concat(
    mix(0.15, t => square(t, 2200) * envelope(t, 0.15, 0.002, 0.01)),
    mix(0.15, t => square(t, 2800) * envelope(t, 0.15, 0.002, 0.01)),
    silence(0.3),
  );
  return repeat(beep, 12);
}

// 5. old_phone.mp3 — Old telephone ring
function oldPhone() {
  const ring = concat(
    mix(0.4, t => sine(t, 1200) * adsr(t, 0.4, 0.005, 0.05, 0.6, 0.03)),
    silence(0.2),
    mix(0.4, t => sine(t, 1500) * adsr(t, 0.4, 0.005, 0.05, 0.6, 0.03)),
    silence(0.2),
    mix(0.4, t => sine(t, 1200) * adsr(t, 0.4, 0.005, 0.05, 0.6, 0.03)),
    silence(0.2),
    mix(0.4, t => sine(t, 1500) * adsr(t, 0.4, 0.005, 0.05, 0.6, 0.03)),
    silence(1.5),
  );
  return repeat(ring, 5);
}

// 6. beep_alarm.mp3 — Repeated beeps
function beepAlarm() {
  const beep = concat(
    mix(0.1, t => square(t, 1600) * envelope(t, 0.1, 0.001, 0.01)),
    silence(0.25),
  );
  return repeat(beep, 20);
}

// 7. morning_alarm.mp3 — Gentle rising alarm
function morningAlarm() {
  const len = 6;
  return mix(len, t => {
    const freq = 400 + t * 150;
    const vol = Math.min(1, t / 2);
    return sine(t, freq) * vol * envelope(t, len, 0.1, 1.0);
  });
}

// 8. urgent_alarm.mp3 — Urgent strong alarm
function urgentAlarm() {
  const tone = concat(
    mix(0.25, t => square(t, 2000 + Math.sin(2 * Math.PI * 8 * t) * 200) * envelope(t, 0.25, 0.001, 0.01)),
    silence(0.15),
  );
  return repeat(tone, 8);
}

// 9. school_bell.mp3 — School bell
function schoolBell() {
  const bell = concat(
    mix(1.5, t => {
      const f1 = sine(t, 2500) * Math.exp(-t * 2);
      const f2 = sine(t, 3200) * Math.exp(-t * 3);
      return (f1 + 0.5 * f2) * 0.7;
    }),
    silence(1.0),
  );
  return repeat(bell, 4);
}

// 10. rooster.mp3 — Rooster crow
function rooster() {
  // Simulated rooster sound with frequency modulation
  const crow = mix(2.5, t => {
    const baseFreq = 800 + 400 * Math.sin(2 * Math.PI * 6 * t) * Math.exp(-t * 0.5);
    const mod = Math.sin(2 * Math.PI * 3 * t) * 0.5;
    return saw(t, baseFreq) * Math.exp(-t * 0.8) * 0.5 * (1 + mod);
  });
  return repeat(concat(crow, silence(3.0)), 3);
}

// ═══════════════════════════════════════════
// GERAR TUDO
// ═══════════════════════════════════════════

console.log('Gerando arquivos WAV...\n');

const sounds = {
  'nokia_classic.wav': nokiaClassic,
  'nokia_tune.wav': nokiaTune,
  'motorola_classic.wav': motorolaClassic,
  'digital_alarm.wav': digitalAlarm,
  'old_phone.wav': oldPhone,
  'beep_alarm.wav': beepAlarm,
  'morning_alarm.wav': morningAlarm,
  'urgent_alarm.wav': urgentAlarm,
  'school_bell.wav': schoolBell,
  'rooster.wav': rooster,
};

for (const [name, fn] of Object.entries(sounds)) {
  writeWav(name, fn());
}

console.log(`\n✅ ${Object.keys(sounds).length} arquivos gerados em ${OUT_DIR}`);
