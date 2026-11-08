const { VGAPlatform } = await import('./svision/js/platform/canvas2D/vga/vgaPlatform.js?ver='+window.srcVersion);
// begin code

/**
 * The machine Lemmings ran on: a PC with a VGA card, 320x200 on a 4:3
 * monitor - pixels 1.2 times taller than wide - and a black border (R-029).
 * The game itself uses only sixteen of the 256 palette registers.
 */
export function appPlatform() {
  return new VGAPlatform({
    width: 320,
    height: 200,
    pixelAspect: 1.2,
    minimalBorder: 0
  });
} // appPlatform
