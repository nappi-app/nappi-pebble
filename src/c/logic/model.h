// The watch's view of nappi: the state the phone sends, and everything the
// UI needs to turn it into words. Plain C, host-tested.
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "protocol.h"

#define BABY_NAME_LEN 24
#define BABY_NAMES_LEN 96

typedef struct {
  uint8_t status;
  int32_t retry_after;
  bool has_data;
  bool from_cache;                   // loaded from persist, not yet confirmed by the phone

  char baby_name[BABY_NAME_LEN];
  char baby_names[BABY_NAMES_LEN];   // newline-joined
  uint8_t baby_count, baby_index, baby_accent;
  bool other_timers;

  uint8_t bottle_units, pump_units;
  bool exit_after_log;
  uint8_t default_bottle;

  uint8_t layout[ACTION_COUNT];
  uint8_t layout_count;

  int32_t last[ACTION_COUNT];        // epoch seconds, 0 = none
  int32_t info[ACTION_COUNT];

  uint8_t timer_state[TIMER_COUNT];
  int32_t timer_elapsed[TIMER_COUNT];
  uint8_t timer_side[TIMER_COUNT];
  int32_t timer_at;                  // epoch seconds the elapsed values were valid

  int32_t pending;                   // writes the phone has not delivered yet
} WatchState;

// The struct is persisted as a raw blob on the watch: changing WatchState
// means bumping PERSIST_VERSION in comm.c. Only int32_t/uint8_t/bool/char
// members, so the size is the same on the host and on the 32-bit ARM watch.
typedef char watchstate_size_check[(sizeof(WatchState) == 232) ? 1 : -1];

void model_default(WatchState *s);

int32_t model_timer_elapsed(const WatchState *s, int timer, int32_t now);
bool model_timer_active(const WatchState *s, int timer);   // running or paused
int model_timer_for_action(int action);                    // -1 if none

const char *model_action_title(int action);
const char *model_diaper_label(int type);
const char *model_potty_label(int outcome);
const char *model_side_label(int side);
const char *model_bottle_type_label(int type);

// The two text lines on a home tile (timer clock when one is active).
void model_tile_lines(const WatchState *s, int action, int32_t now,
                      char *l1, size_t n1, char *l2, size_t n2);

// Banner text for the running timer ("Sleeping 1:12:04"); returns its
// timer index, or -1 with buf empty when nothing is running.
int model_banner(const WatchState *s, int32_t now, char *buf, size_t n);

bool model_status_ok(int status);
void model_status_text(const WatchState *s, char *buf, size_t n);

void model_baby_name(const WatchState *s, int index, char *out, size_t n);
