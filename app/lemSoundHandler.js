const { AbstractAudioHandler } = await import('./svision/js/audio/abstractAudioHandler.js?ver='+window.srcVersion);
// begin code

/**
 * Audio handler of the AdLib card. The card itself - the chip and the game's
 * driver - lives in the AudioWorklet `app/lemSoundProcessor.js`; this fetches
 * the three modules it is made of, glues them into the classic script a
 * worklet has to be, registers it and keeps the node.
 *
 * Modelled on `stinger/app/stingerSoundHandler.js`, which does the same for the
 * emulated sound board of that machine, and on the library's own
 * `AudioWorkletHandler`.
 */

/** the files of the worklet, in dependency order */
var WORKLET_SOURCES = [
  'svision/js/audio/chip/opl2.js',
  'lem/soundImage.js',
  'lemSoundProcessor.js'
];

/** The bundle transformation of `svtool`, so an ES module can be concatenated. */
function bundleCode(text, name) {
  var marker = '// begin code';
  var pos = text.indexOf(marker);
  var code = (pos < 0) ? text : text.substring(pos+marker.length);
  code = code.replace(/^[ \t]*export[ \t]+default[ \t]+[^\n;]+;[ \t]*$/gm, '');
  code = code.replace(/^([ \t]*)export[ \t]+/gm, '$1');
  return '// === '+name+' ===\n'+code;
} // bundleCode

export class LemSoundHandler extends AbstractAudioHandler {

  constructor(app) {
    super(app);
    this.id = 'LemSoundHandler';
    this.node = null;
    this.gain = null;
    this.role = 'sounds';
    this.sound = null;
    /**
     * The volume of the bus, as the manager sets it. Without it the gain of
     * the node is set to `undefined` the moment the worklet starts, which
     * throws, and the bus reports itself as unsupported - the game then runs
     * in silence with nothing but one line in the console to say why.
     */
    this.busFactor = 1.0;
    this.muted = false;
    /** what was asked for before the worklet was ready */
    this.backlog = [];
  } // constructor

  openBus(bus, options, ctx) {
    options = options || {};
    super.openBus(bus, options, ctx);
    if (this.error === false && this.ctx != null) {
      this.muted = ('muted' in options) ? !!options.muted : false;
      this.role = (options.role === 'music') ? 'music' : 'sounds';
      this.sound = options.sound || null;
      this.openProcessor();
    } else {
      this.busy = false;
    }
  } // openBus

  /** Fetches, glues and registers the worklet module; once per context. */
  loadProcessorModule() {
    if (!this.ctx.lemSoundModule) {
      this.ctx.lemSoundModule = (async () => {
        var parts = [];
        for (var i = 0; i < WORKLET_SOURCES.length; i++) {
          var name = WORKLET_SOURCES[i];
          var response = await fetch(this.app.importPath+'/'+name+'?ver='+window.srcVersion);
          if (!response.ok) throw new Error(name+' '+response.status);
          parts.push(bundleCode(await response.text(), name));
        }
        var blobURL = URL.createObjectURL(new Blob([parts.join('\n')], {type: 'text/javascript'}));
        try {
          await this.ctx.audioWorklet.addModule(blobURL);
        } finally {
          URL.revokeObjectURL(blobURL);
        }
      })().catch((error) => {
        this.ctx.lemSoundModule = null;
        throw error;
      });
    }
    return this.ctx.lemSoundModule;
  } // loadProcessorModule

  async openProcessor() {
    try {
      await this.loadProcessorModule();
      this.node = new AudioWorkletNode(this.ctx, 'LemSoundProcessor', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: {role: this.role, sound: this.sound}
      });
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.muted ? 0.0 : this.busFactor;
      this.node.connect(this.gain);
      this.gain.connect(this.ctx.destination);
      for (var i = 0; i < this.backlog.length; i++) this.node.port.postMessage(this.backlog[i]);
      this.backlog.length = 0;
      console.log('LemSoundHandler: bus '+this.bus+' ready ('+this.ctx.state+', '+this.ctx.sampleRate+' Hz)');
    } catch (error) {
      console.error('LemSoundHandler: '+error.message);
      this.node = null;
      this.app.model.sendEvent(1, {id: 'unsupportedAudioBus', bus: this.bus});
    } finally {
      this.busy = false;
    }
  } // openProcessor

  closeBus() {
    if (this.waitForBusy('closeAudioBus')) return false;
    if (this.node) {
      this.node.port.postMessage({id: 'stop'});
      this.node.disconnect();
      this.node = null;
    }
    this.backlog.length = 0;
    if (this.gain) {
      this.gain.disconnect();
      this.gain = null;
    }
    return super.closeBus();
  } // closeBus

  post(message) {
    if (this.node != null) this.node.port.postMessage(message);
    else if (this.backlog.length < 16) this.backlog.push(message);
  } // post

  // ------------------------------------------------- what the manager asks

  pauseBus() {
    this.post({id: 'silence'});
  } // pauseBus

  continueBus() {
  } // continueBus

  stopBus() {
    this.post({id: 'silence'});
  } // stopBus

  muteBus(muted) {
    this.muted = !!muted;
    if (this.gain) this.gain.gain.value = this.muted ? 0.0 : this.busFactor;
  } // muteBus

  setBusVolume(factor) {
    this.busFactor = factor;
    if (this.gain && !this.muted) this.gain.gain.value = factor;
  } // setBusVolume

  busIsReady() {
    return this.node != null;
  } // busIsReady

  /** @param {number} number - the game's sound number, 1..18. */
  playSound(number) {
    this.post({id: 'sound', number: number});
  } // playSound

  /** @param {number} track - 0..19. */
  playMusic(track) {
    this.post({id: 'music', track: track});
  } // playMusic

  silence() {
    this.post({id: 'silence'});
  } // silence

} // LemSoundHandler

export default LemSoundHandler;
