#include "test.h"
#include "send_flow.h"
#include "protocol.h"

static SendFlow awaiting(int id, int view) {
  SendFlow f; sf_init(&f);
  sf_begin(&f, id, ACTION_DIAPER, view);
  return f;
}

TEST(a_second_begin_is_refused_while_awaiting) {
  SendFlow f; sf_init(&f);
  CHECK(!sf_busy(&f));
  CHECK_INT(sf_pending_id(&f), 0);
  CHECK(sf_begin(&f, 7, ACTION_DIAPER, 1));
  CHECK(!sf_begin(&f, 8, ACTION_BOTTLE, 1));
  CHECK(sf_busy(&f));
  CHECK_INT(sf_pending_id(&f), 7);
}

TEST(a_matching_ok_ack_confirms_and_navigates_only_from_the_sending_view) {
  SendFlow f = awaiting(7, 1);
  SfAck a = sf_on_ack(&f, 7, STATUS_OK, 1);
  CHECK_INT(a.outcome, SF_CONFIRMED);
  CHECK(a.navigate);
  CHECK(!sf_busy(&f));

  SendFlow g = awaiting(7, 1);
  SfAck b = sf_on_ack(&g, 7, STATUS_OK, 2);
  CHECK_INT(b.outcome, SF_CONFIRMED);
  CHECK(!b.navigate);
}

TEST(a_mismatched_or_repeated_ack_is_ignored) {
  SendFlow f = awaiting(7, 1);
  SfAck a = sf_on_ack(&f, 6, STATUS_OK, 1);
  CHECK_INT(a.outcome, SF_IGNORED);
  CHECK(!a.navigate);
  CHECK(!a.clear_lockout);
  CHECK(sf_busy(&f));
  CHECK_INT(sf_on_ack(&f, 7, STATUS_OK, 1).outcome, SF_CONFIRMED);
  SfAck again = sf_on_ack(&f, 7, STATUS_OK, 1);
  CHECK_INT(again.outcome, SF_IGNORED);
  CHECK(!again.navigate);
}

TEST(refusals_clear_the_lockout_but_no_reply_does_not) {
  SendFlow f = awaiting(7, 1);
  SfAck a = sf_on_ack(&f, 7, STATUS_WRONG_BABY, 1);
  CHECK_INT(a.outcome, SF_REFUSED);
  CHECK(a.clear_lockout);
  CHECK(!a.navigate);

  SendFlow g = awaiting(7, 1);
  SfAck b = sf_on_ack(&g, 7, COMM_ACK_NOT_SENT, 1);
  CHECK_INT(b.outcome, SF_REFUSED);
  CHECK(b.clear_lockout);

  SendFlow h = awaiting(7, 1);
  SfAck c = sf_on_ack(&h, 7, COMM_ACK_NO_REPLY, 1);
  CHECK_INT(c.outcome, SF_UNCONFIRMED);
  CHECK(!c.clear_lockout);
}

TEST(a_timeout_without_an_ack_is_unconfirmed_and_a_late_ack_is_ignored) {
  SendFlow f = awaiting(7, 1);
  CHECK_INT(sf_on_timeout(&f), SF_UNCONFIRMED);
  CHECK(!sf_busy(&f));
  CHECK_INT(sf_on_ack(&f, 7, STATUS_OK, 1).outcome, SF_IGNORED);
  CHECK_INT(sf_on_timeout(&f), SF_IGNORED);
}

TEST(without_exit_after_log_a_confirmed_log_goes_home) {
  SendFlow f = awaiting(7, 1);
  sf_on_ack(&f, 7, STATUS_OK, 1);
  CHECK_INT(sf_after_logged(&f, false, 1), SF_GO_HOME);
}

TEST(exit_waits_for_a_state_received_after_the_ack) {
  SendFlow f = awaiting(7, 1);
  CHECK_INT(sf_on_state(&f, 0, 1), SF_NOTHING);  // before the ack: not counted
  sf_on_ack(&f, 7, STATUS_OK, 1);
  CHECK_INT(sf_after_logged(&f, true, 1), SF_WAIT_DELIVERY);
  CHECK_INT(sf_on_state(&f, 1, 1), SF_NOTHING);
  CHECK_INT(sf_on_state(&f, 0, 1), SF_EXIT_NOW);
}

TEST(a_state_between_the_ack_and_the_checkmark_counts) {
  SendFlow f = awaiting(7, 1);
  sf_on_ack(&f, 7, STATUS_OK, 1);
  sf_on_state(&f, 0, 1);
  CHECK_INT(sf_after_logged(&f, true, 1), SF_EXIT_NOW);

  SendFlow g = awaiting(7, 1);
  sf_on_ack(&g, 7, STATUS_OK, 1);
  sf_on_state(&g, 2, 1);
  CHECK_INT(sf_after_logged(&g, true, 1), SF_WAIT_DELIVERY);
}

TEST(exit_wait_is_cancelled_when_the_view_is_no_longer_on_top) {
  SendFlow f = awaiting(7, 1);
  sf_on_ack(&f, 7, STATUS_OK, 1);
  CHECK_INT(sf_after_logged(&f, true, 1), SF_WAIT_DELIVERY);
  CHECK_INT(sf_on_state(&f, 0, 2), SF_NOTHING);
  CHECK_INT(sf_on_state(&f, 0, 1), SF_NOTHING);
}

TEST(exit_timeout_stays_open_only_if_the_view_is_still_on_top) {
  SendFlow f = awaiting(7, 1);
  sf_on_ack(&f, 7, STATUS_OK, 1);
  sf_after_logged(&f, true, 1);
  CHECK_INT(sf_on_exit_timeout(&f, 1), SF_STAY_OPEN);

  SendFlow g = awaiting(7, 1);
  sf_on_ack(&g, 7, STATUS_OK, 1);
  sf_after_logged(&g, true, 1);
  CHECK_INT(sf_on_exit_timeout(&g, 2), SF_NOTHING);

  SendFlow h; sf_init(&h);
  CHECK_INT(sf_on_exit_timeout(&h, 1), SF_NOTHING);
  SendFlow k = awaiting(7, 1);
  CHECK_INT(sf_on_exit_timeout(&k, 1), SF_NOTHING);
  CHECK(sf_busy(&k));
}

TEST(a_new_begin_cancels_an_exit_wait) {
  SendFlow f = awaiting(7, 1);
  sf_on_ack(&f, 7, STATUS_OK, 1);
  sf_after_logged(&f, true, 1);
  CHECK(sf_begin(&f, 8, ACTION_BOTTLE, 1));
  CHECK_INT(sf_on_state(&f, 0, 1), SF_NOTHING);
  CHECK(sf_busy(&f));
}

TEST(an_unprompted_reject_cancels_an_exit_wait) {
  SendFlow f = awaiting(7, 1);
  sf_on_ack(&f, 7, STATUS_OK, 1);
  CHECK_INT(sf_after_logged(&f, true, 1), SF_WAIT_DELIVERY);
  sf_on_unprompted_reject(&f);
  CHECK_INT(f.phase, SF_IDLE);
  CHECK_INT(sf_on_state(&f, 0, 1), SF_NOTHING);
}

TEST(an_unprompted_reject_leaves_an_awaited_command_alone) {
  SendFlow f = awaiting(7, 1);
  sf_on_unprompted_reject(&f);
  CHECK_INT(f.phase, SF_AWAITING);
  CHECK(sf_busy(&f));
  CHECK_INT(sf_pending_id(&f), 7);
}

TEST(an_unprompted_reject_while_idle_changes_nothing) {
  SendFlow f; sf_init(&f);
  sf_on_unprompted_reject(&f);
  CHECK_INT(f.phase, SF_IDLE);
  CHECK(!sf_busy(&f));
}

int main(void) {
  RUN(a_second_begin_is_refused_while_awaiting);
  RUN(a_matching_ok_ack_confirms_and_navigates_only_from_the_sending_view);
  RUN(a_mismatched_or_repeated_ack_is_ignored);
  RUN(refusals_clear_the_lockout_but_no_reply_does_not);
  RUN(a_timeout_without_an_ack_is_unconfirmed_and_a_late_ack_is_ignored);
  RUN(without_exit_after_log_a_confirmed_log_goes_home);
  RUN(exit_waits_for_a_state_received_after_the_ack);
  RUN(a_state_between_the_ack_and_the_checkmark_counts);
  RUN(exit_wait_is_cancelled_when_the_view_is_no_longer_on_top);
  RUN(exit_timeout_stays_open_only_if_the_view_is_still_on_top);
  RUN(a_new_begin_cancels_an_exit_wait);
  RUN(an_unprompted_reject_cancels_an_exit_wait);
  RUN(an_unprompted_reject_leaves_an_awaited_command_alone);
  RUN(an_unprompted_reject_while_idle_changes_nothing);
  FINISH();
}
