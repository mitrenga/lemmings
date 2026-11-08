/**
 * `main.dat` - the graphics that do not belong to any one graphics set: the
 * lemmings themselves, the masks their skills cut out of the terrain, the
 * countdown digits, the panel and the fonts, and the main menu.
 *
 * Seven sections come out of the container. This module decodes the two the
 * game needs first: section 0, the lemming animations, and section 1, the
 * terrain masks and the countdown font.
 *
 * The tables below are positions inside those sections. They come from the
 * document of ccexplore and Mindless
 * (`sources/reference/formats/lemmings_main_dat_file_format.txt`); the foot
 * point of every animation - the pixel of the picture that sits where the
 * lemming's position is - is not in that document and is taken from the table
 * in Lemmix (`Styles.Base.pas`), which is why every animation carries it here
 * rather than the physics code guessing it.
 */

import { decodePlanar, bitmapSize, planeSize } from './planarBitmap.mjs';

/** `[offset, name, frames, width, height, bpp, footX, footY, loops]` */
export const ANIMATIONS = [
  [0x0000, 'walking', 8, 16, 10, 2, 8, 10, true],
  [0x0140, 'jumping', 1, 16, 10, 2, 8, 10, false],
  [0x0168, 'walkingLeft', 8, 16, 10, 2, 8, 10, true],
  [0x02a8, 'jumpingLeft', 1, 16, 10, 2, 8, 10, false],
  [0x02d0, 'digging', 16, 16, 14, 3, 8, 12, true],
  [0x0810, 'climbing', 8, 16, 12, 2, 8, 12, true],
  [0x0990, 'climbingLeft', 8, 16, 12, 2, 8, 12, true],
  [0x0b10, 'drowning', 16, 16, 10, 2, 8, 10, false],
  [0x0d90, 'hoisting', 8, 16, 12, 2, 8, 12, false],
  [0x0f10, 'hoistingLeft', 8, 16, 12, 2, 8, 12, false],
  [0x1090, 'building', 16, 16, 13, 3, 8, 13, true],
  [0x1570, 'buildingLeft', 16, 16, 13, 3, 8, 13, true],
  [0x1a50, 'bashing', 32, 16, 10, 3, 8, 10, true],
  [0x21d0, 'bashingLeft', 32, 16, 10, 3, 8, 10, true],
  [0x2950, 'mining', 24, 16, 13, 3, 8, 13, true],
  [0x30a0, 'miningLeft', 24, 16, 13, 3, 8, 13, true],
  [0x37f0, 'falling', 4, 16, 10, 2, 8, 10, true],
  [0x3890, 'fallingLeft', 4, 16, 10, 2, 8, 10, true],
  [0x3930, 'floating', 8, 16, 16, 3, 8, 16, true],
  [0x3c30, 'floatingLeft', 8, 16, 16, 3, 8, 16, true],
  [0x3f30, 'splatting', 16, 16, 10, 2, 8, 10, false],
  [0x41b0, 'exiting', 8, 16, 13, 2, 8, 13, false],
  [0x4350, 'vaporizing', 14, 16, 14, 4, 8, 14, false],
  [0x4970, 'blocking', 16, 16, 10, 2, 8, 10, true],
  [0x4bf0, 'shrugging', 8, 16, 10, 2, 8, 10, false],
  [0x4d30, 'shruggingLeft', 8, 16, 10, 2, 8, 10, false],
  [0x4e70, 'ohNoing', 16, 16, 10, 2, 8, 10, false],
  [0x50f0, 'exploding', 1, 32, 32, 3, 16, 25, false]
];

/** `[offset, name, frames, width, height]`, all one bit - section 1. */
export const MASKS = [
  [0x0000, 'bash', 4, 16, 10],
  [0x0050, 'bashLeft', 4, 16, 10],
  [0x00a0, 'mine', 2, 16, 13],
  [0x00d4, 'mineLeft', 2, 16, 13],
  [0x0108, 'explosion', 1, 16, 22]
];

/** The countdown digits, 9 down to 0, one bit, 8x8 - section 1. */
export const COUNTDOWN_FIRST = 0x0134;

/**
 * The panel of the standard machine mode - section 6. The whole bottom of the
 * screen, 320x40: the skill buttons, the frame of the mini map and the empty
 * strip the status line is written into.
 */
export const PANEL_OFFSET = 0x0000;
export const PANEL_WIDTH = 320;
export const PANEL_HEIGHT = 40;

/**
 * The font of the status line, 8x16, three bits per pixel, in section 6 right
 * after the panel. Thirty eight glyphs in this order.
 */
export const STATUS_FONT_OFFSET = 0x1900;
export const STATUS_FONT_STEP = 0x30;
export const STATUS_CHARACTERS = '%0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The digits over the skill buttons, 8x8 and one bit - section 2. Every digit
 * is stored twice, first with the four pixels on the right half, then on the
 * left, so that a two digit number can be put together out of two halves.
 */
export const SKILL_DIGITS_OFFSET = 0x1900;

/**
 * @param {Uint8Array} section section 0 of `main.dat`
 * @returns {Array} one entry per animation, frames as indices
 */
export function decodeAnimations (section) {
  return ANIMATIONS.map(([offset, name, frames, width, height, bpp, footX, footY, loops]) => {
    const size = bitmapSize(width, height, bpp);
    const pictures = [];
    for (let frame = 0; frame < frames; frame++) {
      pictures.push(decodePlanar(section, offset + frame * size, width, height, bpp));
    }
    return { name, offset, width, height, bitsPerPixel: bpp, footX, footY, loops, frames: pictures };
  });
}

/**
 * The panel and the two fonts that belong to it.
 *
 * @param {Uint8Array} panelSection section 6 of `main.dat`
 * @param {Uint8Array} highPerfSection section 2, for the skill digits
 */
export function decodePanel (panelSection, highPerfSection) {
  const panel = decodePlanar(panelSection, PANEL_OFFSET, PANEL_WIDTH, PANEL_HEIGHT, 4);

  const font = {};
  STATUS_CHARACTERS.split('').forEach((character, index) => {
    font[character] = decodePlanar(panelSection, STATUS_FONT_OFFSET + index * STATUS_FONT_STEP, 8, 16, 3);
  });

  // Right half first, then left half, for every digit.
  const digits = [];
  for (let digit = 0; digit < 10; digit++) {
    digits.push({
      right: decodePlanar(highPerfSection, SKILL_DIGITS_OFFSET + digit * 16, 8, 8, 1),
      left: decodePlanar(highPerfSection, SKILL_DIGITS_OFFSET + digit * 16 + 8, 8, 8, 1)
    });
  }

  return { panel, font, digits };
}

/**
 * @param {Uint8Array} section section 1 of `main.dat`
 * @returns {{masks: Array, countdown: Array}}
 */
export function decodeMasks (section) {
  const masks = MASKS.map(([offset, name, frames, width, height]) => {
    const size = planeSize(width, height);
    const pictures = [];
    for (let frame = 0; frame < frames; frame++) {
      pictures.push(decodePlanar(section, offset + frame * size, width, height, 1));
    }
    return { name, offset, width, height, frames: pictures };
  });

  const countdown = [];
  for (let digit = 0; digit < 10; digit++) {
    // They are stored 9 first, 0 last.
    countdown[9 - digit] = decodePlanar(section, COUNTDOWN_FIRST + digit * 8, 8, 8, 1);
  }
  return { masks, countdown };
}
