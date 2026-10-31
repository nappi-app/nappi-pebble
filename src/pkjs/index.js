// PebbleKit JS entry point: wires the Pebble runtime (AppMessage, Clay,
// localStorage, XHR, timers) into the engine. Logic lives in app.js.

const Clay = require('pebble-clay');
const messageKeys = require('message_keys');
const { createApp } = require('./app');
const { createClient } = require('./api');
const { createSettings } = require('./settings');
const { createXhrTransport } = require('./xhr-transport');
const { prefillFor } = require('./config');
const { toWire } = require('./wire');
const { uuidv4 } = require('./uuid');

function log(err) {
  console.log('nappi-pebble: ' + (err && err.message ? err.message : err));
}

const settings = createSettings(localStorage);
const transport = createXhrTransport();

const app = createApp({
  settings,
  storage: localStorage,
  now: () => Date.now(),
  offsetAt: (ms) => -new Date(ms).getTimezoneOffset(),
  uuid: () => uuidv4(),
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (handle) => clearTimeout(handle),
  log,
  makeClient: (s) => createClient({ baseUrl: s.baseUrl, token: s.token, transport }),
  sendToWatch: (dict) => new Promise((resolve, reject) => {
    Pebble.sendAppMessage(toWire(dict, messageKeys), resolve, (e) => {
      reject(new Error('AppMessage failed: ' + JSON.stringify(e)));
    });
  })
});

// Clay registers its widgets from the config it is constructed with, so a
// fresh instance is made per settings page rather than reusing one.
let clay = null;

Pebble.addEventListener('ready', () => {
  app.start().catch(log);
});

Pebble.addEventListener('appmessage', (e) => {
  if (!e || !e.payload) return;
  Promise.resolve().then(() => app.onMessage(e.payload)).catch(log);
});

Pebble.addEventListener('showConfiguration', () => {
  app.prepareConfig().then((config) => {
    clay = new Clay(config, null, { autoHandleEvents: false });
    clay.setSettings(prefillFor(config));
    Pebble.openURL(clay.generateUrl());
  }).catch(log);
});

Pebble.addEventListener('webviewclosed', (e) => {
  if (!e || !e.response) return;
  const parser = clay || new Clay([], null, { autoHandleEvents: false });
  Promise.resolve().then(() => app.handleConfigClosed(parser.getSettings(e.response, false))).catch(log);
});
