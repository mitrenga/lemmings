#!/usr/bin/env node
/**
 * dumpdat - turns the data files of the game into open formats.
 *
 * Two stages, because they have different homes:
 *
 * - `--what sections` (L1) splits every DAT container into its sections. Those
 *   are still the original bytes of the game, so they go to `build/dat/`,
 *   outside version control, with a `manifest.json` describing them.
 * - `--what graphics|levels|special` (L2) decodes them: the graphics sets, the
 *   levels and the special levels, into `data/` as JSON with base64 pixels -
 *   one byte per pixel, colour index 0..15 - plus PNG sheets for the eye.
 *   `data/` is what the game itself reads at run time.
 *
 * Usage:
 *   node tools/dumpdat.mjs [--in assets/original/game] [--out build/dat]
 *                          [--data data] [--what all|sections|graphics|levels|special]
 *                          [--only <file name>] [--quiet]
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { decompressFile, looksPacked, decodeSpecialChunks } from './lib/datContainer.mjs';
import { parseGroundFile, decodeGraphics, FIXED_COLOURS } from './lib/groundSet.mjs';
import { parseLevel, parseOddTable, GRAPHICS_SETS } from './lib/levelRecord.mjs';
import { parseSpecialGraphics, SPECIAL_WIDTH, SPECIAL_HEIGHT } from './lib/specialGraphics.mjs';
import { decodeAnimations, decodeMasks, decodePanel, PANEL_WIDTH, PANEL_HEIGHT, STATUS_CHARACTERS } from './lib/mainData.mjs';
import { encodeIndexedPNG } from '../app/svision/tools/retro/png.mjs';

const DEFAULT_IN = 'assets/original/game';
const DEFAULT_OUT = 'build/dat';
const DEFAULT_DATA = 'data';
const SET_COUNT = 5;
const SPECIAL_COUNT = 4;

/** What the remake needs each file for, and what its sections hold. */
const KNOWN = {
  'main.dat': {
    what: 'shared graphics',
    sections: [
      'lemming animations',
      'countdown digits and the terrain destruction masks',
      'panel and fonts of the PS/2 and high performance modes',
      'menu background, logo, signs, music and FX icons',
      'purple font, blinking eyes, scroller, rating signs',
      'unknown - identical in main.dat and cgamain.dat',
      'panel and green font of the standard mode'
    ]
  },
  'oddtable.dat': { what: 'the levels that differ between editions, 80 records of 56 bytes', plain: true },
  'adlib.dat': { what: 'AdLib sound driver: effects and music' },
  'tandysnd.dat': { what: 'Tandy sound driver - out of scope' }
};

function describe (name, sectionCount) {
  if (KNOWN[name]) return KNOWN[name].what;
  if (/^level\d{3}\.dat$/.test(name)) return `${sectionCount} levels of 2048 bytes`;
  if (/^ground\d o?\.dat$/.test(name.replace(/(\d)/, '$1 '))) return 'graphics set description';
  if (/^vgagr\d\.dat$/.test(name)) return 'graphics set bitmaps: terrain, then objects';
  if (/^vgaspec\d\.dat$/.test(name)) return 'terrain of one special level, wrapped twice';
  if (/^cga|^tga/.test(name)) return 'CGA or Tandy graphics - out of scope';
  return 'unidentified';
}

function parseArguments (argv) {
  const options = { in: DEFAULT_IN, out: DEFAULT_OUT, data: DEFAULT_DATA, what: 'all', only: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--in': options.in = argv[++i]; break;
      case '--out': options.out = argv[++i]; break;
      case '--data': options.data = argv[++i]; break;
      case '--what': options.what = argv[++i]; break;
      case '--only': options.only = argv[++i].toLowerCase(); break;
      case '--quiet': options.quiet = true; break;
      default: throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  if (!['all', 'sections', 'graphics', 'levels', 'special', 'lemmings'].includes(options.what)) {
    throw new Error(`--what ${options.what}: expected all, sections, graphics, levels, special or lemmings`);
  }
  return options;
}

// --------------------------------------------------------------- the decoders

const base64 = (bytes) => Buffer.from(bytes).toString('base64');

/** Reads and unpacks one file of the game. */
function sectionsOf (directory, name) {
  const buffer = new Uint8Array(readFileSync(join(directory, name)));
  return looksPacked(buffer) ? decompressFile(buffer).map((section) => section.data) : [buffer];
}

/** The sixteen in-level colours as 8-bit r, g, b, for the PNG sheets. */
function pngPalette (setColours) {
  const colours = [...FIXED_COLOURS, setColours[0], ...setColours];
  const bytes = [];
  for (const colour of colours) for (const component of colour) bytes.push(Math.round(component * 255 / 63));
  return bytes;
}

/** Lays bitmaps out under each other into one sheet, for the eye only. */
function sheetOf (pictures) {
  const width = Math.max(1, ...pictures.map((picture) => picture.width));
  const height = pictures.reduce((sum, picture) => sum + picture.height, 0) || 1;
  const pixels = new Uint8Array(width * height);
  let top = 0;
  for (const picture of pictures) {
    for (let y = 0; y < picture.height; y++) {
      pixels.set(picture.pixels.subarray(y * picture.width, (y + 1) * picture.width), (top + y) * width);
    }
    top += picture.height;
  }
  return { width, height, pixels };
}

/**
 * The five graphics sets: `ground<n>o.dat` + `vgagr<n>.dat` -> one JSON each.
 *
 * Terrain masks are not stored: every terrain piece of the game has a mask
 * that is exactly "the pixel is not transparent" (checked on all of them, see
 * MILNIKY.md), so the game derives it. Object masks are stored, because 38 of
 * the 592 object frames do differ.
 */
export function dumpGraphics (options) {
  const directory = join(options.data, 'sets');
  mkdirSync(directory, { recursive: true });
  const written = [];

  for (let number = 0; number < SET_COUNT; number++) {
    const ground = parseGroundFile(new Uint8Array(readFileSync(join(options.in, `ground${number}o.dat`))));
    const [terrainSection, objectSection] = sectionsOf(options.in, `vgagr${number}.dat`);
    const set = decodeGraphics(ground, terrainSection, objectSection);

    let storedMasks = 0;
    const terrain = set.terrain.map((piece) => piece.used
      ? { id: piece.index, width: piece.width, height: piece.height, pixels: base64(piece.pixels) }
      : null);

    const objects = set.objects.map((object) => {
      if (!object.used) return null;
      const frames = object.frames.map((frame) => {
        const derived = frame.pixels.every((value, index) => (value === 0 ? 0 : 1) === frame.mask[index]);
        if (!derived) storedMasks += 1;
        return derived
          ? { pixels: base64(frame.pixels) }
          : { pixels: base64(frame.pixels), mask: base64(frame.mask) };
      });
      return {
        id: object.index,
        width: object.width,
        height: object.height,
        animationFlags: object.animationFlags,
        startFrame: object.startFrame,
        frameCount: object.frameCount,
        previewFrame: object.previewFrame,
        trigger: object.trigger,
        sound: object.trapSound,
        frames
      };
    });

    const json = {
      set: number,
      name: GRAPHICS_SETS[number],
      palette: {
        custom: set.palettes.vgaCustom,
        preview: set.palettes.vgaPreview,
        standard: set.palettes.vgaStandard,
        egaCustom: set.palettes.egaCustom
      },
      terrain,
      objects
    };
    writeFileSync(join(directory, `set${number}.json`), `${JSON.stringify(json)}\n`);

    // Sheets, so a human can look at what came out.
    const palette = pngPalette(set.palettes.vgaCustom);
    const terrainSheet = sheetOf(set.terrain.filter((piece) => piece.used));
    writeFileSync(join(directory, `set${number}-terrain.png`),
      encodeIndexedPNG(terrainSheet.width, terrainSheet.height, terrainSheet.pixels, palette, { transparent: 0 }));
    const objectFrames = set.objects.filter((object) => object.used)
      .flatMap((object) => object.frames.map((frame) => ({ width: object.width, height: object.height, pixels: frame.pixels })));
    const objectSheet = sheetOf(objectFrames);
    writeFileSync(join(directory, `set${number}-objects.png`),
      encodeIndexedPNG(objectSheet.width, objectSheet.height, objectSheet.pixels, palette, { transparent: 0 }));

    written.push({
      set: number,
      name: GRAPHICS_SETS[number],
      terrain: terrain.filter(Boolean).length,
      objects: objects.filter(Boolean).length,
      frames: objectFrames.length,
      storedMasks
    });
  }
  return written;
}

/** The eighty level records and the odd table, as JSON. */
export function dumpLevels (options) {
  const directory = join(options.data, 'levels');
  mkdirSync(directory, { recursive: true });
  const packs = readdirSync(options.in).filter((name) => /^level\d{3}\.dat$/i.test(name)).sort();
  let count = 0;

  for (const pack of packs) {
    const levels = sectionsOf(options.in, pack).map((section, index) => ({ index, ...parseLevel(section) }));
    count += levels.length;
    const stem = basename(pack.toLowerCase(), '.dat');
    writeFileSync(join(directory, `${stem}.json`), `${JSON.stringify({ file: stem, levels }, null, 1)}\n`);
  }

  const odd = parseOddTable(new Uint8Array(readFileSync(join(options.in, 'oddtable.dat'))));
  writeFileSync(join(directory, 'oddtable.json'), `${JSON.stringify({ entries: odd }, null, 1)}\n`);
  return { packs: packs.length, levels: count, oddEntries: odd.length };
}

/**
 * `main.dat`: the lemming animations and the masks the skills cut with. They
 * belong to no graphics set, so they get their own file under `data/main/`.
 */
export function dumpLemmings (options) {
  const directory = join(options.data, 'main');
  mkdirSync(directory, { recursive: true });
  const sections = sectionsOf(options.in, 'main.dat');
  const animations = decodeAnimations(sections[0]);
  const { masks, countdown } = decodeMasks(sections[1]);

  writeFileSync(join(directory, 'lemmings.json'), `${JSON.stringify({
    animations: animations.map((animation) => ({
      name: animation.name,
      width: animation.width,
      height: animation.height,
      footX: animation.footX,
      footY: animation.footY,
      loops: animation.loops,
      frames: animation.frames.map(base64)
    })),
    masks: masks.map((mask) => ({
      name: mask.name, width: mask.width, height: mask.height, frames: mask.frames.map(base64)
    })),
    countdown: countdown.map(base64)
  })}\n`);

  // One sheet per animation, frames side by side, for the eye.
  const palette = pngPalette([[52, 32, 8], [48, 20, 4], [36, 8, 4], [24, 0, 4], [16, 16, 20], [24, 24, 28], [28, 36, 0], [8, 24, 8]]);
  const strip = { width: 0, height: 0, pixels: null };
  const rows = animations.map((animation) => {
    const width = animation.width * animation.frames.length;
    const pixels = new Uint8Array(width * animation.height);
    animation.frames.forEach((frame, index) => {
      for (let y = 0; y < animation.height; y++) {
        pixels.set(frame.subarray(y * animation.width, (y + 1) * animation.width), y * width + index * animation.width);
      }
    });
    return { width, height: animation.height, pixels };
  });
  strip.width = Math.max(...rows.map((row) => row.width));
  strip.height = rows.reduce((sum, row) => sum + row.height, 0);
  strip.pixels = new Uint8Array(strip.width * strip.height);
  let top = 0;
  for (const row of rows) {
    for (let y = 0; y < row.height; y++) {
      strip.pixels.set(row.pixels.subarray(y * row.width, (y + 1) * row.width), (top + y) * strip.width);
    }
    top += row.height;
  }
  writeFileSync(join(directory, 'lemmings.png'),
    encodeIndexedPNG(strip.width, strip.height, strip.pixels, palette, { transparent: 0, scale: 2 }));

  // The panel and its two fonts - the same file, a different part of it.
  const { panel, font, digits } = decodePanel(sections[6], sections[2]);
  writeFileSync(join(directory, 'panel.json'), `${JSON.stringify({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    pixels: base64(panel),
    font: Object.fromEntries(STATUS_CHARACTERS.split('').map((character) => [character, base64(font[character])])),
    fontWidth: 8,
    fontHeight: 16,
    digits: digits.map((digit) => ({ left: base64(digit.left), right: base64(digit.right) }))
  })}\n`);
  writeFileSync(join(directory, 'panel.png'),
    encodeIndexedPNG(PANEL_WIDTH, PANEL_HEIGHT, panel, palette, { scale: 2 }));

  return {
    panel: PANEL_WIDTH + 'x' + PANEL_HEIGHT,
    glyphs: STATUS_CHARACTERS.length,
    animations: animations.length,
    frames: animations.reduce((sum, animation) => sum + animation.frames.length, 0),
    masks: masks.length,
    maskFrames: masks.reduce((sum, mask) => sum + mask.frames.length, 0)
  };
}

/** The four special levels: one 960x160 picture each. */
export function dumpSpecial (options) {
  const directory = join(options.data, 'special');
  mkdirSync(directory, { recursive: true });
  const written = [];
  for (let number = 0; number < SPECIAL_COUNT; number++) {
    const [section] = sectionsOf(options.in, `vgaspec${number}.dat`);
    const special = parseSpecialGraphics(section);
    writeFileSync(join(directory, `spec${number}.json`), `${JSON.stringify({
      special: number,
      width: SPECIAL_WIDTH,
      height: SPECIAL_HEIGHT,
      palette: special.palette,
      ega: special.ega,
      pixels: base64(special.pixels)
    })}\n`);
    writeFileSync(join(directory, `spec${number}.png`),
      encodeIndexedPNG(SPECIAL_WIDTH, SPECIAL_HEIGHT, special.pixels, pngPalette(special.palette), { transparent: 0 }));
    written.push({ special: number, colours: special.palette.length });
  }
  return written;
}

export function dumpDirectory (options) {
  const names = readdirSync(options.in)
    .filter((name) => name.toLowerCase().endsWith('.dat'))
    .filter((name) => !options.only || name.toLowerCase() === options.only)
    .sort();
  if (!names.length) throw new Error(`no .dat files in ${options.in}`);

  rmSync(options.out, { recursive: true, force: true });
  mkdirSync(options.out, { recursive: true });

  const manifest = { source: options.in, files: [] };
  let sectionCount = 0;
  let packedCount = 0;
  let badChecksums = 0;

  for (const name of names) {
    const key = name.toLowerCase();
    const buffer = new Uint8Array(readFileSync(join(options.in, name)));
    const stem = basename(key, '.dat');
    const directory = join(options.out, stem);
    mkdirSync(directory, { recursive: true });

    if (!looksPacked(buffer)) {
      writeFileSync(join(directory, `${stem}.bin`), buffer);
      manifest.files.push({
        name: key, packed: false, size: buffer.length,
        what: describe(key, 0), sections: []
      });
      continue;
    }

    packedCount += 1;
    const sections = decompressFile(buffer);
    sectionCount += sections.length;
    const entries = sections.map((section, index) => {
      const file = `${stem}-${String(index).padStart(2, '0')}.bin`;
      writeFileSync(join(directory, file), section.data);
      if (!section.checksumOk) badChecksums += 1;
      const entry = {
        index,
        file,
        packedSize: section.header.compressedSize,
        size: section.data.length,
        checksumOk: section.checksumOk,
        what: KNOWN[key]?.sections?.[index] ?? null
      };
      // The special graphics carry a second, byte oriented layer inside.
      if (/^vgaspec\d$/.test(stem)) {
        const chunks = decodeSpecialChunks(section.data.subarray(40));
        entry.specialChunks = chunks.map((chunk) => chunk.length);
        chunks.forEach((chunk, order) => {
          writeFileSync(join(directory, `${stem}-${String(index).padStart(2, '0')}-chunk${order}.bin`), chunk);
        });
      }
      return entry;
    });

    manifest.files.push({
      name: key,
      packed: true,
      size: buffer.length,
      what: describe(key, sections.length),
      sections: entries
    });
  }

  manifest.totals = {
    files: manifest.files.length,
    packedFiles: packedCount,
    plainFiles: manifest.files.length - packedCount,
    sections: sectionCount,
    badChecksums
  };
  writeFileSync(join(options.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArguments(process.argv.slice(2));
  const wants = (stage) => options.what === 'all' || options.what === stage;
  let failed = false;

  if (wants('sections')) {
    const manifest = dumpDirectory(options);
    if (!options.quiet) {
      for (const file of manifest.files) {
        const sizes = file.packed ? file.sections.map((section) => section.size).join(' + ') : `${file.size} plain`;
        console.log(`${file.name.padEnd(14)} ${String(file.sections.length).padStart(2)} sections  ${sizes}`);
      }
    }
    const totals = manifest.totals;
    console.log(
      `dumpdat.mjs sections: ${totals.files} files (${totals.packedFiles} packed, ${totals.plainFiles} plain), ` +
      `${totals.sections} sections, ${totals.badChecksums} bad checksums -> ${options.out}`
    );
    failed ||= totals.badChecksums !== 0;
  }

  if (wants('graphics')) {
    const sets = dumpGraphics(options);
    if (!options.quiet) {
      for (const set of sets) {
        console.log(`set${set.set} ${set.name.padEnd(8)} ${String(set.terrain).padStart(2)} terrain pieces, ` +
          `${set.objects} objects in ${set.frames} frames, ${set.storedMasks} frames with a stored mask`);
      }
    }
    const frames = sets.reduce((sum, set) => sum + set.frames, 0);
    const masks = sets.reduce((sum, set) => sum + set.storedMasks, 0);
    console.log(`dumpdat.mjs graphics: ${sets.length} sets, ` +
      `${sets.reduce((sum, set) => sum + set.terrain, 0)} terrain pieces, ` +
      `${sets.reduce((sum, set) => sum + set.objects, 0)} objects in ${frames} frames ` +
      `(${masks} need their own mask) -> ${join(options.data, 'sets')}`);
  }

  if (wants('levels')) {
    const levels = dumpLevels(options);
    console.log(`dumpdat.mjs levels: ${levels.levels} levels in ${levels.packs} files, ` +
      `odd table ${levels.oddEntries} entries -> ${join(options.data, 'levels')}`);
  }

  if (wants('lemmings')) {
    const main = dumpLemmings(options);
    console.log(`dumpdat.mjs lemmings: ${main.animations} animations in ${main.frames} frames, ` +
      `${main.masks} masks in ${main.maskFrames} frames, 10 countdown digits, ` +
      `panel ${main.panel} with ${main.glyphs} glyphs -> ${join(options.data, 'main')}`);
  }

  if (wants('special')) {
    const special = dumpSpecial(options);
    console.log(`dumpdat.mjs special: ${special.length} special levels ${SPECIAL_WIDTH}x${SPECIAL_HEIGHT} ` +
      `-> ${join(options.data, 'special')}`);
  }

  process.exit(failed ? 1 : 0);
}
