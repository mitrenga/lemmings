#!/usr/bin/env node
/**
 * rendersound - plays a music track or a sound effect of the game through our
 * OPL2 and writes it out as a WAV, so it can be listened to without a browser.
 *
 * This is the only way to check the sound at all before the chip is wired into
 * the application: the game has no samples, everything is the AdLib driver
 * writing registers, and whether that comes out sounding like Lemmings is a
 * question for the ear.
 *
 * usage: node tools/rendersound.mjs [--track 0] [--effect 8] [--seconds 20]
 *                                   [--rate 44100] [--out build/sound]
 *                                   [--all-effects]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { OPL2 } from '../app/svision/js/audio/chip/opl2.js';
import { PCMSample } from '../app/svision/js/audio/pcmSample.js';
import { SoundImage } from '../app/lem/soundImage.js';
import { EFFECT_NAMES } from './lib/soundImage.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};

/**
 * Runs a player and renders what the chip makes of it.
 * @param {SoundImagePlayer} player
 * @param {number} seconds
 * @param {number} rate - the sample rate of the WAV.
 * @returns {{samples: Float32Array, writes: number, peak: number}}
 */
export function render (player, seconds, rate, options = {}) {
  const chip = new OPL2({ sampleRate: rate });
  // The driver runs on the chip's own clock; at another output rate the step
  // is the same number of chip samples, scaled.
  const step = Math.max(1, Math.round(player.samplesPerStep * rate / OPL2.SAMPLE_RATE));
  const total = Math.round(seconds * rate);
  const samples = new Float32Array(total);
  const block = new Float32Array(step);

  let writes = 0;
  let at = 0;
  while (at < total) {
    player.step((register, value) => {
      writes += 1;
      // A diagnostic, not a fix: with every operator's frequency multiple
      // forced to one, a patch whose carrier multiplies the note can be told
      // apart from a mistake in the notes themselves.
      if (options.mult1 && (register & 0xE0) === 0x20) value = (value & 0xF0) | 1;
      // One channel at a time, to hear what each voice of a track is doing.
      if (options.only !== undefined && (register & 0xF0) === 0xB0 &&
          (register & 0x0F) !== options.only) value &= ~0x20;
      chip.write(register, value);
    });
    const count = Math.min(step, total - at);
    chip.render(block, count);
    samples.set(block.subarray(0, count), at);
    at += count;
  }

  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  return { samples, writes, peak };
}

function write (name, result, rate, out) {
  mkdirSync(out, { recursive: true });
  // The WAV is written a little louder than the chip's own level, which is
  // mixed for nine channels at once.
  // Half scale, not nine tenths: the sum of nine channels has peaks the
  // average does not show, and pushing it to the top clips them into buzz.
  const gain = result.peak > 0 ? Math.min(8, 0.5 / result.peak) : 1;
  const loud = new Float32Array(result.samples.length);
  for (let i = 0; i < result.samples.length; i++) loud[i] = result.samples[i] * gain;
  const wav = new PCMSample(loud, rate).toWAV(16);
  writeFileSync(join(out, `${name}.wav`), Buffer.from(wav));
  console.log(`${name.padEnd(22)} ${result.writes} register writes, peak ${result.peak.toFixed(3)}, ` +
    `gain ${gain.toFixed(1)} -> ${join(out, `${name}.wav`)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rate = Number(option('--rate', 44100));
  const seconds = Number(option('--seconds', 20));
  const out = option('--out', 'build/sound');
  const image = new SoundImage(JSON.parse(readFileSync('data/sound/adlib.json', 'utf8')));
  const transposeMode = option('--transpose', 'add');
  const shift = Number(option('--shift', 0));
  const mult1 = argv.includes('--mult1');
  const only = argv.includes('--channel') ? Number(option('--channel', 0)) : undefined;

  if (argv.includes('--variants')) {
    // The one open question of the driver: what the instrument's byte 8 does
    // to a note. Three readings, three files, one listening test.
    const track = Number(option('--track', 0));
    // The two open questions at once: what the instrument's byte 8 does, and
    // how many octaves the tune is missing.
    for (const mode of ['ignore', 'subtract']) {
      for (const octaves of [0, 12, 24]) {
        write(`track${String(track).padStart(2, '0')}-${mode}+${octaves}`,
          render(image.music(track, { transposeMode: mode, shift: octaves }), seconds, rate, { mult1 }), rate, out);
      }
    }
    process.exit(0);
  }

  if (argv.includes('--all-effects')) {
    for (let i = 0; i < image.effects.length; i++) {
      write(`effect${String(i + 1).padStart(2, '0')}-${EFFECT_NAMES[i + 1] ?? 'unknown'}`,
        render(image.effect(i, { transposeMode, shift }), 2, rate), rate, out);
    }
  } else if (argv.includes('--effect')) {
    const number = Number(option('--effect', 8));
    write(`effect${String(number).padStart(2, '0')}-${EFFECT_NAMES[number] ?? 'unknown'}`,
      render(image.effect(number - 1, { transposeMode, shift }), Number(option('--seconds', 2)), rate), rate, out);
  } else {
    const track = Number(option('--track', 0));
    write(`track${String(track).padStart(2, '0')}${mult1 ? '-mult1' : ''}${only === undefined ? '' : '-channel' + only}`,
      render(image.music(track, { transposeMode, shift }), seconds, rate, { mult1, only }), rate, out);
  }
}
