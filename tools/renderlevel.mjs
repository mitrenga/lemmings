#!/usr/bin/env node
/**
 * renderlevel - builds a level the way the game builds it and writes it out as
 * a picture: the whole 1584x160 world, and optionally the 320x160 window the
 * player actually sees.
 *
 * The drawing is done by the game's own code (`app/lem/levelBuilder.js`) into a
 * `VGAVideoRAM`, coloured with a `VGAPalette` composed by `app/lem/palette.js`,
 * out of the JSON under `data/`. So what comes out is what the remake will put
 * on the screen - which is what `tools/matchlevel.mjs` holds against DOSBox
 * screenshots for the acceptance of L2.
 *
 * usage: node tools/renderlevel.mjs [--pack level009] [--level 1]
 *                                   [--out build/levels] [--window]
 *                                   [--scale 1] [--no-objects] [--mask] [--all]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodeIndexedPNG } from '../app/svision/tools/retro/png.mjs';
import { LevelBuilder } from '../app/lem/levelBuilder.js';
import { GraphicsSet } from '../app/lem/graphicsSet.js';
import { LemPalette } from '../app/lem/palette.js';

const DATA = 'data';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const flag = (name) => argv.includes(name);

const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Loads one level and everything it needs to be drawn. */
export function loadLevel (pack, index, data = DATA) {
  const levels = readJSON(join(data, 'levels', `${pack}.json`)).levels;
  const level = levels[index];
  if (!level) throw new Error(`${pack} has no level ${index}`);
  const graphics = new GraphicsSet(readJSON(join(data, 'sets', `set${level.graphicsSet}.json`)));
  let special = null;
  if (level.specialSet > 0) {
    const json = readJSON(join(data, 'special', `spec${level.specialSet - 1}.json`));
    special = {
      width: json.width,
      height: json.height,
      pixels: GraphicsSet.fromBase64(json.pixels),
      palette: json.palette
    };
  }
  return { level, graphics, special };
}

/** Builds the world and returns it with the palette it is painted with. */
export function renderLevel (pack, index, options = {}) {
  const { level, graphics, special } = loadLevel(pack, index, options.data ?? DATA);
  const builder = new LevelBuilder(level, graphics, special).build(options.objects !== false);
  // A special level replaces the eight colours of the set with its own.
  const colours = special ? special.palette : graphics.colours;
  return { builder, level, palette: LemPalette.inLevel(colours) };
}

/** The palette in the 8-bit components a PNG wants. */
function pngPalette (colours) {
  const bytes = [];
  for (const colour of colours) for (const component of colour) bytes.push(Math.round(component * 255 / 63));
  return bytes;
}

function writeLevel (pack, index, out, options) {
  const { builder, level, palette } = renderLevel(pack, index, options);
  const scale = Number(options.scale ?? 1);
  mkdirSync(out, { recursive: true });
  const stem = `${pack}-${String(index).padStart(2, '0')}`;

  const world = options.window
    ? builder.window(level.startX)
    : builder.videoRAM;
  writeFileSync(join(out, `${stem}.png`),
    encodeIndexedPNG(world.width, world.height, world.bytes, pngPalette(palette), { scale }));

  if (options.mask) {
    // The terrain mask in black and white - this is what the skills cut into.
    const white = [0, 0, 0, 255, 255, 255];
    writeFileSync(join(out, `${stem}-mask.png`),
      encodeIndexedPNG(LevelBuilder.WIDTH, LevelBuilder.HEIGHT, builder.mask, white, { scale }));
  }

  const solid = builder.mask.reduce((sum, value) => sum + value, 0);
  return { stem, name: level.name, set: level.graphicsSetName, special: level.specialSet, solid, terrain: level.terrain.length, objects: level.objects.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = option('--out', 'build/levels');
  const options = {
    window: flag('--window'),
    mask: flag('--mask'),
    objects: !flag('--no-objects'),
    scale: option('--scale', 1)
  };

  const written = [];
  if (flag('--all')) {
    for (let pack = 0; pack < 10; pack++) {
      for (let index = 0; index < 8; index++) written.push(writeLevel(`level00${pack}`, index, out, options));
    }
  } else {
    const pack = option('--pack', 'level009');
    const index = Number(option('--level', 1));
    written.push(writeLevel(pack, index, out, options));
  }

  for (const entry of written.slice(0, flag('--all') ? 5 : written.length)) {
    console.log(`${entry.stem}  ${entry.name.padEnd(32)} set ${entry.set}${entry.special ? ` special ${entry.special}` : ''}, ` +
      `${entry.terrain} pieces, ${entry.objects} objects, ${entry.solid} solid pixels`);
  }
  console.log(`renderlevel.mjs: ${written.length} levels -> ${out}`);
}
