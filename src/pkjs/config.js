// Clay settings page: the config array handed to Clay, and the parser for
// what comes back. Everything stays on the phone; nothing here is sent to
// the watch.

const { DEFAULTS, isAllowedBaseUrl } = require('./settings');
const { resolveActiveBaby } = require('./babies');
const { NAPPI_DOCS_URL } = require('./protocol');

const NO_BABIES_HINT = 'Enter your API token and save, then reopen these settings to choose a baby. ' +
  'See the <a href="' + NAPPI_DOCS_URL + '">nappi API documentation</a> for how to get one.';

// Default grid order (nappi's own: Sleep, Nursing, Bottle, Diaper, then ours); also the tie-break when two tiles share a position.
const ACTION_ORDER = ['sleep', 'nursing', 'bottle', 'diaper', 'pump', 'potty'];
const ACTION_LABELS = {
  diaper: 'Diaper', bottle: 'Bottle', nursing: 'Nursing', sleep: 'Sleep', pump: 'Pump', potty: 'Potty'
};
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
const BOTTLE_TYPES = ['formula', 'breast_milk'];

const UNIT_OPTIONS = [
  { label: 'Ounces (oz)', value: 'oz' },
  { label: 'Millilitres (ml)', value: 'ml' }
];

function positionOptions() {
  const options = [{ label: 'Hidden', value: '0' }];
  ORDINALS.forEach((label, i) => options.push({ label, value: String(i + 1) }));
  return options;
}

function buildConfig(options) {
  const settings = options.settings;
  const babies = options.babies;

  const items = [
    { type: 'heading', defaultValue: 'nappi-pebble' },
    {
      type: 'input',
      messageKey: 'token',
      label: 'API token',
      description: 'See the <a href="' + NAPPI_DOCS_URL + '">nappi API documentation</a> for how to create a token. Use a dedicated token for this watch.',
      defaultValue: settings.token,
      attributes: { type: 'password', autocomplete: 'off' }
    }
  ];

  if (babies.length > 0) {
    items.push({
      type: 'select',
      messageKey: 'babyId',
      label: 'Baby',
      defaultValue: resolveActiveBaby(babies, settings.babyId).baby.id,
      options: babies.map((b) => ({ label: b.name, value: b.id }))
    });
  } else {
    items.push({ type: 'text', defaultValue: options.error || NO_BABIES_HINT });
  }

  items.push({
    type: 'select',
    messageKey: 'bottleUnits',
    label: 'Bottle units',
    defaultValue: settings.bottleUnits,
    options: UNIT_OPTIONS
  });
  items.push({
    type: 'select',
    messageKey: 'pumpUnits',
    label: 'Pump units',
    defaultValue: settings.pumpUnits,
    options: UNIT_OPTIONS
  });

  items.push({
    type: 'section',
    items: [{ type: 'heading', defaultValue: 'Home screen tiles' }].concat(
      { type: 'text', defaultValue: 'Pick where each tile goes. Tiles fill the grid four to a page in this order; Status is always last.' },
      ACTION_ORDER.map((action) => {
        const at = settings.layout.indexOf(action);
        return {
          type: 'select',
          messageKey: 'pos_' + action,
          label: ACTION_LABELS[action],
          defaultValue: String(at + 1),
          options: positionOptions()
        };
      })
    )
  });

  items.push({
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Bottles' },
      {
        type: 'select',
        messageKey: 'defaultBottleType',
        label: 'Default bottle type',
        defaultValue: settings.defaultBottleType,
        options: [
          { label: 'Formula', value: 'formula' },
          { label: 'Breast milk', value: 'breast_milk' }
        ]
      }
    ]
  });

  items.push({
    type: 'toggle',
    messageKey: 'exitAfterLog',
    label: 'Exit after logging',
    description: 'Close the app after each logged entry instead of returning to the home screen.',
    defaultValue: settings.exitAfterLog
  });

  items.push({
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Developer' },
      {
        type: 'input',
        messageKey: 'baseUrl',
        label: 'API address',
        description: 'Leave as is unless testing against a mock server. Must start with https://; plain http:// is only accepted for localhost and private network addresses.',
        defaultValue: settings.baseUrl,
        attributes: { type: 'url', autocomplete: 'off' }
      }
    ]
  });

  items.push({ type: 'submit', defaultValue: 'Save' });
  return items;
}

// Clay's page prefers the values it stored last time over defaultValue, so
// the glue overwrites them with these before opening the page.
function prefillFor(config) {
  const values = {};
  (function walk(list) {
    list.forEach((item) => {
      if (item.messageKey) values[item.messageKey] = item.defaultValue;
      if (item.items) walk(item.items);
    });
  })(config);
  return values;
}

function plain(raw) {
  return raw && typeof raw === 'object' ? raw.value : raw;
}

function layoutFrom(response) {
  const placed = [];
  let sawAny = false;
  ACTION_ORDER.forEach((action, order) => {
    const raw = plain(response['pos_' + action]);
    if (raw !== undefined) sawAny = true;
    const pos = parseInt(raw, 10);
    if (pos >= 1) placed.push({ action, pos, order });
  });
  if (!sawAny || placed.length === 0) return null;
  placed.sort((a, b) => (a.pos - b.pos) || (a.order - b.order));
  return placed.map((p) => p.action);
}

// The typed API address, trimmed and without trailing slashes; null when the
// response does not carry one.
function typedBaseUrl(response) {
  const raw = plain(response.baseUrl);
  return typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : null;
}

// The typed API address when it is not allowed (see isAllowedBaseUrl), else null.
// An empty field is allowed: it means "use the default".
function rejectedBaseUrl(response) {
  const baseUrl = typedBaseUrl(response);
  if (baseUrl === null || baseUrl === '' || isAllowedBaseUrl(baseUrl)) return null;
  return baseUrl;
}

function settingsFromClayResponse(response) {
  const patch = {};
  const token = plain(response.token);
  if (typeof token === 'string') patch.token = token.trim();

  const babyId = plain(response.babyId);
  if (typeof babyId === 'string' && babyId) patch.babyId = babyId;

  ['bottleUnits', 'pumpUnits'].forEach((name) => {
    const units = plain(response[name]);
    if (units === 'oz' || units === 'ml') patch[name] = units;
  });

  const baseUrl = typedBaseUrl(response);
  if (baseUrl !== null && rejectedBaseUrl(response) === null) {
    patch.baseUrl = baseUrl || DEFAULTS.baseUrl;
  }

  const layout = layoutFrom(response);
  if (layout) patch.layout = layout;

  const bottleType = plain(response.defaultBottleType);
  if (BOTTLE_TYPES.indexOf(bottleType) >= 0) patch.defaultBottleType = bottleType;

  const exit = plain(response.exitAfterLog);
  if (typeof exit === 'boolean') patch.exitAfterLog = exit;

  return patch;
}

module.exports = { buildConfig, settingsFromClayResponse, rejectedBaseUrl, prefillFor, ACTION_ORDER };
