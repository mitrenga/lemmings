const { VGAPalette } = await import('../svision/js/platform/canvas2D/vga/vgaPalette.js?ver='+window.srcVersion);
// begin code

/**
 * The palettes of Lemmings.
 *
 * The game runs 320x200 but uses **sixteen colours**, not 256: a pixel is an
 * index 0..15 and the card holds the sixteen registers as 6-bit components of
 * the VGA DAC. Only the upper half changes - it comes from the graphics set of
 * the level - and of the lower half only seven entries are really fixed:
 * index 7 is a copy of the set's first colour, and the game draws the
 * builder's bricks and the mini map with it.
 *
 * Outside a level (menu, level preview, results) a different sixteen colour
 * palette is used; it is written here in the same 6-bit components, so both
 * go into a {@link VGAPalette} the same way.
 */
export class LemPalette {

  /** The seven fixed in-level colours, 6-bit r, g, b. */
  static get FIXED() {
    return [
      [0x00, 0x00, 0x00],   // black, and the transparent colour of every bitmap
      [0x10, 0x10, 0x38],   // blue - the bodies
      [0x00, 0x2c, 0x00],   // green - the hair
      [0x3c, 0x34, 0x34],   // white - the skin
      [0x2c, 0x2c, 0x00],   // dirty yellow - the panel
      [0x3c, 0x08, 0x08],   // red - the nuke icon
      [0x20, 0x20, 0x20]    // grey - the panel
    ];
  }

  /**
   * The palette outside a level. The document that describes `main.dat` gives
   * it in 8-bit components; these are those values scaled down to the six
   * bits the DAC holds, which is how the game itself holds them.
   */
  static get MENU() {
    return [
      [0x00, 0x00, 0x00], [0x20, 0x10, 0x08], [0x18, 0x0c, 0x08], [0x0c, 0x00, 0x04],
      [0x08, 0x02, 0x1f], [0x10, 0x0b, 0x24], [0x1a, 0x16, 0x29], [0x26, 0x23, 0x2f],
      [0x00, 0x14, 0x00], [0x00, 0x18, 0x04], [0x00, 0x1c, 0x08], [0x00, 0x20, 0x10],
      [0x34, 0x34, 0x34], [0x2c, 0x2c, 0x00], [0x10, 0x14, 0x2c], [0x38, 0x20, 0x24]
    ];
  }

  /**
   * Builds the sixteen in-level registers.
   *
   * @param {number[][]} setColours - the eight colours of the graphics set,
   *   6-bit r, g, b, as they come out of `ground<n>o.dat`.
   * @returns {number[][]} sixteen colours, 6-bit r, g, b.
   */
  static inLevel(setColours) {
    if (!setColours || setColours.length < 8) throw new Error('a graphics set has eight colours');
    var colours = LemPalette.FIXED.slice();
    colours.push(setColours[0].slice());   // index 7 - bricks and the mini map
    for (var i = 0; i < 8; i++) colours.push(setColours[i].slice());
    return colours;
  } // inLevel

  /**
   * The same thing as a {@link VGAPalette}, so a level can be painted through
   * the machine the remake runs on. Registers 16..255 stay black - the game
   * never writes them.
   *
   * @param {number[][]} setColours - the eight colours of the graphics set.
   * @returns {VGAPalette}
   */
  static vgaInLevel(setColours) {
    return LemPalette.toVGA(LemPalette.inLevel(setColours));
  } // vgaInLevel

  /**
   * @param {number[][]} colours - up to 256 colours, 6-bit r, g, b.
   * @returns {VGAPalette}
   */
  static toVGA(colours) {
    var bytes = new Uint8Array(colours.length*3);
    for (var i = 0; i < colours.length; i++) {
      bytes[i*3] = colours[i][0];
      bytes[i*3+1] = colours[i][1];
      bytes[i*3+2] = colours[i][2];
    }
    return new VGAPalette().load(bytes);
  } // toVGA

} // LemPalette

export default LemPalette;
