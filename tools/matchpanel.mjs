#!/usr/bin/env node
/**
 * matchpanel - the acceptance test of milestone L5.
 *
 * Holds our panel against screenshots of the original, pixel by pixel in RGB,
 * exactly the way `matchlevel.mjs` does it for the game window - only the
 * bottom forty lines of the screen are compared, and the state the panel is in
 * comes from a scripted run so that both sides show the same thing.
 *
 * A screenshot is named `<pack>-<level>@<frame>.png`, for example
 * `level009-01@0200.png`: the level it is from and the frame of the game it
 * was taken on. What has to be in it is in `sources/media/panel/README.md`.
 *
 * usage: node tools/matchpanel.mjs [--media sources/media/panel]
 *                                  [--out build/matchpanel] [--selftest]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { encodeIndexedPNG, encodeRGBAPNG, decodePNG } from '../app/svision/tools/retro/png.mjs';
import { GameWorker } from '../app/gameWorker.js';
import { LemPalette } from '../app/lem/palette.js';
import { Panel } from '../app/lem/panel.js';

const DEFAULT_MEDIA = 'sources/media/panel';
const DEFAULT_OUT = 'build/matchpanel';
const DATA = 'data';
const WIDTH = 320;
const SCREEN_HEIGHT = 200;

const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Runs a level to a given frame and returns the whole screen as RGBA. */
export function renderScreen (pack, index, frame, options = {}) {
  const level = readJSON(join(DATA, 'levels', `${pack}.json`)).levels[index];
  if (!level) throw new Error(`${pack} has no level ${index}`);
  const messages = [];
  const worker = new GameWorker((message) => messages.push(message));
  worker.handleMessage({ id: 'init', seed: options.seed ?? 0 });
  worker.handleMessage({
    id: 'level',
    headless: true,
    level,
    set: readJSON(join(DATA, 'sets', `set${level.graphicsSet}.json`)),
    main: readJSON(join(DATA, 'main', 'lemmings.json')),
    panel: readJSON(join(DATA, 'main', 'panel.json')),
    special: level.specialSet > 0 ? readJSON(join(DATA, 'special', `spec${level.specialSet - 1}.json`)) : null
  });
  if (options.skill) worker.handleMessage({ id: 'select', skill: options.skill });
  if (options.pointer) worker.handleMessage({ id: 'pointer', x: options.pointer.x, y: options.pointer.y });
  for (let i = 0; i < frame; i++) worker.tick();

  const colours = LemPalette.inLevel(level.specialSet > 0
    ? readJSON(join(DATA, 'special', `spec${level.specialSet - 1}.json`)).palette
    : readJSON(join(DATA, 'sets', `set${level.graphicsSet}.json`)).palette.custom);
  const rgba = new Uint8Array(WIDTH * SCREEN_HEIGHT * 4);
  for (let i = 0; i < worker.screen.bytes.length; i++) {
    const colour = colours[worker.screen.bytes[i]] ?? [0, 0, 0];
    rgba[i * 4] = Math.round(colour[0] * 255 / 63);
    rgba[i * 4 + 1] = Math.round(colour[1] * 255 / 63);
    rgba[i * 4 + 2] = Math.round(colour[2] * 255 / 63);
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, worker };
}

/** Only the panel, the bottom forty lines. */
export function comparePanel (ours, theirs) {
  let checks = 0;
  let differences = 0;
  const diff = new Uint8Array(WIDTH * Panel.HEIGHT);
  for (let y = 0; y < Panel.HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const at = ((Panel.TOP + y) * WIDTH + x) * 4;
      checks += 1;
      const same = ours[at] === theirs[at] && ours[at + 1] === theirs[at + 1] && ours[at + 2] === theirs[at + 2];
      if (!same) {
        differences += 1;
        diff[y * WIDTH + x] = 1;
      }
    }
  }
  return { checks, differences, diff };
}

/** `level009-01@0200.png` -> `{pack, index, frame}` */
export function parseShotName (name) {
  const match = /^(level\d{3})-(\d{2})@(\d+)\.png$/i.exec(basename(name));
  if (!match) return null;
  return { pack: match[1].toLowerCase(), index: Number(match[2]), frame: Number(match[3]) };
}

/** A test of the tool: the panel matches itself, and another frame does not. */
export function selfTest (report = () => {}) {
  let checks = 0;
  let differences = 0;
  const ours = renderScreen('level009', 1, 200, { skill: 'digger', pointer: { x: 120, y: 70 } }).rgba;

  const same = comparePanel(ours, ours);
  checks += 1;
  if (same.differences !== 0) { differences += 1; report('  DIFFERENCE self test: the panel does not match itself'); }
  else report(`self test identical panel     ${same.checks} checks, 0 differences`);

  // Two hundred frames later the clock and the counters have moved on.
  const later = renderScreen('level009', 1, 400, { skill: 'digger', pointer: { x: 120, y: 70 } }).rgba;
  const moved = comparePanel(ours, later);
  checks += 1;
  if (moved.differences === 0) { differences += 1; report('  DIFFERENCE self test: a later frame looks the same'); }
  else report(`self test a later frame       ${moved.differences} differing pixels, as it should`);

  return { checks, differences };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = argv.indexOf(name);
    return at === -1 ? fallback : argv[at + 1];
  };
  const media = option('--media', DEFAULT_MEDIA);
  const out = option('--out', DEFAULT_OUT);
  const report = (line) => console.log(line);

  const self = selfTest(report);
  if (argv.includes('--selftest')) {
    console.log(`matchpanel.mjs: ${self.checks} self tests, ${self.differences} differences`);
    process.exit(self.differences === 0 ? 0 : 1);
  }

  const names = existsSync(media)
    ? readdirSync(media).filter((name) => name.toLowerCase().endsWith('.png')).sort()
    : [];
  if (!names.length) {
    console.log(`matchpanel.mjs: 0 panels, no golden record in ${media} - see its README.md`);
    process.exit(1);
  }

  let checks = 0;
  let differences = 0;
  for (const name of names) {
    const shot = parseShotName(name);
    if (!shot) {
      console.log(`  ${name}: the name does not say which level and frame it shows, skipped`);
      continue;
    }
    const png = decodePNG(readFileSync(join(media, name)));
    if (png.width !== WIDTH || png.height !== SCREEN_HEIGHT) {
      console.log(`  ${name}: ${png.width}x${png.height}, expected 320x200`);
      differences += 1;
      continue;
    }
    const { rgba } = renderScreen(shot.pack, shot.index, shot.frame);
    const result = comparePanel(rgba, png.rgba);
    checks += result.checks;
    differences += result.differences;
    console.log(`${name.padEnd(28)} ${result.checks} checks, ${result.differences} differences`);
    if (result.differences) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `${basename(name, '.png')}-diff.png`),
        encodeIndexedPNG(WIDTH, Panel.HEIGHT, result.diff, [0, 0, 0, 255, 0, 0], { scale: 2 }));
      writeFileSync(join(out, `${basename(name, '.png')}-ours.png`),
        encodeRGBAPNG(WIDTH, SCREEN_HEIGHT, rgba, 2));
    }
  }
  console.log(`matchpanel.mjs: ${names.length} panels, ${checks} checks, ${differences} differences`);
  process.exit(differences === 0 && self.differences === 0 ? 0 : 1);
}
