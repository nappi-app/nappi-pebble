#include "test.h"
#include "lockout.h"
#include "protocol.h"

TEST(the_first_attempt_is_allowed_and_a_repeat_inside_the_lockout_is_not) {
  Lockout l; lockout_init(&l);
  CHECK(lockout_try(&l, ACTION_DIAPER, 10000));
  CHECK(!lockout_try(&l, ACTION_DIAPER, 10000 + LOCKOUT_MS - 1));
  CHECK(lockout_try(&l, ACTION_DIAPER, 10000 + LOCKOUT_MS));
}

TEST(a_denied_attempt_does_not_extend_the_lockout) {
  Lockout l; lockout_init(&l);
  lockout_try(&l, ACTION_BOTTLE, 0);
  CHECK(!lockout_try(&l, ACTION_BOTTLE, 1000));
  CHECK(lockout_try(&l, ACTION_BOTTLE, LOCKOUT_MS));
}

TEST(actions_are_locked_independently) {
  Lockout l; lockout_init(&l);
  CHECK(lockout_try(&l, ACTION_DIAPER, 100));
  CHECK(lockout_try(&l, ACTION_BOTTLE, 200));
  CHECK(!lockout_try(&l, ACTION_DIAPER, 300));
}

TEST(time_zero_is_a_legitimate_first_attempt) {
  Lockout l; lockout_init(&l);
  CHECK(lockout_try(&l, ACTION_POTTY, 0));
  CHECK(!lockout_try(&l, ACTION_POTTY, 10));
}

TEST(clearing_an_action_lets_it_fire_again_at_once) {
  Lockout l; lockout_init(&l);
  CHECK(lockout_try(&l, ACTION_DIAPER, 100));
  lockout_clear(&l, ACTION_DIAPER);
  CHECK(lockout_try(&l, ACTION_DIAPER, 200));
  CHECK(!lockout_try(&l, ACTION_DIAPER, 300));
}

TEST(clearing_leaves_other_actions_and_bad_indexes_alone) {
  Lockout l; lockout_init(&l);
  lockout_try(&l, ACTION_BOTTLE, 100);
  lockout_clear(&l, ACTION_DIAPER);
  lockout_clear(&l, -1);
  lockout_clear(&l, ACTION_COUNT);
  CHECK(!lockout_try(&l, ACTION_BOTTLE, 200));
}

TEST(out_of_range_actions_are_refused) {
  Lockout l; lockout_init(&l);
  CHECK(!lockout_try(&l, -1, 0));
  CHECK(!lockout_try(&l, ACTION_COUNT, 0));
}

TEST(the_lockout_survives_the_32_bit_millisecond_wrap) {
  Lockout l; lockout_init(&l);
  CHECK(lockout_try(&l, ACTION_DIAPER, 0xFFFFFF00u));
  CHECK(!lockout_try(&l, ACTION_DIAPER, 0x00000010u));
  CHECK(lockout_try(&l, ACTION_DIAPER, 0xFFFFFF00u + LOCKOUT_MS + 5));
}

int main(void) {
  RUN(the_first_attempt_is_allowed_and_a_repeat_inside_the_lockout_is_not);
  RUN(a_denied_attempt_does_not_extend_the_lockout);
  RUN(actions_are_locked_independently);
  RUN(time_zero_is_a_legitimate_first_attempt);
  RUN(clearing_an_action_lets_it_fire_again_at_once);
  RUN(clearing_leaves_other_actions_and_bad_indexes_alone);
  RUN(out_of_range_actions_are_refused);
  RUN(the_lockout_survives_the_32_bit_millisecond_wrap);
  FINISH();
}
