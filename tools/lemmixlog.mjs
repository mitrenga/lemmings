#!/usr/bin/env node
/**
 * lemmixlog - turns the log Lemmix writes into a golden record
 * `tools/matchlem.mjs` can read.
 *
 * Lemmix already has the logger we need (`Game.Logger.pas`,
 * `TGameLogger.LogLemming`): it prints the iteration, the index of the
 * lemming, its position, its action, its animation frame and its direction.
 * It is only called from a few places, so one line has to be added to
 * `CheckLemmings` to have it print every lemming every frame - the recipe is
 * in `sources/media/physics/README.md`.
 *
 * A line looks like this:
 *
 *     000123 ix=  2 x=712 y=79 act=WALKING fr=4 bricks=0 dir=1
 *
 * What comes out is the same shape `tools/tracelem.mjs` writes, so the two
 * are compared field by field. Only the fields the log carries are in it -
 * the counters of the level and the terrain checksum are not - and
 * `matchlem.mjs` skips whatever a golden record does not have.
 *
 * usage: node tools/lemmixlog.mjs --in <log> --pack level009 --level 1
 *                                 [--out sources/media/physics] [--first 0]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Lemmix action name -> the name the remake uses. */
export const ACTIONS = {
  WALKING: 'walking', JUMPING: 'jumping', DIGGING: 'digging', CLIMBING: 'climbing',
  DROWNING: 'drowning', HOISTING: 'hoisting', BUILDING: 'building', BASHING: 'bashing',
  MINING: 'mining', FALLING: 'falling', FLOATING: 'floating', SPLATTING: 'splatting',
  EXITING: 'exiting', VAPORIZING: 'vaporizing', BLOCKING: 'blocking',
  SHRUGGING: 'shrugging', OHNOING: 'ohNoing', EXPLODING: 'exploding'
};

const LINE = /^(\d+)\s+ix=\s*(\d+)\s+x=(-?\d+)\s+y=(-?\d+)\s+act=(\w+)\s+fr=(\d+)(?:\s+bricks=(-?\d+))?\s+dir=(-?\d+)/;

/**
 * @param {string} text the whole log
 * @returns {{frames: object[], skipped: number, unknownActions: string[]}}
 */
export function parseLog (text) {
  const byIteration = new Map();
  const unknown = new Set();
  let skipped = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = LINE.exec(line.trim());
    if (!match) { skipped += 1; continue; }
    const [, iteration, index, x, y, action, frame, , direction] = match;
    if (!ACTIONS[action]) unknown.add(action);
    const at = Number(iteration);
    if (!byIteration.has(at)) byIteration.set(at, []);
    byIteration.get(at).push({
      i: Number(index),
      x: Number(x),
      y: Number(y),
      a: ACTIONS[action] ?? action.toLowerCase(),
      f: Number(frame),
      d: Number(direction)
    });
  }

  const frames = [...byIteration.keys()].sort((a, b) => a - b).map((at) => ({
    frame: at,
    lemmings: byIteration.get(at).sort((a, b) => a.i - b.i)
  }));
  return { frames, skipped, unknownActions: [...unknown] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = argv.indexOf(name);
    return at === -1 ? fallback : argv[at + 1];
  };
  const input = option('--in', null);
  if (!input) throw new Error('--in <log> is required');
  const pack = option('--pack', 'level009');
  const index = Number(option('--level', 1));
  const out = option('--out', 'sources/media/physics');
  const first = Number(option('--first', 0));

  const parsed = parseLog(readFileSync(input, 'utf8'));
  const frames = parsed.frames.filter((frame) => frame.frame >= first);
  const record = {
    tool: 'lemmixlog',
    source: input,
    level: { pack, index },
    seed: 0,
    frames
  };
  mkdirSync(out, { recursive: true });
  const name = `${pack}-${String(index).padStart(2, '0')}.json`;
  writeFileSync(join(out, name), `${JSON.stringify(record)}\n`);

  console.log(`lemmixlog.mjs: ${frames.length} frames, ` +
    `${frames.reduce((sum, frame) => sum + frame.lemmings.length, 0)} lemming rows, ` +
    `${parsed.skipped} lines skipped` +
    (parsed.unknownActions.length ? `, unknown actions: ${parsed.unknownActions.join(', ')}` : '') +
    ` -> ${join(out, name)}`);
}
