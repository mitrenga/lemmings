# data/ - what the game reads

Open formats decoded out of the original files by `tools/dumpdat.mjs`. The
game loads these at run time; it never touches a `.dat` file. Pixels are
base64 of one byte per pixel, the colour index 0..15, zero transparent - the
same shape Prince of Persia uses in its `data/`.

**These files are derived from the operator's game data: ask before
committing them.**

```
data/
  sets/     set<n>.json      one graphics set: terrain, objects, palette
            set<n>-terrain.png, set<n>-objects.png   sheets, for the eye only
  levels/   level00<f>.json  eight level records each, as parsed
            oddtable.json    the 80 entries that turn 80 records into 120 levels
  special/  spec<n>.json     the 960x160 world of one special level
            spec<n>.png      the same picture, for the eye
```

## `sets/set<n>.json`

| field | what it is |
|---|---|
| `set`, `name` | 0..4, `dirt` `fire` `marble` `pillar` `crystal` |
| `palette.custom` | the eight colours the set puts into indices 8..15, 6-bit r, g, b |
| `palette.preview` | the eight colours of the level preview screen - **not always the same as `custom`** |
| `palette.standard`, `palette.egaCustom` | kept for completeness; the game does not use them |
| `terrain[]` | 64 slots, `null` where empty: `{id, width, height, pixels}` |
| `objects[]` | 16 slots, `null` where empty: `{id, width, height, frames[], startFrame, frameCount, previewFrame, animationFlags, trigger, sound}` |

`trigger` is `{left, top, width, height, effect}` in pixels from the object's
corner, `effect` one of `none`, `exit`, `trap`, `drown`, `disintegrate`,
`oneWayLeft`, `oneWayRight`, `steel`. `sound` is the sound a trap plays.

Masks are not stored: every picture of the game has a mask that is exactly
"the pixel is not transparent", checked on all 273 terrain pieces and all 540
object frames. `app/lem/graphicsSet.js` derives it, and still reads a `mask`
field if one is ever written.

## `levels/level00<f>.json`

`{file, levels[]}`, eight per file, each one a parsed level record:
counts, time, `skills`, `startX`, `graphicsSet`, `specialSet`, and the three
lists - `objects`, `terrain`, `steel` - with the coordinates already decoded
into pixels and the flags into booleans.

## `special/spec<n>.json`

`{special, width: 960, height: 160, palette, ega, pixels}`. A level that uses
one has no terrain list at all; the picture is drawn at column 304 of the
1584 pixel wide world.
