#!/usr/bin/env node
/**
 * matchmusic - holds our AdLib against a recording of the original.
 *
 * The sound of the game cannot be compared sample by sample: a recording is
 * a real card through a real amplifier, and our chip is a model. What can be
 * compared is what makes a tune a tune - **which notes sound, and when**:
 *
 *  - the **pitch class profile**: how much energy sits on each of the twelve
 *    semitones over the whole piece. Two renderings of the same music have
 *    the same profile, whatever the timbre; a rendering that is out of tune,
 *    or an octave out, or playing the wrong notes, does not.
 *  - the **onset rate**: how many times a second something new starts. That is
 *    the tempo, without having to guess the beat.
 *
 * Both are worked out the same way for both sides, so the numbers can be held
 * against each other and a setting of the driver picked by measurement rather
 * than by ear.
 *
 * With `--effects` and no reference it checks the eighteen sound effects
 * instead: that each one makes a sound, that it ends by itself, and that no
 * two of them are the same. That is as far as measurement goes without a
 * recording of the original's effects.
 *
 * usage: node tools/matchmusic.mjs --reference <wav> [--track 0] [--seconds 30]
 *                                  [--search] [--effects] [--out build/matchmusic]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { OPL2 } from '../app/svision/js/audio/chip/opl2.js';
import { SoundImage } from '../app/lem/soundImage.js';
import { EFFECT_NAMES } from './lib/soundImage.mjs';

const RATE = 44100;
const WINDOW = 4096;
const HOP = 2048;

/** Reads a mono 16-bit WAV. */
export function readWAV (path) {
  const file = readFileSync(path);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let at = 12;
  let rate = RATE;
  let channels = 1;
  let bits = 16;
  let samples = null;
  while (at + 8 <= file.length) {
    const id = String.fromCharCode(file[at], file[at + 1], file[at + 2], file[at + 3]);
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    } else if (id === 'data') {
      const count = Math.floor(size / (bits / 8) / channels);
      samples = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        samples[i] = view.getInt16(at + 8 + i * channels * (bits / 8), true) / 32768;
      }
    }
    at += 8 + size + (size & 1);
  }
  if (!samples) throw new Error(`${path}: no data chunk`);
  return { samples, rate };
}

/** An in-place radix-2 FFT of a power of two block. */
function fft (re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += length) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < length / 2; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + length / 2] * cr - im[i + j + length / 2] * ci;
        const vi = re[i + j + length / 2] * ci + im[i + j + length / 2] * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + length / 2] = ur - vr;
        im[i + j + length / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/**
 * The twelve semitones and the rate of onsets.
 * @param {Float32Array} samples mono, at `rate`
 * @returns {{chroma: number[], onsets: number, seconds: number, energy: number}}
 */
export function analyse (samples, rate = RATE) {
  const chroma = new Array(12).fill(0);
  const window = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WINDOW);

  let previous = null;
  const flux = [];
  let energy = 0;

  for (let start = 0; start + WINDOW <= samples.length; start += HOP) {
    const re = new Float32Array(WINDOW);
    const im = new Float32Array(WINDOW);
    for (let i = 0; i < WINDOW; i++) re[i] = samples[start + i] * window[i];
    fft(re, im);

    const magnitude = new Float32Array(WINDOW / 2);
    for (let bin = 1; bin < WINDOW / 2; bin++) {
      magnitude[bin] = Math.hypot(re[bin], im[bin]);
      const frequency = bin * rate / WINDOW;
      if (frequency >= 60 && frequency <= 3000) {
        // which of the twelve semitones this bin is, counted from A
        const semitone = Math.round(12 * Math.log2(frequency / 440));
        chroma[((semitone % 12) + 12) % 12] += magnitude[bin];
        energy += magnitude[bin];
      }
    }

    if (previous) {
      let sum = 0;
      for (let bin = 1; bin < WINDOW / 2; bin++) {
        const rise = magnitude[bin] - previous[bin];
        if (rise > 0) sum += rise;
      }
      flux.push(sum);
    }
    previous = magnitude;
  }

  // an onset is a rise well above the usual
  const mean = flux.reduce((sum, value) => sum + value, 0) / (flux.length || 1);
  let onsets = 0;
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] > mean * 1.6 && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) onsets += 1;
  }

  const total = chroma.reduce((sum, value) => sum + value, 0) || 1;
  return {
    chroma: chroma.map((value) => value / total),
    onsets: onsets / (samples.length / rate),
    seconds: samples.length / rate,
    energy: energy / (samples.length / rate)
  };
}

/**
 * Where the music sits, in semitones from the A above middle C. The profile
 * is over absolute pitch rather than pitch class, so holding two of them
 * against each other says **how many semitones apart** two renderings are -
 * which is the answer to "how many octaves is it out".
 */
export function pitchProfile (samples, rate = RATE) {
  const profile = new Array(96).fill(0);   // eight octaves from A0
  const window = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) window[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/WINDOW);

  for (let start = 0; start + WINDOW <= samples.length; start += HOP) {
    const re = new Float32Array(WINDOW);
    const im = new Float32Array(WINDOW);
    for (let i = 0; i < WINDOW; i++) re[i] = samples[start + i]*window[i];
    fft(re, im);
    for (let bin = 1; bin < WINDOW/2; bin++) {
      const frequency = bin*rate/WINDOW;
      if (frequency < 55 || frequency > 4200) continue;
      const semitone = Math.round(12*Math.log2(frequency/55)); // from A1
      if (semitone >= 0 && semitone < 96) profile[semitone] += Math.hypot(re[bin], im[bin]);
    }
  }
  const total = profile.reduce((sum, value) => sum + value, 0) || 1;
  return profile.map((value) => value/total);
}

/**
 * How far apart two absolute pitch profiles are, in semitones: the shift that
 * makes them line up best.
 */
export function bestShift (ours, theirs) {
  let best = { shift: 0, score: -1 };
  for (let shift = -36; shift <= 36; shift++) {
    let dot = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i < ours.length; i++) {
      const j = i + shift;
      const value = (j >= 0 && j < ours.length) ? ours[j] : 0;
      dot += value*theirs[i];
      a += value*value;
      b += theirs[i]*theirs[i];
    }
    const score = dot/(Math.sqrt(a)*Math.sqrt(b) || 1);
    if (score > best.score) best = { shift: -shift, score };
  }
  return best;
}

/**
 * How much the loudness moves: the short term level of the sound, and how
 * deeply it dips between the notes. A tune whose notes are separate has a
 * lively envelope; one whose notes run into each other and drone has a flat
 * one, whatever it is playing.
 *
 * @returns {{swing: number, quiet: number}} the spread of the level around
 *   its mean, and how much of the time it is below a fifth of it.
 */
export function envelope (samples, rate = RATE) {
  const block = Math.round(rate*0.02);
  const levels = [];
  for (let start = 0; start + block <= samples.length; start += block) {
    let sum = 0;
    for (let i = 0; i < block; i++) sum += samples[start + i]*samples[start + i];
    levels.push(Math.sqrt(sum/block));
  }
  const mean = levels.reduce((sum, value) => sum + value, 0)/(levels.length || 1);
  let variance = 0;
  let quiet = 0;
  for (const level of levels) {
    variance += (level - mean)*(level - mean);
    if (level < mean*0.2) quiet += 1;
  }
  return {
    swing: Math.sqrt(variance/(levels.length || 1))/(mean || 1),
    quiet: quiet/(levels.length || 1)
  };
}

/**
 * Where the sound sits in the spectrum: its centre of gravity, and how much
 * of it is above two kilohertz. A tone that is too bright - too much high
 * harmonic content - is what a listener calls buzzy or sawing, and no
 * comparison of notes or of loudness will show it.
 */
export function brightness (samples, rate = RATE) {
  const window = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) window[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/WINDOW);
  let weighted = 0;
  let total = 0;
  let high = 0;
  for (let start = 0; start + WINDOW <= samples.length; start += HOP*4) {
    const re = new Float32Array(WINDOW);
    const im = new Float32Array(WINDOW);
    for (let i = 0; i < WINDOW; i++) re[i] = samples[start + i]*window[i];
    fft(re, im);
    for (let bin = 1; bin < WINDOW/2; bin++) {
      const frequency = bin*rate/WINDOW;
      const magnitude = Math.hypot(re[bin], im[bin]);
      weighted += frequency*magnitude;
      total += magnitude;
      if (frequency > 2000) high += magnitude;
    }
  }
  return { centre: weighted/(total || 1), above2k: high/(total || 1) };
}

/**
 * The beat, found without guessing: the flux of the spectrum over time is a
 * curve with a peak at every note, and the strongest periodicity of that
 * curve is the beat. Reported as the period in seconds and as beats a minute.
 */
export function tempo (samples, rate = RATE) {
  const window = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) window[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/WINDOW);
  const flux = [];
  let previous = null;
  for (let start = 0; start + WINDOW <= samples.length; start += HOP) {
    const re = new Float32Array(WINDOW);
    const im = new Float32Array(WINDOW);
    for (let i = 0; i < WINDOW; i++) re[i] = samples[start + i]*window[i];
    fft(re, im);
    const magnitude = new Float32Array(WINDOW/2);
    for (let bin = 1; bin < WINDOW/2; bin++) magnitude[bin] = Math.hypot(re[bin], im[bin]);
    if (previous) {
      let sum = 0;
      for (let bin = 1; bin < WINDOW/2; bin++) {
        const rise = magnitude[bin] - previous[bin];
        if (rise > 0) sum += rise;
      }
      flux.push(sum);
    }
    previous = magnitude;
  }
  const mean = flux.reduce((sum, value) => sum + value, 0)/(flux.length || 1);
  const centred = flux.map((value) => value - mean);
  const perSecond = rate/HOP;
  let best = { lag: 0, score: -Infinity };
  for (let lag = Math.round(perSecond*0.15); lag < Math.round(perSecond*2) && lag < centred.length/2; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < centred.length; i++) sum += centred[i]*centred[i + lag];
    const score = sum/(centred.length - lag);
    if (score > best.score) best = { lag, score };
  }
  // The strongest periodicity can land on a multiple of the beat, so the
  // three best candidates are reported and the caller can see the family.
  const scores = [];
  for (let lag = Math.round(perSecond*0.15); lag < Math.round(perSecond*2) && lag < centred.length/2; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < centred.length; i++) sum += centred[i]*centred[i + lag];
    scores.push({ period: lag/perSecond, score: sum/(centred.length - lag) });
  }
  const peaks = scores.filter((entry, index) =>
    index > 0 && index < scores.length-1 && entry.score >= scores[index-1].score && entry.score > scores[index+1].score)
    .sort((a, b) => b.score - a.score).slice(0, 3);
  const period = best.lag/perSecond;
  return { period, bpm: period ? 60/period : 0, peaks: peaks.map((entry) => +entry.period.toFixed(3)) };
}

/** How alike two pitch class profiles are, 1 being the same. */
export function similarity (ours, theirs) {
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let i = 0; i < 12; i++) {
    dot += ours[i] * theirs[i];
    a += ours[i] * ours[i];
    b += theirs[i] * theirs[i];
  }
  return dot / (Math.sqrt(a) * Math.sqrt(b) || 1);
}

/** Renders one of our tracks. */
export function renderTrack (image, track, options, seconds) {
  const chip = new OPL2({ sampleRate: RATE });
  const player = image.music(track, options);
  const step = Math.max(1, Math.round(player.samplesPerStep * RATE / OPL2.SAMPLE_RATE));
  const total = Math.round(seconds * RATE);
  const samples = new Float32Array(total);
  const block = new Float32Array(step);
  let at = 0;
  while (at < total) {
    player.step((register, value) => chip.write(register, value));
    const count = Math.min(step, total - at);
    chip.render(block, count);
    samples.set(block.subarray(0, count), at);
    at += count;
  }
  return samples;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = argv.indexOf(name);
    return at === -1 ? fallback : argv[at + 1];
  };
  if (argv.includes('--effects')) {
    // What can be checked about the effects without a recording: that they
    // sound, that they stop, and that they are all different.
    const image = new SoundImage(JSON.parse(readFileSync('data/sound/adlib.json', 'utf8')));
    const profiles = [];
    let problems = 0;
    let checks = 0;
    for (let index = 0; index < image.effects.length; index++) {
      const chip = new OPL2({ sampleRate: RATE });
      const player = image.effect(index);
      const step = Math.max(1, Math.round(player.samplesPerStep * RATE / OPL2.SAMPLE_RATE));
      const samples = new Float32Array(RATE * 3);
      const block = new Float32Array(step);
      let at = 0;
      let stopped = 0;
      while (at < samples.length) {
        player.step((register, value) => chip.write(register, value));
        if (player.finished && !stopped) stopped = at;
        const count = Math.min(step, samples.length - at);
        chip.render(block, count);
        samples.set(block.subarray(0, count), at);
        at += count;
      }
      // how long it is audible, and what it sounds like
      let peak = 0;
      let last = 0;
      for (let i = 0; i < samples.length; i++) {
        const value = Math.abs(samples[i]);
        if (value > peak) peak = value;
        if (value > 0.002) last = i;
      }
      const profile = analyse(samples).chroma;
      profiles.push(profile);

      checks += 2;
      const silent = peak < 0.005;
      const endless = !stopped;
      if (silent) problems += 1;
      if (endless) problems += 1;
      console.log(`  ${String(index + 1).padStart(2)} ${(EFFECT_NAMES?.[index + 1] ?? '').padEnd(16)} ` +
        `peak ${peak.toFixed(3)}, sounds for ${(last / RATE).toFixed(2)} s, ` +
        `driver stops after ${(stopped / RATE).toFixed(2)} s` +
        `${silent ? '  SILENT' : ''}${endless ? '  NEVER STOPS' : ''}`);
    }
    // no two the same
    for (let a = 0; a < profiles.length; a++) {
      for (let b = a + 1; b < profiles.length; b++) {
        checks += 1;
        if (similarity(profiles[a], profiles[b]) > 0.9999) {
          problems += 1;
          console.log(`  DIFFERENCE effects ${a + 1} and ${b + 1} are the same sound`);
        }
      }
    }
    console.log(`matchmusic.mjs --effects: ${checks} checks, ${problems} problems`);
    process.exit(problems ? 1 : 0);
  }

  const referencePath = option('--reference', null);
  if (!referencePath) throw new Error('--reference <wav> is required');
  const seconds = Number(option('--seconds', 30));
  const out = option('--out', 'build/matchmusic');

  const reference = readWAV(referencePath);
  // The same stretch of both, from a little in so the first bar is not alone.
  const from = Math.round(5 * reference.rate);
  const theirs = analyse(reference.samples.subarray(from, from + Math.round(seconds * reference.rate)), reference.rate);
  console.log(`reference ${referencePath}`);
  console.log(`  ${theirs.seconds.toFixed(1)} s, ${theirs.onsets.toFixed(1)} onsets a second`);
  console.log(`  pitch classes: ${theirs.chroma.map((value) => value.toFixed(3)).join(' ')}`);

  const image = new SoundImage(JSON.parse(readFileSync('data/sound/adlib.json', 'utf8')));
  mkdirSync(out, { recursive: true });

  if (argv.includes('--search')) {
    // Every track, every reading of the transpose, every octave: which one is
    // the same music?
    const results = [];
    for (let track = 0; track < image.tracks.length; track++) {
      for (const mode of ['ignore', 'subtract', 'add']) {
        for (const shift of [0, 12, 24, 36]) {
          const ours = analyse(renderTrack(image, track, { transposeMode: mode, shift }, seconds));
          results.push({
            track, mode, shift,
            similarity: similarity(ours.chroma, theirs.chroma),
            onsets: ours.onsets
          });
        }
      }
    }
    results.sort((a, b) => b.similarity - a.similarity);
    console.log('\nthe ten closest:');
    for (const result of results.slice(0, 10)) {
      console.log(`  track ${String(result.track).padStart(2)} ${result.mode.padEnd(8)} +${String(result.shift).padStart(2)}  ` +
        `pitch classes ${(result.similarity * 100).toFixed(1)} %  ${result.onsets.toFixed(1)} onsets/s ` +
        `(reference ${theirs.onsets.toFixed(1)})`);
    }
    process.exit(0);
  }

  const track = Number(option('--track', 0));
  const mode = option('--transpose', 'add');
  const shift = Number(option('--shift', 0));
  const ours = analyse(renderTrack(image, track, { transposeMode: mode, shift }, seconds));
  console.log(`\nours: track ${track}, ${mode}, +${shift}`);
  console.log(`  ${ours.onsets.toFixed(1)} onsets a second`);
  console.log(`  pitch classes: ${ours.chroma.map((value) => value.toFixed(3)).join(' ')}`);
  // And how many semitones apart the two are, which answers the octave.
  const theirPitch = pitchProfile(reference.samples.subarray(from, from + Math.round(seconds*reference.rate)), reference.rate);
  const ourPitch = pitchProfile(renderTrack(image, track, { transposeMode: mode, shift }, seconds));
  const fit = bestShift(ourPitch, theirPitch);
  console.log(`\nmatchmusic.mjs: pitch classes ${(similarity(ours.chroma, theirs.chroma) * 100).toFixed(1)} % alike, ` +
    `onsets ${ours.onsets.toFixed(1)} against ${theirs.onsets.toFixed(1)} a second`);
  console.log(`  ours sits ${fit.shift > 0 ? fit.shift + ' semitones below' : fit.shift < 0 ? (-fit.shift) + ' semitones above' : 'exactly where'} ` +
    `the original (${(fit.score*100).toFixed(1)} % alike at that shift)`);

  const theirEnvelope = envelope(reference.samples.subarray(from, from + Math.round(seconds*reference.rate)), reference.rate);
  const ourEnvelope = envelope(renderTrack(image, track, { transposeMode: mode, shift }, seconds));
  console.log(`  loudness moves ${ourEnvelope.swing.toFixed(2)} against ${theirEnvelope.swing.toFixed(2)}, ` +
    `quiet ${(ourEnvelope.quiet*100).toFixed(0)} % of the time against ${(theirEnvelope.quiet*100).toFixed(0)} %`);

  const theirBright = brightness(reference.samples.subarray(from, from + Math.round(seconds*reference.rate)), reference.rate);
  const ourBright = brightness(renderTrack(image, track, { transposeMode: mode, shift }, seconds));
  console.log(`  centre of the spectrum ${ourBright.centre.toFixed(0)} Hz against ${theirBright.centre.toFixed(0)} Hz, ` +
    `above 2 kHz ${(ourBright.above2k*100).toFixed(0)} % against ${(theirBright.above2k*100).toFixed(0)} %`);

  const theirTempo = tempo(reference.samples.subarray(from, from + Math.round(seconds*reference.rate)), reference.rate);
  const ourTempo = tempo(renderTrack(image, track, { transposeMode: mode, shift }, seconds));
  console.log(`  beat every ${ourTempo.period.toFixed(3)} s (${ourTempo.bpm.toFixed(0)} a minute) ` +
    `against ${theirTempo.period.toFixed(3)} s (${theirTempo.bpm.toFixed(0)} a minute)`);
  console.log(`  candidates: ours ${ourTempo.peaks.join(' ')} s, theirs ${theirTempo.peaks.join(' ')} s`);
}
