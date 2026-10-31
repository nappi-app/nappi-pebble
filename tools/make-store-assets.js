// Renders the appstore icons from art/nappi-logo.png into store/. Needs: npm i --no-save @resvg/resvg-js
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const logo = fs.readFileSync(path.join(__dirname, '..', 'art', 'nappi-logo.png')).toString('base64');
// The logo is already a full-bleed square on black, so it scales straight to the icon sizes.
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><image href="data:image/png;base64,' +
  logo + '" width="512" height="512"/></svg>';
for (const [name, size] of [['icon-small', 80], ['icon-large', 144]]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path.join(__dirname, '..', 'store', name + '.png'), png);
  console.log('wrote', name + '.png', size + 'px');
}
