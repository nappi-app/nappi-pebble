#include "test.h"
#include "ready_gate.h"

TEST(sending_is_blocked_until_the_phone_speaks) {
  ReadyGate g; rg_init(&g);
  CHECK(!rg_may_send(&g));
  CHECK(!rg_not_responding(&g));
}

TEST(any_phone_message_unblocks_sending) {
  ReadyGate g; rg_init(&g);
  rg_on_phone_message(&g);
  CHECK(rg_may_send(&g));
  CHECK(!rg_not_responding(&g));
}

TEST(the_fallback_allows_sending_and_flags_not_responding) {
  ReadyGate g; rg_init(&g);
  rg_on_fallback(&g);
  CHECK(rg_may_send(&g));
  CHECK(rg_not_responding(&g));
}

TEST(a_message_after_the_fallback_clears_not_responding) {
  ReadyGate g; rg_init(&g);
  rg_on_fallback(&g);
  rg_on_phone_message(&g);
  CHECK(rg_may_send(&g));
  CHECK(!rg_not_responding(&g));
}

TEST(a_connection_change_resets_readiness_and_rearms_the_fallback) {
  ReadyGate g; rg_init(&g);
  rg_on_phone_message(&g);
  rg_on_connection(&g, false);
  CHECK(!rg_may_send(&g));
  CHECK(!rg_not_responding(&g));
  rg_on_connection(&g, true);
  CHECK(!rg_may_send(&g));
  rg_on_fallback(&g);
  CHECK(rg_may_send(&g));
  CHECK(rg_not_responding(&g));
  // A fallback flag from the previous connection does not survive a change either.
  rg_on_connection(&g, false);
  CHECK(!rg_may_send(&g));
  CHECK(!rg_not_responding(&g));
}

TEST(repeated_messages_and_an_early_fallback_are_harmless) {
  ReadyGate g; rg_init(&g);
  rg_on_phone_message(&g);
  rg_on_fallback(&g);
  CHECK(rg_may_send(&g));
  CHECK(!rg_not_responding(&g));
  for (int i = 0; i < 10; i++) rg_on_phone_message(&g);
  CHECK(rg_may_send(&g));
  CHECK(!rg_not_responding(&g));
}

int main(void) {
  RUN(sending_is_blocked_until_the_phone_speaks);
  RUN(any_phone_message_unblocks_sending);
  RUN(the_fallback_allows_sending_and_flags_not_responding);
  RUN(a_message_after_the_fallback_clears_not_responding);
  RUN(a_connection_change_resets_readiness_and_rearms_the_fallback);
  RUN(repeated_messages_and_an_early_fallback_are_harmless);
  FINISH();
}
