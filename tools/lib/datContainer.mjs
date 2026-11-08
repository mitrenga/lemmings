/**
 * The DAT container of DOS Lemmings: the bit stream compression every packed
 * file of the game uses, and the byte oriented second layer the special
 * graphics (`vgaspec*.dat`) are wrapped in on top of it.
 *
 * A DAT file is a row of independent sections, each one a ten byte header
 * followed by its compressed bytes. Both the bit stream and the data it
 * produces run backwards: the reader starts at the last byte of the section
 * and fills the output from its last byte towards the first one. See
 * `NOTES.md` and `sources/reference/formats/lemmings_dat_file_format.txt`.
 *
 * The game never reads DAT files at run time - the tools turn them into open
 * formats under `data/` - so this module lives in `tools/`, not in `app/`.
 */

export const HEADER_SIZE = 10;

/** Largest offset each reference encoding can express, by block length. */
const MAX_OFFSET = { 2: 256, 3: 512, 4: 1024, long: 4096 };
/** A `110` reference carries its length in one byte, biased by one. */
const MAX_REFERENCE_LENGTH = 256;
/** A `111` raw run carries its length in one byte, biased by nine. */
const MAX_RAW_RUN = 264;

/**
 * Reads the bits of a section the way the game does: from the last byte
 * towards the first one, each byte from its least significant bit up, with
 * only `bitsInFirstByte` taken from the last byte.
 */
class BackwardBitReader {
  constructor (bytes, bitsInFirstByte) {
    this.bytes = bytes;
    this.index = bytes.length - 1;
    this.current = bytes.length ? bytes[bytes.length - 1] : 0;
    this.left = bitsInFirstByte;
  }

  bit () {
    if (this.left === 0) {
      this.index -= 1;
      if (this.index < 0) throw new Error('compressed data ran out');
      this.current = this.bytes[this.index];
      this.left = 8;
    }
    const bit = this.current & 1;
    this.current >>= 1;
    this.left -= 1;
    return bit;
  }

  number (count) {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | this.bit();
    return value;
  }
}

/** Collects bits in reading order and lays them out into bytes backwards. */
class BackwardBitWriter {
  constructor () {
    this.bits = [];
  }

  bit (value) {
    this.bits.push(value & 1);
  }

  number (value, count) {
    for (let i = count - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }

  /** @returns {{bytes: Uint8Array, bitsInFirstByte: number}} */
  finish () {
    const total = Math.ceil(this.bits.length / 8) || 1;
    const bitsInFirstByte = this.bits.length % 8 || 8;
    const bytes = new Uint8Array(total);
    for (let i = 0; i < this.bits.length; i++) {
      // The first bits read come out of the last byte, and only
      // `bitsInFirstByte` of them; every byte before it carries eight.
      const byte = i < bitsInFirstByte
        ? total - 1
        : total - 2 - ((i - bitsInFirstByte) >> 3);
      const position = i < bitsInFirstByte ? i : (i - bitsInFirstByte) & 7;
      bytes[byte] |= 1 << position;
      if (!this.bits[i]) bytes[byte] &= ~(1 << position);
    }
    return { bytes, bitsInFirstByte };
  }
}

/** The ten byte section header, as it sits in the file. */
export function readHeader (buffer, offset = 0) {
  if (offset + HEADER_SIZE > buffer.length) throw new Error('truncated header');
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, HEADER_SIZE);
  return {
    bitsInFirstByte: view.getUint8(0),
    checksum: view.getUint8(1),
    unused1: view.getUint16(2),
    decompressedSize: view.getUint16(4),
    unused2: view.getUint16(6),
    // The size in the header counts the header itself.
    compressedSize: view.getUint16(8)
  };
}

function writeHeader (header) {
  const bytes = new Uint8Array(HEADER_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, header.bitsInFirstByte);
  view.setUint8(1, header.checksum);
  view.setUint16(2, 0);
  view.setUint16(4, header.decompressedSize);
  view.setUint16(6, 0);
  view.setUint16(8, header.compressedSize);
  return bytes;
}

/** Exclusive or of every byte of the compressed data, header excluded. */
export function checksumOf (bytes) {
  let sum = 0;
  for (const byte of bytes) sum ^= byte;
  return sum;
}

/**
 * Unpacks one section.
 *
 * @param {Uint8Array} buffer whole file
 * @param {number} offset start of the section header
 * @returns {{data: Uint8Array, header: object, checksumOk: boolean}}
 */
export function decompressSection (buffer, offset = 0) {
  const header = readHeader(buffer, offset);
  if (header.compressedSize < HEADER_SIZE) throw new Error('section shorter than its header');
  const end = offset + header.compressedSize;
  if (end > buffer.length) throw new Error('section runs past the end of the file');

  const packed = buffer.subarray(offset + HEADER_SIZE, end);
  const reader = new BackwardBitReader(packed, header.bitsInFirstByte);
  const out = new Uint8Array(header.decompressedSize);
  let position = out.length;

  const raw = (count) => {
    for (let i = 0; i < count; i++) {
      if (position === 0) throw new Error('more bytes decoded than the header promises');
      out[--position] = reader.number(8);
    }
  };
  const reference = (count, offsetBits) => {
    const distance = reader.number(offsetBits) + 1;
    for (let i = 0; i < count; i++) {
      if (position === 0) throw new Error('more bytes decoded than the header promises');
      position -= 1;
      out[position] = out[position + distance];
    }
  };

  while (position > 0) {
    if (reader.bit() === 0) {
      if (reader.bit() === 0) raw(reader.number(3) + 1);
      else reference(2, 8);
    } else {
      switch (reader.number(2)) {
        case 0: reference(3, 9); break;
        case 1: reference(4, 10); break;
        case 2: reference(reader.number(8) + 1, 12); break;
        default: raw(reader.number(8) + 9);
      }
    }
  }

  return { data: out, header, checksumOk: checksumOf(packed) === header.checksum };
}

/**
 * Walks a whole DAT file.
 *
 * @param {Uint8Array} buffer
 * @returns {Array<{data: Uint8Array, header: object, checksumOk: boolean, offset: number}>}
 */
export function decompressFile (buffer) {
  const sections = [];
  let offset = 0;
  while (offset < buffer.length) {
    const section = decompressSection(buffer, offset);
    sections.push({ ...section, offset });
    offset += section.header.compressedSize;
  }
  return sections;
}

/**
 * Tells a packed DAT from the plain files of the game (`ground<n>o.dat`,
 * `oddtable.dat`), which carry no header at all. It only walks the section
 * headers, it does not unpack.
 */
export function looksPacked (buffer) {
  let offset = 0;
  let sections = 0;
  while (offset < buffer.length) {
    if (offset + HEADER_SIZE > buffer.length) return false;
    const header = readHeader(buffer, offset);
    if (header.unused1 !== 0 || header.unused2 !== 0) return false;
    // Zero is legal and the game uses it: it means the last byte of the
    // section carries no bits at all and the stream starts one byte earlier.
    if (header.bitsInFirstByte > 8) return false;
    if (header.compressedSize <= HEADER_SIZE) return false;
    if (header.decompressedSize === 0) return false;
    offset += header.compressedSize;
    sections += 1;
  }
  return offset === buffer.length && sections > 0;
}

/**
 * Packs one section.
 *
 * The original packer is gone and there are many valid ones, so this is not an
 * attempt to reproduce its output byte for byte - it is the counterpart that
 * makes the round trip test of `checkdat.mjs` mean something: our bytes have
 * to unpack to exactly the input again. It scans the data backwards, the way
 * the decoder builds it, and keeps the most recent positions of every pair of
 * bytes to find references from.
 */
export function compressSection (data) {
  const writer = new BackwardBitWriter();
  const pending = [];

  const flushRaw = () => {
    while (pending.length) {
      const count = Math.min(pending.length, MAX_RAW_RUN);
      // A short run is cheaper as `00 nnn`, but only up to eight bytes.
      const take = count <= 8 ? count : Math.max(9, count);
      if (take <= 8) {
        writer.number(0, 2);
        writer.number(take - 1, 3);
      } else {
        writer.number(7, 3);
        writer.number(take - 9, 8);
      }
      for (let i = 0; i < take; i++) writer.number(pending[i], 8);
      pending.splice(0, take);
    }
  };

  /** Most recent positions of each two byte pair, newest first. */
  const pairs = new Map();
  const remember = (position) => {
    if (position < 0 || position + 1 >= data.length) return;
    const key = (data[position] << 8) | data[position + 1];
    const list = pairs.get(key);
    if (!list) pairs.set(key, [position]);
    else {
      list.unshift(position);
      if (list.length > 16) list.pop();
    }
  };

  let cursor = data.length;
  for (let position = data.length - 2; position >= cursor; position--) remember(position);

  while (cursor > 0) {
    let bestLength = 0;
    let bestOffset = 0;

    if (cursor >= 2) {
      const key = (data[cursor - 2] << 8) | data[cursor - 1];
      for (const candidate of pairs.get(key) ?? []) {
        const offset = candidate - (cursor - 2);
        if (offset < 1) continue;
        if (offset > MAX_OFFSET.long) break;
        let length = 2;
        while (
          length < MAX_REFERENCE_LENGTH &&
          cursor - length - 1 >= 0 &&
          data[cursor - length - 1] === data[cursor - length - 1 + offset]
        ) length += 1;
        // Short blocks have their own encodings with a smaller offset field.
        const reach = length === 2 ? MAX_OFFSET[2]
          : length === 3 ? MAX_OFFSET[3]
            : length === 4 ? MAX_OFFSET[4] : MAX_OFFSET.long;
        if (offset > reach) continue;
        if (length > bestLength) {
          bestLength = length;
          bestOffset = offset;
          if (length === MAX_REFERENCE_LENGTH) break;
        }
      }
    }

    if (bestLength >= 2) {
      flushRaw();
      if (bestLength === 2) {
        writer.number(1, 2);
        writer.number(bestOffset - 1, 8);
      } else if (bestLength === 3) {
        writer.number(4, 3);
        writer.number(bestOffset - 1, 9);
      } else if (bestLength === 4) {
        writer.number(5, 3);
        writer.number(bestOffset - 1, 10);
      } else {
        writer.number(6, 3);
        writer.number(bestLength - 1, 8);
        writer.number(bestOffset - 1, 12);
      }
      for (let i = 0; i < bestLength; i++) remember(cursor - 1 - i);
      cursor -= bestLength;
    } else {
      pending.push(data[cursor - 1]);
      if (pending.length === MAX_RAW_RUN) flushRaw();
      remember(cursor - 1);
      cursor -= 1;
    }
  }
  flushRaw();

  const { bytes, bitsInFirstByte } = writer.finish();
  const header = writeHeader({
    bitsInFirstByte,
    checksum: checksumOf(bytes),
    decompressedSize: data.length,
    compressedSize: HEADER_SIZE + bytes.length
  });
  const out = new Uint8Array(header.length + bytes.length);
  out.set(header, 0);
  out.set(bytes, header.length);
  return out;
}

/** Packs a whole file, one section after another. */
export function compressFile (sections) {
  const parts = sections.map(compressSection);
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * The second layer of `vgaspec*.dat`: byte oriented, forwards, and it splits
 * its output into chunks of its own. A length byte below 0x80 introduces that
 * many plus one raw bytes, a byte above it repeats the next byte
 * `0x101 - value` times, and 0x80 ends a chunk.
 *
 * @param {Uint8Array} bytes the data left after the container was unpacked
 * @returns {Uint8Array[]} one entry per chunk
 */
export function decodeSpecialChunks (bytes) {
  const chunks = [];
  let chunk = [];
  let position = 0;
  while (position < bytes.length) {
    const marker = bytes[position++];
    if (marker === 0x80) {
      chunks.push(Uint8Array.from(chunk));
      chunk = [];
    } else if (marker < 0x80) {
      const count = marker + 1;
      for (let i = 0; i < count; i++) chunk.push(bytes[position++]);
    } else {
      const count = 0x101 - marker;
      const value = bytes[position++];
      for (let i = 0; i < count; i++) chunk.push(value);
    }
  }
  if (chunk.length) chunks.push(Uint8Array.from(chunk));
  return chunks;
}

/** The counterpart of {@link decodeSpecialChunks}, again for the round trip. */
export function encodeSpecialChunks (chunks) {
  const out = [];
  for (const chunk of chunks) {
    let position = 0;
    let raw = [];
    const flushRaw = () => {
      while (raw.length) {
        const take = Math.min(raw.length, 128);
        out.push(take - 1, ...raw.slice(0, take));
        raw = raw.slice(take);
      }
    };
    while (position < chunk.length) {
      let run = 1;
      while (run < 128 && position + run < chunk.length && chunk[position + run] === chunk[position]) run += 1;
      if (run >= 2) {
        flushRaw();
        out.push(0x101 - run, chunk[position]);
        position += run;
      } else {
        raw.push(chunk[position]);
        position += 1;
        if (raw.length === 128) flushRaw();
      }
    }
    flushRaw();
    out.push(0x80);
  }
  return Uint8Array.from(out);
}
