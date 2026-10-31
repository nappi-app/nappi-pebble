#include "ui.h"
#include "logic/lockout.h"
#include "logic/send_flow.h"
#include <string.h>

static Lockout s_lockout;
static Window *s_home;

static SendFlow s_flow;
static void on_ack(int id, int status);
static void on_sent(int cmd_id);

void ui_init(void) {
  lockout_init(&s_lockout);
  sf_init(&s_flow);
  comm_set_ack_handler(on_ack);
  comm_set_sent_handler(on_sent);
}

GColor ui_action_color(int action) {
  switch (action) {
    // Hues follow the nappi app's tiles, snapped to the 64-colour palette. Flat fills, no gradient.
    case ACTION_DIAPER: return GColorChromeYellow;
    case ACTION_BOTTLE: return GColorBrilliantRose;
    case ACTION_NURSING: return GColorOrange;
    case ACTION_SLEEP: return GColorVividCerulean;
    case ACTION_PUMP: return GColorLavenderIndigo;
    case ACTION_POTTY: return GColorMayGreen;
    default: return GColorLightGray;
  }
}

uint32_t ui_action_icon(int action) {
  switch (action) {
    case ACTION_DIAPER: return RESOURCE_ID_ICON_DIAPER;
    case ACTION_BOTTLE: return RESOURCE_ID_ICON_BOTTLE;
    case ACTION_NURSING: return RESOURCE_ID_ICON_NURSING;
    case ACTION_SLEEP: return RESOURCE_ID_ICON_SLEEP;
    case ACTION_PUMP: return RESOURCE_ID_ICON_PUMP;
    default: return 0;
  }
}

GColor ui_accent(int index) {
  switch (((index % 6) + 6) % 6) {
    // First three match the nappi app's baby avatars (green, amber, coral).
    case 0: return GColorIslamicGreen;
    case 1: return GColorChromeYellow;
    case 2: return GColorSunsetOrange;
    case 3: return GColorCobaltBlue;
    case 4: return GColorPurple;
    default: return GColorDarkCandyAppleRed;
  }
}

GColor ui_baby_accent(const WatchState *s) {
  return ui_accent(s->baby_accent);
}

int32_t ui_now(void) {
  return (int32_t)time(NULL);
}

void ui_set_home_window(Window *home) {
  s_home = home;
}

void ui_pop_to_home(void) {
  while (s_home && window_stack_get_top_window() != s_home && window_stack_contains_window(s_home)) {
    window_stack_pop(false);
  }
}

void ui_add_header(GridView *gv, const char *title) {
  const WatchState *s = comm_state();
  Rect r = { 0, 0, SCREEN_W, HEADER_H };
  char text[48];
  if (s->baby_name[0]) snprintf(text, sizeof(text), "%s: %s", s->baby_name, title);
  else snprintf(text, sizeof(text), "%s", title);
  GridCell *c = grid_view_add(gv, CELL_HEADER, r, "", text, "", ui_baby_accent(s));
  c->enabled = false;
}

static uint32_t now_ms(void) {
  time_t sec;
  uint16_t ms;
  time_ms(&sec, &ms);
  return (uint32_t)sec * 1000u + ms;
}

// ---- send, wait for the phone's ACK, then confirm ----
//
// The checkmark means the phone has taken the command, not that the Bluetooth
// outbox accepted it: there is no delete in the API, so a confirmed log that
// never arrived is the worst failure this app can have. The decisions live in
// logic/send_flow (host-tested); this file owns the timers, vibes and overlays.
// Both timers belong here, not to a view, so Back or a later overlay cannot
// cancel them, and neither can fire into a freed view.

#define ACK_WAIT_MS 6000     // longer than comm's retries (4 x 600 ms) plus a round trip
#define EXIT_WAIT_MS 6000
#define SENDING_MS 15000     // outlasts the ready fallback plus the ack wait; every result replaces it

static AppTimer *s_ack_timer;    // armed when the awaited command first reaches AppMessage
static AppTimer *s_exit_timer;   // armed only while the flow is in SF_EXIT_WAIT
static int s_last_sent_id;       // newest command id comm has handed to AppMessage
static char s_caption[40];

static void cancel_ack_timer(void) {
  if (s_ack_timer) app_timer_cancel(s_ack_timer);
  s_ack_timer = NULL;
}

static void cancel_exit_timer(void) {
  if (s_exit_timer) app_timer_cancel(s_exit_timer);
  s_exit_timer = NULL;
}

// Whenever the flow has left the exit wait (delivered, view left, new send),
// its timer must not fire later.
static void sync_exit_timer(void) {
  if (s_flow.phase != SF_EXIT_WAIT) cancel_exit_timer();
}

static void go_home(GridView *gv) {
  ui_pop_to_home();
}

// Only on the delivered path: the phone has sent everything to nappi.
static void exit_now(void) {
  cancel_exit_timer();
  exit_reason_set(APP_EXIT_ACTION_PERFORMED_SUCCESSFULLY);
  window_stack_pop_all(true);
}

static void exit_timed_out(void *unused) {
  s_exit_timer = NULL;
  SfNext next = sf_on_exit_timeout(&s_flow, grid_view_top_id());
  if (next != SF_STAY_OPEN) return;
  // Not delivered in time: the write is kept on the phone and goes out later.
  GridView *top = grid_view_top();
  if (top) grid_view_flash(top, 3, "Saved on your phone. Will send later", 2500, go_home);
  else ui_pop_to_home();
}

// The checkmark has shown. PebbleKit JS stops when this app does, so with
// exit-after-log hold on until the phone has sent the write to nappi.
static void after_logged(GridView *gv) {
  if (sf_busy(&s_flow)) return;              // a new command began meanwhile: it owns what happens next
  if (grid_view_top() != gv) return;         // the sending view is no longer in front
  switch (sf_after_logged(&s_flow, comm_state()->exit_after_log, grid_view_id(gv))) {
    case SF_GO_HOME:
      ui_pop_to_home();
      break;
    case SF_EXIT_NOW:
      exit_now();
      break;
    case SF_WAIT_DELIVERY:
      cancel_exit_timer();
      s_exit_timer = app_timer_register(EXIT_WAIT_MS, exit_timed_out, NULL);
      // Outlasts the exit timer, whose result replaces it.
      grid_view_flash(gv, 3, "Saving...", EXIT_WAIT_MS + 1000, NULL);
      break;
    default:
      break;
  }
}

void ui_on_state(void) {
  SfNext next = sf_on_state(&s_flow, comm_state()->pending, grid_view_top_id());
  sync_exit_timer();
  if (next == SF_EXIT_NOW) exit_now();
}

static const char *ack_text(int status) {
  switch (status) {
    case STATUS_NO_TOKEN: return "No token set";
    case STATUS_NO_BABY: return "No baby found";
    case STATUS_WRONG_BABY: return "Baby changed. Try again";
    case COMM_ACK_NOT_SENT: return "Not sent. Try again";
    default: return "Not logged";
  }
}

// It may or may not have been logged: say so without inviting a retry, and
// ask for a fresh state so the Home times show whether it landed.
static void show_unconfirmed(void) {
  GridView *top = grid_view_top();
  vibes_double_pulse();
  if (top) grid_view_flash(top, 2, "Not confirmed. Check nappi", 3000, NULL);
  comm_send(CMD_REFRESH, 1, 0, 0, 0);
}

static void ack_timed_out(void *unused) {
  s_ack_timer = NULL;
  if (sf_on_timeout(&s_flow) == SF_UNCONFIRMED) show_unconfirmed();
}

static void arm_ack_timer(void) {
  if (!s_ack_timer) s_ack_timer = app_timer_register(ACK_WAIT_MS, ack_timed_out, NULL);
}

static void on_sent(int cmd_id) {
  s_last_sent_id = cmd_id;
  if (cmd_id == sf_pending_id(&s_flow)) arm_ack_timer();
}

static void on_ack(int id, int status) {
  GridView *top = grid_view_top();
  if (id == 0) {
    // The phone speaking unprompted: nappi refused a write we had confirmed.
    if (status == STATUS_REJECTED) {
      // Not delivered after all: an exit wait must not close the app as if it were.
      sf_on_unprompted_reject(&s_flow);
      sync_exit_timer();
      vibes_double_pulse();
      if (top) grid_view_flash(top, 2, "nappi rejected a log", 3000, NULL);
    }
    return;
  }
  int action = s_flow.action;
  SfAck a = sf_on_ack(&s_flow, id, status, grid_view_top_id());
  if (a.outcome == SF_IGNORED) return;   // stale, repeated, or after the timeout
  cancel_ack_timer();

  switch (a.outcome) {
    case SF_CONFIRMED:
      vibes_short_pulse();
      // Navigate (Home or exit) only when the sending view is still in front.
      if (top) grid_view_flash(top, 1, s_caption, 600, a.navigate ? after_logged : NULL);
      break;
    case SF_REFUSED:
      // Nothing was logged: let the user tap again at once.
      if (a.clear_lockout) lockout_clear(&s_lockout, action);
      vibes_double_pulse();
      if (top) grid_view_flash(top, 2, ack_text(status), 2500, NULL);
      break;
    case SF_UNCONFIRMED:
      show_unconfirmed();
      break;
    default:
      break;
  }
}

bool ui_send(int action, const char *what, int cmd, int32_t a1, int32_t a2, int32_t a3, int32_t a4) {
  GridView *top = grid_view_top();
  if (sf_busy(&s_flow)) {
    if (top) grid_view_flash(top, 3, "Still sending", 1200, NULL);
    return false;
  }
  if (!lockout_try(&s_lockout, action, now_ms())) return false;

  if (!comm_send(cmd, a1, a2, a3, a4)) {
    lockout_clear(&s_lockout, action);
    vibes_double_pulse();
    if (top) grid_view_flash(top, 2, "Phone not connected", 1500, NULL);
    return false;
  }

  int id = comm_last_cmd_id();
  sf_begin(&s_flow, id, action, grid_view_top_id());
  sync_exit_timer();                       // a new send ends any exit wait
  // comm may have handed it to AppMessage inside comm_send, before the flow knew its id.
  if (s_last_sent_id == id) arm_ack_timer();

  const WatchState *s = comm_state();
  if (s->baby_name[0]) snprintf(s_caption, sizeof(s_caption), "%s: %s", s->baby_name, what);
  else snprintf(s_caption, sizeof(s_caption), "%s", what);
  if (top) grid_view_flash(top, 3, "Sending...", SENDING_MS, NULL);
  return true;
}
