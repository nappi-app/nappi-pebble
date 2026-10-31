#include "test.h"
#include "model.h"

#define NOW 100000

static WatchState fresh(void) {
  WatchState s;
  model_default(&s);
  s.has_data = true;
  s.timer_at = NOW;
  return s;
}

TEST(default_state_has_no_data_and_the_spec_layout) {
  WatchState s;
  model_default(&s);
  CHECK(!s.has_data);
  CHECK_INT(s.bottle_units, UNITS_OZ);
  CHECK_INT(s.pump_units, UNITS_OZ);
  CHECK_INT(ACTION_COUNT, 7);
  CHECK_INT(s.layout_count, 7);
  CHECK_INT(s.layout[0], ACTION_DIAPER);
  CHECK_INT(s.layout[6], ACTION_STATUS);
  CHECK_INT(s.baby_count, 0);
}

TEST(a_running_timer_ticks_on_from_its_snapshot) {
  WatchState s = fresh();
  s.timer_state[TIMER_SLEEP] = TIMER_STATE_RUNNING;
  s.timer_elapsed[TIMER_SLEEP] = 600;
  CHECK_INT(model_timer_elapsed(&s, TIMER_SLEEP, NOW), 600);
  CHECK_INT(model_timer_elapsed(&s, TIMER_SLEEP, NOW + 45), 645);
}

TEST(a_paused_timer_does_not_tick) {
  WatchState s = fresh();
  s.timer_state[TIMER_NURSING] = TIMER_STATE_PAUSED;
  s.timer_elapsed[TIMER_NURSING] = 240;
  CHECK_INT(model_timer_elapsed(&s, TIMER_NURSING, NOW + 500), 240);
}

TEST(no_timer_has_zero_elapsed_and_a_clock_behind_the_snapshot_does_not_go_negative) {
  WatchState s = fresh();
  CHECK_INT(model_timer_elapsed(&s, TIMER_SLEEP, NOW + 99), 0);
  s.timer_state[TIMER_SLEEP] = TIMER_STATE_RUNNING;
  s.timer_elapsed[TIMER_SLEEP] = 50;
  CHECK_INT(model_timer_elapsed(&s, TIMER_SLEEP, NOW - 30), 50);
}

TEST(timer_active_means_running_or_paused) {
  WatchState s = fresh();
  CHECK(!model_timer_active(&s, TIMER_SLEEP));
  s.timer_state[TIMER_SLEEP] = TIMER_STATE_RUNNING;
  CHECK(model_timer_active(&s, TIMER_SLEEP));
  s.timer_state[TIMER_SLEEP] = TIMER_STATE_PAUSED;
  CHECK(model_timer_active(&s, TIMER_SLEEP));
  CHECK(!model_timer_active(&s, 9));
}

TEST(actions_map_to_their_timers) {
  CHECK_INT(model_timer_for_action(ACTION_SLEEP), TIMER_SLEEP);
  CHECK_INT(model_timer_for_action(ACTION_NURSING), TIMER_NURSING);
  CHECK_INT(model_timer_for_action(ACTION_PUMP), TIMER_PUMPING);
  CHECK_INT(model_timer_for_action(ACTION_DIAPER), -1);
  CHECK_INT(model_timer_for_action(ACTION_STATUS), -1);
}

TEST(titles_and_labels) {
  CHECK_STR(model_action_title(ACTION_DIAPER), "Diaper");
  CHECK_STR(model_action_title(ACTION_NURSING), "Nursing");
  CHECK_STR(model_action_title(ACTION_STATUS), "Status");
  CHECK_STR(model_diaper_label(DIAPER_POO), "Poo");
  CHECK_STR(model_potty_label(POTTY_SAT_DRY), "Sat dry");
  CHECK_STR(model_side_label(SIDE_LEFT), "Left");
  CHECK_STR(model_side_label(SIDE_BOTH), "Both");
  CHECK_STR(model_bottle_type_label(BOTTLE_TYPE_BREAST_MILK), "Breast milk");
  CHECK_STR(model_diaper_label(9), "?");
}

TEST(idle_tile_shows_how_long_ago_and_the_detail) {
  WatchState s = fresh();
  char l1[24], l2[24];
  s.last[ACTION_DIAPER] = NOW - 2 * 3600 - 30;
  s.info[ACTION_DIAPER] = DIAPER_POO + 1;
  model_tile_lines(&s, ACTION_DIAPER, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l1, "2h ago"); CHECK_STR(l2, "Poo");

  s.last[ACTION_BOTTLE] = NOW - 600; s.info[ACTION_BOTTLE] = 40;
  model_tile_lines(&s, ACTION_BOTTLE, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l1, "10m ago"); CHECK_STR(l2, "4 oz");

  s.bottle_units = UNITS_ML; s.info[ACTION_BOTTLE] = 1200;
  model_tile_lines(&s, ACTION_BOTTLE, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l2, "120 ml");

  s.last[ACTION_NURSING] = NOW - 3600; s.info[ACTION_NURSING] = SIDE_LEFT;
  model_tile_lines(&s, ACTION_NURSING, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l1, "1h ago"); CHECK_STR(l2, "Left");

  s.last[ACTION_SLEEP] = NOW - 7200; s.info[ACTION_SLEEP] = 72;
  model_tile_lines(&s, ACTION_SLEEP, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l2, "1h 12m");

  s.pump_units = UNITS_OZ; s.last[ACTION_PUMP] = NOW - 60; s.info[ACTION_PUMP] = 30;
  model_tile_lines(&s, ACTION_PUMP, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l2, "3 oz");

  s.last[ACTION_POTTY] = NOW - 60; s.info[ACTION_POTTY] = POTTY_ACCIDENT + 1;
  model_tile_lines(&s, ACTION_POTTY, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l2, "Accident");
}

TEST(bottle_and_pump_tiles_use_their_own_units) {
  WatchState s = fresh();
  char l1[24], l2[24];
  s.bottle_units = UNITS_OZ; s.pump_units = UNITS_ML;
  s.last[ACTION_BOTTLE] = NOW - 600; s.info[ACTION_BOTTLE] = 40;
  s.last[ACTION_PUMP] = NOW - 600; s.info[ACTION_PUMP] = 1200;
  model_tile_lines(&s, ACTION_BOTTLE, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l2, "4 oz");
  model_tile_lines(&s, ACTION_PUMP, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l2, "120 ml");
}

TEST(a_tile_with_no_history_shows_dashes) {
  WatchState s = fresh();
  char l1[24], l2[24];
  model_tile_lines(&s, ACTION_DIAPER, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l1, "--"); CHECK_STR(l2, "");
}

TEST(a_running_timer_replaces_the_tile_text_with_its_clock) {
  WatchState s = fresh();
  char l1[24], l2[24];
  s.timer_state[TIMER_SLEEP] = TIMER_STATE_RUNNING;
  s.timer_elapsed[TIMER_SLEEP] = 4324;
  model_tile_lines(&s, ACTION_SLEEP, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l1, "1h 12m"); CHECK_STR(l2, "Sleeping");

  s.timer_state[TIMER_NURSING] = TIMER_STATE_RUNNING;
  s.timer_elapsed[TIMER_NURSING] = 252;
  s.timer_side[TIMER_NURSING] = SIDE_LEFT;
  model_tile_lines(&s, ACTION_NURSING, NOW + 8, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l1, "4m"); CHECK_STR(l2, "Left");

  s.timer_state[TIMER_NURSING] = TIMER_STATE_PAUSED;
  model_tile_lines(&s, ACTION_NURSING, NOW + 8, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l1, "4m"); CHECK_STR(l2, "Paused");
}

TEST(the_banner_shows_the_running_timer) {
  WatchState s = fresh();
  char b[40];
  CHECK_INT(model_banner(&s, NOW, b, sizeof b), -1);
  CHECK_STR(b, "");

  s.timer_state[TIMER_SLEEP] = TIMER_STATE_RUNNING;
  s.timer_elapsed[TIMER_SLEEP] = 4324;
  CHECK_INT(model_banner(&s, NOW, b, sizeof b), TIMER_SLEEP);
  CHECK_STR(b, "Sleeping 1h 12m");
  model_banner(&s, NOW + 10, b, sizeof b);
  CHECK_STR(b, "Sleeping 1h 12m");
}

TEST(the_banner_names_the_nursing_side_and_marks_pauses) {
  WatchState s = fresh();
  char b[40];
  s.timer_state[TIMER_NURSING] = TIMER_STATE_RUNNING;
  s.timer_elapsed[TIMER_NURSING] = 252;
  s.timer_side[TIMER_NURSING] = SIDE_RIGHT;
  CHECK_INT(model_banner(&s, NOW, b, sizeof b), TIMER_NURSING);
  CHECK_STR(b, "Nursing R 4m");
  s.timer_state[TIMER_NURSING] = TIMER_STATE_PAUSED;
  model_banner(&s, NOW + 60, b, sizeof b);
  CHECK_STR(b, "Nursing paused 4m");
}

TEST(with_several_timers_the_lowest_numbered_wins) {
  WatchState s = fresh();
  char b[40];
  s.timer_state[TIMER_SLEEP] = TIMER_STATE_RUNNING;
  s.timer_state[TIMER_PUMPING] = TIMER_STATE_RUNNING;
  CHECK_INT(model_banner(&s, NOW, b, sizeof b), TIMER_SLEEP);
}

TEST(the_status_tile_reports_sync_state_and_pending_writes) {
  WatchState s = fresh();
  char l1[24], l2[24];
  model_tile_lines(&s, ACTION_STATUS, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l1, "Synced"); CHECK_STR(l2, "");
  s.pending = 2;
  model_tile_lines(&s, ACTION_STATUS, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l2, "2 pending");
  s.status = STATUS_NETWORK;
  model_tile_lines(&s, ACTION_STATUS, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l1, "Offline");
  s.status = STATUS_RATE_LIMITED; s.retry_after = 40;
  model_tile_lines(&s, ACTION_STATUS, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l1, "Wait 40s");
}

TEST(a_cached_state_says_cached) {
  WatchState s = fresh();
  char l1[24], l2[24], b[96];
  s.from_cache = true;
  model_tile_lines(&s, ACTION_STATUS, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l1, "Cached");
  model_status_text(&s, b, sizeof b);
  CHECK_STR(b, "Showing the last saved state. Waiting for the phone");
}

TEST(a_live_state_does_not) {
  WatchState s = fresh();
  char l1[24], l2[24], b[96];
  model_tile_lines(&s, ACTION_STATUS, NOW, l1, sizeof l1, l2, sizeof l2);
  CHECK_STR(l1, "Synced");
  model_status_text(&s, b, sizeof b);
  CHECK_STR(b, "Connected to nappi");
}

TEST(default_state_is_not_from_cache) {
  WatchState s;
  model_default(&s);
  CHECK(!s.from_cache);
}

TEST(status_has_a_sentence_for_every_state) {
  char b[96];
  for (int st = 0; st <= STATUS_ERROR; st++) {
    WatchState s = fresh();
    s.status = (uint8_t)st;
    model_status_text(&s, b, sizeof b);
    CHECK(strlen(b) > 3);
  }
  WatchState s = fresh();
  s.status = STATUS_NO_TOKEN;
  model_status_text(&s, b, sizeof b);
  CHECK(strstr(b, "token") != NULL);
  s.status = STATUS_RATE_LIMITED; s.retry_after = 12;
  model_status_text(&s, b, sizeof b);
  CHECK(strstr(b, "12") != NULL);
}

TEST(only_ok_counts_as_healthy) {
  CHECK(model_status_ok(STATUS_OK));
  CHECK(!model_status_ok(STATUS_NETWORK));
  CHECK(!model_status_ok(STATUS_RATE_LIMITED));
}

TEST(baby_names_are_split_from_the_newline_joined_string) {
  WatchState s = fresh();
  snprintf(s.baby_names, sizeof s.baby_names, "Phoebe\nOscar\nIvy");
  s.baby_count = 3;
  char n[24];
  model_baby_name(&s, 0, n, sizeof n); CHECK_STR(n, "Phoebe");
  model_baby_name(&s, 1, n, sizeof n); CHECK_STR(n, "Oscar");
  model_baby_name(&s, 2, n, sizeof n); CHECK_STR(n, "Ivy");
  model_baby_name(&s, 3, n, sizeof n); CHECK_STR(n, "");
}

int main(void) {
  RUN(default_state_has_no_data_and_the_spec_layout);
  RUN(a_running_timer_ticks_on_from_its_snapshot);
  RUN(a_paused_timer_does_not_tick);
  RUN(no_timer_has_zero_elapsed_and_a_clock_behind_the_snapshot_does_not_go_negative);
  RUN(timer_active_means_running_or_paused);
  RUN(actions_map_to_their_timers);
  RUN(titles_and_labels);
  RUN(idle_tile_shows_how_long_ago_and_the_detail);
  RUN(bottle_and_pump_tiles_use_their_own_units);
  RUN(a_tile_with_no_history_shows_dashes);
  RUN(a_running_timer_replaces_the_tile_text_with_its_clock);
  RUN(the_banner_shows_the_running_timer);
  RUN(the_banner_names_the_nursing_side_and_marks_pauses);
  RUN(with_several_timers_the_lowest_numbered_wins);
  RUN(the_status_tile_reports_sync_state_and_pending_writes);
  RUN(a_cached_state_says_cached);
  RUN(a_live_state_does_not);
  RUN(default_state_is_not_from_cache);
  RUN(status_has_a_sentence_for_every_state);
  RUN(only_ok_counts_as_healthy);
  RUN(baby_names_are_split_from_the_newline_joined_string);
  FINISH();
}
