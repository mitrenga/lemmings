// begin code

/**
 * The panel under the game window: the skill buttons with the number left of
 * each, the status line, and the mini map of the level.
 *
 * The picture of the panel and both its fonts come out of `main.dat` (section
 * 6 for the panel and the status font, section 2 for the little digits over
 * the buttons) through `tools/dumpdat.mjs --what lemmings`, so nothing here is
 * drawn by hand. What is written on it - which numbers, where, in what order -
 * follows the original: the status line is forty characters in four fields,
 * and the buttons sit sixteen pixels apart starting one pixel from the left.
 */
export class Panel {

  /** The panel is the bottom forty lines of the 320x200 screen. */
  static get TOP() { return 160; }
  static get WIDTH() { return 320; }
  static get HEIGHT() { return 40; }

  /** The buttons, in the order they sit on the panel. */
  static get BUTTONS() {
    return ['slower', 'faster', 'climber', 'floater', 'bomber', 'blocker',
            'builder', 'basher', 'miner', 'digger', 'pause', 'nuke'];
  }
  /** The first button's box, and the step to the next one. */
  static get BUTTON_X() { return 1; }
  static get BUTTON_Y() { return 16; }
  static get BUTTON_WIDTH() { return 14; }
  static get BUTTON_HEIGHT() { return 22; }
  static get BUTTON_STEP() { return 16; }

  /** Where the mini map sits inside the panel, and how the level scales onto it. */
  static get MINIMAP_X() { return 208; }
  static get MINIMAP_Y() { return 18; }
  static get MINIMAP_WIDTH() { return 104; }
  static get MINIMAP_HEIGHT() { return 20; }
  static get MINIMAP_SCALE_X() { return 16; }
  static get MINIMAP_SCALE_Y() { return 8; }

  /**
   * @param {Object} json - the contents of `data/main/panel.json`.
   */
  constructor(json) {
    this.id = 'Panel';
    this.width = json.width;
    this.height = json.height;
    this.pixels = Panel.fromBase64(json.pixels);
    this.fontWidth = json.fontWidth;
    this.fontHeight = json.fontHeight;
    this.font = {};
    for (var character in json.font) this.font[character] = Panel.fromBase64(json.font[character]);
    this.digits = json.digits.map(function (digit) {
      return {left: Panel.fromBase64(digit.left), right: Panel.fromBase64(digit.right)};
    });
  } // constructor

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
   * The status line of the original: forty characters in four fields - what
   * is under the cursor, how many lemmings are out, how many are already in,
   * and the time left.
   *
   * @param {Object} status - `{out, saved, total, seconds}`.
   * @param {?string} [underCursor] - `WALKER 2` and the like.
   * @returns {string} exactly forty characters.
   */
  static statusLine(status, underCursor) {
    var pad = function (text, length) {
      text = String(text);
      while (text.length < length) text += ' ';
      return text.substring(0, length);
    };
    var padLeft = function (text, length, with_) {
      text = String(text);
      while (text.length < length) text = (with_ || ' ') + text;
      return text.substring(text.length-length);
    };
    var percent = status.total ? Math.floor(status.saved*100/status.total) : 0;
    var minutes = Math.floor(status.seconds/60);
    var seconds = status.seconds % 60;
    return pad(underCursor || '', 14) +
      'OUT ' + pad(status.out, 5) +
      'IN ' + pad(percent+'%', 5) +
      'TIME' + padLeft(minutes, 2) + '-' + padLeft(seconds, 2, '0');
  } // statusLine

  /**
   * Draws the whole panel into the screen.
   *
   * @param {VGAVideoRAM} screen - the 320x200 picture.
   * @param {Object} status - `{out, saved, total, seconds, releaseRate, skills}`.
   * @param {Object} [options] - `{selected, underCursor, level, scrollX, terrain, lemmings}`.
   */
  draw(screen, status, options) {
    var settings = options || {};
    // the panel itself
    for (var y = 0; y < this.height; y++) {
      for (var x = 0; x < this.width; x++) {
        screen.bytes[(Panel.TOP+y)*screen.width + x] = this.pixels[y*this.width + x];
      }
    }

    this.drawText(screen, 0, 0, Panel.statusLine(status, settings.underCursor));

    // the numbers over the buttons: the level's release rate, the current one,
    // and then how many of each skill are left
    var counts = [settings.level ? settings.level.releaseRate : 0, status.releaseRate];
    var skills = status.skills || {};
    for (var i = 2; i < Panel.BUTTONS.length; i++) {
      var name = Panel.BUTTONS[i];
      counts.push(name in skills ? skills[name] : null);
    }
    for (var button = 0; button < counts.length; button++) {
      if (counts[button] === null || counts[button] === undefined) continue;
      this.drawCount(screen, button, counts[button]);
    }

    if (settings.selected) this.drawSelector(screen, Panel.BUTTONS.indexOf(settings.selected));
    if (settings.terrain) this.drawMinimap(screen, settings.terrain, settings.lemmings || [], settings.scrollX || 0);
  } // draw

  /**
   * Writes with the font of the status line.
   * @param {VGAVideoRAM} screen
   * @param {number} x - inside the panel.
   * @param {number} y - inside the panel.
   * @param {string} text
   */
  drawText(screen, x, y, text) {
    var at = x;
    for (var i = 0; i < text.length; i++) {
      var glyph = this.font[text.charAt(i).toUpperCase()];
      if (glyph) {
        for (var gy = 0; gy < this.fontHeight; gy++) {
          for (var gx = 0; gx < this.fontWidth; gx++) {
            var value = glyph[gy*this.fontWidth + gx];
            var targetX = at + gx;
            var targetY = Panel.TOP + y + gy;
            if (targetX < 0 || targetX >= screen.width || targetY >= screen.height) continue;
            screen.bytes[targetY*screen.width + targetX] = value;
          }
        }
      }
      at += this.fontWidth;
    }
  } // drawText

  /**
   * The two little digits over a button. Every digit is stored twice, once on
   * each half of its 8x8 box, so a two digit number is the left half of one
   * and the right half of the other.
   * @param {VGAVideoRAM} screen
   * @param {number} button - 0..11.
   * @param {number} count
   */
  drawCount(screen, button, count) {
    var value = Math.max(0, Math.min(99, count|0));
    var left = Math.floor(value/10);
    var right = value % 10;
    var x = button*Panel.BUTTON_STEP + 4;
    var y = Panel.TOP + 17;

    // A button with nothing left shows no number at all - the panel has a
    // black hole under the digits, and it simply stays empty.
    // ★ Lemmix paints that area white instead; which of the two the DOS
    // original does is a question for the screenshots of L5.
    if (value === 0) return;

    for (var row = 0; row < 8; row++) {
      for (var column = 0; column < 4; column++) {
        screen.bytes[(y+row)*screen.width + x + column] = this.digits[left].left[row*8 + column] ? 3 : 0;
        screen.bytes[(y+row)*screen.width + x + 4 + column] = this.digits[right].right[row*8 + 4 + column] ? 3 : 0;
      }
    }
  } // drawCount

  /** A frame around the button whose skill the next click hands out. */
  drawSelector(screen, button) {
    if (button < 0) return;
    var x = Panel.BUTTON_X + button*Panel.BUTTON_STEP;
    var y = Panel.TOP + Panel.BUTTON_Y;
    for (var i = 0; i < Panel.BUTTON_WIDTH; i++) {
      screen.bytes[y*screen.width + x + i] = 3;
      screen.bytes[(y+Panel.BUTTON_HEIGHT-1)*screen.width + x + i] = 3;
    }
    for (var j = 0; j < Panel.BUTTON_HEIGHT; j++) {
      screen.bytes[(y+j)*screen.width + x] = 3;
      screen.bytes[(y+j)*screen.width + x + Panel.BUTTON_WIDTH-1] = 3;
    }
  } // drawSelector

  /**
   * The mini map: the terrain of the whole level shrunk sixteen times across
   * and eight times down, the lemmings as dots, and the frame of what the
   * window is showing.
   *
   * @param {VGAVideoRAM} screen
   * @param {Uint8Array} terrain - the mask of the level, 1584x160.
   * @param {Array} lemmings - `{x, y}` of every lemming still on the level.
   * @param {number} scrollX - where the window looks.
   */
  drawMinimap(screen, terrain, lemmings, scrollX) {
    var levelWidth = 1584;
    var left = Panel.MINIMAP_X;
    var top = Panel.TOP + Panel.MINIMAP_Y;

    for (var y = 0; y < Panel.MINIMAP_HEIGHT; y++) {
      for (var x = 0; x < Panel.MINIMAP_WIDTH; x++) {
        var value = 0;
        var fromX = x*Panel.MINIMAP_SCALE_X;
        var fromY = y*Panel.MINIMAP_SCALE_Y;
        // any solid pixel in the block makes the dot solid
        for (var by = 0; by < Panel.MINIMAP_SCALE_Y && !value; by++) {
          for (var bx = 0; bx < Panel.MINIMAP_SCALE_X; bx++) {
            if (fromX + bx >= levelWidth) break;
            if (terrain[(fromY+by)*levelWidth + fromX + bx]) {
              value = 7;
              break;
            }
          }
        }
        screen.bytes[(top+y)*screen.width + left + x] = value;
      }
    }

    for (var i = 0; i < lemmings.length; i++) {
      var dotX = left + Math.floor(lemmings[i].x/Panel.MINIMAP_SCALE_X);
      var dotY = top + Math.floor(lemmings[i].y/Panel.MINIMAP_SCALE_Y);
      if (dotX < left || dotX >= left+Panel.MINIMAP_WIDTH) continue;
      if (dotY < top || dotY >= top+Panel.MINIMAP_HEIGHT) continue;
      screen.bytes[dotY*screen.width + dotX] = 4;
    }

    // the window, as a frame twenty five dots wide
    var frameX = left + Math.round(scrollX/Panel.MINIMAP_SCALE_X);
    var frameWidth = 25;
    for (var fx = 0; fx < frameWidth; fx++) {
      var column = frameX + fx;
      if (column < left || column >= left+Panel.MINIMAP_WIDTH) continue;
      screen.bytes[top*screen.width + column] = 3;
      screen.bytes[(top+Panel.MINIMAP_HEIGHT-1)*screen.width + column] = 3;
    }
    for (var fy = 0; fy < Panel.MINIMAP_HEIGHT; fy++) {
      if (frameX >= left && frameX < left+Panel.MINIMAP_WIDTH) {
        screen.bytes[(top+fy)*screen.width + frameX] = 3;
      }
      var right = frameX + frameWidth - 1;
      if (right >= left && right < left+Panel.MINIMAP_WIDTH) {
        screen.bytes[(top+fy)*screen.width + right] = 3;
      }
    }
  } // drawMinimap

  /**
   * What the player hit on the panel.
   * @param {number} x - on the screen.
   * @param {number} y - on the screen.
   * @returns {?{button: ?string, minimapX: ?number}}
   */
  hit(x, y) {
    if (y < Panel.TOP) return null;
    var localY = y - Panel.TOP;
    if (localY >= Panel.BUTTON_Y && localY < Panel.BUTTON_Y + Panel.BUTTON_HEIGHT) {
      var index = Math.floor((x - Panel.BUTTON_X)/Panel.BUTTON_STEP);
      var inside = (x - Panel.BUTTON_X) % Panel.BUTTON_STEP;
      if (index >= 0 && index < Panel.BUTTONS.length && inside < Panel.BUTTON_WIDTH) {
        return {button: Panel.BUTTONS[index], minimapX: null};
      }
    }
    if (x >= Panel.MINIMAP_X && x < Panel.MINIMAP_X + Panel.MINIMAP_WIDTH &&
        localY >= Panel.MINIMAP_Y && localY < Panel.MINIMAP_Y + Panel.MINIMAP_HEIGHT) {
      // clicking the mini map centres the window on that spot
      return {button: null, minimapX: (x - Panel.MINIMAP_X)*Panel.MINIMAP_SCALE_X - 160};
    }
    return {button: null, minimapX: null};
  } // hit

} // Panel

export default Panel;
