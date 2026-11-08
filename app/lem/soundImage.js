// begin code

/**
 * The AdLib driver of DOS Lemmings - the thing that turns `adlib.dat` into
 * writes to the {@link OPL2} chip.
 *
 * The file is a "sound image": tables of instruments, frequencies and octaves,
 * and two tables of pointers - twenty one music tracks and eighteen effects. Every
 * pointer leads to a little program that a channel of the driver walks
 * through. A byte under 0x80 is a note, a byte from 0xE0 up sets how long to
 * wait, 0xC0 and up picks an instrument, and the rest are commands: jump into
 * the song's list of patterns, hold, stop, change the transpose, start sliding
 * the pitch.
 *
 * Nothing here makes a sound by itself: it hands register writes to whoever
 * asked, and the chip turns them into samples. So the same class serves the
 * worklet in the browser and the offline renderer of `tools/rendersound.mjs`.
 *
 * ★ The format is not published anywhere; it is read off the driver itself,
 * with the layout of the tables taken from the configuration of Lemmings.ts
 * (MIT, read as documentation) and checked against our data. The one number
 * that is a guess is **how often the driver runs** - `sampleRateFactor/210`
 * samples between two steps - and that is the thing to check by ear.
 */
export class SoundImage {

  /**
   * How fast the driver runs.
   *
   * The `sampleRateFactor` of a track is **the divisor the driver programs
   * into the PC's timer**: the machine's 1 193 182 Hz over that number is how
   * many times a second the driver is called. The tracks of the game carry
   * 16384, 16896 and 17408, which comes out at 72.8, 70.6 and 68.5 times a
   * second - the usual range for a music driver of the era.
   *
   * ★ Measured, not guessed: with this, `tools/matchmusic.mjs` puts the beat
   * of track 5 at **0.836 s, exactly the beat of the operator's recording of
   * the original** (the same piece - Pachelbel's Canon; it was the operator
   * who recognised which of the tracks it is). The published
   * description of the format divides the factor by 210 and calls the result
   * samples, which runs the music more than twice too fast.
   */
  static get TIMER_CLOCK() { return 1193182; }

  /**
   * @param {Object} json - the contents of `data/sound/adlib.json`.
   */
  constructor(json) {
    this.id = 'SoundImage';
    this.bytes = SoundImage.fromBase64(json.bytes);
    this.offsets = json.offsets;
    this.tracks = json.tracks;
    this.effects = json.effects;
  } // constructor

  static fromBase64(text) {
    // An AudioWorklet has no `atob`, so the bytes may arrive decoded already.
    if (text instanceof Uint8Array) return text;
    if (Array.isArray(text)) return new Uint8Array(text);
    if (typeof atob === 'function') {
      var binary = atob(text);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    return new Uint8Array(Buffer.from(text, 'base64'));
  } // fromBase64

  byte(offset) {
    return this.bytes[offset] | 0;
  }

  /** A word of the file. They are little endian, as an x86 program writes them. */
  word(offset) {
    return this.bytes[offset] | (this.bytes[offset+1] << 8);
  }

  /**
   * A player for one of the twenty one music tracks.
   * @param {number} index - 0..19.
   * @returns {SoundImagePlayer}
   */
  music(index, options) {
    return new SoundImagePlayer(this, 'music', index, options);
  } // music

  /**
   * A player for one of the eighteen effects.
   * @param {number} index - 0..17, which is the game's sound number minus one.
   * @returns {SoundImagePlayer}
   */
  effect(index, options) {
    return new SoundImagePlayer(this, 'sound', index, options);
  } // effect

} // SoundImage

/**
 * One track or one effect being played: a handful of channels walking their
 * programs, writing registers as they go.
 */
export class SoundImagePlayer {

  /**
   * @param {SoundImage} image
   * @param {string} kind - `music` or `sound`.
   * @param {number} index
   */
  constructor(image, kind, index, options) {
    this.id = 'SoundImagePlayer';
    this.image = image;
    this.kind = kind;
    this.index = index;
    /**
     * What the byte at offset 8 of an instrument does to a note: it is a
     * **transpose, and it is added**, as the description of the format says.
     *
     * ★ It took a measurement to be sure, and the measurement only works when
     * it is made against the **same piece**: held against a recording of
     * track 5 (the operator recognised which one it was), adding
     * gives 97.9 % agreement on where the notes sit and 99.6 % on which notes
     * they are, where ignoring the byte gives 77 % and 93 %. Held against a
     * recording of a *different* track, all three readings score about the
     * same and the measurement says nothing - which is how this ended up
     * wrong for a while.
     */
    this.transposeMode = (options && options.transposeMode) || 'add';
    /**
     * ★ A constant shift of every note, in semitones. The tunes come out low,
     * and until the driver in `vgalemmi.exe` or a recording says how many
     * octaves belong on top, this is the knob for the listening test.
     */
    this.shift = (options && options.shift) || 0;

    this.channels = [];
    this.waitCycles = 0;
    this.currentCycle = 0;
    this.sampleRateFactor = kind === 'music' ? 0 : 0x4300;
    this.instrumentPos = 0;
    this.initialised = false;
    this.finished = false;

    if (kind === 'music') this.startMusic(index);
    else this.startSound(index);
  } // constructor

  /** How many samples of the chip go by between two steps of the driver. */
  get samplesPerStep() {
    if (!this.sampleRateFactor) return 1;
    var stepsPerSecond = SoundImage.TIMER_CLOCK/this.sampleRateFactor;
    return Math.max(1, Math.round(49716/stepsPerSecond));
  }

  newChannel(index) {
    var image = this.image;
    var at = image.offsets.channelConfig + index*20;
    return {
      note: image.byte(at),
      waitTime: 1,
      // where the instrument the channel plays right now sits (the driver's
      // own pointer), and where the table of instruments starts - two
      // different things, and mixing them up sends the notes to pieces
      instrumentAt: image.word(at+2),
      instrumentBase: 0,
      instrument: image.byte(at+4),
      // the register offsets of the channel's two operators
      operatorLow: image.byte(at+5),
      operatorHigh: image.byte(at+6),
      // the channel's own number, for the A0/B0/C0 registers
      channel: image.byte(at+7),
      keyValue: image.byte(at+8),
      keyRegister: image.byte(at+9),
      programPointer: image.word(at+10),
      position: image.word(at+12),
      levelOffset: image.byte(at+15),
      state: 'none',
      waitSum: image.byte(at+17),
      transpose: image.byte(at+18),
      slide: image.byte(at+19)
    };
  } // newChannel

  startMusic(index) {
    var image = this.image;
    var header = image.tracks[index % image.tracks.length];
    this.sampleRateFactor = image.word(header);
    this.instrumentPos = image.word(header+2) + image.offsets.tracks;
    this.waitCycles = image.byte(header+4);
    var count = image.byte(header+5);
    for (var i = 0; i < count; i++) {
      var channel = this.newChannel(i);
      channel.programPointer = image.word(header+6+i*2) + image.offsets.tracks;
      channel.instrumentBase = this.instrumentPos;
      // the first entry of the program says where the channel starts
      channel.position = image.word(channel.programPointer) + image.offsets.tracks;
      channel.programPointer += 2;
      channel.state = 'music';
      channel.waitTime = 1;
      this.channels.push(channel);
    }
  } // startMusic

  startSound(index) {
    var image = this.image;
    // the driver plays effects on a channel of its own, out of the way of the
    // music - the ninth
    var channel = this.newChannel(8);
    channel.instrumentBase = image.offsets.effectData;
    channel.position = image.effects[index];
    channel.waitTime = 1;
    channel.slide = 0;
    channel.state = 'sound';
    this.channels.push(channel);
  } // startSound

  /**
   * One step of the driver.
   * @param {Function} write - `(register, value)`, a write to the chip.
   */
  step(write) {
    if (this.currentCycle > 0) {
      this.currentCycle--;
      return;
    }
    // `waitCycles` steps between two ticks of the channels, not one more:
    // one of them is this step.
    this.currentCycle = Math.max(0, this.waitCycles-1);

    if (!this.initialised) {
      this.initialised = true;
      this.writeInit(write);
    }

    var playing = 0;
    for (var i = 0; i < this.channels.length; i++) {
      if (this.channels[i].state !== 'none') playing++;
      this.stepChannel(this.channels[i], write);
    }
    if (!playing) this.finished = true;
  } // step

  /** What the driver writes before it plays anything. */
  writeInit(write) {
    // the two timers of the chip, masked and cleared
    write(0x04, 0x60);
    write(0x04, 0x80);
    write(0x02, 0xFF);
    write(0x04, 0x21);
    write(0x04, 0x60);
    write(0x04, 0x80);
    // every channel silent to start with
    for (var i = 0; i < this.channels.length; i++) {
      write(this.channels[i].keyRegister, this.channels[i].keyValue);
    }
    // waveforms other than the plain sine, and the depth of the two effects
    write(0x01, 0x20);
    write(0xBD, 0xC0);
  } // writeInit

  /** One step of one channel of the driver. */
  stepChannel(channel, write) {
    if (channel.state === 'none') return;
    channel.waitTime--;
    var wasAt = channel.position;

    if (channel.waitTime <= 0) {
      this.readProgram(channel, write);
      return;
    }

    // a channel that is sliding moves its note every step
    if (channel.slide !== 0) {
      channel.note = (channel.note + (channel.slide === 0xFF ? -1 : channel.slide)) & 0xFF;
      this.setFrequency(channel, write);
    }

    // and a note that has run its length is let go of
    if (this.image.byte(wasAt) !== 0x82) {
      if (this.image.byte(channel.instrumentAt + 0x0E) === channel.waitTime) {
        write(channel.keyRegister, channel.keyValue);
        channel.slide = 0;
      }
    }
  } // stepChannel

  /**
   * Reads the channel's program until it hits a note - everything else is a
   * command that changes how the next note will sound or where to read on.
   */
  readProgram(channel, write) {
    var at = channel.position;
    var guard = 0;
    while (guard++ < 1000) {
      var command = this.image.byte(at);
      at++;

      if ((command & 0x80) === 0) {
        // a note
        channel.note = command;
        write(channel.keyRegister, channel.keyValue);
        this.setFrequency(channel, write);
        channel.waitTime = channel.waitSum;
        channel.position = at;
        return;
      }
      if (command >= 0xE0) {
        // how long the notes that follow last
        channel.waitSum = command - 0xDF;
        continue;
      }
      if (command >= 0xC0) {
        this.setInstrument(channel, command - 0xC0, write);
        continue;
      }
      if (command <= 0xB0) {
        var next = this.command(channel, command, at, write);
        if (next < 0) return;
        at = next;
        continue;
      }
      // anything else sets the volume from the next byte
      this.setLevel(channel, at, write);
      at++;
    }
    // a program that never reaches a note is broken; stop the channel rather
    // than spin
    channel.state = 'none';
  } // readProgram

  /**
   * The commands of the program: jump into the song's pattern list, hold,
   * stop, transpose, slide.
   * @returns {number} where to read on, or -1 when the step is over.
   */
  command(channel, command, at, write) {
    switch (command & 0x0F) {
      case 0: {
        // the next pattern out of the channel's list; a zero there means the
        // list itself jumps somewhere - that is how a song loops
        var pointer = channel.programPointer;
        var entry = this.image.word(pointer);
        pointer += 2;
        if (entry === 0) {
          pointer = this.image.word(pointer) + this.image.offsets.tracks;
          at = this.image.word(pointer) + this.image.offsets.tracks;
          pointer += 2;
        } else {
          at = entry + this.image.offsets.tracks;
        }
        channel.programPointer = pointer;
        channel.position = at;
        return at;
      }
      case 1:
        // let go of the note and wait
        write(channel.keyRegister, channel.keyValue);
        channel.slide = 0;
        channel.position = at;
        channel.waitTime = channel.waitSum;
        return -1;
      case 2:
        // hold the note and wait
        channel.position = at;
        channel.waitTime = channel.waitSum;
        return -1;
      case 3:
        // the end of the song
        channel.state = 'none';
        return -1;
      case 4:
        channel.transpose = this.image.byte(at);
        return at+1;
      case 5:
        write(channel.keyRegister, channel.keyValue);
        channel.state = 'none';
        return -1;
      case 6:
        channel.slide = 1;
        return at;
      case 7:
        channel.slide = 0xFF;
        return at;
      case 8:
        this.setLevel(channel, at, write);
        return at+1;
      default:
        return at;
    }
  } // command

  /**
   * Turns the channel's note into the two registers that carry the frequency,
   * through the tables of the driver: a note picks an octave and an index into
   * the frequency table.
   */
  setFrequency(channel, write) {
    var image = this.image;
    var transpose = channel.transpose;
    if (this.transposeMode === 'ignore') transpose = 0;
    else if (this.transposeMode === 'subtract') transpose = -((transpose << 24) >> 24);
    var at = ((channel.note + transpose + this.shift) & 0xFF) + 4;
    var octave = image.byte(at + image.offsets.octaves);
    var index = image.byte(at + image.offsets.frequencyCount);
    var frequency = image.word(image.offsets.frequencies + index*32);

    if ((frequency & 0x8000) === 0) octave--;
    if ((octave & 0x80) > 0) {
      octave++;
      frequency = (frequency << 1) & 0xFFFF;
    }

    write(channel.channel + 0xA0, frequency & 0xFF);
    channel.keyValue = ((frequency >> 8) & 3) | ((octave << 2) & 0xFF);
    channel.keyRegister = channel.channel + 0xB0;
    // 0x20 is the key on
    write(channel.keyRegister, channel.keyValue | 0x20);
  } // setFrequency

  /**
   * Loads an instrument: sixteen bytes that set both operators - attack and
   * decay, sustain and release, the waveform, how they are connected, and the
   * two bytes that decide the volume.
   */
  setInstrument(channel, number, write) {
    var image = this.image;
    var at = channel.instrumentBase + ((number-1) << 4);
    channel.instrument = number;

    write(channel.operatorLow + 0x60, image.byte(at));
    write(channel.operatorHigh + 0x60, image.byte(at+1));
    write(channel.operatorLow + 0x80, image.byte(at+2));
    write(channel.operatorHigh + 0x80, image.byte(at+3));
    write(channel.operatorLow + 0xE0, image.byte(at+6));
    write(channel.operatorHigh + 0xE0, image.byte(at+7));
    write(channel.channel + 0xC0, image.byte(at+9));
    write(channel.operatorLow + 0x20, image.byte(at+4));
    write(channel.operatorHigh + 0x20, image.byte(at+5));

    channel.transpose = image.byte(at+8);
    channel.levelOffset = image.byte(at+11);
    channel.instrumentAt = at;
    this.setLevel(channel, at+10, write);
  } // setInstrument

  /**
   * The volume of both operators. The byte in the program is an index into a
   * table of the driver, and the instrument says which of the two operators
   * the key scale bits belong to.
   */
  setLevel(channel, at, write) {
    var image = this.image;
    var index = image.byte(at);
    var level = image.byte((index & 0x7F) + image.offsets.data);
    var scale = image.byte(channel.instrumentAt + 0x0C);
    write(channel.operatorLow + 0x40, level | ((scale << 2) & 0xC0));

    index = (channel.levelOffset + image.byte(channel.instrumentAt + 0x0A)) & 0x7F;
    level = image.byte(index + image.offsets.data);
    write(channel.operatorHigh + 0x40, level | ((scale >> 2) & 0xC0));
  } // setLevel

} // SoundImagePlayer

export default SoundImage;
