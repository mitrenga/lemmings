#!/usr/bin/env node
/**
 * dumpsound - takes the sound driver of the game apart.
 *
 * DOS Lemmings has no samples: every sound and every one of the twenty one music
 * tracks is a program for the AdLib chip inside `adlib.dat`. This writes the
 * unpacked driver and its tables into `data/sound/adlib.json`, which is what
 * the game reads, and prints what is in it.
 *
 * usage: node tools/dumpsound.mjs [--in assets/original/game] [--data data]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSoundImage, checkSoundImage, EFFECT_NAMES, TRACK_COUNT, EFFECT_COUNT } from './lib/soundImage.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};

const inDirectory = option('--in', 'assets/original/game');
const dataDirectory = option('--data', 'data');

const image = parseSoundImage(new Uint8Array(readFileSync(join(inDirectory, 'adlib.dat'))));
const problems = checkSoundImage(image);

const directory = join(dataDirectory, 'sound');
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'adlib.json'), `${JSON.stringify({
  size: image.bytes.length,
  offsets: image.offsets,
  tracks: image.tracks,
  effects: image.effects,
  effectNames: EFFECT_NAMES,
  // The driver is run as it is, so the bytes go along whole.
  bytes: Buffer.from(image.bytes).toString('base64')
})}\n`);

if (!argv.includes('--quiet')) {
  console.log(`music tracks (${TRACK_COUNT}): ${image.tracks.join(' ')}`);
  console.log(`effects (${EFFECT_COUNT}):`);
  for (let i = 0; i < EFFECT_COUNT; i++) {
    console.log(`  ${String(i + 1).padStart(2)} ${(EFFECT_NAMES[i + 1] ?? '?').padEnd(16)} at ${image.effects[i]}`);
  }
  for (const problem of problems) console.log(`  PROBLEM ${problem}`);
}
console.log(`dumpsound.mjs: ${image.bytes.length} bytes, ${TRACK_COUNT} tracks, ${EFFECT_COUNT} effects, ` +
  `${problems.length} problems -> ${join(directory, 'adlib.json')}`);
process.exit(problems.length ? 1 : 0);
