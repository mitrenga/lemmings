const { VGAVideoRAM } = await import('./svision/js/platform/canvas2D/vga/vgaVideoRAM.js?ver='+window.srcVersion);
const { VGAPalette } = await import('./svision/js/platform/canvas2D/vga/vgaPalette.js?ver='+window.srcVersion);
const { LevelBuilder } = await import('./lem/levelBuilder.js?ver='+window.srcVersion);
const { GraphicsSet } = await import('./lem/graphicsSet.js?ver='+window.srcVersion);
const { LemmingSprites } = await import('./lem/lemmingSprites.js?ver='+window.srcVersion);
const { LemPalette } = await import('./lem/palette.js?ver='+window.srcVersion);
const { LemmingsGame } = await import('./lem/lemmingsGame.js?ver='+window.srcVersion);
const { Panel } = await import('./lem/panel.js?ver='+window.srcVersion);
// begin code

/**
 * The game program. It runs in a web worker glued out of this module and the
 * ones it imports (svision `ModuleWorker`), ticking at the original's
 * **17 frames a second**, and sends its video memory and palette to the model
 * whenever the picture changed. The same class runs under Node for the tools:
 * `new GameWorker(post)` with `handleMessage()` and `tick()`, no timers
 * (`app/WORKER-PROTOCOL.md`).
 *
 * Milestone L3: the lemmings come out of the hatch and get on with it. The
 * player cannot do anything to them yet - the skills are L4 - so the only
 * input is where the window looks (`scroll`). The seed and a substitutable
 * source of randomness are here from the start (R-009), although nothing in
 * Lemmings has asked for a random number so far: the game is deterministic
 * and its replays depend on it.
 *
 * The screen is the game window, 320x160, at the top of the 320x200 picture;
 * the forty lines below it are the panel and stay black until L5.
 */
export class GameWorker {

  /** one game frame */
  static get TICK_MS() { return 1000/17; }
  /** the game window inside the screen */
  static get WINDOW_HEIGHT() { return 160; }

  /**
   * @param {Function} post - Sends a message to the model (`postMessage`).
   */
  constructor(post) {
    this.post = post;
    this.frame = 0;
    this.running = false;
    this.paused = false;
    this.finished = false;

    /** the seeded source of randomness, substitutable (R-009) */
    this.seed = 0;
    this.random = GameWorker.seededSource(0);

    this.game = null;
    this.sprites = null;
    this.screen = new VGAVideoRAM();
    this.palette = new VGAPalette();
    this.paletteVersion = 0;
    this.dirty = false;

    /** where the window looks, the left column of the level */
    this.scrollX = 0;
    /** the panel under the window (L5) */
    this.panel = null;
    /** the skill the next click hands out, chosen on the panel or by key */
    this.skill = null;
    /** where the pointer is on the screen */
    this.pointer = {x: 160, y: 80};

    this.timer = null;
    this.accumulator = 0;
    this.lastTime = 0;
  } // constructor

  /**
   * A seeded generator - the same one the tools use, so a run can be
   * repeated from its seed alone (R-009, `../METHODOLOGY.md`).
   * @param {number} seed
   */
  static seededSource(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      var value = Math.imul(state ^ (state >>> 15), 1 | state);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  } // seededSource

  // ---------------------------------------------------------------- messages

  /**
   * One message from the model.
   * @param {Object} msg - `{id, ...}`.
   */
  handleMessage(msg) {
    switch (msg.id) {
      case 'init':
        this.seed = msg.seed === undefined ? 0 : msg.seed >>> 0;
        this.random = GameWorker.seededSource(this.seed);
        this.frame = 0;
        break;
      case 'level':
        this.loadLevel(msg.level, msg.set, msg.main, msg.special, msg.panel);
        if (!msg.headless) {
          this.start();
        }
        break;
      case 'scroll':
        this.scrollTo(msg.x);
        break;
      case 'assign':
        // a skill for the lemming under the point, in level coordinates
        if (this.game) {
          this.game.assignSkill(msg.skill || this.skill, msg.x, msg.y, !!msg.walkersOnly);
          this.render();
        }
        break;
      case 'select':
        this.skill = msg.skill || null;
        this.render();
        break;
      case 'pointer':
        this.pointer.x = msg.x | 0;
        this.pointer.y = msg.y | 0;
        this.render();
        break;
      case 'panelClick':
        this.panelClick(msg.x | 0, msg.y | 0);
        break;
      case 'nuke':
        if (this.game) this.game.nuke();
        break;
      case 'releaseRate':
        // the panel's + and - (L5); never below the rate the level starts at
        if (this.game) {
          var rate = this.game.releaseRate + (msg.step | 0);
          this.game.releaseRate = Math.max(this.game.level.releaseRate, Math.min(99, rate));
        }
        break;
      case 'pause':
        this.paused = true;
        break;
      case 'continue':
        this.paused = false;
        this.lastTime = 0;
        break;
      case 'reset':
        this.stop();
        this.game = null;
        break;
    }
  } // handleMessage

  /**
   * Builds a level and draws its first frame.
   * @param {Object} level - a record out of `data/levels/`.
   * @param {Object} set - the graphics set out of `data/sets/`.
   * @param {Object} main - `data/main/lemmings.json`.
   * @param {?Object} special - `data/special/spec<n>.json` for a special level.
   */
  loadLevel(level, set, main, special, panel) {
    this.sprites = new LemmingSprites(main);
    if (panel) this.panel = new Panel(panel);
    var graphics = new GraphicsSet(set);
    var world = null;
    if (special) {
      world = {
        width: special.width,
        height: special.height,
        pixels: GraphicsSet.fromBase64(special.pixels),
        palette: special.palette
      };
    }
    this.game = new LemmingsGame(level, graphics, this.sprites, {special: world});
    this.frame = 0;
    this.finished = false;

    // A special level brings its own eight colours with it.
    var colours = world ? world.palette : graphics.colours;
    this.palette = LemPalette.vgaInLevel(colours);
    this.paletteVersion++;
    this.scrollTo(level.startX);
    this.render();
  } // loadLevel

  scrollTo(x) {
    var max = LevelBuilder.WIDTH - 320;
    this.scrollX = Math.max(0, Math.min(max, Math.round(x || 0)));
    this.dirty = true;
  } // scrollTo

  // ------------------------------------------------------------------ frames

  /** One frame of the game, then the picture. */
  tick() {
    if (!this.game || this.finished) return;
    this.game.tick();
    this.render();
    if (this.game.finished) {
      this.finished = true;
      this.post({id: 'levelDone', saved: this.game.saved, released: this.game.released,
                 toRescue: this.game.level.toRescue, frame: this.game.frame});
    }
  } // tick

  /**
   * Draws the world with its lemmings into the window, the panel under it and
   * the cursor over it, and sends the picture to the model.
   */
  render() {
    if (!this.game) return;
    this.game.draw();
    var window = this.game.window(this.scrollX);
    this.screen.fill(0);
    this.screen.bytes.set(window.bytes.subarray(0, 320*GameWorker.WINDOW_HEIGHT), 0);

    if (this.panel) {
      this.panel.draw(this.screen, this.status(), {
        selected: this.skill,
        underCursor: this.underCursor(),
        level: this.game.level,
        scrollX: this.scrollX,
        terrain: this.game.terrain,
        lemmings: this.game.lemmings.filter(function (lemming) { return !lemming.removed; })
      });
    }
    this.drawCursor();

    this.dirty = true;
    this.sendFrame();
  } // render

  /** What the status line says about whoever is under the cross. */
  underCursor() {
    if (!this.game || this.pointer.y >= GameWorker.WINDOW_HEIGHT) return null;
    var hit = this.game.hitTest(this.scrollX + this.pointer.x, this.pointer.y, false);
    if (!hit.lemming) return null;
    var names = {
      walking: 'WALKER', jumping: 'WALKER', falling: 'FALLER', floating: 'FLOATER',
      climbing: 'CLIMBER', hoisting: 'CLIMBER', digging: 'DIGGER', building: 'BUILDER',
      bashing: 'BASHER', mining: 'MINER', blocking: 'BLOCKER', shrugging: 'SHRUGGER',
      ohNoing: 'BOMBER', exploding: 'BOMBER', drowning: 'DROWNER', splatting: 'SPLATTER',
      exiting: 'EXITER', vaporizing: 'FRIER'
    };
    var name = names[hit.lemming.action] || hit.lemming.action.toUpperCase();
    // An athlete is a lemming that can both climb and float.
    if (hit.lemming.isClimber && hit.lemming.isFloater) name = 'ATHLETE';
    return name+' '+hit.hits;
  } // underCursor

  /**
   * The cross of the original, and the box it turns into over a lemming.
   * ★ The cursor is not among the pictures of `main.dat` the published
   * documents describe, so it is drawn here until it is found.
   */
  drawCursor() {
    var x = this.pointer.x;
    var y = this.pointer.y;
    if (y >= GameWorker.WINDOW_HEIGHT) return;
    var boxed = this.game && this.game.hitTest(this.scrollX + x, y, false).lemming;
    var put = (px, py) => {
      if (px < 0 || px >= 320 || py < 0 || py >= GameWorker.WINDOW_HEIGHT) return;
      this.screen.bytes[py*320 + px] = 3;
    };
    for (var i = -5; i <= 5; i++) {
      if (Math.abs(i) > 1) {
        put(x+i, y);
        put(x, y+i);
      }
    }
    if (boxed) {
      for (var j = -6; j <= 6; j++) {
        if (Math.abs(j) === 6) {
          for (var k = -6; k <= 6; k++) {
            put(x+k, y+j);
            put(x+j, y+k);
          }
        }
      }
    }
  } // drawCursor

  /**
   * A click on the panel: the buttons work as they do in the original, and
   * the mini map moves the window.
   */
  panelClick(x, y) {
    if (!this.panel || !this.game) return;
    var hit = this.panel.hit(x, y);
    if (!hit) return;
    if (hit.minimapX !== null) {
      this.scrollTo(hit.minimapX);
      this.render();
      return;
    }
    switch (hit.button) {
      case null: break;
      case 'slower':
        this.game.releaseRate = Math.max(this.game.level.releaseRate, this.game.releaseRate-1);
        break;
      case 'faster':
        this.game.releaseRate = Math.min(99, this.game.releaseRate+1);
        break;
      case 'pause':
        this.paused = !this.paused;
        break;
      case 'nuke':
        this.game.nuke();
        break;
      default:
        this.skill = hit.button;
        break;
    }
    this.render();
  } // panelClick

  sendFrame() {
    if (!this.dirty) return;
    this.dirty = false;
    this.post({
      id: 'frame',
      vram: this.screen.bytes,
      palette: this.palette.bytes,
      paletteVersion: this.paletteVersion,
      frame: this.game ? this.game.frame : 0,
      // Which sounds the game asked for this frame, by the numbers of the
      // original; what plays them is the model's business (L6).
      sound: this.game && this.game.sounds.length ? this.game.sounds.slice() : null,
      status: this.status()
    });
  } // sendFrame

  /** What the panel will show once it exists (L5). */
  status() {
    if (!this.game) return null;
    return {
      out: this.game.out,
      saved: this.game.saved,
      released: this.game.released,
      total: this.game.level.lemmings,
      seconds: this.game.secondsLeft,
      releaseRate: this.game.releaseRate,
      skills: this.game.skills,
      nuked: this.game.nuked,
      scrollX: this.scrollX
    };
  } // status

  // ------------------------------------------------------------------- timer

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = 0;
    this.accumulator = 0;
    this.schedule();
  } // start

  /**
   * ★ **Nikdy `setInterval`** (R-046): je nepřesný, a nepřesný **jinak** na
   * každém OS i stroji — období se zaokrouhluje na celé milisekundy, časovače
   * se slučují a když se obsluha opozdí, volání se hromadí. Jediné spolehlivé
   * je **rekurzivní `setTimeout`**, jak to dělá `manicminer/app/gameWorker.js`.
   * Akumulátor v `loop()` pod tím zůstává: ten drží **kadenci**, tohle drží
   * **plánování**.
   */
  schedule() {
    if (!this.running) return;
    var self = this;
    this.timer = setTimeout(function () {
      self.loop();
      self.schedule();
    }, GameWorker.TICK_MS);
  } // schedule

  stop() {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  } // stop

  /**
   * Keeps the game on its own clock even when the timer of the host is not
   * exact: it catches up whole frames, it never runs a partial one.
   */
  loop() {
    if (this.paused || !this.game) return;
    var now = Date.now();
    if (!this.lastTime) this.lastTime = now;
    this.accumulator += now - this.lastTime;
    this.lastTime = now;
    var frames = 0;
    while (this.accumulator >= GameWorker.TICK_MS && frames < 4) {
      this.accumulator -= GameWorker.TICK_MS;
      this.tick();
      frames++;
    }
  } // loop

} // GameWorker

// In the worker the program wires itself up; under Node (the tools) and on
// the main thread (should anyone import this) it stays a class.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof self.document === 'undefined') {
  var worker = new GameWorker(function (message) { self.postMessage(message); });
  self.onmessage = function (event) { worker.handleMessage(event.data); };
}

export default GameWorker;
