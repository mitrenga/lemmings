const { AbstractAudioManager } = await import('./svision/js/audio/abstractAudioManager.js?ver='+window.srcVersion);
const { LemSoundHandler } = await import('./lemSoundHandler.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
// begin code

/**
 * The audio of the remake: two buses, both of them the same AdLib card.
 *
 * The game has no samples at all - every sound and every one of the twenty one
 * tracks is a program of the driver in `adlib.dat` for a YM3812. The effects
 * and the music are split into two buses only so the player can turn them
 * down separately, the way the original's F3 does; each bus runs its own chip,
 * which matches the driver, since it plays effects on a channel of its own.
 */
var EFFECT_BUSES = ['sounds'];

export class AudioManager extends AbstractAudioManager {

  constructor(app) {
    super(app);
    this.id = 'AudioManager';
    this.volume = {};
    this.volume.sounds = Math.min(10, Math.max(0, Math.round(Number(Tool.readCookie('audioBusSoundsLevel', 7)))));
    this.volume.music = Math.min(10, Math.max(0, Math.round(Number(Tool.readCookie('audioBusMusicLevel', 7)))));
    this.latencyHint = 'interactive';
    /** the driver, as it comes out of `data/sound/adlib.json` */
    this.sound = null;
    /**
     * The tune the game wants, kept even while there is nobody to play it.
     * A level asks for its music in the same turn it asks for the buses, and
     * a bus is opened by an event, so it is not there yet - the first request
     * fell on the floor and the game ran mute (2026-09-15).
     */
    this.wantedTrack = null;
  } // constructor

  static get effectBuses() {
    return EFFECT_BUSES;
  } // effectBuses

  volumeKey(bus) {
    return (bus === 'music') ? 'music' : 'sounds';
  } // volumeKey

  createAudioHandler() {
    return new LemSoundHandler(this.app);
  } // createAudioHandler

  /**
   * Opens a bus and hands the handler what it needs: which of the two roles
   * it is, and the driver of the card. The volume follows, as the library
   * expects every manager to do for itself.
   */
  openBus(bus, options) {
    options = options || {};
    options.role = this.volumeKey(bus);
    options.sound = this.sound;
    super.openBus(bus, options);
    this.refreshVolume(bus);
    this.muteBus(bus, ('muted' in options) ? options.muted : false);
    if (bus === 'music' && this.wantedTrack !== null) this.playMusic(this.wantedTrack);
  } // openBus

  refreshVolume(bus) {
    var handler = this.buses[bus];
    if (handler === undefined) return;
    handler.setBusVolume(this.volumeFactor(this.volume[this.volumeKey(bus)]));
  } // refreshVolume

  volumeFactor(volume) {
    var levels = [0, 0.005, 0.01, 0.02, 0.04, 0.07, 0.1, 0.14, 0.18, 0.23, 0.29];
    return levels[volume]/levels[10];
  } // volumeFactor

  /**
   * The bytes of the driver, decoded here rather than in the worklet: an
   * AudioWorkletGlobalScope has no `atob`.
   * @param {Object} json - `data/sound/adlib.json`.
   */
  loadSound(json) {
    var binary = atob(json.bytes);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    this.sound = {
      size: json.size,
      offsets: json.offsets,
      tracks: json.tracks,
      effects: json.effects,
      bytes: bytes
    };
    return this.sound;
  } // loadSound

  /** @param {number[]} numbers - the sounds of one frame, 1..18. */
  playFrame(numbers) {
    if (!numbers || !numbers.length) return;
    var handler = this.buses.sounds;
    if (!handler) return;
    if (this.firstSoundLogged === undefined) {
      this.firstSoundLogged = true;
      console.log('AudioManager: first effect of the game is sound '+numbers[0]+', bus state '+handler.getState());
    }
    for (var i = 0; i < numbers.length; i++) handler.playSound(numbers[i]);
  } // playFrame

  /** @param {number} track - 0..19. */
  playMusic(track) {
    this.wantedTrack = track;
    var handler = this.buses.music;
    console.log('AudioManager: music track '+track+(handler ? ' started ('+handler.getState()+')' : ' waits for the bus to open'));
    if (handler) handler.playMusic(track);
  } // playMusic

  /**
   * Which tune a level plays. The game walks through its tracks in order as
   * the player walks through the levels and starts again at the top when it
   * runs out - Fun 1 gets the first, Fun 2 the second, and so on through all
   * hundred and twenty.
   *
   * ★ There are **twenty one** tracks, not twenty: the table of pointers in
   * `adlib.dat` has twenty one entries and the last one plays. Lemmings.ts
   * says twenty in its configuration and we had believed it; Lemmix cycles
   * twenty one, which now agrees with the data (2026-09-15). The modulo is
   * over what the data holds, so it follows the file.
   *
   * ★ **Which tune belongs to which level is still open.** This takes them in
   * the order they lie in the file, the way Lemmix does; the operator hears a
   * different tune in Fun 1 than the original plays, so the game may keep a
   * table of its own in `VGALEMMI.EXE` (L7).
   *
   * @param {number} level - the level's place in the whole game, 0..119.
   * @returns {number} 0..20.
   */
  trackForLevel(level) {
    var count = (this.sound && this.sound.tracks) ? this.sound.tracks.length : 20;
    return ((level % count) + count) % count;
  } // trackForLevel

} // AudioManager

export default AudioManager;
