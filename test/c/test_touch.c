#include "test.h"
#include "touch_fsm.h"

// Two buttons side by side: rect 0 at x 0..99, rect 1 at x 100..199, y 50..149.
static void setup(TouchFsm *f) {
  TouchTarget targets[2] = { { { 0, 50, 100, 100 }, 1 }, { { 100, 50, 100, 100 }, 2 } };
  touch_fsm_init(f);
  touch_fsm_set_targets(f, targets, 2);
}

static void check_none(TouchResult r) {
  CHECK_INT(r.press, -1); CHECK_INT(r.cancel, -1); CHECK_INT(r.activate, -1);
  CHECK_INT(r.long_press, -1); CHECK_INT(r.swipe, 0);
}

TEST(a_tap_presses_on_touchdown_and_activates_on_liftoff) {
  TouchFsm f; setup(&f);
  TouchResult d = touch_fsm_down(&f, 50, 100, 0);
  CHECK_INT(d.press, 0);
  CHECK_INT(d.activate, -1);
  TouchResult u = touch_fsm_up(&f, 52, 101, 120);
  CHECK_INT(u.activate, 0);
  CHECK_INT(u.cancel, -1);
}

TEST(touching_empty_space_does_nothing) {
  TouchFsm f; setup(&f);
  check_none(touch_fsm_down(&f, 50, 10, 0));
  check_none(touch_fsm_up(&f, 50, 10, 100));
}

TEST(dragging_out_cancels_and_lifting_does_not_activate) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  TouchResult m = touch_fsm_move(&f, 50, 160, 50);
  CHECK_INT(m.cancel, 0);
  TouchResult u = touch_fsm_up(&f, 50, 160, 100);
  CHECK_INT(u.activate, -1);
}

TEST(dragging_out_and_back_in_stays_cancelled) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  touch_fsm_move(&f, 50, 160, 50);
  touch_fsm_move(&f, 50, 100, 80);
  TouchResult u = touch_fsm_up(&f, 50, 100, 120);
  CHECK_INT(u.activate, -1);
}

TEST(moving_within_the_target_keeps_the_press) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  check_none(touch_fsm_move(&f, 60, 110, 30));
  CHECK_INT(touch_fsm_up(&f, 60, 110, 90).activate, 0);
}

TEST(a_long_press_fires_once_at_the_threshold_and_suppresses_the_tap) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 150, 100, 1000);
  check_none(touch_fsm_tick(&f, 1000 + LONG_PRESS_MS - 1));
  TouchResult t = touch_fsm_tick(&f, 1000 + LONG_PRESS_MS);
  CHECK_INT(t.long_press, 1);
  check_none(touch_fsm_tick(&f, 1000 + LONG_PRESS_MS + 100));
  TouchResult u = touch_fsm_up(&f, 150, 100, 1700);
  CHECK_INT(u.activate, -1);
}

TEST(no_long_press_after_the_finger_left_the_target) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  touch_fsm_move(&f, 50, 160, 100);
  check_none(touch_fsm_tick(&f, 2000));
}

TEST(no_long_press_after_lift) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  touch_fsm_up(&f, 50, 100, 100);
  check_none(touch_fsm_tick(&f, 2000));
}

TEST(a_horizontal_swipe_left_goes_to_the_next_page) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 150, 100, 0);
  TouchResult m = touch_fsm_move(&f, 150 - SWIPE_MIN_PX, 104, 60);
  CHECK_INT(m.swipe, SWIPE_LEFT);
  CHECK_INT(m.cancel, 1);
  TouchResult u = touch_fsm_up(&f, 90, 104, 100);
  CHECK_INT(u.activate, -1);
  CHECK_INT(u.swipe, 0);
}

TEST(a_horizontal_swipe_right) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  CHECK_INT(touch_fsm_move(&f, 50 + SWIPE_MIN_PX + 5, 102, 60).swipe, SWIPE_RIGHT);
}

TEST(a_swipe_can_start_in_empty_space) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 150, 10, 0);
  TouchResult m = touch_fsm_move(&f, 150 - SWIPE_MIN_PX - 1, 12, 60);
  CHECK_INT(m.swipe, SWIPE_LEFT);
  CHECK_INT(m.cancel, -1);
}

TEST(a_short_horizontal_move_is_not_a_swipe) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  CHECK_INT(touch_fsm_move(&f, 50 + SWIPE_MIN_PX - 1, 100, 30).swipe, 0);
}

TEST(a_mostly_vertical_move_is_not_a_swipe) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  CHECK_INT(touch_fsm_move(&f, 50 + SWIPE_MIN_PX + 5, 200, 30).swipe, 0);
}

TEST(a_swipe_fires_once_per_gesture) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 150, 100, 0);
  CHECK_INT(touch_fsm_move(&f, 100, 100, 30).swipe, SWIPE_LEFT);
  CHECK_INT(touch_fsm_move(&f, 40, 100, 60).swipe, 0);
}

TEST(a_new_touchdown_resets_a_gesture_whose_liftoff_was_missed) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  TouchResult d = touch_fsm_down(&f, 150, 100, 500);
  CHECK_INT(d.press, 1);
  CHECK_INT(touch_fsm_up(&f, 150, 100, 600).activate, 1);
}

TEST(set_targets_keeps_a_tap_when_rect_and_key_are_unchanged) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  TouchTarget same[2] = { { { 0, 50, 100, 100 }, 1 }, { { 100, 50, 100, 100 }, 2 } };
  touch_fsm_set_targets(&f, same, 2);
  CHECK_INT(touch_fsm_up(&f, 50, 100, 100).activate, 0);
}

TEST(set_targets_keeps_a_long_press_when_identity_is_unchanged) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  TouchTarget same[2] = { { { 0, 50, 100, 100 }, 1 }, { { 100, 50, 100, 100 }, 2 } };
  touch_fsm_set_targets(&f, same, 2);
  CHECK_INT(touch_fsm_tick(&f, LONG_PRESS_MS).long_press, 0);
}

TEST(set_targets_cancels_when_the_rect_changes) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  TouchTarget other[2] = { { { 0, 50, 90, 100 }, 1 }, { { 100, 50, 100, 100 }, 2 } };
  touch_fsm_set_targets(&f, other, 2);
  CHECK_INT(touch_fsm_up(&f, 50, 100, 100).activate, -1);
}

TEST(set_targets_cancels_when_only_the_key_changes) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  TouchTarget rekeyed[2] = { { { 0, 50, 100, 100 }, 9 }, { { 100, 50, 100, 100 }, 2 } };
  touch_fsm_set_targets(&f, rekeyed, 2);
  CHECK_INT(touch_fsm_up(&f, 50, 100, 100).activate, -1);
}

TEST(set_targets_cancels_when_the_target_index_no_longer_exists) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 150, 100, 0);
  TouchTarget one[1] = { { { 0, 50, 100, 100 }, 1 } };
  touch_fsm_set_targets(&f, one, 1);
  CHECK_INT(touch_fsm_up(&f, 150, 100, 100).activate, -1);
}

TEST(a_gesture_on_empty_space_survives_set_targets_and_can_swipe) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 10, 0);
  TouchTarget other[1] = { { { 0, 50, 200, 100 }, 5 } };
  touch_fsm_set_targets(&f, other, 1);
  CHECK_INT(touch_fsm_move(&f, 50 - 60, 12, 50).swipe, SWIPE_LEFT);
}

TEST(pressed_reports_the_live_target_only) {
  TouchFsm f; setup(&f);
  CHECK_INT(touch_fsm_pressed(&f), -1);
  touch_fsm_down(&f, 50, 100, 0);
  CHECK_INT(touch_fsm_pressed(&f), 0);
  touch_fsm_move(&f, 50, 160, 50);
  CHECK_INT(touch_fsm_pressed(&f), -1);
  touch_fsm_up(&f, 50, 160, 100);
  CHECK_INT(touch_fsm_pressed(&f), -1);
}

TEST(sequential_taps_each_work) {
  TouchFsm f; setup(&f);
  touch_fsm_down(&f, 50, 100, 0);
  CHECK_INT(touch_fsm_up(&f, 50, 100, 50).activate, 0);
  touch_fsm_down(&f, 150, 100, 400);
  CHECK_INT(touch_fsm_up(&f, 150, 100, 450).activate, 1);
}

int main(void) {
  RUN(a_tap_presses_on_touchdown_and_activates_on_liftoff);
  RUN(touching_empty_space_does_nothing);
  RUN(dragging_out_cancels_and_lifting_does_not_activate);
  RUN(dragging_out_and_back_in_stays_cancelled);
  RUN(moving_within_the_target_keeps_the_press);
  RUN(a_long_press_fires_once_at_the_threshold_and_suppresses_the_tap);
  RUN(no_long_press_after_the_finger_left_the_target);
  RUN(no_long_press_after_lift);
  RUN(a_horizontal_swipe_left_goes_to_the_next_page);
  RUN(a_horizontal_swipe_right);
  RUN(a_swipe_can_start_in_empty_space);
  RUN(a_short_horizontal_move_is_not_a_swipe);
  RUN(a_mostly_vertical_move_is_not_a_swipe);
  RUN(a_swipe_fires_once_per_gesture);
  RUN(a_new_touchdown_resets_a_gesture_whose_liftoff_was_missed);
  RUN(set_targets_keeps_a_tap_when_rect_and_key_are_unchanged);
  RUN(set_targets_keeps_a_long_press_when_identity_is_unchanged);
  RUN(set_targets_cancels_when_the_rect_changes);
  RUN(set_targets_cancels_when_only_the_key_changes);
  RUN(set_targets_cancels_when_the_target_index_no_longer_exists);
  RUN(a_gesture_on_empty_space_survives_set_targets_and_can_swipe);
  RUN(pressed_reports_the_live_target_only);
  RUN(sequential_taps_each_work);
  FINISH();
}
