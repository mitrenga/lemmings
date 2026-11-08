#!/usr/bin/env node
/**
 * matchlevel - the acceptance test of milestone L2.
 *
 * Holds our render of a level against a screenshot of the original taken in
 * DOSBox, pixel by pixel in RGB, and reports the number of checks and the
 * number of differences. Nothing else counts as "the level is drawn right":
 * the picture looking plausible is not a measurement.
 *
 * The golden record lives in `sources/media/levels/`, one PNG per screenshot,
 * named `<pack>-<level>@<x>.png` - the level it shows and the scroll position
 * the window was at, for example `level009-01@0624.png`. A screenshot may be
 * 320x200 (the whole screen, panel included) or 320x160 (the game window
 * only), and any whole multiple of those, because DOSBox scales.
 *
 * Only lines 0..159 are compared - the panel is milestone L5. Areas that hold
 * lemmings or the cursor, which a still picture of the level cannot contain,
 * are listed per screenshot in `sources/media/levels/masks.json` and counted
 * separately.
 *
 * usage: node tools/matchlevel.mjs [--media sources/media/levels]
 *                                  [--out build/matchlevel] [--find] [--selftest]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { encodeIndexedPNG, encodeRGBAPNG, decodePNG } from '../app/svision/tools/retro/png.mjs';
import { LevelBuilder } from '../app/lem/levelBuilder.js';
import { renderLevel } from './renderlevel.mjs';

const DEFAULT_MEDIA = 'sources/media/levels';
const DEFAULT_OUT = 'build/matchlevel';
const WINDOW_WIDTH = 320;
const WINDOW_HEIGHT = 160;

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const flag = (name) => argv.includes(name);

/** `level009-01@0624.png` -> `{pack, index, x}` */
export function parseShotName (name) {
  const match = /^(level\d{3})-(\d{2})@(-?\d+)\.png$/i.exec(basename(name));
  if (!match) return null;
  return { pack: match[1].toLowerCase(), index: Number(match[2]), x: Number(match[3]) };
}

/** The picture as RGBA at 1:1, whatever whole scale it was saved at. */
export function unscale (png) {
  const scaleX = png.width / WINDOW_WIDTH;
  const scaleY = png.height % WINDOW_HEIGHT === 0 ? png.height / WINDOW_HEIGHT : png.height / 200;
  if (!Number.isInteger(scaleX) || !Number.isInteger(scaleY) || scaleX < 1 || scaleX !== scaleY) {
    throw new Error(`${png.width}x${png.height} is not 320x200 or 320x160 at a whole scale`);
  }
  const rgba = new Uint8Array(WINDOW_WIDTH * WINDOW_HEIGHT * 4);
  for (let y = 0; y < WINDOW_HEIGHT; y++) {
    for (let x = 0; x < WINDOW_WIDTH; x++) {
      const from = ((y * scaleY) * png.width + x * scaleX) * 4;
      rgba.set(png.rgba.subarray(from, from + 4), (y * WINDOW_WIDTH + x) * 4);
    }
  }
  return rgba;
}

/** Our window of the level, in the same RGBA form. */
export function renderWindow (pack, index, x, options = {}) {
  const { builder, palette } = renderLevel(pack, index, options);
  const window = builder.window(x);
  const rgba = new Uint8Array(WINDOW_WIDTH * WINDOW_HEIGHT * 4);
  for (let i = 0; i < window.bytes.length; i++) {
    const colour = palette[window.bytes[i]] ?? [0, 0, 0];
    rgba[i * 4] = Math.round(colour[0] * 255 / 63);
    rgba[i * 4 + 1] = Math.round(colour[1] * 255 / 63);
    rgba[i * 4 + 2] = Math.round(colour[2] * 255 / 63);
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/**
 * @returns {{checks: number, differences: number, masked: number}} one check
 *   per compared pixel.
 */
export function compare (ours, theirs, masks = []) {
  const inMask = (x, y) => masks.some((area) =>
    x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height);

  let checks = 0;
  let differences = 0;
  let masked = 0;
  const diff = new Uint8Array(WINDOW_WIDTH * WINDOW_HEIGHT);
  for (let y = 0; y < WINDOW_HEIGHT; y++) {
    for (let x = 0; x < WINDOW_WIDTH; x++) {
      const at = (y * WINDOW_WIDTH + x) * 4;
      const same = ours[at] === theirs[at] && ours[at + 1] === theirs[at + 1] && ours[at + 2] === theirs[at + 2];
      if (inMask(x, y)) {
        if (!same) masked += 1;
        diff[y * WINDOW_WIDTH + x] = same ? 0 : 2;
        continue;
      }
      checks += 1;
      if (!same) {
        differences += 1;
        diff[y * WINDOW_WIDTH + x] = 1;
      }
    }
  }
  return { checks, differences, masked, diff };
}

/**
 * A test of the tool, not of the game: a copy of our own render has to match
 * itself, the same picture at double size too, and a different level has to
 * come out as thousands of differences.
 */
export function selfTest (report = () => {}) {
  let checks = 0;
  let differences = 0;
  const ours = renderWindow('level009', 1, 624);

  const same = compare(ours, ours);
  checks += 1;
  if (same.differences !== 0) { differences += 1; report('  DIFFERENCE self test: a picture does not match itself'); }
  else report(`self test identical copy      ${same.checks} checks, 0 differences`);

  // The same picture written out at 2x and read back has to survive unscaling.
  const doubled = decodePNG(encodeRGBAPNG(WINDOW_WIDTH, WINDOW_HEIGHT, ours, 2));
  const scaled = compare(ours, unscale(doubled));
  checks += 1;
  if (scaled.differences !== 0) { differences += 1; report('  DIFFERENCE self test: the 2x copy does not match'); }
  else report(`self test 2x copy             ${scaled.checks} checks, 0 differences`);

  const other = compare(ours, renderWindow('level009', 3, 624));
  checks += 1;
  if (other.differences < 1000) { differences += 1; report('  DIFFERENCE self test: a foreign level matches too well'); }
  else report(`self test a foreign level     ${other.differences} differing pixels, as it should`);

  return { checks, differences };
}

function run (media, out, find) {
  if (!existsSync(media)) return { shots: 0, checks: 0, differences: 0 };
  const names = readdirSync(media).filter((name) => name.toLowerCase().endsWith('.png')).sort();
  const masks = existsSync(join(media, 'masks.json'))
    ? JSON.parse(readFileSync(join(media, 'masks.json'), 'utf8'))
    : {};

  let checks = 0;
  let differences = 0;
  let shots = 0;
  for (const name of names) {
    const shot = parseShotName(name);
    if (!shot) {
      console.log(`  ${name}: name does not say which level and scroll position it shows, skipped`);
      continue;
    }
    shots += 1;
    const theirs = unscale(decodePNG(readFileSync(join(media, name))));

    let x = shot.x;
    if (find) {
      // Look for the scroll position that fits best - a help for the operator
      // when a screenshot was taken without noting it, never a substitute.
      let best = { x, differences: Infinity };
      for (let candidate = 0; candidate <= LevelBuilder.WIDTH - WINDOW_WIDTH; candidate += 1) {
        const result = compare(renderWindow(shot.pack, shot.index, candidate), theirs, masks[name]);
        if (result.differences < best.differences) best = { x: candidate, differences: result.differences };
        if (best.differences === 0) break;
      }
      x = best.x;
      console.log(`  ${name}: best scroll position ${x} (${best.differences} differences)`);
    }

    const ours = renderWindow(shot.pack, shot.index, x);
    const result = compare(ours, theirs, masks[name]);
    checks += result.checks;
    differences += result.differences;
    console.log(`${name.padEnd(28)} ${result.checks} checks, ${result.differences} differences` +
      (result.masked ? `, ${result.masked} masked pixels differ` : ''));

    if (result.differences) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `${basename(name, '.png')}-diff.png`),
        encodeIndexedPNG(WINDOW_WIDTH, WINDOW_HEIGHT, result.diff,
          [0, 0, 0, 255, 0, 0, 0, 0, 255], { scale: 2 }));
      writeFileSync(join(out, `${basename(name, '.png')}-ours.png`),
        encodeRGBAPNG(WINDOW_WIDTH, WINDOW_HEIGHT, ours, 2));
    }
  }
  return { shots, checks, differences };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const media = option('--media', DEFAULT_MEDIA);
  const out = option('--out', DEFAULT_OUT);

  const self = selfTest((line) => console.log(line));
  if (flag('--selftest')) {
    console.log(`matchlevel.mjs: ${self.checks} self tests, ${self.differences} differences`);
    process.exit(self.differences === 0 ? 0 : 1);
  }

  const result = run(media, out, flag('--find'));
  if (!result.shots) {
    console.log(`matchlevel.mjs: 0 levels, no golden record in ${media} - see its README.md`);
    process.exit(1);
  }
  console.log(`matchlevel.mjs: ${result.shots} screenshots, ${result.checks} checks, ${result.differences} differences`);
  process.exit(result.differences === 0 && self.differences === 0 ? 0 : 1);
}
