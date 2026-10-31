#include "comm.h"
#include <string.h>
#include "logic/ready_gate.h"

// Persistent storage keys. The state is larger than one 256-byte persist
// slot, so it is written in chunks.
#define PERSIST_VERSION_KEY 100
#define PERSIST_CHUNK_KEY 101
#define PERSIST_CHUNK_SIZE 200
#define PERSIST_VERSION 2

#define INBOX_SIZE 1024
#define OUTBOX_SIZE 128

static WatchState s_state;
static CommStateHandler s_state_handler;
static CommAckHandler s_ack_handler;
static CommSentHandler s_sent_handler;
static CommLinkHandler s_link_handler;
static int s_cmd_id;

// Nothing goes out until PebbleKit JS has spoken on this connection (or the
// fallback fired): a command sent into a JS context that is still starting is
// NACKed or lost.
static ReadyGate s_gate;
static AppTimer *s_ready_timer;

// The phone-app link as last reported by the connection service. Taken from
// the callback argument, not a fresh peek, which might still read "connected"
// inside the disconnect handler and leave a queued command waiting for nothing.
static bool s_connected;

const WatchState *comm_state(void) {
  return &s_state;
}

void comm_set_state_handler(CommStateHandler handler) {
  s_state_handler = handler;
}

void comm_set_ack_handler(CommAckHandler handler) {
  s_ack_handler = handler;
}

void comm_set_sent_handler(CommSentHandler handler) {
  s_sent_handler = handler;
}

void comm_set_link_handler(CommLinkHandler handler) {
  s_link_handler = handler;
}

bool comm_phone_responding(void) {
  return !rg_not_responding(&s_gate);
}

int comm_last_cmd_id(void) {
  return s_cmd_id;
}

// ---- persistence ----

static void persist_state(void) {
  if (!s_state.has_data) {
    persist_delete(PERSIST_VERSION_KEY);
    return;
  }
  const uint8_t *bytes = (const uint8_t *)&s_state;
  size_t total = sizeof(s_state);
  persist_write_int(PERSIST_VERSION_KEY, PERSIST_VERSION * 100000 + (int)total);
  for (size_t offset = 0, key = PERSIST_CHUNK_KEY; offset < total; offset += PERSIST_CHUNK_SIZE, key++) {
    size_t n = total - offset < PERSIST_CHUNK_SIZE ? total - offset : PERSIST_CHUNK_SIZE;
    persist_write_data(key, bytes + offset, n);
  }
}

static void load_persisted(void) {
  size_t total = sizeof(s_state);
  if (!persist_exists(PERSIST_VERSION_KEY)) return;
  if (persist_read_int(PERSIST_VERSION_KEY) != PERSIST_VERSION * 100000 + (int)total) return;

  WatchState loaded;
  uint8_t *bytes = (uint8_t *)&loaded;
  for (size_t offset = 0, key = PERSIST_CHUNK_KEY; offset < total; offset += PERSIST_CHUNK_SIZE, key++) {
    size_t n = total - offset < PERSIST_CHUNK_SIZE ? total - offset : PERSIST_CHUNK_SIZE;
    if (persist_read_data(key, bytes + offset, n) != (int)n) return;
  }
  s_state = loaded;
  s_state.from_cache = s_state.has_data;
}

// ---- inbox ----

static bool read_int(DictionaryIterator *it, uint32_t key, int32_t *out) {
  Tuple *t = dict_find(it, key);
  if (!t) return false;
  *out = t->value->int32;
  return true;
}

static void read_array(DictionaryIterator *it, uint32_t base, int32_t *out, int count) {
  for (int i = 0; i < count; i++) {
    int32_t v;
    if (read_int(it, base + i, &v)) out[i] = v;
  }
}

static void apply_state(DictionaryIterator *it) {
  WatchState *s = &s_state;
  int32_t v;
  Tuple *t;

  s->from_cache = false;
  if (read_int(it, MESSAGE_KEY_STATUS, &v)) s->status = (uint8_t)v;
  s->retry_after = read_int(it, MESSAGE_KEY_RETRY_AFTER, &v) ? v : 0;
  if (read_int(it, MESSAGE_KEY_BOTTLE_UNITS, &v)) s->bottle_units = (uint8_t)v;
  if (read_int(it, MESSAGE_KEY_PUMP_UNITS, &v)) s->pump_units = (uint8_t)v;
  if (read_int(it, MESSAGE_KEY_EXIT_AFTER_LOG, &v)) s->exit_after_log = v != 0;
  if (read_int(it, MESSAGE_KEY_DEFAULT_BOTTLE, &v)) s->default_bottle = (uint8_t)v;

  t = dict_find(it, MESSAGE_KEY_BABY_NAME);
  if (!t) {
    // Nothing known about a baby yet (no token, bad token, first run offline).
    s->has_data = false;
    s->baby_name[0] = '\0';
    s->baby_count = 0;
    return;
  }

  s->has_data = true;
  snprintf(s->baby_name, sizeof(s->baby_name), "%s", t->value->cstring);
  if ((t = dict_find(it, MESSAGE_KEY_BABY_NAMES))) snprintf(s->baby_names, sizeof(s->baby_names), "%s", t->value->cstring);
  if (read_int(it, MESSAGE_KEY_BABY_COUNT, &v)) s->baby_count = (uint8_t)v;
  if (read_int(it, MESSAGE_KEY_BABY_INDEX, &v)) s->baby_index = (uint8_t)v;
  if (read_int(it, MESSAGE_KEY_BABY_ACCENT, &v)) s->baby_accent = (uint8_t)v;
  if (read_int(it, MESSAGE_KEY_OTHER_TIMERS, &v)) s->other_timers = v != 0;
  if (read_int(it, MESSAGE_KEY_PENDING, &v)) s->pending = v;
  if (read_int(it, MESSAGE_KEY_TIMER_AT, &v)) s->timer_at = v;

  if ((t = dict_find(it, MESSAGE_KEY_LAYOUT)) && t->length > 0) {
    int n = t->length < ACTION_COUNT ? t->length : ACTION_COUNT;
    memcpy(s->layout, t->value->data, (size_t)n);
    s->layout_count = (uint8_t)n;
  }

  read_array(it, MESSAGE_KEY_LAST, s->last, ACTION_COUNT);
  read_array(it, MESSAGE_KEY_INFO, s->info, ACTION_COUNT);
  read_array(it, MESSAGE_KEY_TIMER_ELAPSED, s->timer_elapsed, TIMER_COUNT);
  for (int i = 0; i < TIMER_COUNT; i++) {
    if (read_int(it, MESSAGE_KEY_TIMER_STATE + i, &v)) s->timer_state[i] = (uint8_t)v;
    if (read_int(it, MESSAGE_KEY_TIMER_SIDE + i, &v)) s->timer_side[i] = (uint8_t)v;
  }
}

static void out_kick(void);
static void ready_timer_cancel(void);

static void inbox_received(DictionaryIterator *it, void *context) {
  // Any message counts as the phone speaking, JS_READY included.
  bool was_not_responding = rg_not_responding(&s_gate);
  rg_on_phone_message(&s_gate);
  ready_timer_cancel();

  int32_t id, result;
  if (read_int(it, MESSAGE_KEY_ACK_ID, &id) && read_int(it, MESSAGE_KEY_ACK_STATUS, &result)) {
    if (s_ack_handler) s_ack_handler((int)id, (int)result);
  }
  // Only a dict carrying STATUS is a state; a bare {JS_READY: 1} is not.
  bool is_state = dict_find(it, MESSAGE_KEY_STATUS) != NULL;
  if (is_state) apply_state(it);
  out_kick();   // anything held back for readiness may go now
  if (is_state) {
    if (s_state_handler) s_state_handler();
  } else if (was_not_responding && s_link_handler) {
    s_link_handler();   // only the "No phone app" header changed
  }
}

static void inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "inbox dropped: %d", (int)reason);
}

// ---- outbox ----
//
// One message is in flight at a time; the rest wait their turn. A message the
// phone never processed (outbox busy, phone not connected, PebbleKit JS not up
// yet and so NACKing) is retried a few times. One that timed out is not: it
// may have arrived, and sending it again could log twice.

#define OUT_QUEUE 4
#define OUT_RETRY_MS 600
#define OUT_MAX_TRIES 4

typedef struct {
  int32_t cmd, id, args[4];
  bool has_baby;
  int32_t baby_index;
} OutCmd;

static OutCmd s_out[OUT_QUEUE];
static int s_out_count;        // s_out[0] is the one being sent
static int s_out_tries;
static bool s_out_sending;     // handed to AppMessage, no sent/failed callback yet
static AppTimer *s_out_timer;

static void out_try(void);

static void out_pop(void) {
  s_out_count--;
  memmove(&s_out[0], &s_out[1], sizeof(OutCmd) * (size_t)s_out_count);
  s_out_tries = 0;
}

// Tries the head of the queue unless it is already with AppMessage or a retry
// is already scheduled (that timer will try it). This guard matters because
// the ack handler may call comm_send re-entrantly (ui.c asks for a refresh
// from inside out_give_up): without it the nested and the outer out_try could
// both run, burning retries and registering a second, orphaned retry timer.
static void out_kick(void) {
  if (s_out_count > 0 && !s_out_sending && !s_out_timer) out_try();
}

static void out_give_up(int status) {
  int id = (int)s_out[0].id;
  out_pop();
  if (s_ack_handler) s_ack_handler(id, status);
  out_kick();
}

static void out_retry_fired(void *unused) {
  s_out_timer = NULL;
  out_kick();
}

static void out_retry(void) {
  s_out_sending = false;
  if (++s_out_tries < OUT_MAX_TRIES) {
    if (s_out_timer) app_timer_cancel(s_out_timer);   // never two retry timers
    s_out_timer = app_timer_register(OUT_RETRY_MS, out_retry_fired, NULL);
    return;
  }
  out_give_up(COMM_ACK_NOT_SENT);
}

static void out_try(void) {
  if (s_out_count == 0 || s_out_sending) return;
  if (!rg_may_send(&s_gate)) {
    // Not ready: hold it (no retry consumed) until the phone speaks or the
    // fallback fires. With no phone at all neither will happen, so give up
    // rather than leave the UI waiting; out_give_up moves on to the rest.
    if (!s_connected) out_give_up(COMM_ACK_NOT_SENT);
    return;
  }
  DictionaryIterator *it;
  AppMessageResult r = app_message_outbox_begin(&it);
  if (r == APP_MSG_OK) {
    const OutCmd *c = &s_out[0];
    dict_write_int32(it, MESSAGE_KEY_CMD, c->cmd);
    dict_write_int32(it, MESSAGE_KEY_CMD_ID, c->id);
    dict_write_int32(it, MESSAGE_KEY_ARG1, c->args[0]);
    dict_write_int32(it, MESSAGE_KEY_ARG2, c->args[1]);
    dict_write_int32(it, MESSAGE_KEY_ARG3, c->args[2]);
    dict_write_int32(it, MESSAGE_KEY_ARG4, c->args[3]);
    if (c->has_baby) dict_write_int32(it, MESSAGE_KEY_BABY_INDEX, c->baby_index);
    r = app_message_outbox_send();
  }
  if (r == APP_MSG_OK) {
    s_out_sending = true;
    if (s_sent_handler) s_sent_handler((int)s_out[0].id);
    return;
  }
  out_retry();
}

static void outbox_sent(DictionaryIterator *it, void *context) {
  if (s_out_count == 0) return;
  s_out_sending = false;
  out_pop();
  out_kick();
}

static void outbox_failed(DictionaryIterator *it, AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "outbox failed: %d", (int)reason);
  if (s_out_count == 0) return;
  s_out_sending = false;
  if (reason == APP_MSG_SEND_REJECTED || reason == APP_MSG_NOT_CONNECTED || reason == APP_MSG_BUSY) {
    out_retry();
  } else {
    out_give_up(COMM_ACK_NO_REPLY);
  }
}

// ---- readiness ----

static void ready_timer_cancel(void) {
  if (s_ready_timer) app_timer_cancel(s_ready_timer);
  s_ready_timer = NULL;
}

static void ready_fallback(void *unused) {
  s_ready_timer = NULL;
  bool was_not_responding = rg_not_responding(&s_gate);
  rg_on_fallback(&s_gate);
  out_kick();   // send anyway; the retry logic then applies
  if (rg_not_responding(&s_gate) != was_not_responding && s_link_handler) s_link_handler();
}

static void ready_arm(void) {
  ready_timer_cancel();
  s_ready_timer = app_timer_register(READY_FALLBACK_MS, ready_fallback, NULL);
}

// PebbleKit JS starts a fresh context on reconnect, so readiness is per connection.
static void on_phone_connection(bool connected) {
  bool was_not_responding = rg_not_responding(&s_gate);
  s_connected = connected;
  rg_on_connection(&s_gate, connected);
  if (connected) ready_arm();
  else ready_timer_cancel();
  // Disconnected: queued commands that are not with AppMessage are given up
  // (see out_try); one in flight ends through its outbox callback.
  out_kick();
  if (was_not_responding && s_link_handler) s_link_handler();
}

bool comm_send(int cmd, int32_t a1, int32_t a2, int32_t a3, int32_t a4) {
  if (!s_connected) return false;
  if (s_out_count >= OUT_QUEUE) return false;
  s_cmd_id++;
  OutCmd *c = &s_out[s_out_count++];
  c->cmd = cmd;
  c->id = s_cmd_id;
  c->args[0] = a1;
  c->args[1] = a2;
  c->args[2] = a3;
  c->args[3] = a4;
  // Name the baby the watch is showing, so the phone can refuse if it has moved on.
  c->has_baby = s_state.has_data;
  c->baby_index = s_state.baby_index;
  out_kick();   // held until ready; otherwise sends now if nothing is ahead of it
  return true;
}

// ---- lifecycle ----

void comm_init(void) {
  model_default(&s_state);
  load_persisted();
  app_message_register_inbox_received(inbox_received);
  app_message_register_inbox_dropped(inbox_dropped);
  app_message_register_outbox_sent(outbox_sent);
  app_message_register_outbox_failed(outbox_failed);
  app_message_open(INBOX_SIZE, OUTBOX_SIZE);
  rg_init(&s_gate);
  s_connected = connection_service_peek_pebble_app_connection();
  connection_service_subscribe((ConnectionHandlers){ .pebble_app_connection_handler = on_phone_connection });
  if (s_connected) ready_arm();
}

void comm_deinit(void) {
  connection_service_unsubscribe();
  ready_timer_cancel();
  persist_state();
}
