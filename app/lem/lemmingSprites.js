// begin code

/**
 * The lemming animations out of `main.dat`, as the remake holds them:
 * `data/main/lemmings.json`, made by `tools/dumpdat.mjs --what lemmings`.
 *
 * Every animation carries its **foot point** - the pixel of the picture that
 * sits exactly where the lemming's position is. The game stores a lemming as
 * one point under its feet, so drawing means putting the picture at
 * `x - footX`, `y - footY`. Those numbers are not in the published format
 * documents; they come from the table in Lemmix and belong to the data, not
 * to the physics code.
 *
 * The masks the skills cut out of the terrain are in the same file; they are
 * not used before L4, but they come out of the same section.
 */
export class LemmingSprites {

  /** @param {Object} json - the contents of `data/main/lemmings.json`. */
  constructor(json) {
    this.id = 'LemmingSprites';
    /** animations by name: `walking`, `walkingLeft`, `falling`, ... */
    this.animations = {};
    for (var i = 0; i < json.animations.length; i++) {
      var animation = json.animations[i];
      this.animations[animation.name] = {
        name: animation.name,
        width: animation.width,
        height: animation.height,
        footX: animation.footX,
        footY: animation.footY,
        loops: animation.loops,
        frames: animation.frames.map(LemmingSprites.fromBase64)
      };
    }
    /** terrain masks by name: `bash`, `bashLeft`, `mine`, `mineLeft`, `explosion` */
    this.masks = {};
    for (var m = 0; m < (json.masks || []).length; m++) {
      var mask = json.masks[m];
      this.masks[mask.name] = {
        width: mask.width, height: mask.height,
        frames: mask.frames.map(LemmingSprites.fromBase64)
      };
    }
    /** the explosion countdown digits, 0..9, 8x8, one byte per pixel */
    this.countdown = (json.countdown || []).map(LemmingSprites.fromBase64);
  } // constructor

  /**
   * The animation of an action, in the direction the lemming faces.
   * @param {string} action - `walking`, `falling`, `splatting`, ...
   * @param {number} xDelta - +1 facing right, -1 facing left.
   */
  animation(action, xDelta) {
    var left = this.animations[action + 'Left'];
    return (xDelta < 0 && left) ? left : this.animations[action];
  } // animation

  static fromBase64(text) {
    if (typeof atob === 'function') {
      var binary = atob(text);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    return new Uint8Array(Buffer.from(text, 'base64'));
  } // fromBase64

} // LemmingSprites

export default LemmingSprites;
