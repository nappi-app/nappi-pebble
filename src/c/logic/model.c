#include "model.h"
#include "fmt.h"
#include <stdio.h>
#include <string.h>

void model_default(WatchState *s) {
  memset(s, 0, sizeof(*s));
  s->bottle_units = UNITS_OZ;
  s->pump_units = UNITS_OZ;
  static const uint8_t layout[] = {
    ACTION_DIAPER, ACTION_BOTTLE, ACTION_NURSING, ACTION_SLEEP,
    ACTION_PUMP, ACTION_POTTY, ACTION_STATUS
  };
  memcpy(s->layout, layout, sizeof(layout));
  s->layout_count = sizeof(layout);
}

// ---- timers ----

bool model_timer_active(const WatchState *s, int timer) {
  if (timer < 0 || timer >= TIMER_COUNT) return false;
  return s->timer_state[timer] == TIMER_STATE_RUNNING || s->timer_state[timer] == TIMER_STATE_PAUSED;
}

int32_t model_timer_elapsed(const WatchState *s, int timer, int32_t now) {
  if (!model_timer_active(s, timer)) return 0;
  int32_t e = s->timer_elapsed[timer];
  if (s->timer_state[timer] == TIMER_STATE_PAUSED) return e;
  int32_t gap = now - s->timer_at;
  return gap > 0 ? e + gap : e;
}

int model_timer_for_action(int action) {
  switch (action) {
    case ACTION_SLEEP: return TIMER_SLEEP;
    case ACTION_NURSING: return TIMER_NURSING;
    case ACTION_PUMP: return TIMER_PUMPING;
    default: return -1;
  }
}

// ---- labels ----

static const char *pick(const char *const *table, int count, int i) {
  return (i >= 0 && i < count) ? table[i] : "?";
}

const char *model_action_title(int action) {
  static const char *const t[] = { "Diaper", "Bottle", "Nursing", "Sleep", "Pump", "Potty", "Status" };
  return pick(t, ACTION_COUNT, action);
}

const char *model_diaper_label(int type) {
  static const char *const t[] = { "Wet", "Poo", "Mixed", "Dry" };
  return pick(t, 4, type);
}

const char *model_potty_label(int outcome) {
  static const char *const t[] = { "Potty", "Accident", "Sat dry" };
  return pick(t, 3, outcome);
}

const char *model_side_label(int side) {
  static const char *const t[] = { "", "Left", "Right", "Both" };
  return pick(t, 4, side);
}

const char *model_bottle_type_label(int type) {
  static const char *const t[] = {
    "Formula", "Breast milk", "Tube feeding", "Cow milk", "Goat milk", "Soy milk", "Other"
  };
  return pick(t, 7, type);
}

// ---- status ----

bool model_status_ok(int status) {
  return status == STATUS_OK;
}

static void status_short(const WatchState *s, char *buf, size_t n) {
  if (s->from_cache) { snprintf(buf, n, "Cached"); return; }
  switch (s->status) {
    case STATUS_OK: snprintf(buf, n, "Synced"); break;
    case STATUS_NO_TOKEN: snprintf(buf, n, "No token"); break;
    case STATUS_UNAUTHORIZED: snprintf(buf, n, "Bad token"); break;
    case STATUS_TOKEN_EXPIRED: snprintf(buf, n, "Expired"); break;
    case STATUS_PREMIUM_REQUIRED: snprintf(buf, n, "No Premium"); break;
    case STATUS_NETWORK: snprintf(buf, n, "Offline"); break;
    case STATUS_RATE_LIMITED: snprintf(buf, n, "Wait %ds", (int)s->retry_after); break;
    case STATUS_NO_BABY: snprintf(buf, n, "No baby"); break;
    default: snprintf(buf, n, "Error"); break;
  }
}

void model_status_text(const WatchState *s, char *buf, size_t n) {
  if (s->from_cache) { snprintf(buf, n, "Showing the last saved state. Waiting for the phone"); return; }
  switch (s->status) {
    case STATUS_OK: snprintf(buf, n, "Connected to nappi"); break;
    case STATUS_NO_TOKEN: snprintf(buf, n, "Enter your API token in the phone app's settings"); break;
    case STATUS_UNAUTHORIZED: snprintf(buf, n, "Token not accepted. Check the phone settings"); break;
    case STATUS_TOKEN_EXPIRED: snprintf(buf, n, "Token expired. Create a new one"); break;
    case STATUS_PREMIUM_REQUIRED: snprintf(buf, n, "nappi Premium is required"); break;
    case STATUS_NETWORK: snprintf(buf, n, "Phone can't reach nappi. Entries are queued"); break;
    case STATUS_RATE_LIMITED: snprintf(buf, n, "Rate limited. Retry in %d s", (int)s->retry_after); break;
    case STATUS_NO_BABY: snprintf(buf, n, "No babies in this nappi household"); break;
    default: snprintf(buf, n, "Unexpected response from nappi"); break;
  }
}

// ---- tiles ----

static void detail_line(const WatchState *s, int action, char *out, size_t n) {
  int32_t info = s->info[action];
  out[0] = '\0';
  if (s->last[action] <= 0) return;
  switch (action) {
    case ACTION_DIAPER:
      if (info > 0) snprintf(out, n, "%s", model_diaper_label((int)info - 1));
      break;
    case ACTION_BOTTLE:
      if (info > 0) fmt_amount(out, n, info, s->bottle_units);
      break;
    case ACTION_PUMP:
      if (info > 0) fmt_amount(out, n, info, s->pump_units);
      break;
    case ACTION_NURSING:
      snprintf(out, n, "%s", model_side_label((int)info));
      break;
    case ACTION_SLEEP:
      if (info > 0) fmt_duration_min(out, n, (int)info);
      break;
    case ACTION_POTTY:
      if (info > 0) snprintf(out, n, "%s", model_potty_label((int)info - 1));
      break;
    default:
      break;
  }
}

void model_tile_lines(const WatchState *s, int action, int32_t now,
                      char *l1, size_t n1, char *l2, size_t n2) {
  l1[0] = '\0';
  l2[0] = '\0';

  int timer = model_timer_for_action(action);
  if (timer >= 0 && model_timer_active(s, timer)) {
    fmt_elapsed_min(l1, n1, model_timer_elapsed(s, timer, now));
    if (s->timer_state[timer] == TIMER_STATE_PAUSED) snprintf(l2, n2, "Paused");
    else if (timer == TIMER_NURSING && s->timer_side[timer] != SIDE_NONE) snprintf(l2, n2, "%s", model_side_label(s->timer_side[timer]));
    else if (timer == TIMER_NURSING) snprintf(l2, n2, "Nursing");
    else if (timer == TIMER_SLEEP) snprintf(l2, n2, "Sleeping");
    else snprintf(l2, n2, "Pumping");
    return;
  }

  if (action == ACTION_STATUS) {
    status_short(s, l1, n1);
    if (s->pending > 0) snprintf(l2, n2, "%d pending", (int)s->pending);
    return;
  }

  if (action < 0 || action >= ACTION_COUNT) return;
  fmt_ago(l1, n1, now, s->last[action]);
  detail_line(s, action, l2, n2);
}

int model_banner(const WatchState *s, int32_t now, char *buf, size_t n) {
  buf[0] = '\0';
  for (int t = 0; t < TIMER_COUNT; t++) {
    if (!model_timer_active(s, t)) continue;
    char clock[16];
    fmt_elapsed_min(clock, sizeof clock, model_timer_elapsed(s, t, now));
    bool paused = s->timer_state[t] == TIMER_STATE_PAUSED;
    if (t == TIMER_SLEEP) {
      snprintf(buf, n, paused ? "Sleep paused %s" : "Sleeping %s", clock);
    } else if (t == TIMER_NURSING) {
      if (paused) snprintf(buf, n, "Nursing paused %s", clock);
      else if (s->timer_side[t] == SIDE_LEFT) snprintf(buf, n, "Nursing L %s", clock);
      else if (s->timer_side[t] == SIDE_RIGHT) snprintf(buf, n, "Nursing R %s", clock);
      else snprintf(buf, n, "Nursing %s", clock);
    } else {
      snprintf(buf, n, paused ? "Pump paused %s" : "Pumping %s", clock);
    }
    return t;
  }
  return -1;
}

void model_baby_name(const WatchState *s, int index, char *out, size_t n) {
  out[0] = '\0';
  if (index < 0 || index >= s->baby_count) return;
  const char *p = s->baby_names;
  for (int i = 0; i < index; i++) {
    p = strchr(p, '\n');
    if (!p) return;
    p++;
  }
  const char *end = strchr(p, '\n');
  size_t len = end ? (size_t)(end - p) : strlen(p);
  if (len >= n) len = n - 1;
  memcpy(out, p, len);
  out[len] = '\0';
}
