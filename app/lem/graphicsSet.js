// begin code

/**
 * One graphics set of the game - "dirt", "fire", "marble", "pillar" or
 * "crystal" - as the remake holds it: the terrain pieces a level is built
 * from, the interactive objects with their frames and trigger areas, and the
 * eight colours the set puts into the upper half of the palette.
 *
 * The original keeps this in two files, `ground<n>o.dat` (the description) and
 * `vgagr<n>.dat` (the bitmaps). `tools/dumpdat.mjs` turns the pair into one
 * JSON under `data/sets/`, with the pixels as base64 - one byte per pixel,
 * the colour index 0..15, zero being transparent. This class is that JSON at
 * run time; it never reads a DAT file.
 */
export class GraphicsSet {

  /**
   * @param {Object} json - the contents of `data/sets/set<n>.json`.
   */
  constructor(json) {
    this.id = 'GraphicsSet';
    /** 0..4 */
    this.number = json.set;
    /** "dirt", "fire", ... */
    this.name = json.name;
    /** the eight colours of the set, 6-bit r, g, b */
    this.colours = json.palette.custom;
    /** the eight colours of the level preview screen */
    this.previewColours = json.palette.preview;
    /** terrain pieces by their id in the level record; `null` for an empty slot */
    this.terrain = (json.terrain || []).map(GraphicsSet.decodePiece);
    /** interactive objects by their id; `null` for an empty slot */
    this.objects = (json.objects || []).map(GraphicsSet.decodeObject);
  } // constructor

  /**
   * @param {Object} piece - `{width, height, pixels}` with base64 pixels.
   * @returns {?{width: number, height: number, pixels: Uint8Array, mask: Uint8Array}}
   */
  static decodePiece(piece) {
    if (!piece) return null;
    var pixels = GraphicsSet.fromBase64(piece.pixels);
    return {
      width: piece.width,
      height: piece.height,
      pixels: pixels,
      // Every picture of the game has a mask that is exactly "the pixel is
      // not transparent" - verified on all 273 terrain pieces and all 540
      // object frames of the five sets - so it is not stored, it is derived.
      // A `mask` is still honoured if `data/` ever carries one.
      mask: piece.mask ? GraphicsSet.fromBase64(piece.mask) : GraphicsSet.maskOf(pixels)
    };
  } // decodePiece

  /** @param {Object} object - one entry of the `objects` array. */
  static decodeObject(object) {
    if (!object) return null;
    var frames = [];
    for (var i = 0; i < object.frames.length; i++) {
      var frame = object.frames[i];
      var pixels = GraphicsSet.fromBase64(frame.pixels);
      frames.push({
        pixels: pixels,
        // The same holds for object frames, once the frame count is read the
        // way the game reads it (byte 3 of the object entry is a count, not
        // the index of the last frame - reading one frame too many walks into
        // the next object and was what made 38 frames look different).
        mask: frame.mask ? GraphicsSet.fromBase64(frame.mask) : GraphicsSet.maskOf(pixels)
      });
    }
    return {
      width: object.width,
      height: object.height,
      frames: frames,
      startFrame: object.startFrame,
      frameCount: object.frameCount,
      previewFrame: object.previewFrame,
      /** 0 = the animation loops, 1 = it only plays when triggered */
      triggeredAnimation: (object.animationFlags & 1) !== 0,
      /** `{left, top, width, height, effect}`, in pixels from the object's corner */
      trigger: object.trigger,
      /** the sound a trap plays, only for `effect === 'trap'` */
      sound: object.sound
    };
  } // decodeObject

  /** A solid-pixel mask of a bitmap: 1 where the pixel is not the transparent 0. */
  static maskOf(pixels) {
    var mask = new Uint8Array(pixels.length);
    for (var i = 0; i < pixels.length; i++) mask[i] = pixels[i] === 0 ? 0 : 1;
    return mask;
  } // maskOf

  /** Base64 to bytes, in the browser and under Node alike. */
  static fromBase64(text) {
    if (typeof atob === 'function') {
      var binary = atob(text);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    return new Uint8Array(Buffer.from(text, 'base64'));
  } // fromBase64

  /**
   * The frame the level preview - and any still picture of the level - shows
   * of an object.
   * @param {number} identifier - the object's id in the level record.
   */
  previewFrameOf(identifier) {
    var object = this.objects[identifier];
    if (!object || !object.frames.length) return null;
    var index = Math.min(object.previewFrame, object.frames.length-1);
    return object.frames[index];
  } // previewFrameOf

} // GraphicsSet

export default GraphicsSet;
