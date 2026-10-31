#include "home.h"
#include "ui.h"
#include "sheets.h"
#include "logic/model.h"
#include "logic/layout.h"

static int s_since_refresh;

static void rebuild(GridView *gv) {
  const WatchState *s = comm_state();
  int32_t now = ui_now();
  grid_view_clear(gv);

  // Header: the running-timer banner replaces the baby name.
  char banner[40];
  int timer = model_banner(s, now, banner, sizeof(banner));
  char name[BABY_NAME_LEN + 4];
  if (s->baby_name[0]) snprintf(name, sizeof(name), s->other_timers ? "%s *" : "%s", s->baby_name);
  else snprintf(name, sizeof(name), "nappi-pebble");

  char status[24], pending[24];
  model_tile_lines(s, ACTION_STATUS, now, status, sizeof(status), pending, sizeof(pending));
  // Precedence: "No phone app" (red) wins over every phone-reported status.
  bool no_phone_app = !comm_phone_responding();
  const char *status_line = no_phone_app ? "No phone app" : (model_status_ok(s->status) ? pending : status);
  GridCell *h = grid_view_add(gv, CELL_HEADER, (Rect){ 0, 0, SCREEN_W, HEADER_H }, "",
                              timer >= 0 ? banner : name, status_line, ui_baby_accent(s));
  h->key = timer >= 0 ? 100 + timer : 99;
  h->enabled = timer >= 0 || s->baby_count > 1;
  h->has_dot = true;
  h->dot = no_phone_app ? GColorRed
         : (!s->has_data || s->from_cache) ? GColorLightGray : (model_status_ok(s->status) ? GColorGreen : GColorRed);

  gv->pages = layout_page_count(s->layout_count);
  if (gv->page >= gv->pages) gv->page = gv->pages - 1;
  int tiles = layout_tiles_on_page(s->layout_count, gv->page);
  for (int slot = 0; slot < tiles; slot++) {
    int action = s->layout[gv->page * TILES_PER_PAGE + slot];
    char l1[24], l2[24];
    model_tile_lines(s, action, now, l1, sizeof(l1), l2, sizeof(l2));
    GridCell *c = grid_view_add(gv, CELL_TILE, layout_tile_rect(slot), model_action_title(action), l1, l2,
                                ui_action_color(action));
    c->key = action + 1;
    c->icon = ui_action_icon(action);
    int t = model_timer_for_action(action);
    c->selected = t >= 0 && model_timer_active(s, t);
  }
  grid_view_commit(gv);
}

static void open_action(int action, bool long_press) {
  const WatchState *s = comm_state();
  int timer = model_timer_for_action(action);
  bool active = timer >= 0 && model_timer_active(s, timer);

  // Only Sleep and Pump tell a long press apart: a tap starts the timer now,
  // a long press opens the start sheet to backdate it.
  switch (action) {
    case ACTION_DIAPER: sheet_diaper(); break;
    case ACTION_BOTTLE: sheet_bottle(); break;
    case ACTION_POTTY: sheet_potty(); break;
    case ACTION_STATUS: sheet_status(); break;
    case ACTION_NURSING:
      if (active) timer_view_open(timer);
      else sheet_nursing_start();
      break;
    case ACTION_SLEEP:
    case ACTION_PUMP:
      if (active) timer_view_open(timer);
      else if (long_press) sheet_timer_start(action);
      else ui_send(action, action == ACTION_SLEEP ? "Sleep started" : "Pump started", CMD_TIMER_START, timer, 0, 0, 0);
      break;
    default: break;
  }
}

static void on_activate(GridView *gv, int index, bool long_press) {
  const WatchState *s = comm_state();
  if (index == 0) {
    char banner[40];
    int timer = model_banner(s, ui_now(), banner, sizeof(banner));
    if (timer >= 0) timer_view_open(timer);
    else if (s->baby_count > 1) sheet_babies();
    return;
  }
  int li = gv->page * TILES_PER_PAGE + (index - 1);
  if (li < s->layout_count) open_action(s->layout[li], long_press);
}

static void on_swipe(GridView *gv, int direction) {
  int page = gv->page;
  if (direction == SWIPE_LEFT && page < gv->pages - 1) page++;
  else if (direction == SWIPE_RIGHT && page > 0) page--;
  if (page == gv->page) return;
  gv->page = page;
  gv->focus = -1;
  rebuild(gv);
}

static void on_tick(GridView *gv) {
  s_since_refresh += gv->tick_secs;
  if (s_since_refresh >= 60) {
    s_since_refresh = 0;
    comm_send(CMD_REFRESH, 0, 0, 0, 0);   // the phone throttles to once a minute
  }
  rebuild(gv);
}

static void on_state(GridView *gv) {
  rebuild(gv);
}

void home_push(void) {
  GridHandlers handlers = { .on_activate = on_activate, .on_swipe = on_swipe, .on_tick = on_tick, .on_state = on_state };
  GridView *gv = grid_view_create(&handlers, NULL);
  if (!gv) return;
  grid_view_set_tick(gv, 60);   // Home shows minutes only: one tick a minute, set once
  rebuild(gv);
  ui_set_home_window(gv->window);
  grid_view_push(gv);
}
