// begin code

/**
 * The sounds of the game, by the numbers the original uses for them.
 *
 * DOS Lemmings has **no samples at all**: every sound is a little program for
 * the AdLib chip inside `adlib.dat` (`data/sound/adlib.json`). What the game
 * itself deals in is the number of a sound - the same number a graphics set
 * carries for the trap it describes - and this table is that numbering.
 *
 * How long a sound plays is none of the game's business either: it asks for a
 * sound and walks on. That keeps a run a function of the level and the input
 * alone, so the tools can drive it in silence and still get the same frames
 * (R-009), the same way Prince of Persia does it.
 */
export class Sounds {

  /** The number of every sound the game asks for by itself. */
  static get ID() {
    return {
      skillSelect: 1,
      entrance: 2,
      letsGo: 3,
      assignSkill: 4,
      ohNo: 5,
      electrode: 6,
      squisher: 7,
      splat: 8,
      slicer: 9,
      steel: 10,
      unknown11: 11,
      explosion: 12,
      fire: 13,
      tenTon: 14,
      bearTrap: 15,
      exit: 16,
      drown: 17,
      builderWarning: 18
    };
  }

  /** The name of a sound by its number, for the records of the tools. */
  static nameOf(id) {
    var names = Sounds.ID;
    for (var name in names) if (names[name] === id) return name;
    return 'sound'+id;
  } // nameOf

} // Sounds

export default Sounds;
