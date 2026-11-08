/**
 * The planar bitmaps of DOS Lemmings: a picture is not a row of pixels but a
 * stack of one bit planes, plane 0 first. Plane 0 adds one to the colour
 * index, plane 1 two, plane 2 four, plane 3 eight, so the bits of one pixel
 * are scattered across the whole picture. Masks are the same thing with a
 * single plane, where a one bit means "solid".
 *
 * Every plane is stored row by row, each row padded to whole bytes, the most
 * significant bit leftmost.
 *
 * Source: `sources/reference/formats/lemmings_vgagrx_dat_groundxo_dat_file_format.txt`
 * and `..._main_dat_file_format.txt`.
 */

/** Bytes one plane of a `width` x `height` picture takes. */
export function planeSize (width, height) {
  return Math.ceil(width / 8) * height;
}

/** Bytes a `bitsPerPixel` picture takes. */
export function bitmapSize (width, height, bitsPerPixel) {
  return planeSize(width, height) * bitsPerPixel;
}

/**
 * Decodes a planar bitmap into one byte per pixel.
 *
 * @param {Uint8Array} bytes the section the picture lives in
 * @param {number} offset where the picture starts
 * @param {number} width
 * @param {number} height
 * @param {number} bitsPerPixel 1 for a mask, 3 or 4 for a picture
 * @returns {Uint8Array} width * height colour indices
 */
export function decodePlanar (bytes, offset, width, height, bitsPerPixel) {
  const stride = Math.ceil(width / 8);
  const pixels = new Uint8Array(width * height);
  for (let plane = 0; plane < bitsPerPixel; plane++) {
    const base = offset + plane * stride * height;
    const weight = 1 << plane;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = bytes[base + y * stride + (x >> 3)];
        if (byte === undefined) throw new Error('planar bitmap runs past the end of the data');
        if ((byte >> (7 - (x & 7))) & 1) pixels[y * width + x] |= weight;
      }
    }
  }
  return pixels;
}

/** The counterpart of {@link decodePlanar}, used by the round trip tests. */
export function encodePlanar (pixels, width, height, bitsPerPixel) {
  const stride = Math.ceil(width / 8);
  const bytes = new Uint8Array(stride * height * bitsPerPixel);
  for (let plane = 0; plane < bitsPerPixel; plane++) {
    const base = plane * stride * height;
    const weight = 1 << plane;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[y * width + x] & weight) {
          bytes[base + y * stride + (x >> 3)] |= 1 << (7 - (x & 7));
        }
      }
    }
  }
  return bytes;
}

/** Decodes a one plane mask; 1 means solid, 0 transparent. */
export function decodeMask (bytes, offset, width, height) {
  return decodePlanar(bytes, offset, width, height, 1);
}
