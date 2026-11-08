#!/usr/bin/env node
/**
 * checkdat - the acceptance test of milestone L1.
 *
 * For every section of every DAT file of the game it does the round trip:
 * unpack it, pack it again with our own packer, unpack that, and compare.
 * The original packer is gone and there are many valid ones, so the criterion
 * is not "our bytes equal the bytes of Psygnosis" - it is "our bytes unpack
 * to exactly the same data", the same rule Prince of Persia settled on in P1.
 *
 * It also checks the stored checksum of every section, that the section
 * headers tile the file exactly, the fixed sizes of the plain files, and the
 * second, byte oriented layer inside the special graphics.
 *
 * Usage: node tools/checkdat.mjs [--in assets/original/game] [--quiet]
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decompressFile, decompressSection, compressSection, looksPacked,
  checksumOf, readHeader, HEADER_SIZE,
  decodeSpecialChunks, encodeSpecialChunks
} from './lib/datContainer.mjs';
import { decodePlanar, encodePlanar, bitmapSize } from './lib/planarBitmap.mjs';
import { parseGroundFile, decodeGraphics, GROUND_SIZE } from './lib/groundSet.mjs';
import { parseLevel, LEVEL_SIZE } from './lib/levelRecord.mjs';

const DEFAULT_IN = 'assets/original/game';

/** Files with no container around them, and the size each one has to have. */
const PLAIN_SIZES = {
  'ground0o.dat': 1056, 'ground1o.dat': 1056, 'ground2o.dat': 1056,
  'ground3o.dat': 1056, 'ground4o.dat': 1056,
  'oddtable.dat': 80 * 56
};

/**
 * A seeded generator, so a run of the self test is repeatable and can be
 * compared with the last one (R-009 - no `Math.random` anywhere).
 */
function seededSource (seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) & 0xff;
  };
}

/**
 * Cases the game itself does not contain, so that a clean run over the game
 * data cannot hide a packer that only works on friendly input: long runs of
 * one byte, raw runs past the 264 byte token, matches too far away for the
 * short encodings, and the smallest sections that can exist.
 */
function selfTestCases () {
  const cases = new Map();
  cases.set('one byte', Uint8Array.of(0x42));
  cases.set('two equal bytes', Uint8Array.of(7, 7));
  cases.set('zeros 5000', new Uint8Array(5000));
  cases.set('run of one value', new Uint8Array(4000).fill(0xab));

  const counting = new Uint8Array(3000);
  for (let i = 0; i < counting.length; i++) counting[i] = i & 0xff;
  cases.set('counting bytes', counting);

  const random = new Uint8Array(5000);
  const source = seededSource(0xc0de);
  for (let i = 0; i < random.length; i++) random[i] = source();
  cases.set('incompressible', random);

  // A repeat far enough apart that only the twelve bit offset can reach it,
  // and one past even that, which has to fall back to raw bytes.
  const far = new Uint8Array(9000);
  const noise = seededSource(0x51ee);
  for (let i = 0; i < far.length; i++) far[i] = noise();
  far.set(far.subarray(0, 300), 4000);
  far.set(far.subarray(0, 300), 8600);
  cases.set('distant repeats', far);

  const mixed = new Uint8Array(1200);
  const other = seededSource(0x1234);
  for (let i = 0; i < mixed.length; i++) mixed[i] = i < 600 ? other() : 0x5a;
  cases.set('raw run then a long run', mixed);
  return cases;
}

function equalBytes (left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

/** The round trip over synthetic data - a test of the tool, not of the game. */
export function checkSelfTest (report = () => {}) {
  let checks = 0;
  let differences = 0;
  for (const [name, data] of selfTestCases()) {
    checks += 1;
    const packed = compressSection(data);
    const back = decompressSection(packed, 0);
    if (!equalBytes(back.data, data) || !back.checksumOk) {
      differences += 1;
      report(`  DIFFERENCE self test "${name}": round trip changed the data`);
    } else {
      report(`self test ${name.padEnd(24)} ${data.length} -> ${packed.length} bytes, clean`);
    }
  }
  return { checks, differences };
}

/**
 * The decoders of milestone L2 over the real data: every terrain piece and
 * every object frame of the five graphics sets has to survive planar ->
 * indices -> planar, and every level record has to parse into sane numbers.
 */
export function checkGraphics (inDirectory, report = () => {}) {
  let checks = 0;
  let differences = 0;
  let pieces = 0;
  let frames = 0;
  let ownMask = 0;
  const fail = (what) => { differences += 1; report(`  DIFFERENCE ${what}`); };

  for (let number = 0; number < 5; number++) {
    const groundBytes = new Uint8Array(readFileSync(join(inDirectory, `ground${number}o.dat`)));
    checks += 1;
    if (groundBytes.length !== GROUND_SIZE) fail(`ground${number}o.dat is ${groundBytes.length} bytes`);
    const ground = parseGroundFile(groundBytes);

    const sections = decompressFile(new Uint8Array(readFileSync(join(inDirectory, `vgagr${number}.dat`))));
    checks += 1;
    if (sections.length !== 2) fail(`vgagr${number}.dat has ${sections.length} sections, expected 2`);
    const set = decodeGraphics(ground, sections[0].data, sections[1].data);

    for (const piece of set.terrain) {
      if (!piece.used) continue;
      pieces += 1;
      // planar -> indices -> planar has to give the original bytes back
      checks += 1;
      const planar = encodePlanar(piece.pixels, piece.width, piece.height, 4);
      const original = sections[0].data.subarray(piece.imageOffset, piece.imageOffset + bitmapSize(piece.width, piece.height, 4));
      if (!equalBytes(planar, original)) fail(`set ${number} terrain ${piece.index}: planar round trip changed the picture`);

      // and the mask of a terrain piece is always "the pixel is not zero"
      checks += 1;
      const derived = piece.pixels.every((value, index) => (value === 0 ? 0 : 1) === piece.mask[index]);
      if (!derived) fail(`set ${number} terrain ${piece.index}: mask is not the solid pixels`);
    }

    for (const object of set.objects) {
      if (!object.used) continue;
      checks += 1;
      if (object.frames.length !== object.frameCount) {
        fail(`set ${number} object ${object.index}: ${object.frames.length} frames, the file says ${object.frameCount}`);
      }
      for (const [index, frame] of object.frames.entries()) {
        frames += 1;
        checks += 1;
        const planar = encodePlanar(frame.pixels, object.width, object.height, 4);
        const at = object.framesOffset + index * object.frameSize;
        const original = sections[1].data.subarray(at, at + bitmapSize(object.width, object.height, 4));
        if (!equalBytes(planar, original)) fail(`set ${number} object ${object.index} frame ${index}: planar round trip changed the picture`);
        if (!frame.pixels.every((value, i) => (value === 0 ? 0 : 1) === frame.mask[i])) ownMask += 1;
      }
    }
  }
  report(`graphics       ${pieces} terrain pieces, ${frames} object frames, ${ownMask} frames whose mask is not the solid pixels`);
  return { checks, differences, pieces, frames, ownMask };
}

/** Every level record has to parse, and to parse into numbers that can exist. */
export function checkLevels (inDirectory, report = () => {}) {
  let checks = 0;
  let differences = 0;
  let levels = 0;
  const fail = (what) => { differences += 1; report(`  DIFFERENCE ${what}`); };

  const packs = readdirSync(inDirectory).filter((name) => /^level\d{3}\.dat$/i.test(name)).sort();
  for (const pack of packs) {
    for (const [index, section] of decompressFile(new Uint8Array(readFileSync(join(inDirectory, pack)))).entries()) {
      levels += 1;
      checks += 1;
      if (section.data.length !== LEVEL_SIZE) { fail(`${pack}#${index}: ${section.data.length} bytes`); continue; }
      const level = parseLevel(section.data);
      const where = `${pack}#${index} "${level.name.trim()}"`;

      checks += 1;
      if (level.graphicsSet > 4) fail(`${where}: graphics set ${level.graphicsSet}, the game has 0..4`);
      checks += 1;
      if (level.specialSet > 4) fail(`${where}: special set ${level.specialSet}, the game has 0..4`);
      checks += 1;
      if (level.toRescue > level.lemmings) fail(`${where}: ${level.toRescue} to rescue out of ${level.lemmings}`);
      checks += 1;
      if (level.releaseRate < 1 || level.releaseRate > 99) fail(`${where}: release rate ${level.releaseRate}`);
      checks += 1;
      if (level.terrain.some((piece) => piece.id > 63)) fail(`${where}: a terrain id above 63`);
      checks += 1;
      if (level.objects.some((object) => object.id > 15)) fail(`${where}: an object id above 15`);
      // The four special levels are the ones that list no terrain at all.
      checks += 1;
      if ((level.specialSet > 0) !== (level.terrain.length === 0)) {
        fail(`${where}: special set ${level.specialSet} with ${level.terrain.length} terrain pieces`);
      }
    }
  }
  report(`levels         ${levels} records parsed`);
  return { checks, differences, levels };
}

export function checkDirectory (inDirectory, report = () => {}) {
  const names = readdirSync(inDirectory)
    .filter((name) => name.toLowerCase().endsWith('.dat'))
    .sort();

  let checks = 0;
  let differences = 0;
  let sections = 0;
  let packedBytes = 0;
  let ourBytes = 0;
  let shorter = 0;

  const fail = (what) => { differences += 1; report(`  DIFFERENCE ${what}`); };

  for (const name of names) {
    const key = name.toLowerCase();
    const buffer = new Uint8Array(readFileSync(join(inDirectory, name)));

    if (!looksPacked(buffer)) {
      checks += 1;
      const expected = PLAIN_SIZES[key];
      if (expected === undefined) fail(`${key}: not packed and not a known plain file`);
      else if (buffer.length !== expected) fail(`${key}: ${buffer.length} bytes, expected ${expected}`);
      report(`${key.padEnd(14)} plain, ${buffer.length} bytes`);
      continue;
    }

    const unpacked = decompressFile(buffer);
    sections += unpacked.length;

    // The headers have to tile the file with nothing left over.
    checks += 1;
    const covered = unpacked.reduce((sum, section) => sum + section.header.compressedSize, 0);
    if (covered !== buffer.length) fail(`${key}: sections cover ${covered} of ${buffer.length} bytes`);

    for (const [index, section] of unpacked.entries()) {
      const where = `${key}#${index}`;

      // 1. the checksum the game itself would verify
      checks += 1;
      if (!section.checksumOk) fail(`${where}: stored checksum does not match`);

      // 2. our packer has to be readable by our unpacker, byte for byte
      checks += 1;
      const repacked = compressSection(section.data);
      const again = decompressSection(repacked, 0);
      if (!equalBytes(again.data, section.data)) fail(`${where}: round trip changed the data`);

      // 3. and the header we write has to describe what we wrote
      checks += 1;
      const header = readHeader(repacked, 0);
      const body = repacked.subarray(HEADER_SIZE);
      if (header.compressedSize !== repacked.length) fail(`${where}: our compressedSize is wrong`);
      else if (header.decompressedSize !== section.data.length) fail(`${where}: our decompressedSize is wrong`);
      else if (header.checksum !== checksumOf(body)) fail(`${where}: our checksum is wrong`);
      else if (!again.checksumOk) fail(`${where}: our section fails its own checksum`);

      // 5. every level record is exactly 2048 bytes
      if (/^level\d{3}\.dat$/.test(key)) {
        checks += 1;
        if (section.data.length !== 2048) fail(`${where}: level record is ${section.data.length} bytes, expected 2048`);
      }

      packedBytes += section.header.compressedSize;
      ourBytes += repacked.length;
      if (repacked.length <= section.header.compressedSize) shorter += 1;

      // 4. the special graphics carry a second layer; check that one too
      if (/^vgaspec\d\.dat$/.test(key)) {
        const inner = section.data.subarray(40);
        const chunks = decodeSpecialChunks(inner);
        checks += 1;
        if (chunks.length !== 4) fail(`${where}: ${chunks.length} chunks after the second layer, expected 4`);
        for (const [order, chunk] of chunks.entries()) {
          checks += 1;
          if (chunk.length !== 14400) fail(`${where} chunk ${order}: ${chunk.length} bytes, expected 14400`);
        }
        checks += 1;
        const rechunked = decodeSpecialChunks(encodeSpecialChunks(chunks));
        if (rechunked.length !== chunks.length ||
            chunks.some((chunk, order) => !equalBytes(chunk, rechunked[order]))) {
          fail(`${where}: second layer round trip changed the data`);
        }
      }
    }
    report(`${key.padEnd(14)} ${String(unpacked.length).padStart(2)} sections, round trip clean`);
  }

  return { checks, differences, sections, files: names.length, packedBytes, ourBytes, shorter };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const quiet = argv.includes('--quiet');
  const inIndex = argv.indexOf('--in');
  const inDirectory = inIndex === -1 ? DEFAULT_IN : argv[inIndex + 1];

  const report = quiet ? () => {} : (line) => console.log(line);
  const self = checkSelfTest(report);
  const result = checkDirectory(inDirectory, report);
  const graphics = checkGraphics(inDirectory, report);
  const levels = checkLevels(inDirectory, report);
  const checks = result.checks + self.checks + graphics.checks + levels.checks;
  const differences = result.differences + self.differences + graphics.differences + levels.differences;
  console.log(
    `checkdat.mjs: ${checks} checks, ${differences} differences ` +
    `(${result.files} files, ${result.sections} sections, ${graphics.pieces} terrain pieces, ` +
    `${graphics.frames} object frames, ${levels.levels} levels, ${self.checks} self tests)`
  );
  console.log(
    `  our packer: ${result.ourBytes} bytes against ${result.packedBytes} of the original ` +
    `(${(100 * result.ourBytes / result.packedBytes).toFixed(1)} %), ` +
    `${result.shorter} of ${result.sections} sections no longer than the original`
  );
  process.exit(differences === 0 ? 0 : 1);
}
