# Worker protocol

The game runs in a web worker (`app/gameWorker.js`), glued at run time out of
ES modules by svision's `ModuleWorker`, and ticks at the original's **17
frames a second**. The model (`app/gameModel.js`) owns the screen, the data
files and the input; the worker owns the game.

The same class runs **under Node without a worker at all**: the tools make a
`GameWorker(post)`, feed it `handleMessage()` and call `tick()` themselves, so
a run is a pure function of the seed, the level and the input (R-009).

## Model → worker

| message | fields | what it means |
|---|---|---|
| `init` | `seed` | new run; seeds the substitutable source of randomness |
| `level` | `level`, `set`, `main`, `special`, `headless` | build this level and draw its first frame; `headless` means the tools drive the clock |
| `scroll` | `x` | the window looks at this column of the level |
| `pause` / `continue` | | stop and resume the clock |
| `reset` | | drop the level |

`level` is a record out of `data/levels/`, `set` the graphics set out of
`data/sets/`, `main` the animations out of `data/main/lemmings.json`, and
`special` the picture out of `data/special/` for the four special levels.

## Worker → model

| message | fields | what it means |
|---|---|---|
| `frame` | `vram`, `palette`, `paletteVersion`, `frame`, `status` | the picture changed |
| `levelDone` | `saved`, `released`, `toRescue`, `frame` | every lemming is home or gone |

`vram` is the 320x200 screen: the game window is the top 160 lines, the forty
below it are the panel and stay black until L5. `palette` is 256 registers of
6-bit components, of which the game uses the first sixteen. `status` carries
what the panel will show - `out`, `saved`, `released`, `total`, `seconds`,
`releaseRate`, `scrollX`.

## What is not here yet

Assigning a skill, the release rate buttons, pause and nuke (L4, L5), the
panel and the mini map (L5), and sound (L6) - the worker will say which sound
to start in the `frame` message, the way Prince of Persia does.
