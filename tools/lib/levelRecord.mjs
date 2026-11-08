/**
 * One level of DOS Lemmings: the 2048 bytes a section of `level<nnn>.dat`
 * unpacks to. Ten such files hold eighty records; `oddtable.dat` turns those
 * eighty into the hundred and twenty levels the game offers.
 *
 * Unlike `ground<n>o.dat`, the words here are **big endian**.
 *
 * Source: `sources/reference/formats/lemmings_lvl_file_format.txt`.
 */

export const LEVEL_SIZE = 2048;
export const MAX_OBJECTS = 32;
export const MAX_TERRAIN = 400;
export const MAX_STEEL = 32;

/** The order the eight skill counts are stored in. */
export const SKILLS = ['climber', 'floater', 'bomber', 'blocker', 'builder', 'basher', 'miner', 'digger'];

/** The five graphics sets of Lemmings; 5..8 belong to Oh No! More Lemmings. */
export const GRAPHICS_SETS = ['dirt', 'fire', 'marble', 'pillar', 'crystal'];

/**
 * Level names are plain code page 437 text padded with spaces. Everything the
 * game uses is ASCII, so anything else is shown as a dot rather than guessed.
 */
function decodeName (bytes) {
  let name = '';
  for (const byte of bytes) name += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.';
  return name.replace(/\.+$/, '').trimEnd();
}

function readObject (view, offset) {
  const x = view.getUint16(offset);
  const y = view.getInt16(offset + 2);
  return {
    // The stored x counts from -16, in steps of eight.
    x: x - 16,
    y,
    // Only the low nibble of the id word is the slot in the graphics set.
    id: view.getUint8(offset + 5) & 0x0f,
    // 0x80: do not draw over terrain that is already there.
    onlyOnBackground: (view.getUint8(offset + 6) & 0x80) !== 0,
    // 0x40: draw only where terrain is, i.e. the object shows through it.
    onlyOverTerrain: (view.getUint8(offset + 6) & 0x40) !== 0,
    upsideDown: view.getUint8(offset + 7) === 0x8f
  };
}

function readTerrain (view, offset) {
  const first = view.getUint8(offset);
  if (first === 0xff && view.getUint8(offset + 1) === 0xff &&
      view.getUint8(offset + 2) === 0xff && view.getUint8(offset + 3) === 0xff) return null;
  const b0 = view.getUint8(offset);
  const b1 = view.getUint8(offset + 1);
  const b2 = view.getUint8(offset + 2);
  const b3 = view.getUint8(offset + 3);
  // y is nine bits: all of byte 2 plus the top bit of byte 3, signed, and
  // counted from -4. The remaining six bits of byte 3 are the piece.
  let y = (b2 << 1) + ((b3 & 0x80) >> 7);
  if (y >= 256) y -= 512;
  return {
    // x is twelve bits, counted from -16; the top three bits are the flags.
    x: ((b0 & 0x0f) << 8) + b1 - 16,
    doNotOverwrite: (b0 & 0x80) !== 0,
    upsideDown: (b0 & 0x40) !== 0,
    remove: (b0 & 0x20) !== 0,
    y: y - 4,
    id: b3 & 0x3f
  };
}

function readSteel (view, offset) {
  if (view.getUint32(offset) === 0) return null;
  const b0 = view.getUint8(offset);
  const b1 = view.getUint8(offset + 1);
  const area = view.getUint8(offset + 2);
  return {
    // x is nine bits - byte 0 plus the top bit of byte 1 - and everything
    // here counts in units of four pixels.
    x: ((b0 << 1) + ((b1 & 0x80) >> 7)) * 4 - 16,
    y: (b1 & 0x7f) * 4,
    width: (area >> 4) * 4 + 4,
    height: (area & 0x0f) * 4 + 4,
    // The fourth byte is always zero.
    spare: view.getUint8(offset + 3)
  };
}

/**
 * @param {Uint8Array} bytes one unpacked section, 2048 bytes
 * @returns {object} the level
 */
export function parseLevel (bytes) {
  if (bytes.length !== LEVEL_SIZE) throw new Error(`level record is ${bytes.length} bytes, expected ${LEVEL_SIZE}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);

  const skills = {};
  SKILLS.forEach((name, index) => { skills[name] = view.getUint16(8 + index * 2); });

  const objects = [];
  for (let i = 0; i < MAX_OBJECTS; i++) {
    const offset = 0x20 + i * 8;
    // An unused slot is all zeros; slot zero of a used object is never empty
    // because every level has at least one entrance.
    let empty = true;
    for (let b = 0; b < 8; b++) if (bytes[offset + b] !== 0) { empty = false; break; }
    if (empty) continue;
    objects.push(readObject(view, offset));
  }

  const terrain = [];
  for (let i = 0; i < MAX_TERRAIN; i++) {
    const piece = readTerrain(view, 0x120 + i * 4);
    if (piece) terrain.push(piece);
  }

  const steel = [];
  for (let i = 0; i < MAX_STEEL; i++) {
    const area = readSteel(view, 0x760 + i * 4);
    if (area) steel.push(area);
  }

  return {
    releaseRate: view.getUint16(0),
    lemmings: view.getUint16(2),
    toRescue: view.getUint16(4),
    timeLimit: view.getUint16(6),
    skills,
    startX: view.getUint16(0x18),
    graphicsSet: view.getUint16(0x1a),
    graphicsSetName: GRAPHICS_SETS[view.getUint16(0x1a)] ?? null,
    specialSet: view.getUint16(0x1c),
    // Lemmix reads 0xFFFF here as the "super lemming" flag - the mode where
    // the game runs at double speed. No level of the original sets it.
    superLemming: view.getUint16(0x1e) === 0xffff,
    reserved: view.getUint16(0x1e),
    objects,
    terrain,
    steel,
    name: decodeName(bytes.subarray(0x7e0, 0x800))
  };
}

/**
 * `oddtable.dat`: eighty records of 56 bytes. A record repeats the parameters
 * of a level - counts, time, skills and a name - for a rating that reuses the
 * same terrain, which is how eighty stored levels become a hundred and twenty.
 * The layout is the head of a level record: the same fields up to the skills,
 * then the name.
 */
export const ODD_ENTRY_SIZE = 56;

export function parseOddTable (bytes) {
  if (bytes.length % ODD_ENTRY_SIZE !== 0) {
    throw new Error(`odd table is ${bytes.length} bytes, not a multiple of ${ODD_ENTRY_SIZE}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const entries = [];
  for (let offset = 0; offset < bytes.length; offset += ODD_ENTRY_SIZE) {
    const skills = {};
    SKILLS.forEach((name, index) => { skills[name] = view.getUint16(offset + 8 + index * 2); });
    entries.push({
      index: entries.length,
      releaseRate: view.getUint16(offset),
      lemmings: view.getUint16(offset + 2),
      toRescue: view.getUint16(offset + 4),
      timeLimit: view.getUint16(offset + 6),
      skills,
      name: decodeName(bytes.subarray(offset + 0x18, offset + ODD_ENTRY_SIZE))
    });
  }
  return entries;
}
