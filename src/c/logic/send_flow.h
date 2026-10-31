// The life of one logged command, from tap to checkmark to (optionally) exit.
// Pure state: no timers, no clock. The caller owns the timers and calls
// sf_on_timeout / sf_on_exit_timeout when they fire. `view` is an opaque
// nonzero id for the screen that sent the command; 0 means no view. Plain C.
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "protocol.h"

typedef enum { SF_IDLE, SF_AWAITING, SF_EXIT_WAIT } SfPhase;

typedef struct {
  SfPhase phase;
  int cmd_id, action, view;
  int states_since_ack;   // phone states received since the last ack (saturates)
  int32_t last_pending;   // pending count in the latest phone state
} SendFlow;

typedef enum { SF_IGNORED, SF_CONFIRMED, SF_REFUSED, SF_UNCONFIRMED } SfOutcome;

typedef struct {
  SfOutcome outcome;
  bool navigate;        // confirmed while the sending view is still on top
  bool clear_lockout;   // the command never took effect: allow an immediate retry
} SfAck;

typedef enum { SF_NOTHING, SF_GO_HOME, SF_WAIT_DELIVERY, SF_EXIT_NOW, SF_STAY_OPEN } SfNext;

void sf_init(SendFlow *f);

// True while a command is awaiting its ack.
bool sf_busy(const SendFlow *f);

// The awaited command id, or 0 when not awaiting.
int sf_pending_id(const SendFlow *f);

// Start awaiting an ack. False (and no change) if already awaiting. Starting
// while waiting to exit cancels that wait.
bool sf_begin(SendFlow *f, int cmd_id, int action, int view);

// An ack arrived. Anything that is not the awaited command (stale, repeated,
// or after the timeout) is SF_IGNORED and changes nothing.
SfAck sf_on_ack(SendFlow *f, int cmd_id, int status, int top_view);

// The ack timer fired.
SfOutcome sf_on_timeout(SendFlow *f);

// The confirmation has been shown. Says what to do next.
SfNext sf_after_logged(SendFlow *f, bool exit_after_log, int view);

// A phone state arrived.
SfNext sf_on_state(SendFlow *f, int32_t pending, int top_view);

// The exit-wait timer fired.
SfNext sf_on_exit_timeout(SendFlow *f, int top_view);

// The phone said, unprompted, that nappi refused a write. Ends an exit wait
// (the app must not close as if delivered); an awaited command keeps waiting
// for its own ack.
void sf_on_unprompted_reject(SendFlow *f);
