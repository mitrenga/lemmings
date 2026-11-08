#!/usr/bin/env node
/**
 * matchlem - the acceptance test of milestones L3 and up.
 *
 * Holds our record of a run (`tools/tracelem.mjs`) against the same run taken
 * from the original, frame by frame and field by field: where every lemming
 * is, what it is doing, which frame of that animation it is on, how far it
 * has fallen, the counters of the level and the checksum of the terrain mask.
 *
 * A golden record does not have to carry every field. Whatever it does not
 * have is not compared - so a record made before the terrain could be dug
 * still counts for the fields it does have, the way Prince of Persia does it
 * in P3 and P4.
 *
 * The golden records live in `sources/media/physics/`, one JSON per run, named
 * after the run they hold: `level009-01.json`. What has to be in them is in
 * that directory's README.
 *
 * usage: node tools/matchlem.mjs [--media sources/media/physics]
 *                                [--frames 900] [--selftest] [--quiet]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { traceRun } from './tracelem.mjs';

const DEFAULT_MEDIA = 'sources/media/physics';

/** The fields of a lemming a record may carry, and what they mean. */
const LEMMING_FIELDS = ['x', 'y', 'a', 'f', 'd', 'fallen', 'bricks', 'timer', 'gone'];
/** The fields of a frame. */
const FRAME_FIELDS = ['out', 'saved', 'released', 'seconds', 'terrain'];

/**
 * Compares two records.
 * @param {Object} ours our record
 * @param {Object} theirs the golden one
 * @returns {{checks: number, differences: number, firstDifference: ?string}}
 */
export function compareRecords (ours, theirs, report = () => {}) {
  let checks = 0;
  let differences = 0;
  let first = null;
  const fail = (what) => {
    differences += 1;
    if (!first) first = what;
    if (differences <= 10) report(`  DIFFERENCE ${what}`);
  };

  const frames = Math.min(ours.frames.length, theirs.frames.length);
  checks += 1;
  if (!frames) fail('the record has no frames');

  for (let index = 0; index < frames; index++) {
    const ourFrame = ours.frames[index];
    const theirFrame = theirs.frames[index];
    const where = `frame ${theirFrame.frame ?? index}`;

    // The sounds are a list, so they are compared as one field.
    if (theirFrame.sounds) {
      checks += 1;
      if (JSON.stringify(ourFrame.sounds ?? []) !== JSON.stringify(theirFrame.sounds)) {
        fail(`${where}: sounds ${JSON.stringify(ourFrame.sounds)} against ${JSON.stringify(theirFrame.sounds)}`);
      }
    }

    for (const field of FRAME_FIELDS) {
      if (!(field in theirFrame)) continue;
      checks += 1;
      if (ourFrame[field] !== theirFrame[field]) {
        fail(`${where}: ${field} ${ourFrame[field]} against ${theirFrame[field]}`);
      }
    }

    if (!theirFrame.lemmings) continue;
    checks += 1;
    if (ourFrame.lemmings.length !== theirFrame.lemmings.length) {
      fail(`${where}: ${ourFrame.lemmings.length} lemmings against ${theirFrame.lemmings.length}`);
    }
    const lemmings = Math.min(ourFrame.lemmings.length, theirFrame.lemmings.length);
    for (let i = 0; i < lemmings; i++) {
      for (const field of LEMMING_FIELDS) {
        if (!(field in theirFrame.lemmings[i])) continue;
        checks += 1;
        if (ourFrame.lemmings[i][field] !== theirFrame.lemmings[i][field]) {
          fail(`${where} lemming ${i}: ${field} ${JSON.stringify(ourFrame.lemmings[i][field])} ` +
            `against ${JSON.stringify(theirFrame.lemmings[i][field])}`);
        }
      }
    }
  }

  // A record that stops early is not the same run.
  checks += 1;
  if (ours.frames.length < theirs.frames.length) {
    fail(`our run ends after ${ours.frames.length} frames, the record has ${theirs.frames.length}`);
  }
  return { checks, differences, firstDifference: first };
}

/**
 * A test of the tool, not of the game: our own record has to match itself,
 * and a record with one number changed has to come out as a difference.
 */
export function selfTest (report = () => {}) {
  let checks = 0;
  let differences = 0;
  const { record } = traceRun('level009', 1, { frames: 300, seed: 0xc0de });

  const same = compareRecords(record, JSON.parse(JSON.stringify(record)));
  checks += 1;
  if (same.differences !== 0) { differences += 1; report('  DIFFERENCE self test: a record does not match itself'); }
  else report(`self test identical record    ${same.checks} checks, 0 differences`);

  const changed = JSON.parse(JSON.stringify(record));
  const frame = changed.frames.find((entry) => entry.lemmings.length);
  frame.lemmings[0].x += 1;
  const moved = compareRecords(record, changed);
  checks += 1;
  if (moved.differences === 0) { differences += 1; report('  DIFFERENCE self test: a moved lemming went unnoticed'); }
  else report(`self test one pixel moved     ${moved.differences} differences, as it should`);

  // And a run of the same level from the same seed has to come out the same:
  // the game is a function of the level and the input, nothing else (R-009).
  const again = traceRun('level009', 1, { frames: 300, seed: 0xc0de }).record;
  const repeated = compareRecords(again, record);
  checks += 1;
  if (repeated.differences !== 0) { differences += 1; report('  DIFFERENCE self test: the run does not repeat'); }
  else report(`self test the run repeats     ${repeated.checks} checks, 0 differences`);

  return { checks, differences };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = argv.indexOf(name);
    return at === -1 ? fallback : argv[at + 1];
  };
  const media = option('--media', DEFAULT_MEDIA);
  const frames = Number(option('--frames', 0));
  const quiet = argv.includes('--quiet');
  const report = quiet ? () => {} : (line) => console.log(line);

  const self = selfTest(report);
  if (argv.includes('--selftest')) {
    console.log(`matchlem.mjs: ${self.checks} self tests, ${self.differences} differences`);
    process.exit(self.differences === 0 ? 0 : 1);
  }

  const names = existsSync(media)
    ? readdirSync(media).filter((name) => name.toLowerCase().endsWith('.json')).sort()
    : [];
  if (!names.length) {
    console.log(`matchlem.mjs: 0 runs, no golden record in ${media} - see its README.md`);
    process.exit(1);
  }

  let checks = 0;
  let differences = 0;
  for (const name of names) {
    const theirs = JSON.parse(readFileSync(join(media, name), 'utf8'));
    const match = /^(level\d{3})-(\d{2})\.json$/i.exec(basename(name));
    if (!match) {
      console.log(`  ${name}: the name does not say which level it is, skipped`);
      continue;
    }
    const { record } = traceRun(match[1].toLowerCase(), Number(match[2]), {
      frames: frames || theirs.frames.length,
      seed: theirs.seed ?? 0
    });
    const result = compareRecords(record, theirs, report);
    checks += result.checks;
    differences += result.differences;
    console.log(`${name.padEnd(24)} ${result.checks} checks, ${result.differences} differences` +
      (result.firstDifference ? `, first at ${result.firstDifference}` : ''));
  }
  console.log(`matchlem.mjs: ${names.length} runs, ${checks} checks, ${differences} differences`);
  process.exit(differences === 0 && self.differences === 0 ? 0 : 1);
}
