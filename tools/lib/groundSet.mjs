/**
 * `ground<n>o.dat` - the description of one graphics set: what its sixteen
 * objects and sixty four terrain pieces look like, where their bitmaps sit in
 * `vgagr<n>.dat`, where an object's trigger area is and what it does to a
 * lemming, and the eight colours the set adds to the palette.
 *
 * The file is not packed and always 1056 bytes = 16*28 + 64*8 + 96. Unlike
 * the level records, its words are **little endian**.
 *
 * Source: `sources/reference/formats/lemmings_vgagrx_dat_groundxo_dat_file_format.txt`.
 */

import { decodePlanar, decodeMask, planeSize, bitmapSize } from './planarBitmap.mjs';

export const GROUND_SIZE = 1056;
export const OBJECT_SLOTS = 16;
export const TERRAIN_SLOTS = 64;
export const OBJECT_ENTRY = 28;
export const TERRAIN_ENTRY = 8;

/** What an object does to a lemming that walks into its trigger area. */
export const TRIGGER_EFFECT = {
  0: 'none',
  1: 'exit',
  4: 'trap',          // the lemming is removed at once; the animation shows one
  5: 'drown',
  6: 'disintegrate',
  7: 'oneWayLeft',
  8: 'oneWayRight',
  9: 'steel'          // no object of the game uses it
};

/**
 * The seven fixed colours of the in-level palette, in the 6 bit components of
 * the VGA DAC. Index 7 is not fixed: the game copies the first colour of the
 * set into it, and draws the builder's bricks and the mini map with it.
 */
export const FIXED_COLOURS = [
  [0x00, 0x00, 0x00], // black, also transparent
  [0x10, 0x10, 0x38], // blue - the lemmings' bodies
  [0x00, 0x2c, 0x00], // green - hair
  [0x3c, 0x34, 0x34], // white - skin
  [0x2c, 0x2c, 0x00], // dirty yellow - the panel
  [0x3c, 0x08, 0x08], // red - the nuke icon
  [0x20, 0x20, 0x20]  // grey - the panel
];

function readObjectInfo (view, offset) {
  return {
    animationFlags: view.getUint16(offset, true),
    startFrame: view.getUint8(offset + 2),
    // The document calls this "end_animation_frame_index", but it is the
    // number of frames: the exit of set 0 has a 1 here and its data really is
    // one frame long (the next object starts one frameSize later). Lemmix
    // reads it as a count too.
    frameCount: view.getUint8(offset + 3),
    width: view.getUint8(offset + 4),
    height: view.getUint8(offset + 5),
    frameSize: view.getUint16(offset + 6, true),
    maskOffset: view.getUint16(offset + 8, true),
    unknown1: view.getUint16(offset + 10, true),
    unknown2: view.getUint16(offset + 12, true),
    triggerLeft: view.getUint16(offset + 14, true),
    triggerTop: view.getUint16(offset + 16, true),
    triggerWidth: view.getUint8(offset + 18),
    triggerHeight: view.getUint8(offset + 19),
    triggerEffect: view.getUint8(offset + 20),
    framesOffset: view.getUint16(offset + 21, true),
    // And this is not an index either but a location in the same section, so
    // the frame it means has to be worked out from the frame size.
    previewLocation: view.getUint16(offset + 23, true),
    unknown3: view.getUint16(offset + 25, true),
    trapSound: view.getUint8(offset + 27)
  };
}

function readTerrainInfo (view, offset) {
  return {
    width: view.getUint8(offset),
    height: view.getUint8(offset + 1),
    imageOffset: view.getUint16(offset + 2, true),
    maskOffset: view.getUint16(offset + 4, true),
    unknown1: view.getUint16(offset + 6, true)
  };
}

/** One palette of eight VGA entries, as 6 bit components. */
function readVgaPalette (bytes, offset) {
  const colours = [];
  for (let i = 0; i < 8; i++) {
    colours.push([bytes[offset + i * 3] & 0x3f, bytes[offset + i * 3 + 1] & 0x3f, bytes[offset + i * 3 + 2] & 0x3f]);
  }
  return colours;
}

/**
 * Parses `ground<n>o.dat`.
 *
 * @param {Uint8Array} bytes the whole, unpacked file
 * @returns {{objects: object[], terrain: object[], palettes: object}}
 */
export function parseGroundFile (bytes) {
  if (bytes.length !== GROUND_SIZE) {
    throw new Error(`ground file is ${bytes.length} bytes, expected ${GROUND_SIZE}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);

  const objects = [];
  for (let i = 0; i < OBJECT_SLOTS; i++) {
    const info = readObjectInfo(view, i * OBJECT_ENTRY);
    info.index = i;
    // An empty slot is all zeros; a picture with no size cannot be drawn.
    info.used = info.width > 0 && info.height > 0;
    info.previewFrame = info.used && info.frameSize > 0
      ? Math.max(0, Math.round((info.previewLocation - info.framesOffset) / info.frameSize))
      : 0;
    // The game keeps its trigger map at a resolution of four pixels, and the
    // numbers in the file are in those units.
    info.trigger = info.used
      ? {
          left: info.triggerLeft * 4,
          top: info.triggerTop * 4 - 4,
          width: info.triggerWidth * 4,
          height: info.triggerHeight * 4,
          effect: TRIGGER_EFFECT[info.triggerEffect] ?? `unknown${info.triggerEffect}`
        }
      : null;
    objects.push(info);
  }

  const terrainBase = OBJECT_SLOTS * OBJECT_ENTRY;
  const terrain = [];
  for (let i = 0; i < TERRAIN_SLOTS; i++) {
    const info = readTerrainInfo(view, terrainBase + i * TERRAIN_ENTRY);
    info.index = i;
    info.used = info.width > 0 && info.height > 0;
    terrain.push(info);
  }

  const palettesBase = terrainBase + TERRAIN_SLOTS * TERRAIN_ENTRY;
  const palettes = {
    // The three EGA palettes come first, one byte each entry; the remake
    // does not use them, but they are kept so the file is fully described.
    egaCustom: Array.from(bytes.subarray(palettesBase, palettesBase + 8)),
    egaStandard: Array.from(bytes.subarray(palettesBase + 8, palettesBase + 16)),
    egaPreview: Array.from(bytes.subarray(palettesBase + 16, palettesBase + 24)),
    vgaCustom: readVgaPalette(bytes, palettesBase + 24),
    vgaStandard: readVgaPalette(bytes, palettesBase + 48),
    vgaPreview: readVgaPalette(bytes, palettesBase + 72)
  };

  return { objects, terrain, palettes };
}

/**
 * Cuts the pictures of the set out of the two sections of `vgagr<n>.dat`.
 *
 * Section one holds the terrain, section two the objects (ccexplore had it the
 * other way round at first; Simon corrected it). Both are 4 bits per pixel,
 * with a one plane mask beside each picture.
 *
 * @param {object} ground the result of {@link parseGroundFile}
 * @param {Uint8Array} terrainSection first section of `vgagr<n>.dat`
 * @param {Uint8Array} objectSection second section
 */
export function decodeGraphics (ground, terrainSection, objectSection) {
  const terrain = ground.terrain.map((info) => {
    if (!info.used) return { ...info, pixels: null, mask: null };
    return {
      ...info,
      pixels: decodePlanar(terrainSection, info.imageOffset, info.width, info.height, 4),
      mask: decodeMask(terrainSection, info.maskOffset, info.width, info.height)
    };
  });

  const objects = ground.objects.map((info) => {
    if (!info.used) return { ...info, frames: [] };
    const frames = [];
    for (let frame = 0; frame < info.frameCount; frame++) {
      const base = info.framesOffset + frame * info.frameSize;
      if (base + bitmapSize(info.width, info.height, 4) > objectSection.length) break;
      frames.push({
        pixels: decodePlanar(objectSection, base, info.width, info.height, 4),
        mask: decodeMask(objectSection, base + info.maskOffset, info.width, info.height)
      });
    }
    return { ...info, frames };
  });

  return { terrain, objects, palettes: ground.palettes };
}

/** How many bytes the pictures of one terrain piece occupy. */
export function terrainBytes (info) {
  return bitmapSize(info.width, info.height, 4) + planeSize(info.width, info.height);
}
