# NOTES.md — poznatky o formátech a vnitřnostech

Průběžné poznámky k datovým souborům DOS Lemmings. Každý údaj má zdroj;
**`★` značí nález ověřený na skutečných datech nebo na běžícím originálu** —
bez značky je to přepis z cizí dokumentace, zatím neověřený.

Data operátora dorazila 2026-09-14 (`sources/docs/original_files.md`), takže
první `★` tu jsou: ověřené jednorázovým skriptem nad
`assets/original/dos/`, ne ještě nástrojem z L1.

Zdroje, není-li uvedeno jinak: `sources/reference/formats/` (dokumenty
ccexplore, Mindless, rt, staženo 2026-09-14) a `sources/reference/lemmix/`
(Pascal zdroják Lemmixu). Pravidla hry z manuálu jsou v `sources/docs/`.

---

## Obraz a paleta

Hra kreslí **320×200**, ale **jen v 16 barvách** — ne 256, přestože jde
o VGA. Barva pixelu je index 0–15 do šestnáctiprvkové fyzické palety,
jejíž registry se v režimu VGA plní **6bitovými složkami DAC** (jako
`VGAPalette` ve svision, jen prvních 16 registrů).

Dolní polovina palety je pevná, horní se mění podle grafické sady:

| index | v úrovni (VGA) | k čemu |
|---:|---|---|
| 0 | `00 00 00` | černá / průhledná |
| 1 | `10 10 38` | modrá — těla lemmíků |
| 2 | `00 2C 00` | zelená — vlasy |
| 3 | `3C 34 34` | bílá — kůže |
| 4 | `2C 2C 00` | špinavě žlutá — panel |
| 5 | `3C 08 08` | červená — ikona nuke |
| 6 | `20 20 20` | šedá — panel |
| 7 | kopie indexu 8 | **cihly stavitele a minimapa** |
| 8–15 | z `GROUND<n>O.DAT` (nebo `VGASPEC<n>.DAT`) | grafická sada |

Menu a obrazovka s náhledem úrovně mají **druhou paletu** (hnědé, fialové,
zelené; `main.dat` dokument, sekce 2). Ta je v dokumentu zapsaná v 8bitových
složkách (např. `128,64,32`), kdežto in-game paleta v 6bitových — **sjednotit
při zápisu do `data/` na 6 bitů a ověřit na originále**.

Rozvržení obrazovky: **herní okno 320×160** nahoře, **panel 320×40** dole
(sekce 6 `main.dat` je celý pruh 320×40 včetně rámečku minimapy a místa na
stavový řádek). Úroveň je širší než okno a scrolluje se.

## Kontejner `*.DAT` — komprese

Komprimované jsou `LEVEL<nnn>.DAT`, `VGAGR<n>.DAT`, `VGASPEC<n>.DAT`,
`MAIN.DAT`, `CGAMAIN.DAT` a ovladače zvuku (`ADLIB.DAT`).
**`GROUND<n>O.DAT` komprimovaný není.**

Soubor = posloupnost sekcí, každá má 10bajtovou hlavičku:

```
byte  num_bits_in_first_byte    kolik bitů se bere z posledního bajtu dat
byte  checksum                  XOR všech bajtů komprimovaných dat (bez hlavičky)
word  unused1                   0
word  decompressed_data_size
word  unused2                   0
word  compressed_data_size      včetně 10 B hlavičky
```

**`num_bits_in_first_byte` bývá i nula ★** — dokumentace ccexplora to má za
„shouldn't happen", ale `level000`–`003`, `level005`–`007`, `vgagr4`
a `cgagr0` to tak mají. Znamená to, že z posledního bajtu sekce se nebere
žádný bit a proud začíná o bajt dřív. Kdo to neošetří, ty soubory vůbec
nerozpozná jako balené.

Dekomprese je **bitový proud čtený pozpátku** a data se skládají **od
posledního bajtu k prvnímu**: začne se posledním bajtem komprimovaných dat,
z něj se berou bity zprava (LSB první, jen `num_bits_in_first_byte` z nich),
pak předchozí bajt celý, atd. Kódování:

| bity | význam |
|---|---|
| `00 nnn` + n+1 bajtů | 1–8 syrových bajtů |
| `01 mmmmmmmm` | odkaz na 2 bajty, offset = m+1 (max 256) |
| `100 m×9` | odkaz na 3 bajty (max 512) |
| `101 m×10` | odkaz na 4 bajty (max 1024) |
| `110 nnnnnnnn m×12` | odkaz na n+1 bajtů (max 256) do 4096 zpět |
| `111 nnnnnnnn` + n+9 bajtů | 9–264 syrových bajtů |

Odkaz s offsetem menším než délka bloku se **překrývá sám se sebou** — tak
originál kóduje dlouhé běhy stejného bajtu (`110 00001111 000…0` = 16×
předchozí bajt). Kopíruje se odzadu dopředu.

Konec: až je vygenerováno `decompressed_data_size` bajtů.

**Ověřeno na datech operátora ★ (L1):** `tools/lib/datContainer.mjs` rozbalí
**všech 33 balených souborů hry, 123 sekcí, 1 419 732 B**, a **všechny
kontrolní součty XOR sedí**; hlavičky pokrývají soubory přesně, beze zbytku.
Délky: `level*.dat` 8 sekcí po 2048 B, `vgagr0` 30 008 + 47 700, `main.dat`
7 sekcí (21 104 · 388 · 8 384 · 61 968 · 36 080 · 758 · 8 224), `vgaspec0`
34 366, `adlib.dat` 22 125. `ground<n>o.dat` a `oddtable.dat` balené nejsou ★.

Náš packer (zpětný sken, tabulka posledních dvojic) vyjde na **576 346 B
proti 575 014 B originálu, 100,2 %** — u 25 ze 123 sekcí ne delší než
originál. `checkdat.mjs: 520 kontrol, 0 rozdílů`.

**Pro `checkdat.mjs`:** packerů je nekonečně, dekompresor jediný. Kritérium
je tedy „naše balení se rozbalí na stejné bajty", ne shoda bajtů
s originálním balením (ccexplore sám píše, že se u ne-levelových DAT netrefí
na velikost Psygnosis) — stejný závěr jako u Prince of Persia (P1).

## `LEVEL<nnn>.DAT` → 2048 B na úroveň

Každá sekce kontejneru = jedna úroveň, po rozbalení přesně **2048 B**
(formát `.LVL`, dokument rt). **Slova jsou big-endian**, na rozdíl od
`GROUND*O.DAT`.

```
0x0000  word  release rate          0…0xFA
0x0002  word  počet lemmíků         max 0x72 = 114
0x0004  word  kolik zachránit
0x0006  word  časový limit (minuty)
0x0008  8×word počty dovedností     Climber, Floater, Bomber, Blocker,
                                    Builder, Basher, Miner, Digger
0x0018  word  start screen xpos     0…0x04F0, zarovnává se na násobek 8
0x001A  word  grafická sada         0 dirt, 1 fire, 2 squasher, 3 pillar,
                                    4 crystal  (★ hra má jen sady 0–4;
                                    5 brick, 6 rock, 7 snow, 8 bubble
                                    jsou z datadisku Oh No! More Lemmings)
0x001C  word  rozšířená sada        (VGASPEC)
0x0020  32×8B objekty
0x0120  400×4B terén
0x0760  32×4B ocelové oblasti
0x07E0  32B  jméno úrovně (ASCII, doplněno mezerami)
```

- **objekt** (8 B): x (násobek 8, od −16), y (−41…159), id do
  `OBJECT_INFO`, modifikátory `80` = nepřekrývat existující terén,
  `40` = vidět jen tam, kde terén je; druhý bajt `8F` = vzhůru nohama.
- **terén** (4 B): horní nibble x nese příznaky **8 = nepřekrývat,
  4 = vzhůru nohama, 2 = ubrat terén místo přidat** (sčítají se);
  y je 9bitové a přetéká do dalšího bajtu; id 0–63 do `TERRAIN_INFO`.
  Nepoužité bloky jsou `FF`.
- **ocel** (4 B): x i y v krocích po 4 pixelech, `area` = nibble x-rozměr,
  nibble y-rozměr, taky po 4 pixelech; čtvrtý bajt nevyužitý.

**Plocha úrovně je 1584×160 ★** (`Prog.Tools.pas` Lemmixu ji tak zapisuje
a rozsahy v datech sedí). Pozor: pár kusů terénu má x až 4066 — dvanáctibitové
pole to unese a hra je prostě ořízne, není to chyba čtení.

Přesné rozdělení bajtů, ověřené na datech ★ (dokumentace rt je v tomhle
nejednoznačná, Lemmix `Level.Loader.pas` to má stejně):

- **kus terénu** (4 B): `x = ((B0 & 0x0F) << 8) + B1 − 16`, příznaky
  `B0 & 0x80` nepřepisovat, `0x40` vzhůru nohama, `0x20` ubrat;
  `y = znaménkových 9 bitů ((B2 << 1) + (B3 >> 7)) − 4`; `id = B3 & 0x3F`.
- **objekt** (8 B): `x = slovo − 16`, `y` znaménkové slovo, `id = B5 & 0x0F`.
- **ocel** (4 B): `x = ((B0 << 1) + (B1 >> 7)) · 4 − 16`, `y = (B1 & 0x7F) · 4`,
  šířka `(B2 >> 4) · 4 + 4`, výška `(B2 & 0x0F) · 4 + 4`; čtvrtý bajt je vždy 0.
- slovo na `0x1E` je **příznak „super lemming"** (`0xFFFF`, dvojnásobná
  rychlost) ★ — v originálních úrovních nikdy nastavený není.

**Úrovní je v souborech 80, ne 120 ★:** `LEVEL000.DAT`…`LEVEL009.DAT`,
každý 8 sekcí. Zbytek dělá `ODDTABLE.DAT` — **4 480 B = 80 × 56 B** ★,
záznam nese jiné parametry a jméno pro tutéž plochu (první se jmenuje
„This is a non-used duplicate"). Strukturu 56bajtového záznamu rozebrat
v L2.

**Pořadí úrovní není pořadí v souborech.** Hra ho bere z tabulek v EXE
a z `ODDTABLE.DAT` (úrovně, které se mezi edicemi liší); mapování
Fun/Tricky/Taxing/Mayhem → soubor + index je vidět i v konfiguraci
Lemmings.ts (`sources/reference/lemmingsts/public/data/config.json`,
`level.order`, `level.useOddTable`). **Ověřit proti EXE, ne opsat.**

## `GROUND<n>O.DAT` — popis grafické sady (nekomprimovaný)

Pevná velikost **1 056 B ★** = 16×28 + 64×8 + 96, tři části: `OBJECT_INFO[16]` (28 B každý) ·
`TERRAIN_INFO[64]` (8 B každý) · palety. **Slova little-endian.**

`OBJECT_INFO`: `animation_flags` (bit 0 = 0 nekonečná smyčka, 1 = spouštěná),
první snímek a **počet snímků** (bajt 3 — dokumentace mu říká
„end_animation_frame_index", ale je to **počet** ★: východ sady 0 tu má 1
a jeho data jsou opravdu jeden snímek, další objekt začíná o jeden
`frameSize` dál. Kdo čte index, přečte o snímek víc a vleze do dat
následujícího objektu), šířka, výška, `animation_frame_data_size`,
`mask_offset_from_image`, 2× neznámé (CGA/Tandy), obdélník spouště
(`trigger_left*4`, `trigger_top*4−4`, `trigger_width*4`, `trigger_height*4`
vůči levému hornímu rohu objektu **zarovnanému dolů na násobek 4** — hra
vede mapu spouští v rozlišení 4 px), `trigger_effect_id`,
`animation_frames_base_loc`, `preview_image_index` — **taky to není index,
ale adresa** v téže sekci ★, snímek je `(adresa − framesOffset) / frameSize` —,
`trap_sound_effect_id`.

`trigger_effect_id`: 0 nic · 1 východ · 4 spouštěná past (lemmík **zmizí
hned**, to, co je vidět umírat, je animace objektu; ostatní projdou
nezraněni) · 5 utopení · 6 okamžitý rozpad (může zabít víc lemmíků naráz)
· 7/8 jednosměrná zeď vlevo/vpravo · 9 ocel (žádný objekt ji nepoužívá).

**Vchod nemá `trigger_effect_id`** — hra má natvrdo, že vchod je objekt id 0
grafické sady, a natvrdo i bod, ze kterého lemmíci vypadávají. Zjistit
z EXE nebo z Lemmixu, do `data/` jako číslo.

`trap_sound_effect_id` (hex): 00 ticho · 01 výběr dovednosti · 02 otevření
vchodu · 03 „let's go" · 04 přidělení dovednosti · 05 „oh no" · 06 elektroda
· 07 drtič/bodce · 08 „aargh" (splat) · 09 lano/kráječ · 0A dovednost
narazila na ocel · 0B ? · 0C exploze · 0D rotující past / uhlí / plameny ·
0E 10tunové závaží · 0F medvědí past · 10 východ · 11 utopení · 12 poslední
tři cihly stavitele.

`TERRAIN_INFO` (8 B): šířka, výška, `image_loc`, `mask_loc`, neznámé.

Palety na konci: `ega_custom[8]`, `ega_standard[8]`, `ega_preview[8]`,
`vga_custom[8]`, `vga_standard[8]`, `vga_preview[8]`. VGA položka = 3 B po
6 bitech. `*_standard` hra podle ccexplora nepoužívá; `custom` je pro
úroveň, `preview` pro náhled — a **shodné nejsou ★**, aspoň v sadě 0 se liší
(dokumentace tvrdí opak).

## `VGAGR<n>.DAT` — bitmapy sady

Dvě sekce: **první terén, druhá objekty** (ccexplore to měl původně obráceně,
opravil Simon). Bitmapa je **plošinová (planar), 4 bity na pixel** — čtyři
monochromatické roviny za sebou, rovina 0 přidává 1, rovina 1 dvojku, 2
čtyřku, 3 osmičku. Maska je monochromatická, 1 = plný pixel.

U terénu je poslední rovina totožná s maskou (terén používá jen barvy 8–15,
vzduch je 0), a `mask_loc` v `TERRAIN_INFO` na ni skutečně ukazuje — hra
ale masku čte zvlášť a barvu skládá ze všech čtyř rovin.

**Maska je vždycky „pixel ≠ 0" ★** — ověřeno na všech 273 kusech terénu
i všech 540 snímcích objektů pěti sad, takže `data/` ji neukládá a
`app/lem/graphicsSet.js` si ji odvodí. (Než se opravilo čtení počtu snímků,
vycházelo „38 snímků má masku jinou" — byly to snímky přečtené navíc,
z dat sousedního objektu.)

## `VGASPEC<n>.DAT` — celý terén zvláštních úrovní

Po běžné dekompresi jedna sekce: 24 B palety (8 položek VGA → indexy 8–15;
index 7 hra kopíruje z 8), pak 16 B nejspíš EGA palety, a pak **druhá vrstva
komprese** — bajtová, dopředná:

| bajt | význam |
|---|---|
| `0x00`–`0x7F` | n+1 syrových bajtů následuje |
| `0x81`–`0xFF` | běh: délka = 0x101 − bajt (`0xFF` = 2, `0x81` = 128), pak opakovaný bajt |
| `0x80` | konec sekce |

Výstup jsou **4 sekce po 14 400 B ★** (ověřeno ve všech čtyřech
`vgaspec*.dat`), každá 40 řádků bitmapy **960×160**,
uložené jako **3bitová plošinová** bitmapa; barvy se mapují 0→0, 1–7→9–15.
Terén takové úrovně je celý odtud a **seznam terénu je v záznamu úrovně
prázdný ★** (přesně u těch čtyř úrovní z osmdesáti, které mají
`specialSet > 0`). Umístění: **sloupec 304 ★**, ne na střed (ten by byl
312) — `DrawSpecialBitmap` Lemmixu; ccexplore si v dokumentu není jistý.

## `MAIN.DAT` — společná grafika

Po dekompresi **7 sekcí ★**:

| sekce | obsah |
|---:|---|
| 0 | animace lemmíků |
| 1 | číslice odpočtu exploze + **masky destrukce terénu** |
| 2 | panel a fonty pro režim „PS/2 / High performance" |
| 3 | hnědé pozadí, logo, cedule menu (F1–F4), ikony hudby a FX |
| 4 | fialový font, mrkání očí, běžící text (reel), cedule obtížností |
| 5 | **neznámá** — nulování nic viditelně nemění; shodná v `MAIN.DAT` i `CGAMAIN.DAT` |
| 6 | panel a zelený font pro běžný režim „PC Compatible" |

Sekce 0 — animace (šířka×výška, počet snímků, bpp), offsety v dokumentu
`lemmings_main_dat_file_format.txt`: chůze 8 sn. 16×10 2bpp · „jumping"
(krok o 3–6 px nahoru) 1 sn. · kopání 16 sn. 16×14 3bpp · lezení 8 sn.
16×12 · topení 16 sn. · dolezení 8 sn. · stavění 16 sn. 16×13 3bpp ·
bourání 32 sn. (**dva údery na 32 snímků**) · kutání 24 sn. 16×13 ·
pád 4 sn. · otevírání deštníku 4 sn. 16×16 + plachtění 4 sn. · splat 16 sn.
· východ 8 sn. · uhoření 14 sn. 16×14 4bpp · blokování 16 sn. · krčení
ramen 8 sn. · „oh no" 16 sn. · exploze 1 sn. 32×32. Vlevo/vpravo jsou
zvlášť. Částice po explozi kreslí hra sama, u kopání/bourání/kutání jsou
částice součástí snímků.

Sekce 1 — **masky, kterými dovednosti ubírají terén** (1 = pixel pryč):
bourání 4 sn. 16×10 vlevo i vpravo, kutání 2 sn. 16×13, exploze 1 sn.
16×22; pak font číslic 8×8 pro odpočet. **Tohle jsou data pro L4, nesmí se
opisovat do kódu.**

Sekce 2 a 6 — panel 320×40 4bpp, font 8×16 pro stavový řádek (znaky
`% 0–9 - A–Z`, offset `base + 0x30*i`), číslice dovedností 8×8 ve variantě
vlevo/vpravo (číslice je jen 4 px široká, dvojciferné číslo se skládá).
**Který panel se použije, závisí na typu stroje zvoleném při startu** (viz
manuál: „PC Compatible/Tandy" = sekce 6, „PS/2 / High Performance" =
sekce 2). Remake volí jeden a zapíše který.

## Zvuk — ovladač AdLibu ★

**V DOS Lemmings nejsou žádné samply.** Všechno, co je slyšet — dvacet
skladeb i osmnáct efektů — jsou programy pro **YM3812 (OPL2)** uvnitř
`adlib.dat` (po rozbalení 22 125 B). Ovladač je „sound image": vpředu
tabulky (nástroje, frekvence, oktávy, konfigurace kanálů), pak dvě tabulky
ukazatelů — na skladby a na efekty — a za nimi proudy bajtů, které ovladač
prochází, zapisuje registry čipu a čeká.

Offsety tabulek (z konfigurace Lemmings.ts, ověřené na našich datech —
všech 38 ukazatelů padne dovnitř souboru):

| tabulka | offset |
|---|---:|
| konfigurace kanálů | 1452 |
| data | 2215 |
| frekvence | 2343 |
| oktávy | 2727 |
| počet frekvencí | 2823 |
| **ukazatele skladeb** (20) | 2926 |
| data efektů | 21731 |
| **ukazatele efektů** (18) | 21989 |

**Ukazatele jsou little-endian ★** — Lemmings.ts svou čtecí metodu jmenuje
`readWordBE`, ale čte LE; jako BE ukazují daleko za konec souboru.

**Čísla zvuků 1–18 jsou tatáž, jaká nesou grafické sady u pastí**
(`trap_sound_effect_id`), index v ovladači je číslo mínus jedna (ověřit
poslechem): 1 výběr dovednosti · 2 otevření poklopu · 3 „let's go" ·
4 přidělení dovednosti · 5 „oh no" · 6 elektroda · 7 drtič · 8 rozplácnutí ·
9 kráječ · 10 ocel · 11 ? · 12 exploze · 13 oheň · 14 desetitunové závaží ·
15 medvědí past · 16 východ · 17 utopení · 18 poslední cihly stavitele.

**Hra si o zvuk jen řekne a jde dál** — nezná jeho délku ani jestli hraje.
Průlet tak zůstává funkcí úrovně a vstupů (R-009).

**Program kanálu** (jak ho ovladač čte): bajt pod 0x80 je **nota** (zapíše
frekvenci a klíč), 0xE0 a výš nastaví **délku** not (`bajt − 0xDF`), 0xC0 a výš
vybere **nástroj**, a zbytek jsou příkazy podle spodního nibblu: 0 skok do
seznamu vzorů (nula v seznamu = skok na jeho jiné místo, tak se skladba
zacyklí), 1 pustit notu a čekat, 2 držet a čekat, 3 konec skladby,
4 transpozice, 5 konec kanálu, 6 a 7 glissando nahoru a dolů, 8 hlasitost.

**Nástroj je 16 bajtů**: útok/pokles obou operátorů, držení/uvolnění, tvar
vlny, propojení (0xC0), modulace (0x20), transpozice, dva bajty pro hlasitost
a bajt, po kolika krocích se nota pouští.

**Frekvence** se skládá ze dvou tabulek: nota (plus transpozice) vybere oktávu
a index do tabulky frekvencí po 32 bajtech; když nejvyšší bit frekvence není
nastavený, oktáva se sníží; záporná oktáva se vyrovná zdvojením frekvence.

**Co stálo za falešnými stopami při ladění zvuku ★** (všechno chyby v našem
čipu, ne v datech): výška počítaná z hodinového kmitočtu místo z vzorkovací
frekvence; zaokrouhlování při převodu vzorkovací frekvence nahoru (čip běžel
2×); zpětná vazba dvakrát silnější, než má být; a **fáze oscilátoru, která
nepřetékala** — po pár sekundách v desítkách milionů radiánů, kde `Math.sin`
nemá na zlomek otáčky přesnost.

**Tempo ovladače ★:** `sampleRateFactor` **je dělitel do časovače PC** —
ovladač běží `1 193 182 / sampleRateFactor` krát za sekundu, tedy u skladeb
hry 72,8 · 70,6 · 68,5 Hz (faktory 16384, 16896, 17408). Změřeno: s tímhle
vyjde perioda rytmu skladby 5 na **0,836 s, přesně jako v nahrávce
originálu** téže skladby (Pachelbelův kánon; kterou z dvaceti to je, poznal
operátor). Popis formátu dělí faktor 210 a mluví o vzorcích — to běží víc než
dvakrát rychleji.

**Změřeno proti nahrávce originálu ★** (`tools/matchmusic.mjs`,
`sources/media/sound/`): **AdLib karta má na výstupu dolní propust** — bez ní
je model čipu jasnější než skutečná karta (těžiště spektra 5,5 kHz a 48 %
energie nad 2 kHz proti 4,4 kHz a 43 %) a zní „pilovitě"; **jednopólová
propust na 10 kHz** sedí na obě čísla.
**Tempo** je `sampleRateFactor/210` vzorků na krok: perioda rytmu vyjde
0,859 s proti 0,836 s originálu. **Noty jsou ve správné oktávě bez posunu**,
takže bajt 8 nástroje se k notě nepřičítá.

**Bajt 8 nástroje je transpozice a přičítá se ★** — ověřeno měřením proti
nahrávce téže skladby (97,9 % shoda poloh not proti 77 % při ignorování).
Měřit se dá **jen proti stejné skladbě**: proti jiné vycházejí všechna čtení
stejně, protože hrubé profily jsou u tonální hudby skoro totožné.

★ **Co zůstává neznámé:**

1. **Jak často ovladač běží** — bereme `sampleRateFactor / 210` vzorků čipu
   mezi kroky (empirická hodnota z Lemmings.ts).
2. **Co dělá s notou bajt 8 nástroje.** Popis formátu říká „transpozice, která
   se přičte", jenže hodnoty v datech nejsou hudební intervaly (−1, −50, −32,
   −10) a **při přičtení vyjdou všechny noty na 25–52 Hz**, tedy pod hranicí
   slyšitelnosti. Když se **odečte**, melodie sedí do 78–988 Hz; když se
   **ignoruje**, je o oktávu níž. `tools/rendersound.mjs --variants` udělá
   všechny tři varianty vedle sebe.

**Tabulky nót jsou ověřené ★:** oktávová tabulka je 96 hodnot (8 oktáv po 12),
indexová 0–11 dokola, a frekvenční tabulka po 32 bajtech dá přesný
chromatický půltón — **nota 53 vyjde na 440,0 Hz**, tedy komorní a.

## Zvuk

Efekty i hudba jdou přes ovladač v `ADLIB.DAT` (a sourozencích pro ostatní
karty) — je to komprimovaný DAT jako ostatní. Lemmings.ts si do konfigurace
zapsal offsety uvnitř toho ovladače (`audio.dataOffset`,
`audio.frequenciesOffset`, `audio.instructionsOffset`,
`audio.soundIndexTablePosition`, `audio.numberOfTracks: 20`) —
**neověřeno, pro nás zatím jen vodítko, kde hledat**.

Pozor na licenci: Lemmings.ts má OPL emulaci portovanou z **DOSBoxu (GPL)**
(`src/game/resources/sound/DBOPL/`) — přesně to, co R-029 zakazuje
přebírat. Jeho ostatní kód je MIT. Vlastní OPL2 se musí psát podle
datasheetu YM3812.

## Skládání úrovně (L2) ★

Kusy terénu se kreslí **v pořadí seznamu** a modifikátory znamenají:

| příznak | co dělá |
|---|---|
| bez příznaku | kde je kus plný, zapiš barvu a označ terén |
| nepřepisovat (`0x80`) | totéž, ale jen kde ještě terén není |
| ubrat (`0x20`) | kde je kus plný, **smaž** pixel i terén |
| vzhůru nohama (`0x40`) | kus se před kreslením překlopí svisle |

Nepřepisovat vyhrává nad ubrat, když jsou oba. Potom se kreslí objekty ve
**dvou průchodech**: nejdřív ty s příznakem „jen přes terén", pak ostatní
(`RenderWorld` Lemmixu). Objekty **maskou terénu nehýbou** — lemmík
východem prochází, nestojí na něm. Ve statickém obrázku úrovně má každý
objekt svůj `previewFrame`.

## Fyzika (L3)

Čísla a postupy, které v žádném popisu formátů nejsou — jsou to pravidla
hry, ne dat. Zdroj je `Game.pas` Lemmixu, dokud je nepotvrdí zlatý záznam
(`sources/media/physics/`); proto tu zatím `★` **nejsou**, i když jsou
v kódu reprodukované přesně.

**Čas a start**

- **17 snímků za sekundu**; hodiny úrovně ubírají sekundu vždy po 17 snímcích
  (`fClockFrame >= 17`).
- snímek 15: „let's go"; **snímek 35: otevření vchodu**; snímek 55: hudba.
- první lemmík: odpočet **20** snímků, další po **`(99 − rate)/2 + 4`**
  snímcích celočíselně — proto rychlost 99 a 98 vypadá stejně.
- lemmík vypadává na `x = vchod.x + 24`, `y = vchod.y + 14`, směrem doprava,
  ve stavu `falling`.
- pořadí vchodů u víc vchodů: `released mod 4` do tabulky — dva vchody
  **ABAB**, tři ABCB, čtyři ABCD. (Lemmix zná i variantu ABBA jako volitelnou
  mechaniku — **otevřená otázka**, rozhodne zlatý záznam.)

**Chůze**

1. `x += směr`; mimo `0…1647` = otočka.
2. Je-li pod nohama plný pixel, zkouší se stoupat: dokud je plný pixel nad
   ním, až **6 pixelů**. Víc než 6 = zeď (climber leze, jinak otočka).
   **3 a víc** = poskok (`jumping`, `y -= 2`).
3. Není-li pod nohama nic, klesá se o **1 až 3** pixely; pod to se padá.
4. `y > 163` = pád pod svět, lemmík mizí bez zvuku.
5. Hlava nad `-5` (`HEAD_MIN_Y`): lemmík se srazí zpátky a otočí.

**Pád**

- padá se po **3 pixelech za snímek**, spadlá výška se sčítá;
- **nad 60 spadlých pixelů** dopad zabije (`splatting`);
- **po 16 spadlých** se deštník otevře, má-li ho lemmík.

**Animace objektů**

**Ve hře se do světa nezapékají žádné objekty ★** — svět je jen terén
a všechny objekty se kreslí přes něj **každý snímek**, ve dvou průchodech
(nejdřív ty „jen přes terén", pak ostatní). Zapečený stojící snímek má jen
**náhled úrovně**; v Lemmixu je to totéž rozlišení (`RenderWorld(fWorld,
False)` ve hře, `True` v náhledu). Když se objekty zapečou i do herního
světa, prosvítá stojící snímek pod pohyblivým: poklop vypadá od začátku
otevřený a jeho spodek zůstane hnědý místo modrého průhledu (hlášení
operátora 2026-09-14).

Jak se animace posouvají:

- **objekt začíná na svém `start_animation_frame_index`** z `ground<n>o.dat`,
  ne na nule ★. U všech objektů je to 0, **u poklopu 1**.
- **poklop** (objekt id 1): do snímku 35 stojí na snímku 1, ve snímku 35 se
  spustí, běží snímky 1…9 a skončí na **snímku 0**. Vypadá to jako chyba,
  dokud se člověk nepodívá na obrázky ★: **snímek 0 je poklop otevřený**
  (dveře visí po stranách), **snímek 1 zavřený** (plné víko) a 2…9 je jeho
  otvírání. Proto se originál po animaci vrací na nulu a poklop zůstane
  otevřený. Kdo bere nulu za výchozí stav, ukáže na začátku otevřený poklop,
  který se pak „zavře a znovu otevře" (hlášení operátora 2026-09-14);
- **průběžné** objekty (voda, plameny, vlajky, šipky) se točí pořád;
- **pasti** (příznak „spouštěná animace") běží jen po spuštění a samy se
  zastaví, až animace dojede.

**Objekty pod nohama** (mapa v rozlišení 4 px, jako originál)

`exit` (kromě padajícího lemmíka) · `drown` · `disintegrate` (uhoření) ·
jednosměrné zdi otáčejí · **spouštěná past lemmíka odstraní hned** a to,
co je vidět umírat, je animace pasti, ne lemmík; past se spustí jen jednou.

**Chyba originálu, která se reprodukuje**

Lemmík, který se rozplácne (`splatting`), **ještě týž snímek dostane slovo
od objektů pod sebou** — takže když se rozplácne přesně na východu, počítá
se jako zachráněný („direct drop to exit"). Lemmix to má okomentované jako
chybu DOS verze; my ji taky neopravujeme.

## Panel (L5) ★

Panel je **sekce 6** `main.dat`, 320×40, 4 bity na pixel, a hned za ním v téže
sekci je **stavový font 8×16** (3 bity, 38 glyfů v pořadí `%`, `0`–`9`, `-`,
`A`–`Z`, po 0x30 bajtech od 0x1900). **Číslice nad tlačítky** jsou jinde —
v sekci 2 od 0x1900, 8×8 jednobitové, každá číslice **dvakrát**: jednou
s číslicí na pravé půlce, jednou na levé, aby se dvojciferné číslo složilo ze
dvou půlek.

Rozvržení:

| co | kde |
|---|---|
| stavový řádek | 40 znaků od (0,0) panelu; pole 1–14 kurzor, 15–23 `OUT n`, 24–31 `IN n%`, 32–40 `TIME m-ss` |
| tlačítka | první (1,16), velikost 14×22, krok 16 px; pořadí `-`, `+`, climber, floater, bomber, blocker, builder, basher, miner, digger, pauza, nuke |
| počty nad tlačítky | (index·16 + 4, 17), dvě půlčíslice po 4 px |
| minimapa | (208,18), 104×20; terén zmenšený 16× na šířku a 8× na výšku, rámeček výřezu 25 bodů |

## Dovednosti (L4)

Zdroj je opět `Game.pas` Lemmixu, potvrdí to až zlatý záznam.

| dovednost | co dělá po snímcích |
|---|---|
| **Climber** | snímky 0–3 kouká, jestli je blízko vrchol (`y − 7 − snímek`), pak `hoisting`; dál stoupá o 1 px za snímek, převis ho shodí dozadu (otočka, `x += 2·směr`) |
| **Hoisting** | snímky 0–4 zvedne o 2 px, na konci animace jde |
| **Floater** | tabulka 16 kroků: první čtyři ještě padá po 3 px (deštník se otvírá), pak klesá po 2 px; po šestnáctém kroku se vrací na devátý |
| **Bomber** | odpočet **79** snímků; kdo padá, plachtí, topí se nebo hoří, přeskočí „oh no" a vybuchne rovnou; exploze nevyřízne díru v oceli ani ve vodě |
| **Blocker** | zapíše do mapy objektů 3×3 buňky po 4 px (vlevo „otoč doleva", uprostřed „blocker", vpravo „otoč doprava"); když mu zmizí zem pod nohama, jde dál a mapu vrátí, jak byla |
| **Builder** | **12 cihel**; na snímku 9 položí cihlu 6 px v barvě 7, na snímku 0 udělá krok nahoru a dva vpřed; naráz-do-hlavy nebo zeď před ním ho otočí; po poslední cihle pokrčí rameny |
| **Basher** | snímky 2–5 každého ze dvou úderů vyříznou masku; snímky 11–15 posun o 1 px; na snímku 5 se dívá 4 px dopředu — prázdno znamená prorazil |
| **Miner** | masky na snímcích 1 a 2, na snímcích 3 a 15 dva kroky vpřed (na 3 i o pixel dolů) |
| **Digger** | řada **9 px** (od `x − 4`) na snímcích 0 a 8; první snímek vyhloubí dvě řady naráz; když není co ubrat, padá |

**Snímky si posouvá hra sama jen u dvou akcí ★** — kopání a plachtění. Kdo
jim posouvá snímek i automaticky (jako u ostatních akcí), kopáč nikdy
nekopne, protože jeho čítač přeskočí nuly.

**Chyby originálu, které se reprodukují ★**

- **jednosměrná zeď doprava nejde vykutat ani jedním směrem** — kontrola
  v kódu u kutání nemá v sobě směr lemmíka;
- **stavitel, který vyleze moc vysoko, se nezastaví otočkou, ale stane se
  chodcem** — kontrola stropu selže kvůli jinému bodu nohou nové animace.

## Fyzika podle manuálu (nezávisle na kódu)

- Lemmík umře pádem z výšky „asi 80 pixelů" (manuál) — **skutečná mez je
  konstanta v kódu hry, změřit**; s deštníkem přežije jakýkoli pád.
- Climber a Floater jsou trvalé vlastnosti (obojí naráz = „Athlete").
- Stavitel má **12 cihel**, staví vždy pod stejným úhlem nahoru; před
  koncem cvakne (zvuk 0x12), po posledním pokrčí rameny a jde dál.
- Basher přestane, když prorazí; když narazí na ocel, otočí se.
- Blocker stojí, dokud ho někdo neodstřelí.
- Bomber: odpočet **5**, pak „oh no" a exploze (maska 16×22).
- Pravé tlačítko při přidělování: dovednost dostane **jen Walker**.
- Release rate 1–99, **nedá se snížit pod startovní hodnotu úrovně**.
- Čas: po vypršení se úroveň vyhodnotí podle procenta zachráněných.

Skutečná čísla (počty snímků na krok, mez stoupání, rychlost pádu,
pořadí lemmíků v rámci snímku) **patří vzít z běžícího originálu, ne
z manuálu** — pro to je L3.
