// Touch gesture state machine. The SDK only gives raw touchdown / position /
// liftoff events, so taps, drag-out cancel, long press and page swipes are
// decided here, over a set of rects. Plain C.
//
// Semantics (spec "Interaction model"):
//  - press on touchdown inside a rect;
//  - activate on liftoff only if the finger never left that rect;
//  - leaving the rect cancels, and coming back does not revive the tap;
//  - holding LONG_PRESS_MS fires long_press once and suppresses the tap;
//  - a mostly-horizontal move of SWIPE_MIN_PX fires one swipe and cancels.
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "layout.h"

#define TOUCH_MAX_RECTS 16
#define LONG_PRESS_MS 500
#define SWIPE_MIN_PX 40
#define SWIPE_LEFT (-1)   // finger moved left: next page
#define SWIPE_RIGHT 1

typedef struct {
  int press;       // rect index, or -1
  int cancel;
  int activate;
  int long_press;
  int swipe;       // SWIPE_LEFT, SWIPE_RIGHT or 0
} TouchResult;

// A hit rect plus the identity of what it stands for. A gesture survives a
// target-set refresh only if its target keeps the same rect and key.
typedef struct {
  Rect rect;
  int16_t key;
} TouchTarget;

typedef struct {
  TouchTarget targets[TOUCH_MAX_RECTS];
  int count;
  bool active;
  int target;
  int down_x, down_y;
  uint32_t down_ms;
  bool long_fired, cancelled, swiped;
} TouchFsm;

void touch_fsm_init(TouchFsm *f);
// Replaces the targets. An active gesture is kept if it has no target or its
// target index still exists with an equal rect and key; otherwise it is dropped.
void touch_fsm_set_targets(TouchFsm *f, const TouchTarget *targets, int count);
// Target index while a gesture is live (not cancelled, long-fired or swiped), else -1.
int touch_fsm_pressed(const TouchFsm *f);
TouchResult touch_fsm_down(TouchFsm *f, int x, int y, uint32_t now_ms);
TouchResult touch_fsm_move(TouchFsm *f, int x, int y, uint32_t now_ms);
TouchResult touch_fsm_up(TouchFsm *f, int x, int y, uint32_t now_ms);
TouchResult touch_fsm_tick(TouchFsm *f, uint32_t now_ms);
