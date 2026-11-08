/**
 * `adlib.dat` - the sound driver of DOS Lemmings, and with it every sound the
 * game makes. There are **no digitised samples anywhere in the game**: both
 * the music and the effects are little programs that write registers of the
 * AdLib's YM3812 (OPL2) chip, and the driver runs them.
 *
 * The file is a "sound image": a few tables near the front - the instruments,
 * the frequencies, the octaves - and two tables of pointers, one to the
 * twenty one music tracks and one to the eighteen effects. Every pointer leads to
 * a stream of bytes the driver walks through, writing registers and waiting.
 *
 * The offsets of those tables are not in the file; they are known from the
 * Lemmings.ts configuration (MIT, read as documentation) and verified here
 * against the data: with them every pointer lands inside the file and the
 * tables grow the way they should.
 *
 * ★ The pointers are **little endian**, although the reader of Lemmings.ts
 * calls its method `readWordBE`; read as big endian they point past the end
 * of the file.
 */

import { decompressFile } from './datContainer.mjs';

/** Where the tables sit in the unpacked `adlib.dat` of DOS Lemmings. */
export const OFFSETS = {
  channelConfig: 1452,
  data: 2215,
  frequencies: 2343,
  octaves: 2727,
  frequencyCount: 2823,
  tracks: 2926,
  effectData: 21731,
  effects: 21989
};

/**
 * ★ **Twenty one**, not twenty. Lemmings.ts says twenty in its configuration
 * and we believed it; the table of pointers at 2926 runs to 2966 - twenty one
 * words - and the twenty first (21303) lands inside the file just like the
 * rest, ahead of the effect data at 21731. Lemmix cycles twenty one tunes
 * through the hundred and twenty levels, which is the same number (2026-09-15).
 */
export const TRACK_COUNT = 21;
export const EFFECT_COUNT = 18;

/**
 * The effects by the number the game uses for them - the same numbers the
 * graphics sets carry for their traps (`trap_sound_effect_id`). Index in the
 * sound image is that number minus one.
 * ★ The names come from the format document; that the index is the number
 * minus one is our reading and has to be confirmed by ear.
 */
export const EFFECT_NAMES = {
  1: 'skillSelect', 2: 'entrance', 3: 'letsGo', 4: 'assignSkill', 5: 'ohNo',
  6: 'electrode', 7: 'squisher', 8: 'splat', 9: 'slicer', 10: 'steel',
  11: 'unknown11', 12: 'explosion', 13: 'fire', 14: 'tenTon', 15: 'bearTrap',
  16: 'exit', 17: 'drown', 18: 'builderWarning'
};

const word = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);

/**
 * @param {Uint8Array} file the packed `adlib.dat`
 * @returns {{bytes: Uint8Array, tracks: number[], effects: number[], offsets: object}}
 */
export function parseSoundImage (file) {
  const bytes = decompressFile(file)[0].data;

  const tracks = [];
  for (let i = 0; i < TRACK_COUNT; i++) tracks.push(word(bytes, OFFSETS.tracks + i * 2));
  const effects = [];
  for (let i = 0; i < EFFECT_COUNT; i++) effects.push(word(bytes, OFFSETS.effects + i * 2));

  return { bytes, tracks, effects, offsets: { ...OFFSETS } };
}

/** Whether every pointer lands inside the file and the tables climb. */
export function checkSoundImage (image) {
  const problems = [];
  const inside = (value) => value > 0 && value < image.bytes.length;
  image.tracks.forEach((pointer, index) => {
    if (!inside(pointer)) problems.push(`track ${index} points to ${pointer}`);
  });
  image.effects.forEach((pointer, index) => {
    if (!inside(pointer)) problems.push(`effect ${index} points to ${pointer}`);
  });
  for (const name of Object.keys(OFFSETS)) {
    if (!inside(OFFSETS[name])) problems.push(`the ${name} table is at ${OFFSETS[name]}`);
  }
  return problems;
}
