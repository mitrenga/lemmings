// begin code

/**
 * One lemming: a point under its feet, a direction, an action and the frame
 * of that action's animation. Everything else about it - where it can walk,
 * what it falls on - is in the world, not here.
 *
 * The actions of milestone L3 are the ones a lemming does without the player:
 * walking, the little jump up a step, falling, splatting, drowning, burning
 * and leaving through the exit. The skills come in L4 and get their own
 * actions; the names here are the ones the original uses.
 */
export class Lemming {

  /** How far a lemming may fall before the landing kills it. */
  static get MAX_FALL_DISTANCE() { return 60; }
  /** A faller that has fallen this far opens the umbrella, if it has one. */
  static get FLOAT_AFTER() { return 16; }
  /** The left and right edge of the world, for a lemming's position. */
  static get MIN_X() { return 0; }
  static get MAX_X() { return 1647; }
  /** Below this line a lemming is gone, without a sound. */
  static get MAX_Y() { return 163; }
  /** A lemming's head may not go above this line. */
  static get HEAD_MIN_Y() { return -5; }

  /**
   * @param {number} x - the pixel under the lemming's feet.
   * @param {number} y
   * @param {number} xDelta - +1 walking right, -1 left.
   */
  constructor(x, y, xDelta) {
    this.id = 'Lemming';
    this.x = x;
    this.y = y;
    this.xDelta = xDelta === undefined ? 1 : xDelta;
    /** the action, a name of an animation: `falling`, `walking`, ... */
    this.action = 'falling';
    /** the frame of that animation */
    this.frame = 0;
    this.maxFrame = 0;
    this.loops = true;
    this.endOfAnimation = false;
    /** how many pixels it has fallen without landing */
    this.fallen = 0;
    /** permanent skills, both of them until the end of the level */
    this.isClimber = false;
    this.isFloater = false;
    /** bricks a builder has left of its twelve */
    this.bricksLeft = 0;
    /** frames to the explosion, 0 when there is none coming */
    this.explosionTimer = 0;
    /** a blocker holds three cells of the object map; these are what was there */
    this.isBlocking = false;
    this.savedMap = null;
    /** the first frame of a digger digs two rows at once */
    this.isNewDigger = false;
    /** where in the sixteen step table of the umbrella the lemming is */
    this.floatIndex = 0;
    /** set when the lemming has left the level, one way or another */
    this.removed = false;
    /** the frame of the game it was born in, for the record */
    this.born = 0;
    /** how the lemming left: `saved`, `splat`, `drowned`, `burned`, `fell` */
    this.gone = null;
  } // constructor

  /** `true` while the lemming is on the level and can be drawn. */
  get alive() {
    return !this.removed;
  }

} // Lemming

export default Lemming;
