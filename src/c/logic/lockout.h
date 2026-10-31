// Per-action debounce: the API has no delete, so a second tap on the same
// action within LOCKOUT_MS of an accepted one is ignored. Plain C.
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "protocol.h"

#define LOCKOUT_MS 1500

typedef struct {
  uint32_t last_ms[ACTION_COUNT];
  bool seen[ACTION_COUNT];
} Lockout;

void lockout_init(Lockout *l);

// True (and records the time) if the action may fire now.
bool lockout_try(Lockout *l, int action, uint32_t now_ms);

// Forget the last attempt, for an action that never reached the phone: the
// user may try again at once.
void lockout_clear(Lockout *l, int action);
