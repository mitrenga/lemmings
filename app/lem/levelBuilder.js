const { VGAVideoRAM } = await import('../svision/js/platform/canvas2D/vga/vgaVideoRAM.js?ver='+window.srcVersion);
// begin code

/**
 * Builds the world of a level: the 1584x160 bitmap the lemmings walk on, and
 * the terrain mask that says which of its pixels are solid.
 *
 * This is the one place where Lemmings differs from every other game the
 * library has carried so far. There is no grid of tiles: the level is a list
 * of terrain pieces stamped into one bitmap, and from then on the **mask is
 * game state** - a basher cuts pixels out of it, a builder adds them. So the
 * builder does not only paint, it also hands out the mask, and both are
 * compared byte for byte by the match tools.
 *
 * Pieces are drawn in the order of the list, with three modifiers from the
 * level record: `doNotOverwrite` leaves pixels that are already terrain,
 * `remove` erases where the piece is solid, and `upsideDown` flips it. Objects
 * come afterwards, those that draw only over terrain first (the order of
 * `Game.Rendering.pas` of Lemmix, verified against the running original by its
 * author; see MILNIKY.md).
 */
export class LevelBuilder {

  /** The bitmap of a level is always this big. */
  static get WIDTH() { return 1584; }
  static get HEIGHT() { return 160; }
  /** The special levels put their own 960x160 picture at this column. */
  static get SPECIAL_X() { return 304; }

  /**
   * @param {Object} level - a parsed level record, as `data/levels/*.json`.
   * @param {GraphicsSet} graphics - the set the level uses.
   * @param {?Object} [special] - `{width, height, pixels}` of a special level.
   */
  constructor(level, graphics, special) {
    this.id = 'LevelBuilder';
    this.level = level;
    this.graphics = graphics;
    this.special = special || null;
    /** the picture, one byte per pixel, colour index 0..15 */
    this.videoRAM = VGAVideoRAM.buffer(LevelBuilder.WIDTH, LevelBuilder.HEIGHT);
    /** 1 where a lemming cannot walk through, one byte per pixel */
    this.mask = new Uint8Array(LevelBuilder.WIDTH*LevelBuilder.HEIGHT);
  } // constructor

  /**
   * Draws the terrain and then the objects.
   * @param {boolean} [withObjects=true] - objects are part of the picture, not
   *   of the mask; a tool that only wants the walkable world can leave them out.
   * @returns {LevelBuilder} this
   */
  build(withObjects) {
    this.videoRAM.fill(0);
    this.mask.fill(0);

    if (this.special) this.drawSpecial();
    else for (var i = 0; i < this.level.terrain.length; i++) this.drawTerrain(this.level.terrain[i]);

    if (withObjects !== false) {
      // Two passes, as the original draws them.
      for (var pass = 0; pass < 2; pass++) {
        for (var o = 0; o < this.level.objects.length; o++) {
          var object = this.level.objects[o];
          if ((pass === 0) === Boolean(object.onlyOverTerrain)) this.drawObject(object);
        }
      }
    }
    return this;
  } // build

  /**
   * One terrain piece.
   * @param {Object} piece - `{id, x, y, doNotOverwrite, remove, upsideDown}`.
   */
  drawTerrain(piece) {
    var art = this.graphics.terrain[piece.id];
    if (!art) return;
    for (var y = 0; y < art.height; y++) {
      for (var x = 0; x < art.width; x++) {
        var source = piece.upsideDown ? (art.height-1-y)*art.width + x : y*art.width + x;
        if (!art.mask[source]) continue;      // transparent, nothing happens
        var targetX = piece.x + x;
        var targetY = piece.y + y;
        if (targetX < 0 || targetX >= LevelBuilder.WIDTH) continue;
        if (targetY < 0 || targetY >= LevelBuilder.HEIGHT) continue;
        var at = targetY*LevelBuilder.WIDTH + targetX;
        if (piece.remove) {
          this.videoRAM.bytes[at] = 0;
          this.mask[at] = 0;
        } else if (piece.doNotOverwrite && this.mask[at]) {
          continue;
        } else {
          this.videoRAM.bytes[at] = art.pixels[source];
          this.mask[at] = 1;
        }
      }
    }
  } // drawTerrain

  /**
   * One interactive object, in the frame the still picture of a level shows.
   * Objects do not change the terrain mask - a lemming walks through an exit
   * or a trap, not on it.
   * @param {Object} object - `{id, x, y, onlyOnBackground, onlyOverTerrain, upsideDown}`.
   */
  drawObject(object) {
    var meta = this.graphics.objects[object.id];
    var frame = this.graphics.previewFrameOf(object.id);
    if (!meta || !frame) return;
    for (var y = 0; y < meta.height; y++) {
      for (var x = 0; x < meta.width; x++) {
        var source = object.upsideDown ? (meta.height-1-y)*meta.width + x : y*meta.width + x;
        if (!frame.mask[source]) continue;
        var targetX = object.x + x;
        var targetY = object.y + y;
        if (targetX < 0 || targetX >= LevelBuilder.WIDTH) continue;
        if (targetY < 0 || targetY >= LevelBuilder.HEIGHT) continue;
        var at = targetY*LevelBuilder.WIDTH + targetX;
        // "only on terrain" shows the object through the terrain, "no
        // overwrite" only where nothing has been drawn at all.
        if (object.onlyOverTerrain && !this.mask[at]) continue;
        if (object.onlyOnBackground && this.videoRAM.bytes[at] !== 0) continue;
        this.videoRAM.bytes[at] = frame.pixels[source];
      }
    }
  } // drawObject

  /**
   * The four special levels do not list terrain at all: their whole world is
   * one 960x160 picture from `vgaspec<n>.dat`, drawn at a fixed column.
   */
  drawSpecial() {
    var art = this.special;
    for (var y = 0; y < art.height; y++) {
      for (var x = 0; x < art.width; x++) {
        var value = art.pixels[y*art.width + x];
        if (!value) continue;
        var targetX = LevelBuilder.SPECIAL_X + x;
        var targetY = y;
        if (targetX < 0 || targetX >= LevelBuilder.WIDTH) continue;
        if (targetY >= LevelBuilder.HEIGHT) continue;
        var at = targetY*LevelBuilder.WIDTH + targetX;
        this.videoRAM.bytes[at] = value;
        this.mask[at] = 1;
      }
    }
  } // drawSpecial

  /**
   * Cuts the 320x160 window the game shows out of the world.
   * @param {number} x - left edge in the level, clamped to the level.
   * @returns {VGAVideoRAM} a 320x160 buffer.
   */
  window(x) {
    var left = Math.max(0, Math.min(LevelBuilder.WIDTH-320, Math.round(x)));
    var window = VGAVideoRAM.buffer(320, 160);
    for (var y = 0; y < 160; y++) {
      var from = y*LevelBuilder.WIDTH + left;
      window.bytes.set(this.videoRAM.bytes.subarray(from, from+320), y*320);
    }
    return window;
  } // window

} // LevelBuilder

export default LevelBuilder;
