// begin code

/**
 * The AdLib card of the machine, as an AudioWorklet processor.
 *
 * Lemmings has no samples: what comes out of the speaker is the game's own
 * driver ({@link SoundImage}) writing registers of a YM3812 ({@link OPL2}), and
 * that is what runs in here. The game thread only says **which** sound or
 * track to start; the timing of the driver is the chip's own clock, counted in
 * samples, so a stutter of the worker cannot slow the music down.
 *
 * One processor per bus: the `sounds` bus plays the effects, the `music` bus
 * the tracks. Each has its own chip, which is also how the original behaves -
 * an effect never takes a voice away from the music, because the driver plays
 * effects on a channel of its own.
 */
class LemSoundProcessor extends AudioWorkletProcessor {

  constructor(options) {
    super();
    var settings = (options && options.processorOptions) || {};
    this.role = settings.role === 'music' ? 'music' : 'sounds';
    /**
     * How loud what comes out of the chip is. ★ Measured on the data: the
     * loudest of the twenty one tracks peaks at 0.635 and the loudest effect
     * at 0.220, so the music is left as it is and the effects are lifted to
     * sit beside it. It used to be three for both, which drove every tune
     * well past one and clipped it - the operator heard it as music that is
     * "somehow oddly sampled" (2026-09-15).
     */
    this.gain = (this.role === 'music') ? 1.0 : 2.0;
    this.chip = new OPL2({sampleRate: sampleRate});
    this.image = settings.sound ? new SoundImage(settings.sound) : null;
    /** the players running right now */
    this.players = [];
    /** how many samples are left before the driver takes its next step */
    this.countdown = 0;
    this.stopped = false;

    this.port.onmessage = (event) => {
      var message = event.data || {};
      switch (message.id) {
        case 'sound':
          if (this.image) this.image.effect && this.start(this.image.effect(message.number-1));
          break;
        case 'music':
          if (this.image) {
            this.players = [];
            this.start(this.image.music(message.track));
          }
          break;
        case 'silence':
          this.players = [];
          this.chip.reset();
          break;
        case 'stop':
          this.stopped = true;
          break;
      }
    };
  } // constructor

  start(player) {
    // The effects are short; more than a handful at once would only be noise.
    if (this.players.length > 4) this.players.shift();
    this.players.push({player: player, countdown: 0});
  } // start

  /**
   * Fills the output. Every player is stepped on its own clock, and the chip
   * renders whatever its registers say at that moment.
   */
  process(inputs, outputs) {
    if (this.stopped) return false;
    var output = outputs[0][0];
    if (!output) return true;

    var written = 0;
    var self = this;
    while (written < output.length) {
      // how far to the next step of the fastest player
      var span = output.length - written;
      for (var i = 0; i < this.players.length; i++) {
        if (this.players[i].countdown < span) span = Math.max(1, this.players[i].countdown);
      }

      for (var p = 0; p < this.players.length; p++) {
        var entry = this.players[p];
        entry.countdown -= span;
        if (entry.countdown <= 0) {
          entry.player.step(function (register, value) { self.chip.write(register, value); });
          entry.countdown = Math.max(1, Math.round(entry.player.samplesPerStep*sampleRate/OPL2.SAMPLE_RATE));
        }
      }
      this.players = this.players.filter(function (entry) { return !entry.player.finished; });

      var block = output.subarray(written, written+span);
      this.chip.render(block, span, this.gain);
      written += span;
    }
    return true;
  } // process

} // LemSoundProcessor

registerProcessor('LemSoundProcessor', LemSoundProcessor);
