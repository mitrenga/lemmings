#!/usr/bin/env node
/**
 * tracelem - runs a level in the remake and writes down what every lemming
 * did, frame by frame: its position, its action, the frame of that action
 * and how far it has fallen, plus the counters of the level and a checksum
 * of the terrain mask.
 *
 * That record is one half of the acceptance of L3: `tools/matchlem.mjs` holds
 * it against the same record taken from the original (`sources/media/physics/`).
 * The run is driven by the game worker itself, headless - no timers, no
 * browser - so what is measured is the game, not the plumbing.
 *
 * A run can be scripted: `--script tools/scripts/<name>.json` says which
 * level to play, with which seed, and which skill to hand to which point of
 * the level on which frame - the counterpart of the input scripts Prince of
 * Persia drives its physics with. Without a script nobody touches the
 * lemmings and they do what they do on their own (milestone L3).
 *
 * usage: node tools/tracelem.mjs [--pack level009] [--level 1] [--frames 600]
 *                                [--seed 49374] [--out build/trace]
 *                                [--script tools/scripts/x.json]
 *                                [--strip 60] [--quiet]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodeIndexedPNG } from '../app/svision/tools/retro/png.mjs';
import { GameWorker } from '../app/gameWorker.js';
import { LemPalette } from '../app/lem/palette.js';

const DATA = 'data';

const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** A stable checksum of the terrain mask - the world the skills will cut. */
export function terrainChecksum (mask) {
  let sum = 0x811c9dc5;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    sum ^= i;
    sum = Math.imul(sum, 0x01000193) >>> 0;
  }
  return sum >>> 0;
}

/** Loads a level and starts a headless worker on it. */
export function startRun (pack, index, options = {}) {
  const data = options.data ?? DATA;
  const level = readJSON(join(data, 'levels', `${pack}.json`)).levels[index];
  if (!level) throw new Error(`${pack} has no level ${index}`);
  const set = readJSON(join(data, 'sets', `set${level.graphicsSet}.json`));
  const main = readJSON(join(data, 'main', 'lemmings.json'));
  const special = level.specialSet > 0
    ? readJSON(join(data, 'special', `spec${level.specialSet - 1}.json`))
    : null;

  const messages = [];
  const worker = new GameWorker((message) => messages.push(message));
  worker.handleMessage({ id: 'init', seed: options.seed ?? 0 });
  worker.handleMessage({ id: 'level', level, set, main, special, headless: true });
  return { worker, level, messages, special, set };
}

/** One row of the record. */
function snapshot (game) {
  return {
    frame: game.frame,
    out: game.out,
    saved: game.saved,
    released: game.released,
    seconds: game.secondsLeft,
    terrain: terrainChecksum(game.terrain),
    skills: {...game.skills},
    // the sounds the game asked for this frame, by the numbers of the original
    sounds: game.sounds.slice(),
    lemmings: game.lemmings.map((lemming, index) => ({
      i: index,
      x: lemming.x,
      y: lemming.y,
      a: lemming.action,
      f: lemming.frame,
      d: lemming.xDelta,
      fallen: lemming.fallen,
      bricks: lemming.bricksLeft,
      timer: lemming.explosionTimer,
      gone: lemming.gone
    }))
  };
}

/**
 * @returns {{record: object, worker: GameWorker}} the record of the run.
 */
export function traceRun (pack, index, options = {}) {
  const { worker, level } = startRun(pack, index, options);
  const frames = [];
  const events = [];
  const count = options.frames ?? 600;
  // The skills the script hands out, by the frame they are given on.
  const script = new Map();
  for (const assignment of options.assignments ?? []) {
    if (!script.has(assignment.frame)) script.set(assignment.frame, []);
    script.get(assignment.frame).push(assignment);
  }
  for (let i = 0; i < count; i++) {
    worker.tick();
    for (const assignment of script.get(worker.game.frame) ?? []) {
      const given = worker.game.assignSkill(assignment.skill, assignment.x, assignment.y, Boolean(assignment.walkersOnly));
      events.push({ frame: worker.game.frame, event: given ? 'assigned' : 'assignFailed', skill: assignment.skill });
    }
    frames.push(snapshot(worker.game));
    for (const event of worker.game.events) events.push({ frame: worker.game.frame, ...event });
    if (worker.finished) break;
  }
  return {
    record: {
      tool: 'tracelem',
      level: { pack, index, name: level.name.trim(), set: level.graphicsSetName, special: level.specialSet },
      seed: options.seed ?? 0,
      frames,
      events
    },
    worker
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = argv.indexOf(name);
    return at === -1 ? fallback : argv[at + 1];
  };
  const scriptFile = option('--script', null);
  const script = scriptFile ? JSON.parse(readFileSync(scriptFile, 'utf8')) : null;
  const pack = script ? script.level.pack : option('--pack', 'level009');
  const index = script ? script.level.index : Number(option('--level', 1));
  const frames = Number(option('--frames', script ? script.frames ?? 600 : 600));
  const seed = script && script.seed !== undefined ? script.seed : Number(option('--seed', 0xc0de));
  const out = option('--out', 'build/trace');
  const strip = Number(option('--strip', 0));
  const quiet = argv.includes('--quiet');

  const { record, worker } = traceRun(pack, index, { frames, seed, assignments: script ? script.assignments : [] });
  if (script) record.script = scriptFile;
  mkdirSync(out, { recursive: true });
  const stem = `${pack}-${String(index).padStart(2, '0')}`;
  writeFileSync(join(out, `${stem}.json`), `${JSON.stringify(record)}\n`);

  // A strip of pictures for the eye: every Nth frame of the window.
  if (strip > 0) {
    const game = worker.game;
    const colours = record.level.special
      ? readJSON(join(DATA, 'special', `spec${record.level.special - 1}.json`)).palette
      : game.graphics.colours;
    const palette = [];
    for (const colour of LemPalette.inLevel(colours)) for (const part of colour) palette.push(Math.round(part * 255 / 63));
    const shots = record.frames.filter((_, i) => i % strip === 0).length;
    const picture = new Uint8Array(320 * 160 * shots);
    // Re-run, because the record holds numbers, not pictures.
    const again = startRun(pack, index, { seed });
    // The same script has to run again, or the pictures would show a level
    // nobody touched while the record says otherwise.
    const replay = new Map();
    for (const assignment of (script ? script.assignments : []) ?? []) {
      if (!replay.has(assignment.frame)) replay.set(assignment.frame, []);
      replay.get(assignment.frame).push(assignment);
    }
    let row = 0;
    for (let i = 0; i < record.frames.length; i++) {
      again.worker.tick();
      for (const assignment of replay.get(again.worker.game.frame) ?? []) {
        again.worker.game.assignSkill(assignment.skill, assignment.x, assignment.y, Boolean(assignment.walkersOnly));
      }
      if (i % strip !== 0) continue;
      const window = again.worker.game.draw() && again.worker.game.window(again.worker.scrollX);
      picture.set(window.bytes, row * 320 * 160);
      row += 1;
    }
    writeFileSync(join(out, `${stem}-strip.png`), encodeIndexedPNG(320, 160 * shots, picture, palette));
  }

  if (!quiet) {
    const last = record.frames[record.frames.length - 1];
    for (const event of record.events.slice(0, 12)) {
      console.log(`  frame ${String(event.frame).padStart(4)}  ${event.event}` +
        (event.lemming === undefined ? '' : ` lemming ${event.lemming}`));
    }
    console.log(`${stem} "${record.level.name}" set ${record.level.set}: ${record.frames.length} frames, ` +
      `${last.released} released, ${last.saved} saved, ${last.out} still out, clock ${last.seconds}s`);
  }
  console.log(`tracelem.mjs: ${record.frames.length} frames, ${record.events.length} events -> ${join(out, `${stem}.json`)}`);
}
