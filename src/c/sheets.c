#include "sheets.h"
#include "ui.h"
#include "logic/amount.h"
#include "logic/fmt.h"
#include "logic/model.h"
#include <stdlib.h>

// Last amount logged on each screen, x10 ml so a unit change does not lose it.
#define PERSIST_BOTTLE_AMOUNT 111
#define PERSIST_PUMP_AMOUNT 112

#define TIME_RECT ((Rect){ 3, 27, 194, 36 })
#define BUTTONS_Y 66
#define MAX_CHOICES 4

// What each nav zone controls.
enum { ZONE_TIME, ZONE_UNITS, ZONE_AMOUNT, ZONE_BUTTONS };

typedef struct SheetCtx SheetCtx;

struct SheetCtx {
  int action;               // lockout key
  int timer;                // timer index for the start sheets
  int screen;               // AMOUNT_BOTTLE or AMOUNT_PUMP
  int time_cell;            // -1 when the sheet has no time strip
  int unit_first;           // "oz" chip; "ml" follows. -1 when none
  int amount_cell;          // -1 when none
  int units;
  int32_t value;            // amount, x10 of `units`
  int btn_first, btn_count; // the choice zone
  void (*choose)(GridView *gv, int k);   // log the k-th button
  int zone_what[NAV_MAX_ZONES];
  NavZone zones[NAV_MAX_ZONES];
  int zone_first[NAV_MAX_ZONES], zone_count[NAV_MAX_ZONES];
  int zones_n;
};

static void free_ctx(GridView *gv) {
  free(gv->ctx);
}

static SheetCtx *ctx_of(GridView *gv) {
  return gv->ctx;
}

// ---- zones ----

static void add_zone(SheetCtx *c, int what, ZoneKind kind, int first, int count, int start) {
  if (c->zones_n >= NAV_MAX_ZONES) return;
  int z = c->zones_n++;
  c->zone_what[z] = what;
  c->zones[z] = (NavZone){ kind, (uint8_t)(kind == ZONE_CHOICE ? count : 0), (uint8_t)start };
  c->zone_first[z] = first;
  c->zone_count[z] = count;
}

// Adds the action buttons as the last zone, focused on `start` first.
static void add_buttons(GridView *gv, SheetCtx *c, const Rect *rects, const char *const *labels, int count,
                        GColor bg, int start) {
  c->btn_first = gv->count;
  c->btn_count = count;
  for (int i = 0; i < count; i++) grid_view_add(gv, CELL_BUTTON, rects[i], labels[i], "", "", bg);
  add_zone(c, ZONE_BUTTONS, ZONE_CHOICE, c->btn_first, count, start);
}

// ---- time strip ----

static void time_refresh(GridView *gv) {
  SheetCtx *c = ctx_of(gv);
  if (c->time_cell < 0) return;
  GridCell *cell = &gv->cells[c->time_cell];
  time_t when = time(NULL) - cell->strip_value * 60;
  struct tm *tm = localtime(&when);
  fmt_strip_time(cell->title, sizeof(cell->title), (int)cell->strip_value, tm->tm_hour, tm->tm_min,
                 clock_is_24h_style());
}

static void add_time_strip(GridView *gv, SheetCtx *c) {
  c->time_cell = gv->count;
  GridCell *cell = grid_view_add(gv, CELL_STRIP, TIME_RECT, "", "", "", GColorWhite);
  cell->geom = strip_time_geom();
  cell->strip_value = 0;   // opens at Now every time
  time_refresh(gv);
  add_zone(c, ZONE_TIME, ZONE_ADJUST, c->time_cell, 1, 0);
}

static int minutes_ago(GridView *gv) {
  SheetCtx *c = ctx_of(gv);
  return c->time_cell >= 0 ? (int)gv->cells[c->time_cell].strip_value : 0;
}

// ---- amount strip and unit chips ----

static uint32_t amount_key(int screen) {
  return screen == AMOUNT_PUMP ? PERSIST_PUMP_AMOUNT : PERSIST_BOTTLE_AMOUNT;
}

static void amount_refresh(GridView *gv) {
  SheetCtx *c = ctx_of(gv);
  GridCell *cell = &gv->cells[c->amount_cell];
  cell->geom = amount_geom(c->screen, c->units);
  cell->strip_value = c->value;
  fmt_amount(cell->title, sizeof(cell->title), c->value, c->units);
  gv->cells[c->unit_first].selected = c->units == UNITS_OZ;
  gv->cells[c->unit_first + 1].selected = c->units == UNITS_ML;
}

static void set_units(GridView *gv, int units) {
  SheetCtx *c = ctx_of(gv);
  if (units == c->units) return;
  // The phone reads logged amounts in its saved unit, so the watch only
  // switches once the phone has been told; otherwise the sheet stays as it was.
  if (!comm_send(CMD_SET_UNITS, c->screen == AMOUNT_BOTTLE ? UNITS_SCREEN_BOTTLE : UNITS_SCREEN_PUMP, units, 0, 0)) {
    vibes_double_pulse();
    grid_view_flash(gv, 2, "Phone not connected", 1500, NULL);
    return;
  }
  StripGeom g = amount_geom(c->screen, units);
  c->value = strip_snap(&g, amount_convert(c->value, c->units, units));
  c->units = units;
  amount_refresh(gv);
  grid_view_redraw(gv);
}

// Unit chips at y, then the amount strip in `strip`; adds both zones.
static void add_amount(GridView *gv, SheetCtx *c, int screen, int y, Rect strip) {
  const WatchState *s = comm_state();
  c->screen = screen;
  c->units = (screen == AMOUNT_PUMP ? s->pump_units : s->bottle_units) == UNITS_ML ? UNITS_ML : UNITS_OZ;
  StripGeom g = amount_geom(screen, c->units);
  uint32_t key = amount_key(screen);
  if (persist_exists(key)) c->value = strip_snap(&g, amount_convert(persist_read_int(key), UNITS_ML, c->units));
  else c->value = amount_default(screen, c->units);

  c->unit_first = gv->count;
  grid_view_add(gv, CELL_CHIP, (Rect){ 3, y, 95, 26 }, "oz", "", "", GColorLightGray);
  grid_view_add(gv, CELL_CHIP, (Rect){ 102, y, 95, 26 }, "ml", "", "", GColorLightGray);
  add_zone(c, ZONE_UNITS, ZONE_ADJUST, c->unit_first, 2, 0);

  c->amount_cell = gv->count;
  grid_view_add(gv, CELL_STRIP, strip, "", "", "", GColorWhite);
  add_zone(c, ZONE_AMOUNT, ZONE_ADJUST, c->amount_cell, 1, 0);
  amount_refresh(gv);
}

// Remembers a logged amount (x10 ml) as the next starting point.
static void remember_amount(const SheetCtx *c) {
  persist_write_int(amount_key(c->screen), amount_convert(c->value, c->units, UNITS_ML));
}

// ---- shared handlers ----

static void sheet_activate(GridView *gv, int index, bool long_press) {
  SheetCtx *c = ctx_of(gv);
  if (c->unit_first >= 0 && (index == c->unit_first || index == c->unit_first + 1)) {
    set_units(gv, index == c->unit_first ? UNITS_OZ : UNITS_ML);
    return;
  }
  int k = index - c->btn_first;
  if (k < 0 || k >= c->btn_count || !c->choose) return;
  c->choose(gv, k);
}

static void sheet_strip(GridView *gv, int cell, int x) {
  SheetCtx *c = ctx_of(gv);
  GridCell *strip = &gv->cells[cell];
  int32_t v = strip_value_at(&strip->geom, x);
  if (v == strip->strip_value) return;
  if (cell == c->time_cell) {
    strip->strip_value = v;
    time_refresh(gv);
  } else if (cell == c->amount_cell) {
    c->value = v;
    amount_refresh(gv);
  }
  grid_view_redraw(gv);
}

static void sheet_adjust(GridView *gv, int zone, int dir) {
  SheetCtx *c = ctx_of(gv);
  if (zone < 0 || zone >= c->zones_n) return;
  switch (c->zone_what[zone]) {
    case ZONE_TIME: {
      GridCell *strip = &gv->cells[c->time_cell];
      strip->strip_value = strip_nudge(&strip->geom, strip->strip_value, dir);
      time_refresh(gv);
      break;
    }
    case ZONE_UNITS:
      set_units(gv, dir > 0 ? UNITS_ML : UNITS_OZ);
      break;
    case ZONE_AMOUNT: {
      StripGeom g = amount_geom(c->screen, c->units);
      c->value = strip_nudge(&g, c->value, dir);
      amount_refresh(gv);
      break;
    }
    default: break;
  }
  grid_view_redraw(gv);
}

// The clock in the readout follows the wall clock.
static void sheet_tick(GridView *gv) {
  time_refresh(gv);
  grid_view_redraw(gv);
}

// ---- opening ----

static GridView *open_sheet(const char *title, int action, void (*choose)(GridView *, int)) {
  SheetCtx *c = calloc(1, sizeof(SheetCtx));
  if (!c) return NULL;
  c->action = action;
  c->time_cell = c->unit_first = c->amount_cell = -1;
  c->choose = choose;
  GridHandlers h = { .on_activate = sheet_activate, .on_strip = sheet_strip, .on_adjust = sheet_adjust,
                     .on_tick = sheet_tick, .on_unload = free_ctx };
  GridView *gv = grid_view_create(&h, c);
  if (!gv) {
    free(c);
    return NULL;
  }
  ui_add_header(gv, title);
  return gv;
}

static void show_sheet(GridView *gv) {
  SheetCtx *c = ctx_of(gv);
  grid_view_commit(gv);
  grid_view_set_zones(gv, c->zones, c->zone_first, c->zone_count, c->zones_n);
  if (c->time_cell >= 0) grid_view_set_tick(gv, 60);
  grid_view_push(gv);
}

// ---- diaper / potty / nursing start / sleep or pump start ----

static void diaper_choose(GridView *gv, int type) {
  ui_send(ACTION_DIAPER, model_diaper_label(type), CMD_LOG_DIAPER, type, minutes_ago(gv), 0, 0);
}

void sheet_diaper(void) {
  GridView *gv = open_sheet("Diaper", ACTION_DIAPER, diaper_choose);
  if (!gv) return;
  SheetCtx *c = ctx_of(gv);
  add_time_strip(gv, c);
  Rect cells[4];
  layout_grid((Rect){ 3, BUTTONS_Y, 194, 158 }, 2, 2, 4, cells);
  const char *labels[4];
  for (int i = 0; i < 4; i++) labels[i] = model_diaper_label(i);
  add_buttons(gv, c, cells, labels, 4, ui_action_color(ACTION_DIAPER), 0);
  show_sheet(gv);
}

static void potty_choose(GridView *gv, int outcome) {
  ui_send(ACTION_POTTY, model_potty_label(outcome), CMD_LOG_POTTY, outcome, minutes_ago(gv), 0, 0);
}

void sheet_potty(void) {
  GridView *gv = open_sheet("Potty", ACTION_POTTY, potty_choose);
  if (!gv) return;
  SheetCtx *c = ctx_of(gv);
  add_time_strip(gv, c);
  Rect cells[3];
  layout_grid((Rect){ 3, BUTTONS_Y, 194, 158 }, 3, 1, 4, cells);
  const char *labels[3];
  for (int i = 0; i < 3; i++) labels[i] = model_potty_label(i);
  add_buttons(gv, c, cells, labels, 3, ui_action_color(ACTION_POTTY), 0);
  show_sheet(gv);
}

static void nursing_choose(GridView *gv, int k) {
  int side = k + 1;   // SIDE_LEFT, SIDE_RIGHT, SIDE_BOTH
  char what[32];
  snprintf(what, sizeof(what), "Nursing %s", model_side_label(side));
  ui_send(ACTION_NURSING, what, CMD_TIMER_START, TIMER_NURSING, side, minutes_ago(gv), 0);
}

void sheet_nursing_start(void) {
  GridView *gv = open_sheet("Nursing", ACTION_NURSING, nursing_choose);
  if (!gv) return;
  SheetCtx *c = ctx_of(gv);
  add_time_strip(gv, c);
  static const Rect cells[3] = { { 3, BUTTONS_Y, 95, 78 }, { 102, BUTTONS_Y, 95, 78 }, { 3, 148, 194, 76 } };
  const char *labels[3];
  for (int i = 0; i < 3; i++) labels[i] = model_side_label(i + 1);
  add_buttons(gv, c, cells, labels, 3, ui_action_color(ACTION_NURSING), 0);
  show_sheet(gv);
}

static void timer_start_choose(GridView *gv, int k) {
  SheetCtx *c = ctx_of(gv);
  ui_send(c->action, c->action == ACTION_SLEEP ? "Sleep started" : "Pump started", CMD_TIMER_START,
          c->timer, 0, minutes_ago(gv), 0);
}

void sheet_timer_start(int action) {
  GridView *gv = open_sheet(action == ACTION_SLEEP ? "Sleep" : "Pump", action, timer_start_choose);
  if (!gv) return;
  SheetCtx *c = ctx_of(gv);
  c->timer = model_timer_for_action(action);
  add_time_strip(gv, c);
  Rect cell = { 3, BUTTONS_Y, 194, 158 };
  const char *label = action == ACTION_SLEEP ? "Start sleep" : "Start pump";
  add_buttons(gv, c, &cell, &label, 1, ui_action_color(action), 0);
  show_sheet(gv);
}

// ---- bottle ----

static void bottle_choose(GridView *gv, int k) {
  SheetCtx *c = ctx_of(gv);
  int type = k == 1 ? BOTTLE_TYPE_BREAST_MILK : BOTTLE_TYPE_FORMULA;
  char what[24];
  fmt_amount(what, sizeof(what), c->value, c->units);
  if (ui_send(ACTION_BOTTLE, what, CMD_LOG_BOTTLE, c->value, type, minutes_ago(gv), c->units)) remember_amount(c);
}

void sheet_bottle(void) {
  GridView *gv = open_sheet("Bottle", ACTION_BOTTLE, bottle_choose);
  if (!gv) return;
  SheetCtx *c = ctx_of(gv);
  add_time_strip(gv, c);
  add_amount(gv, c, AMOUNT_BOTTLE, BUTTONS_Y, (Rect){ 3, 95, 194, 48 });
  static const Rect cells[2] = { { 3, 148, 95, 76 }, { 102, 148, 95, 76 } };
  static const char *const labels[2] = { "Formula", "Breast milk" };
  int start = comm_state()->default_bottle == BOTTLE_TYPE_BREAST_MILK ? 1 : 0;
  add_buttons(gv, c, cells, labels, 2, ui_action_color(ACTION_BOTTLE), start);
  show_sheet(gv);
}

// ---- pump stop amount ----

static void pump_amount_choose(GridView *gv, int k) {
  SheetCtx *c = ctx_of(gv);
  if (k == 1) {
    ui_send(ACTION_PUMP, "Pump saved", CMD_TIMER_STOP, TIMER_PUMPING, 0, 0, c->units);
    return;
  }
  char what[24];
  fmt_amount(what, sizeof(what), c->value, c->units);
  if (ui_send(ACTION_PUMP, what, CMD_TIMER_STOP, TIMER_PUMPING, 0, c->value, c->units)) remember_amount(c);
}

void sheet_pump_amount(void) {
  GridView *gv = open_sheet("How much?", ACTION_PUMP, pump_amount_choose);
  if (!gv) return;
  SheetCtx *c = ctx_of(gv);
  add_amount(gv, c, AMOUNT_PUMP, 28, (Rect){ 3, 57, 194, 48 });
  static const Rect cells[2] = { { 3, 108, 194, 64 }, { 3, 176, 194, 48 } };
  static const char *const labels[2] = { "Log", "Skip amount" };
  add_buttons(gv, c, cells, labels, 2, ui_action_color(ACTION_PUMP), 0);
  GridCell *skip = &gv->cells[c->btn_first + 1];
  skip->bg = GColorLightGray;
  skip->fg = gcolor_legible_over(skip->bg);
  show_sheet(gv);
}

// ---- babies ----

static void babies_activate(GridView *gv, int index, bool long_press) {
  const WatchState *s = comm_state();
  int baby = index - 1;
  if (baby < 0 || baby >= s->baby_count) return;
  if (!comm_send(CMD_SWITCH_BABY, baby, 0, 0, 0)) {
    vibes_double_pulse();
    grid_view_flash(gv, 2, "Phone not connected", 1500, NULL);
    return;
  }
  window_stack_pop(true);
}

void sheet_babies(void) {
  const WatchState *s = comm_state();
  GridHandlers h = { .on_activate = babies_activate };
  GridView *gv = grid_view_create(&h, NULL);
  if (!gv) return;
  ui_add_header(gv, "Switch baby");
  int count = s->baby_count < 4 ? s->baby_count : 4;
  for (int i = 0; i < count; i++) {
    char name[BABY_NAME_LEN];
    model_baby_name(s, i, name, sizeof(name));
    GridCell *c = grid_view_add(gv, CELL_BUTTON, (Rect){ 4, 32 + i * 48, SCREEN_W - 8, 44 }, name, "", "", ui_accent(i));
    c->selected = i == s->baby_index;
  }
  grid_view_commit(gv);
  grid_view_push(gv);
}

// ---- status ----

#define STATUS_TEXT 1
#define STATUS_REFRESH 2

static void status_refresh(GridView *gv) {
  const WatchState *s = comm_state();
  char line[64];
  model_status_text(s, line, sizeof(line));
  if (s->pending > 0) snprintf(gv->cells[STATUS_TEXT].l1, sizeof(gv->cells[STATUS_TEXT].l1), "%s\n\n%d entries waiting to send", line, (int)s->pending);
  else snprintf(gv->cells[STATUS_TEXT].l1, sizeof(gv->cells[STATUS_TEXT].l1), "%s", line);
  grid_view_redraw(gv);
}

static void status_activate(GridView *gv, int index, bool long_press) {
  if (index != STATUS_REFRESH) return;
  // ARG1 1: skip the phone's once-a-minute throttle
  if (!comm_send(CMD_REFRESH, 1, 0, 0, 0)) {
    vibes_double_pulse();
    grid_view_flash(gv, 2, "Phone not connected", 1500, NULL);
    return;
  }
  grid_view_flash(gv, 3, "Refreshing...", 800, NULL);
}

void sheet_status(void) {
  GridHandlers h = { .on_activate = status_activate, .on_state = status_refresh };
  GridView *gv = grid_view_create(&h, NULL);
  if (!gv) return;
  ui_add_header(gv, "Status");
  grid_view_add(gv, CELL_TEXT, (Rect){ 8, 34, SCREEN_W - 16, 120 }, "", "", "", GColorWhite);
  grid_view_add(gv, CELL_BUTTON, (Rect){ 4, 168, SCREEN_W - 8, 52 }, "Refresh", "", "", GColorLightGray);
  status_refresh(gv);
  grid_view_commit(gv);
  grid_view_push(gv);
}
