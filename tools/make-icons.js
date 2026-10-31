// Renders art/icons/*.svg (24px line icons from the nappi app) to 1-bit PNGs in resources/icons/,
// and the launcher menu icon from art/nappi-logo.png.
// Needs: npm i --no-save @resvg/resvg-js pngjs
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { PNG } = require('pngjs');

const SRC = path.join(__dirname, '..', 'art', 'icons');
const OUT = path.join(__dirname, '..', 'resources', 'icons');
const SIZE = 24;
const MENU_SIZE = 25;   // the launcher's menu icon, a 1-bit silhouette of art/nappi-logo.png
const MENU_CUTOFF = 60; // luminance at or above this is ink; lower keeps the gap between moon and baby open

function render(file, size, outName) {
  const svg = fs.readFileSync(path.join(SRC, file));
  const raw = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render();
  const src = PNG.sync.read(raw.asPng());
  const out = new PNG({ width: size, height: size });
  // Anti-aliasing turns to mush on e-paper: keep a pixel if it is at least half covered.
  for (let i = 0; i < size * size; i++) {
    const on = src.data[i * 4 + 3] >= 128;
    out.data.set(on ? [0, 0, 0, 255] : [0, 0, 0, 0], i * 4);
  }
  fs.writeFileSync(path.join(OUT, outName), PNG.sync.write(out));
  console.log('wrote', outName);
}

for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith('.svg'))) {
  render(file, SIZE, file.replace('.svg', '.png'));
}

// The logo is light shapes on black: shrink it, then keep the bright pixels as ink.
const logo = fs.readFileSync(path.join(__dirname, '..', 'art', 'nappi-logo.png')).toString('base64');
const wrapped = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><image href="data:image/png;base64,' +
  logo + '" width="512" height="512"/></svg>';
const small = PNG.sync.read(new Resvg(wrapped, { fitTo: { mode: 'width', value: MENU_SIZE } }).render().asPng());
const menu = new PNG({ width: MENU_SIZE, height: MENU_SIZE });
for (let i = 0; i < MENU_SIZE * MENU_SIZE; i++) {
  const lum = 0.299 * small.data[i * 4] + 0.587 * small.data[i * 4 + 1] + 0.114 * small.data[i * 4 + 2];
  menu.data.set(lum >= MENU_CUTOFF ? [0, 0, 0, 255] : [0, 0, 0, 0], i * 4);
}
fs.writeFileSync(path.join(OUT, 'menu-icon.png'), PNG.sync.write(menu));
console.log('wrote menu-icon.png');
