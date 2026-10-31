#include "touch_fsm.h"
#include <string.h>

static TouchResult none(void) {
  TouchResult r = { -1, -1, -1, -1, 0 };
  return r;
}

static int hit(const TouchFsm *f, int x, int y) {
  for (int i = 0; i < f->count; i++) {
    if (rect_contains(f->targets[i].rect, x, y)) return i;
  }
  return -1;
}

static int iabs(int v) {
  return v < 0 ? -v : v;
}

void touch_fsm_init(TouchFsm *f) {
  memset(f, 0, sizeof(*f));
  f->target = -1;
}

static bool same_rect(Rect a, Rect b) {
  return a.x == b.x && a.y == b.y && a.w == b.w && a.h == b.h;
}

void touch_fsm_set_targets(TouchFsm *f, const TouchTarget *targets, int count) {
  if (count > TOUCH_MAX_RECTS) count = TOUCH_MAX_RECTS;
  if (count < 0) count = 0;
  bool keep = f->active &&
              (f->target < 0 ||
               (f->target < count && f->target < f->count &&
                same_rect(f->targets[f->target].rect, targets[f->target].rect) &&
                f->targets[f->target].key == targets[f->target].key));
  if (count > 0) memcpy(f->targets, targets, sizeof(TouchTarget) * (size_t)count);
  f->count = count;
  if (!keep) {
    f->active = false;
    f->target = -1;
  }
}

int touch_fsm_pressed(const TouchFsm *f) {
  if (f->active && f->target >= 0 && !f->cancelled && !f->long_fired && !f->swiped) return f->target;
  return -1;
}

TouchResult touch_fsm_down(TouchFsm *f, int x, int y, uint32_t now_ms) {
  TouchResult r = none();
  f->active = true;
  f->down_x = x;
  f->down_y = y;
  f->down_ms = now_ms;
  f->long_fired = false;
  f->cancelled = false;
  f->swiped = false;
  f->target = hit(f, x, y);
  r.press = f->target;
  return r;
}

TouchResult touch_fsm_move(TouchFsm *f, int x, int y, uint32_t now_ms) {
  TouchResult r = none();
  (void)now_ms;
  if (!f->active) return r;

  int dx = x - f->down_x;
  int dy = y - f->down_y;
  if (!f->swiped && iabs(dx) >= SWIPE_MIN_PX && iabs(dx) > 2 * iabs(dy)) {
    f->swiped = true;
    r.swipe = dx < 0 ? SWIPE_LEFT : SWIPE_RIGHT;
    if (f->target >= 0 && !f->cancelled) {
      r.cancel = f->target;
      f->cancelled = true;
    }
    return r;
  }

  if (f->target >= 0 && !f->cancelled && !rect_contains(f->targets[f->target].rect, x, y)) {
    r.cancel = f->target;
    f->cancelled = true;
  }
  return r;
}

TouchResult touch_fsm_up(TouchFsm *f, int x, int y, uint32_t now_ms) {
  TouchResult r = none();
  (void)now_ms;
  if (!f->active) return r;
  f->active = false;
  if (f->target >= 0 && !f->cancelled && !f->long_fired && !f->swiped &&
      rect_contains(f->targets[f->target].rect, x, y)) {
    r.activate = f->target;
  }
  return r;
}

TouchResult touch_fsm_tick(TouchFsm *f, uint32_t now_ms) {
  TouchResult r = none();
  if (f->active && f->target >= 0 && !f->cancelled && !f->long_fired && !f->swiped &&
      (uint32_t)(now_ms - f->down_ms) >= LONG_PRESS_MS) {
    f->long_fired = true;
    r.long_press = f->target;
  }
  return r;
}
