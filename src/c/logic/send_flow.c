#include "send_flow.h"

#define STATES_MAX 1000

void sf_init(SendFlow *f) {
  f->phase = SF_IDLE;
  f->cmd_id = 0;
  f->action = 0;
  f->view = 0;
  f->states_since_ack = 0;
  f->last_pending = 0;
}

bool sf_busy(const SendFlow *f) { return f->phase == SF_AWAITING; }

int sf_pending_id(const SendFlow *f) { return f->phase == SF_AWAITING ? f->cmd_id : 0; }

bool sf_begin(SendFlow *f, int cmd_id, int action, int view) {
  if (f->phase == SF_AWAITING) return false;
  f->phase = SF_AWAITING;
  f->cmd_id = cmd_id;
  f->action = action;
  f->view = view;
  f->states_since_ack = 0;
  return true;
}

SfAck sf_on_ack(SendFlow *f, int cmd_id, int status, int top_view) {
  SfAck a = { SF_IGNORED, false, false };
  if (f->phase != SF_AWAITING || cmd_id != f->cmd_id) return a;
  f->phase = SF_IDLE;
  f->states_since_ack = 0;
  if (status == STATUS_OK) {
    a.outcome = SF_CONFIRMED;
    a.navigate = (top_view == f->view);
  } else if (status == COMM_ACK_NO_REPLY) {
    a.outcome = SF_UNCONFIRMED;
  } else {
    a.outcome = SF_REFUSED;
    a.clear_lockout = true;
  }
  return a;
}

SfOutcome sf_on_timeout(SendFlow *f) {
  if (f->phase != SF_AWAITING) return SF_IGNORED;
  f->phase = SF_IDLE;
  return SF_UNCONFIRMED;
}

SfNext sf_after_logged(SendFlow *f, bool exit_after_log, int view) {
  if (!exit_after_log) return SF_GO_HOME;
  if (f->states_since_ack > 0 && f->last_pending == 0) return SF_EXIT_NOW;
  f->phase = SF_EXIT_WAIT;
  f->view = view;
  return SF_WAIT_DELIVERY;
}

SfNext sf_on_state(SendFlow *f, int32_t pending, int top_view) {
  f->last_pending = pending;
  if (f->states_since_ack < STATES_MAX) f->states_since_ack++;
  if (f->phase != SF_EXIT_WAIT) return SF_NOTHING;
  if (top_view != f->view) {
    f->phase = SF_IDLE;
    return SF_NOTHING;
  }
  if (pending == 0) {
    f->phase = SF_IDLE;
    return SF_EXIT_NOW;
  }
  return SF_NOTHING;
}

SfNext sf_on_exit_timeout(SendFlow *f, int top_view) {
  if (f->phase != SF_EXIT_WAIT) return SF_NOTHING;
  f->phase = SF_IDLE;
  return top_view == f->view ? SF_STAY_OPEN : SF_NOTHING;
}

void sf_on_unprompted_reject(SendFlow *f) {
  if (f->phase == SF_EXIT_WAIT) f->phase = SF_IDLE;
}
