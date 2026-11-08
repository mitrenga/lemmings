const { VGAVideoRAM } = await import('../svision/js/platform/canvas2D/vga/vgaVideoRAM.js?ver='+window.srcVersion);
const { LevelBuilder } = await import('./levelBuilder.js?ver='+window.srcVersion);
const { Lemming } = await import('./lemming.js?ver='+window.srcVersion);
const { Sounds } = await import('./sounds.js?ver='+window.srcVersion);
// begin code

/**
 * The run of one level: the world the lemmings walk in, the object map that
 * says what is under their feet, the hatch that lets them out and the loop
 * that moves them one frame at a time.
 *
 * ## Milestone L3
 *
 * What is here is everything a lemming does on its own: it drops out of the
 * hatch, falls, walks, climbs a step of up to six pixels, turns at a wall,
 * splats if it fell further than sixty pixels, drowns, burns in a trap and
 * leaves through the exit. The skills - and with them the cutting of the
 * terrain - are L4, and the panel is L5; the hooks for both are the empty
 * methods at the end of this class.
 *
 * ## The clock
 *
 * The game runs at a **fixed 17 frames per second** and the clock of the level
 * counts one second every seventeen frames. Nothing here reads the wall clock:
 * a run is a function of the seed, the level and the input, so it repeats
 * (R-009). Frame 15 is where the original plays "let's go", the hatch opens at
 * frame 35.
 */
export class LemmingsGame {

  /** Frames of the game in a second - the whole simulation is in these. */
  static get FRAMES_PER_SECOND() { return 17; }
  /** The frame the hatch opens on. */
  static get ENTRANCE_FRAME() { return 35; }
  /** The countdown to the first lemming, before the release rate takes over. */
  static get FIRST_COUNTDOWN() { return 20; }
  /** Frames from "oh no" to the bang. */
  static get EXPLOSION_TIMER() { return 79; }
  /** A builder starts with twelve bricks. */
  static get BRICKS() { return 12; }
  /** Bricks are drawn in the colour the game keeps for them and the mini map. */
  static get BRICK_COLOUR() { return 7; }

  /**
   * The umbrella. The original fakes sixteen frames of floating out of eight
   * pictures: every step says how far the lemming sinks and which picture to
   * show, and after the sixteenth step it goes back to the ninth.
   */
  static get FLOAT_TABLE() {
    return [
      {dy: 3, frame: 1}, {dy: 3, frame: 2}, {dy: 3, frame: 3}, {dy: 3, frame: 5},
      {dy: -1, frame: 5}, {dy: 0, frame: 5}, {dy: 1, frame: 5}, {dy: 1, frame: 5},
      {dy: 2, frame: 5}, {dy: 2, frame: 6}, {dy: 2, frame: 7}, {dy: 2, frame: 7},
      {dy: 2, frame: 6}, {dy: 2, frame: 5}, {dy: 2, frame: 4}, {dy: 2, frame: 4}
    ];
  }

  /** What the object map holds. Below 128 it is the index of a trap. */
  static get MAP() {
    return {
      NONE: 128, EXIT: 129, FORCE_LEFT: 130, FORCE_RIGHT: 131,
      WATER: 133, FIRE: 134, ONE_WAY_LEFT: 135, ONE_WAY_RIGHT: 136,
      STEEL: 137, BLOCKER: 138
    };
  }

  /**
   * @param {Object} level - a level record out of `data/levels/`.
   * @param {GraphicsSet} graphics - its graphics set.
   * @param {LemmingSprites} sprites - the animations out of `data/main/`.
   * @param {Object} [options] - `{special, entranceOrder}`.
   */
  constructor(level, graphics, sprites, options) {
    this.id = 'LemmingsGame';
    var settings = options || {};
    this.level = level;
    this.graphics = graphics;
    this.sprites = sprites;

    /**
     * The world and the terrain mask. **Terrain only** - the objects are not
     * baked into it, they are drawn over it every frame, which is how the
     * original does it as well (its level preview is the one picture that has
     * them baked in). Baking them left the still frame of an object showing
     * through the moving one: the hatch looked open from the start and its
     * bottom half stayed brown instead of showing the sky through it
     * (reported by the operator 2026-09-14).
     */
    this.builder = new LevelBuilder(level, graphics, settings.special || null).build(false);
    this.world = this.builder.videoRAM;
    this.terrain = this.builder.mask;

    /** the picture including the lemmings, redrawn every frame */
    this.screen = VGAVideoRAM.buffer(LevelBuilder.WIDTH, LevelBuilder.HEIGHT);

    this.objectMap = this.buildObjectMap();
    /**
     * The animation state of every object of the level. It starts at the
     * object's **start frame** from `ground<n>o.dat`, not at zero: for the
     * hatch that is frame 1, the closed one, while frame 0 is the hatch
     * standing open - which is why the original goes back to frame 0 when the
     * opening animation is over.
     */
    var sets = this.graphics;
    this.objectStates = this.level.objects.map(function (object) {
      var meta = sets.objects[object.id];
      return {object: object, triggered: false, frame: meta ? meta.startFrame : 0};
    });
    this.entranceAnimationDone = false;
    this.entrances = this.level.objects.filter(function (object) { return object.id === 1; });
    this.entranceOrder = settings.entranceOrder || LemmingsGame.orderOf(this.entrances.length);

    this.lemmings = [];
    this.frame = 0;
    this.clockFrame = 0;
    this.secondsLeft = this.level.timeLimit*60;
    this.releaseRate = this.level.releaseRate;
    /** how many of each skill are left, as the level record gives them */
    this.skills = {};
    for (var name in this.level.skills) this.skills[name] = this.level.skills[name];
    /** set when the player fired the nuke */
    this.nuked = false;
    this.nukeIndex = 0;
    this.nextLemmingCountdown = LemmingsGame.FIRST_COUNTDOWN;
    this.entrancesOpened = false;
    this.released = 0;
    this.out = 0;
    this.saved = 0;
    /** what happened this frame, for the trace tools */
    this.events = [];
    /** the sounds asked for this frame, by their number in the original */
    this.sounds = [];
  } // constructor

  /**
   * Which hatch the next lemming comes out of, by the count of those already
   * released modulo four.
   * ★ Two orders exist for two hatches - ABAB and ABBA - and which one the
   * DOS game uses is not settled here; the golden record of L3 decides
   * (see MILNIKY.md). This is ABAB.
   */
  static orderOf(count) {
    if (count === 2) return [0, 1, 0, 1];
    if (count === 3) return [0, 1, 2, 1];
    if (count >= 4) return [0, 1, 2, 3];
    return [0, 0, 0, 0];
  } // orderOf

  // ------------------------------------------------------------- the world

  /**
   * The map of what is under a lemming, at the resolution of four pixels the
   * original keeps it at: steel first, then every object's trigger area over
   * it. A trap is written as its own index so the game knows which one to set
   * off; everything else is a code of its own.
   */
  buildObjectMap() {
    var map = {
      width: Math.ceil((1647 + 16)/4),
      height: Math.ceil((175 + 16)/4),
      add: 4,
      bytes: null
    };
    map.bytes = new Uint8Array(map.width*map.height).fill(LemmingsGame.MAP.NONE);
    this.objectMap = map;

    for (var s = 0; s < this.level.steel.length; s++) {
      var steel = this.level.steel[s];
      for (var y = steel.y; y < steel.y + steel.height; y++) {
        for (var x = steel.x; x < steel.x + steel.width; x++) this.writeMap(x, y, LemmingsGame.MAP.STEEL);
      }
    }

    var effects = {
      exit: LemmingsGame.MAP.EXIT, drown: LemmingsGame.MAP.WATER,
      disintegrate: LemmingsGame.MAP.FIRE,
      oneWayLeft: LemmingsGame.MAP.ONE_WAY_LEFT, oneWayRight: LemmingsGame.MAP.ONE_WAY_RIGHT,
      steel: LemmingsGame.MAP.STEEL, none: LemmingsGame.MAP.NONE
    };
    for (var i = 0; i < this.level.objects.length; i++) {
      var object = this.level.objects[i];
      var meta = this.graphics.objects[object.id];
      if (!meta || !meta.trigger) continue;
      var value = meta.trigger.effect === 'trap' ? i : effects[meta.trigger.effect];
      if (value === undefined) continue;
      // The corner is rounded down to four pixels before the trigger offset
      // is added - the map has no finer resolution than that.
      var left = (object.x & ~3) + meta.trigger.left;
      var top = (object.y & ~3) + meta.trigger.top;
      for (var ty = top; ty < top + meta.trigger.height; ty++) {
        for (var tx = left; tx < left + meta.trigger.width; tx++) this.writeMap(tx, ty, value);
      }
    }
    return map;
  } // buildObjectMap

  writeMap(x, y, value) {
    var map = this.objectMap;
    var mx = ((x & ~3)/4) + map.add;
    var my = ((y & ~3)/4) + map.add;
    if (mx < 0 || mx >= map.width || my < 0 || my >= map.height) return;
    map.bytes[my*map.width + mx] = value;
  } // writeMap

  readMap(x, y) {
    var map = this.objectMap;
    var mx = ((x & ~3)/4) + map.add;
    var my = ((y & ~3)/4) + map.add;
    if (mx < 0 || mx >= map.width || my < 0 || my >= map.height) return LemmingsGame.MAP.NONE;
    return map.bytes[my*map.width + mx];
  } // readMap

  /** Is there solid terrain at this pixel? Outside the level there is not. */
  hasPixelAt(x, y) {
    if (x < 0 || x >= LevelBuilder.WIDTH || y < 0 || y >= LevelBuilder.HEIGHT) return false;
    return this.terrain[y*LevelBuilder.WIDTH + x] !== 0;
  } // hasPixelAt

  /**
   * The same, but a lemming whose head is above the level looks for terrain
   * at the clipping line instead - that is how the original keeps a climber
   * from walking off the top of the world.
   */
  hasPixelAtClipped(x, y, minY) {
    return y >= minY ? this.hasPixelAt(x, y) : this.hasPixelAt(x, minY);
  } // hasPixelAtClipped

  // ------------------------------------------------------------ the frame

  /**
   * One frame of the game: the clock, the hatch, then every lemming in the
   * order it was born, and after each one the objects it is standing on.
   * @returns {LemmingsGame} this
   */
  tick() {
    this.events = [];
    this.sounds = [];
    this.frame++;

    this.clockFrame++;
    if (this.clockFrame >= LemmingsGame.FRAMES_PER_SECOND) {
      this.clockFrame = 0;
      if (this.secondsLeft > 0) this.secondsLeft--;
    }
    // The two sounds the start of a level makes by itself.
    if (this.frame === 15) this.playSound(Sounds.ID.letsGo);
    if (this.frame === 34) this.playSound(Sounds.ID.entrance);
    if (this.frame === LemmingsGame.ENTRANCE_FRAME) {
      this.entrancesOpened = true;
      // The hatches are set off here, and the animation starts at its second
      // frame - the first one is the closed hatch the world already shows.
      for (var e = 0; e < this.objectStates.length; e++) {
        if (this.objectStates[e].object.id === 1) {
          this.objectStates[e].triggered = true;
          this.objectStates[e].frame = 1;
        }
      }
      this.events.push({ event: 'entrance' });
    }

    this.spawn();
    for (var i = 0; i < this.lemmings.length; i++) {
      var lemming = this.lemmings[i];
      if (lemming.removed) continue;
      // The countdown of a bomber runs before the lemming does anything, and
      // the frame it reaches zero the lemming only starts its "oh no".
      if (lemming.explosionTimer !== 0 && this.updateExplosionTimer(lemming)) continue;
      if (this.handle(lemming)) this.checkObjects(lemming);
    }
    this.updateNuking();
    this.updateObjects();
    return this;
  } // tick

  /**
   * How many frames pass between two lemmings at the current release rate.
   * ★ `(99 - rate) / 2 + 4`, integer division - so 99 and 98 come out the
   * same. The formula is ccexplore's measurement of the DOS game.
   */
  /**
   * Moves the animations of the objects on by one frame, the way the original
   * does it (`UpdateInteractiveObjects`):
   *
   * - a **hatch** runs its animation once, from frame 35 on, and then stops;
   * - a **continuous** object - water, a flag, a flame - loops for ever;
   * - a **triggered** one - a trap - only runs while it is set off, and stops
   *   itself when it gets to the end.
   *
   * Nothing is drawn here; that is `draw()`.
   */
  updateObjects() {
    for (var i = 0; i < this.objectStates.length; i++) {
      var state = this.objectStates[i];
      var meta = this.graphics.objects[state.object.id];
      if (!meta || meta.frames.length < 2) continue;

      if (state.object.id === 1) {
        // The hatch. It sits on its start frame - the closed one - until
        // frame 35, runs its animation once, and ends on **frame 0**, which
        // is the hatch standing open. That last step reads like a mistake
        // until one looks at the pictures: frame 0 is the open hatch, frame 1
        // the closed one, and the animation in between is it swinging open.
        if (this.entranceAnimationDone || this.frame < LemmingsGame.ENTRANCE_FRAME) continue;
        if (!state.triggered) continue;
        state.frame++;
        if (state.frame >= meta.frames.length) {
          state.frame = 0;
          state.triggered = false;
          this.entranceAnimationDone = true;
        }
        continue;
      }

      if (state.triggered || !meta.triggeredAnimation) state.frame++;
      if (state.frame >= meta.frames.length) {
        state.frame = 0;
        state.triggered = false;
      }
    }
  } // updateObjects

  releaseDelay() {
    var value = 99 - this.releaseRate;
    if (value < 0) value += 256;
    return Math.floor(value/2) + 4;
  } // releaseDelay

  /**
   * Asks for a sound. The game does not know how long it plays or whether
   * anything is listening.
   * @param {number} id - a number out of {@link Sounds}.
   */
  playSound(id) {
    if (id) this.sounds.push(id);
  } // playSound

  /** Lets the next lemming out of the hatch when its turn has come. */
  spawn() {
    if (!this.entrancesOpened) return;
    this.nextLemmingCountdown--;
    if (this.nextLemmingCountdown > 0) return;
    this.nextLemmingCountdown = this.releaseDelay();
    if (this.released >= this.level.lemmings || !this.entrances.length) return;

    var entrance = this.entrances[this.entranceOrder[this.released % 4]] || this.entrances[0];
    // The hatch drops them from its middle, fourteen pixels down.
    var lemming = new Lemming(entrance.x + 24, entrance.y + 14, 1);
    lemming.born = this.frame;
    this.transition(lemming, 'falling');
    this.lemmings.push(lemming);
    this.released++;
    this.out++;
    this.events.push({ event: 'spawn', lemming: this.lemmings.length - 1 });
  } // spawn

  /**
   * Puts a lemming into an action: always a fresh animation, and the frame
   * counter starts again.
   * @param {Lemming} lemming
   * @param {string} action
   * @param {boolean} [turn] - turn it around while doing so.
   */
  transition(lemming, action, turn) {
    if (turn) lemming.xDelta = -lemming.xDelta;
    var animation = this.sprites.animation(action, lemming.xDelta);
    if (!animation) throw new Error('unknown action '+action);
    lemming.maxFrame = animation.frames.length - 1;
    lemming.loops = animation.loops;
    if (lemming.action === action && !turn) return;
    if (lemming.action === action) return;

    lemming.action = action;
    lemming.frame = 0;
    lemming.endOfAnimation = false;
    lemming.fallen = 0;
    lemming.bricksLeft = 0;

    // what entering a state does, as the original does it
    switch (action) {
      case 'splatting':
        lemming.explosionTimer = 0;
        lemming.xDelta = 0;
        this.playSound(Sounds.ID.splat);
        break;
      case 'blocking':
        lemming.isBlocking = true;
        this.saveMap(lemming);
        this.setBlockerField(lemming);
        break;
      case 'digging':
        lemming.isNewDigger = true;
        break;
      case 'ohNoing':
        if (!this.nuked) this.playSound(Sounds.ID.ohNo);
        break;
      case 'exploding':
        this.playSound(Sounds.ID.explosion);
        break;
      case 'exiting':
        this.playSound(Sounds.ID.exit);
        break;
      case 'drowning':
        this.playSound(Sounds.ID.drown);
        break;
      case 'building':
        lemming.bricksLeft = LemmingsGame.BRICKS;
        break;
      case 'floating':
        lemming.floatIndex = 0;
        break;
      case 'mining':
        lemming.y++;
        break;
      default:
        break;
    }
  } // transition

  turnAround(lemming) {
    lemming.xDelta = -lemming.xDelta;
    this.transition(lemming, lemming.action);
  } // turnAround

  /**
   * Advances the animation and then does the work of the action.
   * @returns {boolean} whether the objects under the lemming get a turn.
   */
  handle(lemming) {
    // The frame moves on by itself for every action but two: a digger counts
    // its own frames (it digs on 0 and 8 and the first frame does two rows at
    // once) and a floater takes its frame out of the table of the umbrella.
    if (lemming.action === 'digging' || lemming.action === 'floating') {
      return this.handleAction(lemming);
    }
    if (lemming.frame < lemming.maxFrame) {
      lemming.endOfAnimation = false;
      lemming.frame++;
    } else {
      lemming.endOfAnimation = true;
      if (lemming.loops) lemming.frame = 0;
    }
    return this.handleAction(lemming);
  } // handle

  /**
   * The work of the action itself.
   * @returns {boolean} whether the objects under the lemming get a turn.
   */
  handleAction(lemming) {
    switch (lemming.action) {
      case 'walking': return this.handleWalking(lemming);
      case 'jumping': return this.handleJumping(lemming);
      case 'falling': return this.handleFalling(lemming);
      case 'floating': return this.handleFloating(lemming);
      case 'splatting': return this.handleEnding(lemming, 'splat');
      case 'drowning': return this.handleEnding(lemming, 'drowned');
      case 'vaporizing': return this.handleEnding(lemming, 'burned');
      case 'exiting': return this.handleExiting(lemming);
      case 'climbing': return this.handleClimbing(lemming);
      case 'hoisting': return this.handleHoisting(lemming);
      case 'digging': return this.handleDigging(lemming);
      case 'building': return this.handleBuilding(lemming);
      case 'bashing': return this.handleBashing(lemming);
      case 'mining': return this.handleMining(lemming);
      case 'blocking': return this.handleBlocking(lemming);
      case 'shrugging': return this.handleShrugging(lemming);
      case 'ohNoing': return this.handleOhNoing(lemming);
      case 'exploding': return this.handleExploding(lemming);
      default: return false;
    }
  } // handle

  handleWalking(lemming) {
    lemming.x += lemming.xDelta;
    if (lemming.x < Lemming.MIN_X || lemming.x > Lemming.MAX_X) {
      this.turnAround(lemming);
      return true;
    }

    if (this.hasPixelAt(lemming.x, lemming.y)) {
      // Something ahead: walk up to six pixels up, above that it is a wall.
      var dy = 0;
      var newY = lemming.y;
      while (dy <= 6 && this.hasPixelAtClipped(lemming.x, newY-1, -dy-1)) {
        dy++;
        newY--;
      }
      if (dy > 6) {
        if (lemming.isClimber) this.transition(lemming, 'climbing');
        else this.turnAround(lemming);
        return true;
      }
      // Three pixels or more and it has to hop.
      if (dy >= 3) {
        this.transition(lemming, 'jumping');
        newY = lemming.y - 2;
      }
      lemming.y = newY;
      this.checkTopBoundary(lemming);
      return true;
    }

    // Nothing under the feet: step down up to three pixels, below that it falls.
    var down = 1;
    while (down <= 3) {
      lemming.y++;
      if (this.hasPixelAtClipped(lemming.x, lemming.y, down)) break;
      down++;
    }
    if (down > 3) {
      lemming.y++;
      this.transition(lemming, 'falling');
    }
    if (lemming.y > Lemming.MAX_Y) {
      this.remove(lemming, 'fell');
      return false;
    }
    return true;
  } // handleWalking

  handleJumping(lemming) {
    var dy = 0;
    while (dy < 2 && this.hasPixelAtClipped(lemming.x, lemming.y-1, -dy-1)) {
      dy++;
      lemming.y--;
    }
    if (dy < 2) this.transition(lemming, 'walking');
    this.checkTopBoundary(lemming);
    return true;
  } // handleJumping

  handleFalling(lemming) {
    if (lemming.fallen > Lemming.FLOAT_AFTER && lemming.isFloater) {
      this.transition(lemming, 'floating');
      return true;
    }
    var dy = 0;
    while (dy < 3 && !this.hasPixelAtClipped(lemming.x, lemming.y, dy)) {
      dy++;
      lemming.y++;
      if (lemming.y > Lemming.MAX_Y) {
        this.remove(lemming, 'fell');
        return false;
      }
    }
    if (dy === 3) {
      lemming.fallen += 3;
      return true;
    }
    // It landed. Sixty pixels is the height the landing kills at.
    if (lemming.fallen > Lemming.MAX_FALL_DISTANCE) {
      this.transition(lemming, 'splatting');
      this.events.push({ event: 'splat', lemming: this.lemmings.indexOf(lemming) });
      // ★ The original returns "check the objects" here as well, and that is
      // the bug that lets a lemming drop straight into an exit and be saved
      // although it should have splattered. It is reproduced, not fixed.
      return true;
    }
    this.transition(lemming, 'walking');
    return true;
  } // handleFalling

  /**
   * The umbrella, step by step out of the table of the original: the first
   * four steps are the parachute opening (and the lemming still drops three
   * pixels a frame), then it floats down two at a time.
   */
  handleFloating(lemming) {
    var step = LemmingsGame.FLOAT_TABLE[lemming.floatIndex];
    lemming.frame = step.frame;
    var dy = step.dy;
    lemming.floatIndex++;
    if (lemming.floatIndex >= 16) lemming.floatIndex = 8;

    if (dy <= 0) {
      lemming.y += dy;
    } else {
      var minY = 0;
      while (dy > 0) {
        if (this.hasPixelAtClipped(lemming.x, lemming.y, minY)) {
          this.transition(lemming, 'walking');
          return true;
        }
        lemming.y++;
        dy--;
        minY++;
      }
    }
    if (lemming.y > Lemming.MAX_Y) {
      this.remove(lemming, 'fell');
      return false;
    }
    return true;
  } // handleFloating

  handleEnding(lemming, how) {
    if (lemming.endOfAnimation) this.remove(lemming, how);
    return false;
  } // handleEnding

  handleExiting(lemming) {
    if (lemming.endOfAnimation) {
      this.remove(lemming, 'saved');
      this.saved++;
    }
    return false;
  } // handleExiting

  // ------------------------------------------------------- the eight skills

  /**
   * A climber goes up the wall it walked into. The first four frames it looks
   * whether the top is near - then it pulls itself over - and after that it
   * moves one pixel up a frame, until an overhang sends it falling backwards.
   */
  handleClimbing(lemming) {
    if (lemming.frame <= 3) {
      if (!this.hasPixelAtClipped(lemming.x, lemming.y - 7 - lemming.frame, 0)) {
        lemming.y = lemming.y - lemming.frame + 2;
        this.transition(lemming, 'hoisting');
        this.checkTopBoundary(lemming);
      }
      return true;
    }
    lemming.y--;
    var animation = this.sprites.animation(lemming.action, lemming.xDelta);
    if (lemming.y - animation.footY < Lemming.HEAD_MIN_Y ||
        this.hasPixelAtClipped(lemming.x - lemming.xDelta, lemming.y - 8, -8)) {
      this.transition(lemming, 'falling', true);
      lemming.x += lemming.xDelta*2;
    }
    return true;
  } // handleClimbing

  /** Pulling itself over the edge after a climb. */
  handleHoisting(lemming) {
    if (lemming.frame <= 4) {
      lemming.y -= 2;
      this.checkTopBoundary(lemming);
      return true;
    }
    if (lemming.endOfAnimation) {
      this.transition(lemming, 'walking');
      this.checkTopBoundary(lemming);
      return true;
    }
    return false;
  } // handleHoisting

  /**
   * A digger takes a row of nine pixels out from under itself on frames 0 and
   * 8; the very first frame takes two rows at once. When there is nothing
   * left to dig it falls, and steel stops it.
   */
  handleDigging(lemming) {
    if (lemming.isNewDigger) {
      this.digOneRow(lemming, lemming.y - 2);
      this.digOneRow(lemming, lemming.y - 1);
      lemming.isNewDigger = false;
    } else {
      lemming.frame++;
      if (lemming.frame >= 16) lemming.frame -= 16;
    }

    if (lemming.frame === 0 || lemming.frame === 8) {
      var y = lemming.y;
      lemming.y++;
      if (lemming.y > Lemming.MAX_Y) {
        this.remove(lemming, 'fell');
        return false;
      }
      if (!this.digOneRow(lemming, y)) {
        this.transition(lemming, 'falling');
      } else if (this.readMap(lemming.x, lemming.y) === LemmingsGame.MAP.STEEL) {
        this.events.push({event: 'steel', lemming: this.lemmings.indexOf(lemming)});
        this.playSound(Sounds.ID.steel);
        this.transition(lemming, 'walking');
      }
      return true;
    }
    return false;
  } // handleDigging

  /**
   * A builder lays a brick on frame 9 and steps up and forward on frame 0.
   * It stops when it runs out of bricks (and shrugs), when its head hits
   * something, or when the wall ahead is too high.
   */
  handleBuilding(lemming) {
    // three bricks left: the clicking that tells the player to look
    if (lemming.frame === 10 && lemming.bricksLeft <= 3) this.playSound(Sounds.ID.builderWarning);
    if (lemming.frame === 9 || (lemming.frame === 10 && lemming.bricksLeft === 9)) {
      this.layBrick(lemming);
      return false;
    }
    if (lemming.frame !== 0) return true;

    lemming.x += lemming.xDelta;
    lemming.y--;
    if (lemming.x <= Lemming.MIN_X || lemming.x > Lemming.MAX_X ||
        this.hasPixelAtClipped(lemming.x, lemming.y - 1, -1)) {
      this.transition(lemming, 'walking', true);
      this.checkTopBoundary(lemming);
      return true;
    }

    lemming.x += lemming.xDelta;
    if (this.hasPixelAtClipped(lemming.x, lemming.y - 1, -1)) {
      this.transition(lemming, 'walking', true);
      this.checkTopBoundary(lemming);
      return true;
    }

    lemming.bricksLeft--;
    if (lemming.bricksLeft === 0) {
      this.transition(lemming, 'shrugging');
      this.checkTopBoundary(lemming);
      return true;
    }

    if (this.hasPixelAtClipped(lemming.x + lemming.xDelta*2, lemming.y - 9, -9) ||
        lemming.x <= Lemming.MIN_X || lemming.x > Lemming.MAX_X) {
      this.transition(lemming, 'walking', true);
      this.checkTopBoundary(lemming);
      return true;
    }

    // ★ A builder that gets too high becomes a walker and does **not** turn
    // around, although it looks as if it should: the check for the top of the
    // level fails because the animation it changed to has another foot point.
    // The original does it this way, so it stays.
    var animation = this.sprites.animation(lemming.action, lemming.xDelta);
    if (lemming.y - animation.footY < Lemming.HEAD_MIN_Y) {
      this.transition(lemming, 'walking');
      this.checkTopBoundary(lemming);
    }
    return true;
  } // handleBuilding

  /**
   * A basher cuts a tunnel straight ahead: frames 2..5 of each of its two
   * strokes take a mask out of the terrain, frames 11..15 move it forward.
   * Steel and a one-way wall pointing the other way turn it around.
   */
  handleBashing(lemming) {
    var index = lemming.frame;
    if (index >= 16) index -= 16;

    if (index >= 11 && index <= 15) {
      lemming.x += lemming.xDelta;
      if (lemming.x < Lemming.MIN_X || lemming.x > Lemming.MAX_X) {
        this.transition(lemming, 'walking', true);
        return true;
      }
      var dy = 0;
      while (dy < 3 && !this.hasPixelAtClipped(lemming.x, lemming.y, dy)) {
        dy++;
        lemming.y++;
      }
      if (dy === 3) {
        this.transition(lemming, 'falling');
        return true;
      }
      var front = this.readMap(lemming.x + lemming.xDelta*8, lemming.y - 8);
      if (front === LemmingsGame.MAP.STEEL) {
        this.events.push({event: 'steel', lemming: this.lemmings.indexOf(lemming)});
        this.playSound(Sounds.ID.steel);
      }
      if (front === LemmingsGame.MAP.STEEL ||
          (front === LemmingsGame.MAP.ONE_WAY_LEFT && lemming.xDelta !== -1) ||
          (front === LemmingsGame.MAP.ONE_WAY_RIGHT && lemming.xDelta !== 1)) {
        this.transition(lemming, 'walking', true);
      }
      return true;
    }

    if (index >= 2 && index <= 5) {
      this.applyBashMask(lemming, index - 2);
      // On the last mask of the first stroke it looks ahead: four empty
      // pixels mean it has broken through and can walk on.
      if (lemming.frame === 5) {
        var n = 0;
        var x = lemming.x + lemming.xDelta*8;
        var y = lemming.y - 6;
        while (n < 4 && !this.hasPixelAt(x, y)) {
          n++;
          x += lemming.xDelta;
        }
        if (n === 4) this.transition(lemming, 'walking');
      }
    }
    return false;
  } // handleBashing

  /**
   * A miner digs a slope down and forward: two masks on frames 1 and 2, then
   * two steps forward and one down on frames 3 and 15.
   */
  handleMining(lemming) {
    var animation = this.sprites.animation(lemming.action, lemming.xDelta);
    if (lemming.frame === 1) {
      this.applyMineMask(lemming, 0, lemming.x - animation.footX, lemming.y - animation.footY);
      return false;
    }
    if (lemming.frame === 2) {
      this.applyMineMask(lemming, 1, lemming.x + lemming.xDelta - animation.footX, lemming.y + 1 - animation.footY);
      return false;
    }
    if (lemming.frame === 3 || lemming.frame === 15) {
      lemming.x += lemming.xDelta;
      if (lemming.x < Lemming.MIN_X || lemming.x > Lemming.MAX_X) {
        this.transition(lemming, 'walking', true);
        return true;
      }
      lemming.x += lemming.xDelta;
      if (lemming.x < Lemming.MIN_X || lemming.x > Lemming.MAX_X) {
        this.transition(lemming, 'walking', true);
        return true;
      }
      if (lemming.frame === 3) {
        lemming.y++;
        if (lemming.y > Lemming.MAX_Y) {
          this.remove(lemming, 'fell');
          return false;
        }
      }
      if (!this.hasPixelAtClipped(lemming.x, lemming.y, 0)) {
        this.transition(lemming, 'falling');
        return true;
      }
      var below = this.readMap(lemming.x, lemming.y);
      if (below === LemmingsGame.MAP.STEEL) {
        this.events.push({event: 'steel', lemming: this.lemmings.indexOf(lemming)});
        this.playSound(Sounds.ID.steel);
      }
      // ★ A bug of the original, kept: the check for a one-way wall pointing
      // right has no direction in it, so such a wall cannot be mined from
      // either side.
      if (below === LemmingsGame.MAP.STEEL ||
          (below === LemmingsGame.MAP.ONE_WAY_LEFT && lemming.xDelta !== -1) ||
          below === LemmingsGame.MAP.ONE_WAY_RIGHT) {
        this.transition(lemming, 'walking', true);
      }
      return true;
    }
    if (lemming.frame === 0) {
      lemming.y++;
      if (lemming.y > Lemming.MAX_Y) {
        this.remove(lemming, 'fell');
        return false;
      }
      return true;
    }
    return false;
  } // handleMining

  /** A blocker stands until the ground under it is gone. */
  handleBlocking(lemming) {
    if (!this.hasPixelAtClipped(lemming.x, lemming.y, 0)) {
      this.transition(lemming, 'walking');
      lemming.isBlocking = false;
      this.restoreMap(lemming);
    }
    return false;
  } // handleBlocking

  /** The shrug of a builder that has run out of bricks. */
  handleShrugging(lemming) {
    if (lemming.endOfAnimation) {
      this.transition(lemming, 'walking');
      return true;
    }
    return false;
  } // handleShrugging

  /** "Oh no" - the lemming trembles, and falls while it does. */
  handleOhNoing(lemming) {
    if (lemming.endOfAnimation) {
      this.transition(lemming, 'exploding');
      return false;
    }
    var dy = 0;
    while (dy < 3 && !this.hasPixelAtClipped(lemming.x, lemming.y, dy)) {
      dy++;
      lemming.y++;
    }
    if (lemming.y > Lemming.MAX_Y) {
      this.remove(lemming, 'fell');
      return false;
    }
    return true;
  } // handleOhNoing

  /** The bang: a hole in the terrain, unless the lemming stands in steel or water. */
  handleExploding(lemming) {
    if (!lemming.endOfAnimation) return false;
    if (lemming.isBlocking) {
      lemming.isBlocking = false;
      this.restoreMap(lemming);
    }
    var below = this.readMap(lemming.x, lemming.y);
    if (below !== LemmingsGame.MAP.STEEL && below !== LemmingsGame.MAP.WATER) {
      this.applyExplosionMask(lemming);
    }
    this.remove(lemming, 'exploded');
    this.events.push({event: 'explode', lemming: this.lemmings.indexOf(lemming)});
    return false;
  } // handleExploding

  // ------------------------------------------------- cutting into the world

  /** Takes one pixel out of the world - and out of the terrain mask with it. */
  removePixel(x, y) {
    if (x < 0 || x >= LevelBuilder.WIDTH || y < 0 || y >= LevelBuilder.HEIGHT) return;
    var at = y*LevelBuilder.WIDTH + x;
    this.world.bytes[at] = 0;
    this.terrain[at] = 0;
  } // removePixel

  /**
   * One row of nine pixels under a digger.
   * @returns {boolean} whether there was anything to take out.
   */
  digOneRow(lemming, y) {
    var removed = false;
    var row = y < 0 ? 0 : y;
    for (var i = 0; i < 9; i++) {
      var x = lemming.x - 4 + i;
      if (this.hasPixelAt(x, row)) {
        this.removePixel(x, row);
        removed = true;
      }
    }
    return removed;
  } // digOneRow

  /**
   * Six pixels of brick under the builder's feet, in the colour the game
   * keeps for them. A brick only goes where there is nothing yet.
   */
  layBrick(lemming) {
    var x = lemming.xDelta === 1 ? lemming.x : lemming.x - 4;
    var y = lemming.y - 1;
    for (var i = 0; i < 6; i++) {
      if (x + i >= 0 && x + i < LevelBuilder.WIDTH && y >= 0 && y < LevelBuilder.HEIGHT) {
        var at = y*LevelBuilder.WIDTH + x + i;
        if (this.world.bytes[at] === 0) {
          this.world.bytes[at] = LemmingsGame.BRICK_COLOUR;
          this.terrain[at] = 1;
        }
      }
    }
  } // layBrick

  /**
   * Puts one of the masks of `main.dat` into the terrain: every set bit of
   * the mask takes a pixel out.
   * @param {string} name - `bash`, `bashLeft`, `mine`, `mineLeft`, `explosion`.
   * @param {number} index - which frame of the mask.
   * @param {number} left - where its left edge goes.
   * @param {number} top
   */
  applyMask(name, index, left, top) {
    var mask = this.sprites.masks[name];
    if (!mask) return;
    var frame = mask.frames[Math.min(index, mask.frames.length-1)];
    for (var y = 0; y < mask.height; y++) {
      for (var x = 0; x < mask.width; x++) {
        if (frame[y*mask.width + x]) this.removePixel(left + x, top + y);
      }
    }
  } // applyMask

  applyBashMask(lemming, index) {
    var animation = this.sprites.animation(lemming.action, lemming.xDelta);
    this.applyMask(lemming.xDelta < 0 ? 'bashLeft' : 'bash', index,
      lemming.x - animation.footX, lemming.y - animation.footY);
  } // applyBashMask

  applyMineMask(lemming, index, left, top) {
    this.applyMask(lemming.xDelta < 0 ? 'mineLeft' : 'mine', index, left, top);
  } // applyMineMask

  applyExplosionMask(lemming) {
    this.applyMask('explosion', 0, lemming.x - 8, lemming.y - 14);
  } // applyExplosionMask

  // ------------------------------------------------------------- blockers

  /** The nine cells of the object map a blocker holds, before it takes them. */
  saveMap(lemming) {
    lemming.savedMap = [];
    for (var y = -6; y <= 2; y += 4) {
      for (var x = -4; x <= 4; x += 4) lemming.savedMap.push(this.readMap(lemming.x + x, lemming.y + y));
    }
  } // saveMap

  restoreMap(lemming) {
    if (!lemming.savedMap) return;
    var at = 0;
    for (var y = -6; y <= 2; y += 4) {
      for (var x = -4; x <= 4; x += 4) this.writeMap(lemming.x + x, lemming.y + y, lemming.savedMap[at++]);
    }
  } // restoreMap

  /** The field a blocker puts up: turn left on its left, turn right on its right. */
  setBlockerField(lemming) {
    var map = LemmingsGame.MAP;
    for (var y = -6; y <= 2; y += 4) {
      this.writeMap(lemming.x - 4, lemming.y + y, map.FORCE_LEFT);
      this.writeMap(lemming.x, lemming.y + y, map.BLOCKER);
      this.writeMap(lemming.x + 4, lemming.y + y, map.FORCE_RIGHT);
    }
  } // setBlockerField

  /** Whether another blocker's field is already where this one would stand. */
  overlapsBlockerField(lemming) {
    var map = LemmingsGame.MAP;
    for (var y = -6; y <= 2; y += 4) {
      for (var x = -4; x <= 4; x += 4) {
        var value = this.readMap(lemming.x + x, lemming.y + y);
        if (value === map.FORCE_LEFT || value === map.FORCE_RIGHT || value === map.BLOCKER) return true;
      }
    }
    return false;
  } // overlapsBlockerField

  // -------------------------------------------------------- the player's say

  /**
   * The countdown of a bomber.
   * @returns {boolean} whether it reached zero this frame - then the lemming
   *   does nothing else this frame.
   */
  updateExplosionTimer(lemming) {
    lemming.explosionTimer--;
    if (lemming.explosionTimer > 0) return false;
    if (lemming.action === 'vaporizing' || lemming.action === 'drowning' ||
        lemming.action === 'floating' || lemming.action === 'falling') {
      this.transition(lemming, 'exploding');
    } else {
      this.transition(lemming, 'ohNoing');
    }
    return true;
  } // updateExplosionTimer

  /** The nuke: one lemming a frame gets its countdown, in the order they came. */
  updateNuking() {
    if (!this.nuked) return;
    while (this.nukeIndex < this.lemmings.length && this.lemmings[this.nukeIndex].removed) this.nukeIndex++;
    if (this.nukeIndex >= this.lemmings.length) return;
    var lemming = this.lemmings[this.nukeIndex];
    if (lemming.explosionTimer === 0 && lemming.action !== 'splatting' && lemming.action !== 'exploding') {
      lemming.explosionTimer = LemmingsGame.EXPLOSION_TIMER;
    }
    this.nukeIndex++;
  } // updateNuking

  nuke() {
    this.nuked = true;
    this.nukeIndex = 0;
    this.events.push({event: 'nuke'});
  } // nuke

  /**
   * The lemmings under the cursor, the way the original picks them: a lemming
   * is "under the cursor" when the point is inside a 13x13 square at the top
   * left of its picture. Of those, one doing a job wins over one just walking
   * - unless the player holds the right button, which asks for the walker.
   *
   * @param {number} x - in the level, not on the screen.
   * @param {number} y
   * @param {boolean} [walkersOnly] - the right mouse button.
   * @returns {{lemming: ?Lemming, other: ?Lemming, hits: number}}
   */
  hitTest(x, y, walkersOnly) {
    var priority = null;
    var plain = null;
    var hits = 0;
    var jobs = {blocking: 1, building: 1, shrugging: 1, bashing: 1, mining: 1, digging: 1, ohNoing: 1};
    for (var i = 0; i < this.lemmings.length; i++) {
      var lemming = this.lemmings[i];
      if (lemming.removed) continue;
      var animation = this.sprites.animation(lemming.action, lemming.xDelta);
      if (!animation) continue;
      var left = lemming.x - animation.footX;
      var top = lemming.y - animation.footY;
      if (x < left || x > left + 12 || y < top || y > top + 12) continue;
      hits++;
      if (jobs[lemming.action]) priority = lemming;
      else plain = lemming;
    }
    var chosen = (walkersOnly || !priority) ? plain : priority;
    return {lemming: chosen, other: plain, hits: hits};
  } // hitTest

  /**
   * Gives a skill to the lemming under the point, with the conditions of the
   * original: a climber and a floater keep it for good, a bomber gets a
   * countdown, and the four digging skills only take on a lemming that is
   * walking or doing another job - never on one that is falling.
   *
   * @param {string} skill - `climber`, `floater`, `bomber`, `blocker`,
   *   `builder`, `basher`, `miner`, `digger`.
   * @param {number} x - in the level.
   * @param {number} y
   * @param {boolean} [walkersOnly] - the right mouse button.
   * @returns {boolean} whether it was given.
   */
  assignSkill(skill, x, y, walkersOnly) {
    if (!(skill in this.skills) || this.skills[skill] <= 0) return false;
    var hit = this.hitTest(x, y, walkersOnly);
    var one = hit.lemming;
    var two = hit.other;
    if (!one) return false;

    var works = {
      walking: 1, shrugging: 1, building: 1, bashing: 1, mining: 1, digging: 1
    };
    var pick = (without) => {
      var allowed = {};
      for (var name in works) if (name !== without) allowed[name] = 1;
      if (allowed[one.action]) return one;
      if (two && allowed[two.action]) return two;
      return null;
    };
    var map = LemmingsGame.MAP;
    var blocked = (lemming, front, below) => {
      if (front === map.STEEL) return true;
      if (below === map.STEEL) return true;
      if (front === map.ONE_WAY_LEFT && lemming.xDelta !== -1) return true;
      if (front === map.ONE_WAY_RIGHT && lemming.xDelta !== 1) return true;
      return false;
    };
    var taken = null;

    switch (skill) {
      case 'climber':
        if (!one.isClimber && one.action !== 'blocking' && one.action !== 'splatting' && one.action !== 'exploding') {
          one.isClimber = true;
          taken = one;
        }
        break;
      case 'floater':
        if (!one.isFloater && one.action !== 'blocking' && one.action !== 'splatting' && one.action !== 'exploding') {
          one.isFloater = true;
          taken = one;
        }
        break;
      case 'bomber':
        if (one.explosionTimer === 0 && one.action !== 'ohNoing' && one.action !== 'exploding' &&
            one.action !== 'vaporizing' && one.action !== 'splatting') {
          one.explosionTimer = LemmingsGame.EXPLOSION_TIMER;
          taken = one;
        }
        break;
      case 'blocker':
        if (works[one.action] && !this.overlapsBlockerField(one)) {
          this.transition(one, 'blocking');
          taken = one;
        }
        break;
      case 'builder': {
        var animation = this.sprites.animation(one.action, one.xDelta);
        if (one.y - animation.footY < Lemming.HEAD_MIN_Y) break;
        var builder = pick('building');
        if (builder) {
          this.transition(builder, 'building');
          taken = builder;
        }
        break;
      }
      case 'basher': {
        var basher = pick('bashing');
        if (!basher) break;
        var frontB = this.readMap(basher.x + 8*basher.xDelta, basher.y - 8);
        if (frontB === map.STEEL ||
            (frontB === map.ONE_WAY_LEFT && basher.xDelta !== -1) ||
            (frontB === map.ONE_WAY_RIGHT && basher.xDelta !== 1)) break;
        this.transition(basher, 'bashing');
        taken = basher;
        break;
      }
      case 'miner': {
        var miner = pick('mining');
        if (!miner) break;
        var frontM = this.readMap(miner.x + 8*miner.xDelta, miner.y - 8);
        var belowM = this.readMap(miner.x, miner.y);
        if (blocked(miner, frontM, belowM)) break;
        this.transition(miner, 'mining');
        taken = miner;
        break;
      }
      case 'digger': {
        if (this.readMap(one.x, one.y) === map.STEEL) break;
        var digger = pick('digging');
        if (digger) {
          this.transition(digger, 'digging');
          taken = digger;
        }
        break;
      }
      default:
        break;
    }

    if (!taken) return false;
    this.skills[skill]--;
    this.playSound(Sounds.ID.assignSkill);
    this.events.push({event: 'assign', skill: skill, lemming: this.lemmings.indexOf(taken)});
    return true;
  } // assignSkill

  /** A lemming whose head would leave the level turns around instead. */
  checkTopBoundary(lemming) {
    var animation = this.sprites.animation(lemming.action, lemming.xDelta);
    var dy = -animation.footY;
    if (lemming.y + dy < Lemming.HEAD_MIN_Y) {
      lemming.y = Lemming.HEAD_MIN_Y - 2 - dy;
      this.turnAround(lemming);
      if (lemming.action === 'jumping') this.transition(lemming, 'walking');
      return true;
    }
    return false;
  } // checkTopBoundary

  /** What the lemming is standing in: an exit, water, fire, a trap, a wall. */
  checkObjects(lemming) {
    var below = this.readMap(lemming.x, lemming.y);
    var map = LemmingsGame.MAP;
    if (below === map.NONE) return;

    if (below < 128) {
      // A trap. It goes off once and takes the lemming with it - what is seen
      // dying afterwards is the trap's own animation, not the lemming.
      var state = this.objectStates[below];
      if (state && !state.triggered) {
        state.triggered = true;
        state.frame = 0;
        var meta = this.graphics.objects[state.object.id];
        if (meta) this.playSound(meta.sound);
        this.remove(lemming, 'trapped');
        this.events.push({ event: 'trap', object: below, lemming: this.lemmings.indexOf(lemming) });
      }
      return;
    }

    switch (below) {
      case map.EXIT:
        if (lemming.action !== 'falling') {
          this.transition(lemming, 'exiting');
          this.events.push({ event: 'exit', lemming: this.lemmings.indexOf(lemming) });
        }
        break;
      case map.FORCE_LEFT:
        if (lemming.xDelta > 0) this.turnAround(lemming);
        break;
      case map.FORCE_RIGHT:
        if (lemming.xDelta < 0) this.turnAround(lemming);
        break;
      case map.WATER:
        this.transition(lemming, 'drowning');
        this.events.push({ event: 'drown', lemming: this.lemmings.indexOf(lemming) });
        break;
      case map.FIRE:
        this.transition(lemming, 'vaporizing');
        this.events.push({ event: 'burn', lemming: this.lemmings.indexOf(lemming) });
        break;
      default:
        break;
    }
  } // checkObjects

  remove(lemming, how) {
    lemming.removed = true;
    lemming.gone = how;
    this.out--;
  } // remove

  // ------------------------------------------------------------- drawing

  /**
   * Paints the world and the lemmings into `screen`.
   * @returns {VGAVideoRAM} the whole level, 1584x160.
   */
  draw() {
    this.screen.bytes.set(this.world.bytes);
    this.drawObjects();
    for (var i = 0; i < this.lemmings.length; i++) {
      var lemming = this.lemmings[i];
      if (lemming.removed) continue;
      this.drawLemming(lemming);
    }
    return this.screen;
  } // draw

  /**
   * Every object of the level, painted over the terrain at the frame it is on
   * right now. Two passes, as the original draws them: the ones that show
   * only where terrain is, then the rest.
   */
  drawObjects() {
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < this.objectStates.length; i++) {
        var state = this.objectStates[i];
        var meta = this.graphics.objects[state.object.id];
        if (!meta || !meta.frames.length) continue;
        if ((pass === 0) !== Boolean(state.object.onlyOverTerrain)) continue;
        this.drawObjectFrame(state.object, meta, meta.frames[Math.min(state.frame, meta.frames.length-1)]);
      }
    }
  } // drawObjects

  /**
   * One frame of one object, with the two drawing flags of the level record:
   * "only where terrain is" and "only where nothing has been drawn yet".
   */
  drawObjectFrame(object, meta, frame) {
    for (var y = 0; y < meta.height; y++) {
      var targetY = object.y + y;
      if (targetY < 0 || targetY >= this.screen.height) continue;
      for (var x = 0; x < meta.width; x++) {
        var source = object.upsideDown ? (meta.height-1-y)*meta.width + x : y*meta.width + x;
        if (!frame.mask[source]) continue;
        var targetX = object.x + x;
        if (targetX < 0 || targetX >= this.screen.width) continue;
        var at = targetY*this.screen.width + targetX;
        if (object.onlyOverTerrain && !this.terrain[at]) continue;
        if (object.onlyOnBackground && this.screen.bytes[at] !== 0) continue;
        this.screen.bytes[at] = frame.pixels[source];
      }
    }
  } // drawObjectFrame

  drawLemming(lemming) {
    var animation = this.sprites.animation(lemming.action, lemming.xDelta);
    if (!animation) return;
    var frame = animation.frames[Math.min(lemming.frame, animation.frames.length-1)];
    var left = lemming.x - animation.footX;
    var top = lemming.y - animation.footY;
    for (var y = 0; y < animation.height; y++) {
      var targetY = top + y;
      if (targetY < 0 || targetY >= this.screen.height) continue;
      for (var x = 0; x < animation.width; x++) {
        var value = frame[y*animation.width + x];
        if (!value) continue;
        var targetX = left + x;
        if (targetX < 0 || targetX >= this.screen.width) continue;
        this.screen.bytes[targetY*this.screen.width + targetX] = value;
      }
    }
  } // drawLemming

  /** The 320x160 window the player looks through. */
  window(x) {
    var left = Math.max(0, Math.min(LevelBuilder.WIDTH-320, Math.round(x)));
    var window = VGAVideoRAM.buffer(320, 160);
    for (var y = 0; y < 160; y++) {
      var from = y*LevelBuilder.WIDTH + left;
      window.bytes.set(this.screen.bytes.subarray(from, from+320), y*320);
    }
    return window;
  } // window

  /** `true` when there is nothing left to wait for. */
  get finished() {
    return this.released >= this.level.lemmings && this.out === 0;
  }

  // ------------------------------------------------------- hooks for L4/L5

  /** The skills: assigning one, and the actions that cut the terrain. L4. */
  handleSkill() { return false; }

} // LemmingsGame

export default LemmingsGame;
