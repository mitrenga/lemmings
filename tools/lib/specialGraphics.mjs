/**
 * `vgaspec<n>.dat` - the whole terrain of one of the four special levels, in
 * one 960x160 picture instead of a list of pieces.
 *
 * Inside the container there is a second, byte oriented layer
 * (`decodeSpecialChunks`); before it come 40 bytes of palette: eight VGA
 * entries that become colours 8..15, then sixteen bytes of what ccexplore
 * took for the EGA palette. What comes out of the second layer are four
 * chunks of 14400 bytes, each one 40 lines of a **three** plane planar
 * bitmap, and its colours map 0 -> 0, 1..7 -> 9..15.
 *
 * Source: `sources/reference/formats/lemmings_vgaspecx_dat_file_format.txt`.
 */

import { decodeSpecialChunks } from './datContainer.mjs';
import { decodePlanar } from './planarBitmap.mjs';

export const SPECIAL_WIDTH = 960;
export const SPECIAL_HEIGHT = 160;
export const CHUNK_LINES = 40;
export const CHUNK_SIZE = 14400;
export const PALETTE_BYTES = 40;

/**
 * @param {Uint8Array} section the single section of `vgaspec<n>.dat`
 * @returns {{palette: number[][], ega: number[], pixels: Uint8Array}}
 */
export function parseSpecialGraphics (section) {
  const palette = [];
  for (let i = 0; i < 8; i++) {
    palette.push([section[i * 3] & 0x3f, section[i * 3 + 1] & 0x3f, section[i * 3 + 2] & 0x3f]);
  }
  const ega = Array.from(section.subarray(24, PALETTE_BYTES));

  const chunks = decodeSpecialChunks(section.subarray(PALETTE_BYTES));
  if (chunks.length !== 4) throw new Error(`${chunks.length} chunks, expected 4`);

  const pixels = new Uint8Array(SPECIAL_WIDTH * SPECIAL_HEIGHT);
  chunks.forEach((chunk, index) => {
    if (chunk.length !== CHUNK_SIZE) throw new Error(`chunk ${index} is ${chunk.length} bytes, expected ${CHUNK_SIZE}`);
    const part = decodePlanar(chunk, 0, SPECIAL_WIDTH, CHUNK_LINES, 3);
    // Three planes give 0..7; the game shows them as 0 and 9..15.
    for (let i = 0; i < part.length; i++) part[i] = part[i] === 0 ? 0 : part[i] + 8;
    pixels.set(part, index * CHUNK_LINES * SPECIAL_WIDTH);
  });

  return { palette, ega, pixels };
}
