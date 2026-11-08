# assets/original/ - původní data hry

**Nic v tomhle adresáři se necommituje** (`.gitignore`: `assets/original/*`,
výjimka jen tenhle README). Data Lemmings jsou chráněná autorským právem;
do repozitáře patří nástroje, které je rozbalují, a formáty zapsané
v `NOTES.md`.

## Jak je to uspořádané (uklizeno 2026-09-14)

```
assets/original/
  README.md     jediný commitovaný soubor
  game/         44 souborů Psygnosis — data hry a její EXE  ← sem koukají nástroje
  scene/        26 souborů, které přidala scéna (krak, trenér, texty) — hra je nečte
  archives/     lemmings.zip + lemmings.img, jak dávky přišly
```

Dělicí čára je **původ**, ne „čte / nečte": v `game/` je jen to, co vylisoval
Psygnosis v roce 1991. Jediná výjimka opačným směrem je `lemmings.bat` —
původní dispatcher, ale krak v něm přesměroval volání na `lem*.com`, takže
leží v `scene/`.

**Datace je obnovená z obrazu ★**: plochá dávka měla všude 1996-12-24, obraz
FAT16 nese původní časy, a soubory shodné s obrazem (46 ze 70) je zase mají —
grafika 1991-03-31, `main.dat` 1991-04-22, úrovně a zvuk 1991-04-30,
EXE 1991-05-10. Rozbor v `../../sources/docs/original_files.md`, kde je i
**soupis všech souborů s velikostí, datem, hashem a popisem**.

### `game/` — co je k čemu

| soubor | co v něm je | pro milník |
|---|---|---|
| `vgalemmi.exe` | **hra pro VGA** (PKLITE) — tabulky pořadí úrovní, konstanty fyziky | L2, L3 |
| `main.dat` | animace lemmíků, **masky destrukce**, panely, fonty, menu | L2, L4 |
| `level000.dat`…`level009.dat` | 80 záznamů úrovní, 2048 B každý | L2 |
| `oddtable.dat` | 80 × 56 B — z 80 záznamů dělá 120 úrovní | L2, L7 |
| `vgagr0.dat`…`vgagr4.dat` | bitmapy terénu a objektů pěti grafických sad | L2 |
| `ground0o.dat`…`ground4o.dat` | popisy sad, spouště, palety — **nekomprimované**, 1 056 B | L2 |
| `vgaspec0.dat`…`vgaspec3.dat` | celý terén čtyř zvláštních úrovní | L2 |
| `adlib.dat` | zvukový ovladač AdLibu — efekty i hudba | L6 |
| `autodet.exe`, `install.exe` | dobový start a instalace — předloha pro `DOSBootModel` | L7 |
| `cga*`, `tga*`, `tandysnd.dat` | CGA/Tandy varianty — **mimo rozsah**, ať tu zůstanou |

### `scene/` — čeho si všímat

Krakové zavaděče `lem*.com`, `russell.dat`/`russell.var`/`lemmi.bat`, trenér
(`flr.exe`, `lemcrue.com`, `crue.inf`) a texty. **Nástroje sem nesahají.**
Dvě pasti v textech:

- `lemming.cod` a `lemmings.cod` jsou **dva seznamy hesel, které si
  odporují**; `lempass.txt` je vůbec k Lemmings 2. Jako autorita nepoužívat.
- `lemming.doc` a `lem1.doc`…`lem4.doc` jsou přepis manuálu od scény —
  zdroj z třetí ruky, popisuje spíš Amigu. Autorita je sken originálu
  v `../../sources/docs/manual.md`.

## Edice — určeno ★

**DOS Lemmings 1991**, krakovaná kopie The Humble Guys (druhé, opravené
vydání kraku). Doloženo shodou dvou nezávislých dávek, datováním souborů
v obrazu první dávky a rozborem obsahu. Hashe:

```
cd assets/original && sha256sum -c ../../sources/docs/original_files.sha256
```

## Kde to hledají nástroje

| nástroj | čte | píše |
|---|---|---|
| `tools/dumpdat.mjs` (L1, L2) | `assets/original/game/*.dat`, `game/vgalemmi.exe` | `data/` |
| `tools/checkdat.mjs` (L1) | totéž | — |

Jména souborů jsou **malými písmeny** (v obrazu první dávky byla velkými) —
nástroje ať se na velikost písmen nespoléhají.

Rozbalené výstupy jdou do `data/` — **před commitem `data/` se ptát**,
je odvozené z dat operátora.
