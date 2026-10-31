#if !defined(PBL_PLATFORM_EMERY)
#error "nappi-pebble targets Emery only; the layout is hard-coded to 200x228 (see docs/ARCHITECTURE.md, ADR-002)"
#endif

#include <pebble.h>
#include "comm.h"
#include "grid_view.h"
#include "home.h"
#include "ui.h"

static void on_state(void) {
  grid_view_notify_state();
  ui_on_state();
}

static void init(void) {
  ui_init();
  comm_init();
  comm_set_state_handler(on_state);
  comm_set_link_handler(grid_view_notify_state);   // redraw only; not a state for ui.c
  home_push();
  // No refresh here: the phone's start() sends state and refreshes on its own.
}

static void deinit(void) {
  comm_deinit();
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
