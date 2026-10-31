// The running-timer screen: a big clock, a deliberate Stop button (stopping
// is never one accidental tap), and for nursing a Switch side button.
// It doubles as the "stop sheet" the spec asks for.
#include "sheets.h"
#include "ui.h"
#include "logic/fmt.h"
#include "logic/model.h"
#include <stdlib.h>

#define CELL_LABEL 1
#define CELL_CLOCK 2
#define CELL_SUB 3
#define CELL_STOP 4
#define CELL_SWITCH 5

typedef struct {
  int timer;
  AppTimer *close_timer;   // a deferred close of this window, see refresh()
  int since_refresh;       // seconds since the phone was last asked for fresh state
} TimerCtx;

static const char *const TITLES[TIMER_COUNT] = { "Sleep", "Nursing", "Pump" };
static const int ACTIONS[TIMER_COUNT] = { ACTION_SLEEP, ACTION_NURSING, ACTION_PUMP };

static void free_ctx(GridView *gv) {
  TimerCtx *c = gv->ctx;
  if (c->close_timer) app_timer_cancel(c->close_timer);
  free(c);
}

// Closes this screen once its timer is over. Never done from inside refresh():
// that runs from the window's own appear handler, including while
// ui_pop_to_home() is still popping windows, and a pop nested in a pop leaves
// the window stack (and the button handlers) in a bad state.
static void close_now(void *data) {
  GridView *gv = data;
  TimerCtx *c = gv->ctx;
  c->close_timer = NULL;
  if (model_timer_active(comm_state(), c->timer) || gv->overlay || grid_view_top() != gv) return;
  window_stack_remove(gv->window, true);
}

static void refresh(GridView *gv) {
  TimerCtx *c = gv->ctx;
  const WatchState *s = comm_state();
  int32_t now = ui_now();

  if (!model_timer_active(s, c->timer)) {
    // Stopped (here or on another device): nothing left to show. While a
    // confirmation is up, leave it be: it ends by going Home (or exiting) itself.
    if (!c->close_timer && !gv->overlay && grid_view_top() == gv) c->close_timer = app_timer_register(0, close_now, gv);
    return;
  }
  char clock[16], l1[24], l2[24];
  fmt_clock(clock, sizeof(clock), model_timer_elapsed(s, c->timer, now));
  model_tile_lines(s, ACTIONS[c->timer], now, l1, sizeof(l1), l2, sizeof(l2));

  snprintf(gv->cells[CELL_CLOCK].l1, sizeof(gv->cells[CELL_CLOCK].l1), "%s", clock);
  snprintf(gv->cells[CELL_SUB].l1, sizeof(gv->cells[CELL_SUB].l1), "%s", l2);
  bool running = s->timer_state[c->timer] == TIMER_STATE_RUNNING;
  if (gv->tick_secs != (running ? 1 : 0)) grid_view_set_tick(gv, running ? 1 : 0);
  grid_view_redraw(gv);
}

// Once a second while running. A timer someone else stopped or paused would
// otherwise stay on screen, since only Home asks the phone for fresh state.
static void on_tick(GridView *gv) {
  TimerCtx *c = gv->ctx;
  if (++c->since_refresh >= 60) {
    c->since_refresh = 0;
    comm_send(CMD_REFRESH, 0, 0, 0, 0);   // the phone throttles to once a minute
  }
  refresh(gv);
}

static void switch_side(GridView *gv) {
  const WatchState *s = comm_state();
  int other = s->timer_side[TIMER_NURSING] == SIDE_LEFT ? SIDE_RIGHT : SIDE_LEFT;
  char what[32];
  snprintf(what, sizeof(what), "Now %s", model_side_label(other));
  ui_send(ACTION_NURSING, what, CMD_TIMER_SWITCH, other, 0, 0, 0);
}

static void on_activate(GridView *gv, int index, bool long_press) {
  TimerCtx *c = gv->ctx;
  if (index == CELL_STOP) {
    if (c->timer == TIMER_PUMPING) {
      sheet_pump_amount();
    } else {
      char what[24];
      snprintf(what, sizeof(what), "%s saved", TITLES[c->timer]);
      ui_send(ACTIONS[c->timer], what, CMD_TIMER_STOP, c->timer, 0, 0, 0);
    }
  } else if (index == CELL_SWITCH && c->timer == TIMER_NURSING) {
    switch_side(gv);
  }
}

void timer_view_open(int timer) {
  if (timer < 0 || timer >= TIMER_COUNT) return;
  TimerCtx *c = calloc(1, sizeof(TimerCtx));
  if (!c) return;
  c->timer = timer;

  GridHandlers h = { .on_activate = on_activate, .on_tick = on_tick, .on_state = refresh, .on_unload = free_ctx };
  GridView *gv = grid_view_create(&h, c);
  if (!gv) {
    free(c);
    return;
  }
  ui_add_header(gv, TITLES[timer]);
  gv->cells[0].enabled = false;
  grid_view_add(gv, CELL_TEXT, (Rect){ 0, 0, 0, 0 }, "", "", "", GColorWhite);   // keeps indices stable (CELL_LABEL)
  grid_view_add(gv, CELL_TEXT, (Rect){ 0, 34, SCREEN_W, 52 }, "", "", "", GColorWhite)->font = FONT_CLOCK;
  grid_view_add(gv, CELL_TEXT, (Rect){ 0, 90, SCREEN_W, 30 }, "", "", "", GColorWhite)->font = FONT_VALUE;
  grid_view_add(gv, CELL_BUTTON, (Rect){ 4, 160, SCREEN_W - 8, 62 }, "Stop", "", "", GColorRed);
  if (timer == TIMER_NURSING) {
    gv->cells[CELL_STOP].rect = (Rect){ 4, 168, SCREEN_W - 8, 54 };
    grid_view_add(gv, CELL_BUTTON, (Rect){ 4, 122, SCREEN_W - 8, 40 }, "Switch side", "", "", GColorBrilliantRose);
  }
  refresh(gv);
  grid_view_commit(gv);
  grid_view_push(gv);
}
