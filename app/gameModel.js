const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { VGAVideoRAMEntity } = await import('./svision/js/platform/canvas2D/vga/vgaVideoRAMEntity.js?ver='+window.srcVersion);
const { ModuleWorker } = await import('./svision/js/moduleWorker.js?ver='+window.srcVersion);
const { LemPalette } = await import('./lem/palette.js?ver='+window.srcVersion);
// begin code

/**
 * The game screen. The game itself runs in the worker (`gameWorker.js`) at
 * the original's 17 frames a second and sends its video memory and palette
 * whenever the picture changes; this model shows the last frame in a
 * {@link VGAVideoRAMEntity}, loads the data a level needs and tells the
 * worker where to look (`app/WORKER-PROTOCOL.md`).
 *
 * Milestone L3: the lemmings walk, fall, drown, burn and leave; the player
 * only scrolls. Pushing the pointer against the left or right edge of the
 * window scrolls it, as in the original, and so do the cursor keys; `+` and
 * `-` step through the levels and `B` boots again - debugging conveniences
 * until L7. The panel, the mini map and the skills are L4 and L5.
 */
export class GameModel extends AbstractModel {

  /** the modules the worker is glued from, in dependency order */
  static get WORKER_SOURCES() {
    return [
      'svision/js/platform/canvas2D/vga/vgaVideoRAM.js',
      'svision/js/platform/canvas2D/vga/vgaPalette.js',
      'lem/palette.js',
      'lem/graphicsSet.js',
      'lem/lemmingSprites.js',
      'lem/lemming.js',
      'lem/levelBuilder.js',
      'lem/sounds.js',
      'lem/lemmingsGame.js',
      'lem/panel.js',
      'gameWorker.js'
    ];
  }

  /** how many pixels a frame the window scrolls when pushed at an edge */
  static get SCROLL_STEP() { return 8; }

  /**
   * The keys of the original (`sources/docs/manual.md`): the function keys
   * pick a skill whatever the control device is, F11 pauses, F12 nukes.
   * The panel with the same buttons on it comes with L5.
   */
  static get SKILL_KEYS() {
    return {
      F3: 'climber', F4: 'floater', F5: 'bomber', F6: 'blocker',
      F7: 'builder', F8: 'basher', F9: 'miner', F10: 'digger'
    };
  }

  constructor(app) {
    super(app);
    this.id = 'GameModel';
    console.log('GameModel: created');
    // The game reads the keyboard itself; an autorepeat would flood it.
    this.autorepeatKeys = false;
    this.screen = null;
    this.paletteVersion = -1;
    this.ready = false;
    this.paused = false;
    /** where the window looks; the worker is told, it does the cutting */
    this.scrollX = 0;
    this.scrolling = 0;
    this.loaded = {};
    this.pending = [];
    this.status = null;
    /** the skill the next click gives away, chosen with F3..F10 */
    this.skill = null;
    /** the right mouse button is held: only a walker may be picked */
    this.walkersOnly = false;
    /** where the pointer is, in the game window */
    this.pointer = {x: 0, y: 0};
  } // constructor

  init() {
    super.init();
    if (this.borderEntity != null) {
      this.borderEntity.bkColor = '#000000';
    }
    this.desktopEntity.bkColor = '#000000';

    this.screen = new VGAVideoRAMEntity(this.desktopEntity, 0, 0);
    this.screen.clear(0);
    this.desktopEntity.addEntity(this.screen);
    // Until the first frame of the game arrives the screen says what is going
    // on. A game that hangs before its first frame is otherwise a black
    // rectangle with nothing to go on.
    this.screen.palette.load(LemPalette.toVGA(LemPalette.inLevel([
      [52, 32, 8], [48, 20, 4], [36, 8, 4], [24, 0, 4], [16, 16, 20], [24, 24, 28], [28, 36, 0], [8, 24, 8]
    ])).bytes);
    this.paletteVersion = -1;
    this.showStatus('LOADING');

    this.startWorker();
  } // init

  shutdown() {
    this.sendWorkerMessage({id: 'reset'});
    super.shutdown();
  } // shutdown

  /**
   * Writes one line onto the screen, in the font of the machine. Used while
   * the game is being loaded and when something goes wrong; the first frame
   * of the game overwrites it.
   * @param {string} text
   */
  showStatus(text) {
    if (!this.screen) return;
    this.screen.videoRAM.fill(0);
    this.screen.videoRAM.drawText(this.app.fonts.vgaFonts8x16Mono, 8, 8, text.toUpperCase(), 3, 0);
    this.screen.invalidate();
  } // showStatus

  // ------------------------------------------------------------------ worker

  startWorker() {
    if (this.app.worker) {
      this.app.worker.onmessage = (event) => this.handleWorkerMessage(event);
      this.ready = true;
      this.loadLevel(this.app.levelPack, this.app.levelIndex);
      return;
    }
    this.showStatus('BUILDING WORKER');
    ModuleWorker.create(this.app, GameModel.WORKER_SOURCES).then((worker) => {
      this.app.worker = worker;
      worker.onmessage = (event) => this.handleWorkerMessage(event);
      worker.onerror = (event) => this.app.showErrorMessage('game worker: '+event.message, 'restart');
      this.ready = true;
      this.sendWorkerMessage({id: 'init', seed: Date.now() >>> 0});
      this.loadLevel(this.app.levelPack, this.app.levelIndex);
    }).catch((error) => {
      this.showStatus('WORKER: '+error.message);
      this.app.showErrorMessage('game worker: '+error.message, 'restart');
    });
  } // startWorker

  sendWorkerMessage(event) {
    if (this.app.worker && this.ready) {
      this.app.worker.postMessage(event);
    }
  } // sendWorkerMessage

  handleWorkerMessage(event) {
    var data = event.data;
    switch (data.id) {
      case 'frame':
        if (this.firstFrameSeen === undefined) {
          // Which frame of the game the player first gets to see. A number
          // far above zero means the worker had been running before the
          // picture reached the screen - worth knowing when the start of a
          // level looks wrong.
          this.firstFrameSeen = data.frame;
          console.log('GameModel: first frame shown is game frame '+data.frame);
        }
        if (data.paletteVersion !== this.paletteVersion) {
          this.paletteVersion = data.paletteVersion;
          this.screen.palette.load(data.palette);
        }
        this.screen.restore(data.vram);
        this.status = data.status;
        if (data.status) this.scrollX = data.status.scrollX;
        // The sounds the game asked for this frame go to the AdLib card.
        if (data.sound) this.app.audioManager.playFrame(data.sound);
        break;
      case 'levelDone':
        // every lemming is home or gone - the results screen is L7
        break;
    }
  } // handleWorkerMessage

  // -------------------------------------------------------------------- data

  /**
   * Fetches one of our JSON files.
   *
   * The library's own way is a POST of `<name>.data`, which svision's
   * `dataPage.php` answers with `data/<name>.json` (the server configuration
   * rewrites every URL to `index.php?<path>` and blocks `.json` outright).
   * Where that rewrite is not in place - a game served from a subdirectory of
   * a plain web server, say - the POST comes back as a 404, so the plain file
   * is asked for as a fallback. Whichever answers first is used; the console
   * says which one it was.
   *
   * @param {string} file - `levels/level009`, `sets/set0`, `main/lemmings`.
   * @returns {Promise<Object>} the parsed content.
   */
  fetchJSON(file) {
    var self = this;
    var id = 'lem'+Date.now().toString();
    return fetch(file+'.data', {
      method: 'POST',
      headers: {fetchDataId: id},
      body: '{}',
      credentials: 'same-origin'
    }).then(function (response) {
      if (!response.ok) throw new Error('data endpoint '+response.status);
      return response.json();
    }).then(function (answer) {
      if (answer && answer.error) throw new Error(answer.error.message);
      if (!answer || !answer.data) throw new Error('data endpoint sent no data');
      return answer.data;
    }).catch(function (error) {
      console.warn('GameModel: '+file+'.data failed ('+error.message+'), trying data/'+file+'.json');
      return fetch('data/'+file+'.json', {credentials: 'same-origin'}).then(function (response) {
        if (!response.ok) throw new Error('data/'+file+'.json '+response.status);
        return response.json();
      });
    }).then(function (data) {
      if (self.app.devMode) console.log('GameModel: loaded '+file);
      return data;
    });
  } // fetchJSON

  /**
   * Fetches what a level needs - the pack it is in, its graphics set, the
   * lemming animations, and the special picture if it has one - and hands
   * them to the worker.
   * @param {string} pack - `level000` .. `level009`.
   * @param {number} index - 0..7 inside the pack.
   */
  loadLevel(pack, index) {
    var self = this;
    this.showStatus('LOADING '+pack+' #'+index);
    this.loadingPack = pack;
    this.loadingIndex = index;
    Promise.all([this.fetchJSON('levels/'+pack), this.fetchJSON('main/lemmings'), this.fetchJSON('main/panel'),
                 this.app.audioManager.sound ? Promise.resolve(null) : this.fetchJSON('sound/adlib')])
      .then(function (answers) {
        var levels = answers[0];
        var main = answers[1];
        var panel = answers[2];
        // The driver of the AdLib card, once for the whole session.
        if (answers[3]) {
          self.app.audioManager.loadSound(answers[3]);
          console.log('GameModel: sound driver loaded, opening the two buses');
          self.sendEvent(0, {id: 'openAudioBus', bus: 'sounds', options: {muted: false}});
          self.sendEvent(0, {id: 'openAudioBus', bus: 'music', options: {muted: false}});
        }
        var level = levels.levels[index];
        if (!level) throw new Error(pack+' has no level '+index);
        var more = [self.fetchJSON('sets/set'+level.graphicsSet)];
        if (level.specialSet > 0) more.push(self.fetchJSON('special/spec'+(level.specialSet-1)));
        return Promise.all(more).then(function (rest) {
          self.showStatus('STARTING');
          console.log('GameModel: level '+self.loadingPack+' #'+self.loadingIndex+' sent to the worker');
          // The tune of a level: the game walks through its tracks as the
          // player walks through the levels. Which level this is in the whole
          // game comes with the level order (L7); until then the place in the
          // pack stands in for it.
          var place = Number(pack.replace('level', ''))*8 + index;
          self.app.audioManager.playMusic(self.app.audioManager.trackForLevel(place));
          self.sendWorkerMessage({
            id: 'level',
            level: level,
            set: rest[0],
            main: main,
            panel: panel,
            special: rest[1] || null
          });
        });
      })
      .catch(function (error) {
        self.showStatus('DATA: '+error.message);
        self.app.showErrorMessage('game data: '+error.message, 'restart');
      });
  } // loadLevel

  // ------------------------------------------------------------------ events

  /**
   * The library hands every input to the model as an event. Until the skills
   * arrive (L4) the only thing the player can do is look around: the pointer
   * pushed against an edge of the window scrolls it, as the manual describes,
   * and so do the cursor keys.
   */
  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'keyPress':
        if (this.paused) {
          this.paused = false;
          this.sendWorkerMessage({id: 'continue'});
        }
        if (event.x !== undefined) this.pointerAt(event.x, event.y);
        return this.keyChanged(event.key, true);
      case 'keyRelease':
        return this.keyChanged(event.key, false);
      case 'mouseHover':
      case 'keyMove':
        return this.pointerAt(event.x, event.y);
      case 'blurWindow':
        this.paused = true;
        this.sendWorkerMessage({id: 'pause'});
        return true;
    }
    return false;
  } // handleEvent

  /**
   * @param {string} key - the reported key.
   * @param {boolean} value - pressed or released.
   * @returns {boolean} whether the key meant anything.
   */
  keyChanged(key, value) {
    var skills = GameModel.SKILL_KEYS;
    if (skills[key]) {
      if (value) {
        this.skill = skills[key];
        this.sendWorkerMessage({id: 'select', skill: this.skill});
      }
      return true;
    }
    switch (key) {
      case 'ArrowLeft': this.scrolling = value ? -1 : 0; return true;
      case 'ArrowRight': this.scrolling = value ? 1 : 0; return true;
      case 'F1': if (value) this.sendWorkerMessage({id: 'releaseRate', step: -1}); return true;
      case 'F2': if (value) this.sendWorkerMessage({id: 'releaseRate', step: 1}); return true;
      case 'F11': if (value) this.sendWorkerMessage({id: 'panelClick', x: 176, y: 180}); return true;
      case 'F12': case 'Delete': if (value) this.sendWorkerMessage({id: 'nuke'}); return true;
      case 'Mouse1':
        // the left button gives the chosen skill to the lemming under the cross
        if (value) this.assignAt(this.pointer.x, this.pointer.y);
        return true;
      case 'Mouse2':
        this.walkersOnly = value;
        return true;
      case 'b': case 'B':
        // boot again - a debugging convenience until L7
        if (value) this.app.setModel('BootModel');
        return true;
      default: return false;
    }
  } // keyChanged

  /**
   * Hands the chosen skill to whoever is under the point on the screen. The
   * worker works in the level, so the scroll position is added here.
   * @param {number} x - on the screen, 0..319.
   * @param {number} y - on the screen; the game window is the top 160 lines.
   */
  assignAt(x, y) {
    // Below the game window is the panel: its buttons and its mini map.
    if (y >= 160) {
      this.sendWorkerMessage({id: 'panelClick', x: x, y: y});
      return;
    }
    if (!this.skill) return;
    this.sendWorkerMessage({
      id: 'assign',
      skill: this.skill,
      x: this.scrollX + x,
      y: y,
      walkersOnly: this.walkersOnly
    });
  } // assignAt

  /** The pointer against an edge of the game window scrolls it. */
  pointerAt(x, y) {
    if (x === undefined) return false;
    this.pointer.x = x;
    if (y !== undefined) this.pointer.y = y;
    this.sendWorkerMessage({id: 'pointer', x: this.pointer.x, y: this.pointer.y});
    if (x <= 2) this.scrolling = -1;
    else if (x >= this.desktopWidth-3) this.scrolling = 1;
    else this.scrolling = 0;
    return true;
  } // pointerAt

  /**
   * The model draws itself every frame. Nothing in the library does it for a
   * game: `AbstractModel.loopModel()` only runs the event queue, and
   * `drawModel()` is called by a resize or by arriving data. A game whose
   * picture comes from a worker has to paint it here, or the screen only
   * refreshes when the window is resized - which is exactly how it looked:
   * black until the browser tab was left and entered again (2026-09-14).
   */
  loopModel(timestamp) {
    super.loopModel(timestamp);
    if (this.scrolling !== 0) {
      this.scrollX += this.scrolling*GameModel.SCROLL_STEP;
      this.sendWorkerMessage({id: 'scroll', x: this.scrollX});
    }
    this.drawModel();
  } // loopModel

} // GameModel

export default GameModel;
