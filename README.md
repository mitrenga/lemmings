# lemmings

Browser remake of **Lemmings** (DMA Design / Psygnosis, 1991) on the svision
library, VGA platform, 320x200 in 16 colours out of the VGA palette,
mouse-driven. The remake
targets the **first PC release** (DOS, VGA), not the Amiga original and not
any later port. The brief and the fidelity target are in `ZADANI.md`, the
milestones in `MILNIKY.md`, the format findings in `NOTES.md` (all three in
Czech, as the project's working documents are).

Two things make this one different from the other DOS remakes here: the view
**scrolls** over a level 1584 pixels wide, and the world is a **destructible
bitmap** rather than a grid of tiles - the skills cut the terrain away pixel
by pixel, so the terrain mask is game state and gets compared like any other.

## Status

M0 and L1 done, L2 to L6 written (2026-09-14). `checkdat.mjs: 2310 checks, 0
differences` over the containers, the five graphics sets and all eighty level
records, and `renderlevel.mjs --all` draws every level of the game into
`build/levels/`. L2 is not closed yet: its acceptance is `matchlevel.mjs`
against DOSBox screenshots, which the operator has to take (see
`sources/media/levels/README.md`).

## Original data

The game needs the files of a legally bought DOS copy. Put them into
`assets/original/` - the list and the edition check are in
`assets/original/README.md`. They never enter the repository.

## Running

Like every svision project: `index.php` -> `app/svision/php/main.php`,
`config/config.php` with `$devMode = true`, no build step. The game data have
to be decoded first - `node tools/dumpdat.mjs` writes what the game reads into
`data/`. **The page has never been opened in a browser yet**; everything so
far was verified under Node.

## Tools

| tool | what it does |
|---|---|
| `tools/lib/datContainer.mjs` | the DAT compression of the game, both ways, plus the second layer of the special graphics - L1 |
| `tools/dumpdat.mjs` | splits every DAT container into its sections under `build/dat/` with a manifest - L1 |
| `tools/checkdat.mjs` | round trip of unpacker and packer over every section, plus synthetic self tests - L1 |
| `tools/lib/planarBitmap.mjs`, `groundSet.mjs`, `levelRecord.mjs`, `specialGraphics.mjs` | the decoders of the graphics sets, the level records and the special levels - L2 |
| `tools/renderlevel.mjs` | builds a level into a 1584x160 image through the game's own code - L2 |
| `tools/matchlevel.mjs` | our render against DOSBox screenshots, with self tests - L2 |
| `tools/tracelem.mjs` | runs a level headless and records every lemming frame by frame - L3 |
| `tools/matchlem.mjs` | that record against a golden one, field by field - L3 |
| `tools/lemmixlog.mjs` | turns a Lemmix log into a golden record - L3 |
| `tools/scripts/*.json` | scripted runs: which skill is given where and when - L4 |
| `tools/tracelem.mjs` | records our lemmings frame by frame - L3 |
| `tools/matchlem.mjs` | that record against the golden one - L3..L6 |
| `tools/matchpanel.mjs` | the panel against DOSBox screenshots, with self tests - L5 |
| `tools/dumpsound.mjs` | takes the AdLib driver apart: 20 music tracks and 18 effects - L6 |
| `tools/rendersound.mjs` | plays a track or an effect through our OPL2 and writes a WAV - L6 |
| `tools/matchmusic.mjs` | measures our sound against a recording of the original: pitch, tempo, brightness - L6 |

## Sources

`sources/README.md` - where from, when, with which hash.

## ⚠ Open issue — game data (data/)

The game's data in `data/` is derived from the original and is **not in git**
(`.gitignore`): every machine generates it from the operator's copy with the
project's `dump*` tools. Before the project moves on, decide and document:

1. **Storage** — where the data lives on the server, in what format and size,
   how it is produced from the original and how its completeness and
   correctness are verified (`SHA256SUMS`, `check*`).
2. **Versioning** — how a data set is tied to the version of the game and of
   the tools that produced it, when the files themselves are not versioned
   (a manifest with hashes and the dump version).
3. **Loading** — how the game loads it (all at once or on demand, through
   `appData` or directly), and what happens when a file is missing.
4. **Caching** — the browser and the service worker (precache or on demand,
   invalidation by version); `localStorage` is only a cache of server data
   and may be wiped at any time.

Raised 2026-11-08 for every project whose data is outside git.
