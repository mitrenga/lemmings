const { AbstractApp } = await import('./svision/js/abstractApp.js?ver='+window.srcVersion);
const { VGAFonts8x16 } = await import('./svision/js/platform/canvas2D/vga/vgaFonts8x16.js?ver='+window.srcVersion);
const { DOSBootModel } = await import('./svision/js/platform/canvas2D/vga/dosBootModel.js?ver='+window.srcVersion);
const { VGAControls } = await import('./svision/js/platform/canvas2D/vga/vgaControls.js?ver='+window.srcVersion);
const { GameModel } = await import('./gameModel.js?ver='+window.srcVersion);
const { AudioManager } = await import('./audioManager.js?ver='+window.srcVersion);
const { Version } = await import('./version.js?ver='+window.srcVersion);
// begin code

/**
 * The application: boots "MS-DOS" and then runs a level. Two models so far,
 * switched by name the way every svision game does it; the menu, the level
 * preview and the results screen come with L5 and L7.
 *
 * The boot follows the original, not the cracked copy the data came in:
 * `LEMMINGS` runs `AUTODET` and that starts `VGALEMMI -v`
 * (`sources/docs/manual.md`).
 */
export class MainApp extends AbstractApp {

  constructor(platform, importPath, wsURL) {
    super(platform, 'bodyApp', importPath, wsURL);
    this.id = 'MainApp';
    this.version = Version;
    this.copyright = '©2026 L. Mitrenga, CC BY-NC-SA 4.0';

    this.fonts = {};
    this.fonts.vgaFonts8x16Mono = new VGAFonts8x16(this, false);

    /** the AdLib card: the effects on one bus, the music on the other */
    this.audioManager = new AudioManager(this);

    /** Lemmings is a mouse game; the keyboard only helps (manual, F1..F12) */
    this.controlsOptions = VGAControls.controlsOptions(VGAControls.POINT_AND_CLICK);
    this.controls = {
      keyboard: VGAControls.defaultControls('keyboard', VGAControls.POINT_AND_CLICK),
      mouse: VGAControls.defaultControls('mouse', VGAControls.POINT_AND_CLICK),
      gamepads: VGAControls.defaultControls('gamepads', VGAControls.POINT_AND_CLICK),
      /** the touch layout comes with the panel (L5) */
      touchscreen: {supported: false, type: false}
    };

    /** the game worker, made by the game model out of the glued modules */
    this.worker = null;
    /** which level the game model shows - a debugging convenience until L7 */
    this.levelPack = 'level009';
    this.levelIndex = 1;

    this.setModel('BootModel');
  } // constructor

  /**
   * Switches models: shuts the current one down, makes the next one,
   * initialises it and lays it out.
   * @param {string} model - 'BootModel' or 'GameModel'.
   */
  setModel(model) {
    var needResizeApp = false;
    if (this.model) {
      this.model.shutdown();
      needResizeApp = true;
    }
    switch (model) {
      case 'BootModel':
        this.model = new DOSBootModel(this, {
          nextModel: 'GameModel',
          skipKeys: 'any',
          memoryKB: 640,
          extendedKB: 3072,
          dos: {
            autoexec: ['Microsoft (R) Mouse Driver Version 8.20', ''],
            commands: [
              {command: 'CD LEMMINGS', prompt: 'C:\\LEMMINGS>'},
              {command: 'LEMMINGS'}
            ]
          }
        });
        break;
      case 'GameModel':
        this.model = new GameModel(this);
        break;
    } // switch
    this.model.init();
    if (needResizeApp) {
      this.resizeApp();
    }
  } // setModel

} // MainApp
