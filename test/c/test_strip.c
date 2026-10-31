#include "test.h"
#include "strip.h"
#include "amount.h"
#include "protocol.h"

TEST(time_strip_maps_x_to_minutes_ago) {
  StripGeom g = strip_time_geom();
  CHECK_INT(g.x, 15); CHECK_INT(g.w, 170);
  CHECK_INT(g.min, 0); CHECK_INT(g.max, 60); CHECK_INT(g.step, 5);
  CHECK(g.invert);
  CHECK_INT(strip_value_at(&g, 185), 0);
  CHECK_INT(strip_value_at(&g, 15), 60);
  CHECK_INT(strip_value_at(&g, 100), 30);
  CHECK_INT(strip_value_at(&g, -20), 60);
  CHECK_INT(strip_value_at(&g, 400), 0);
}

TEST(time_strip_knob_position) {
  StripGeom g = strip_time_geom();
  CHECK_INT(strip_x_for(&g, 0), 185);
  CHECK_INT(strip_x_for(&g, 60), 15);
}

TEST(time_strip_nudge_moves_toward_now_on_up) {
  StripGeom g = strip_time_geom();
  CHECK_INT(strip_nudge(&g, 0, +1), 0);
  CHECK_INT(strip_nudge(&g, 0, -1), 5);
  CHECK_INT(strip_nudge(&g, 60, -1), 60);
  CHECK_INT(strip_nudge(&g, 60, +1), 55);
}

TEST(snap_rounds_to_nearest_step_and_clamps) {
  StripGeom g = strip_time_geom();
  CHECK_INT(strip_snap(&g, 12), 10);
  CHECK_INT(strip_snap(&g, 13), 15);
  CHECK_INT(strip_snap(&g, -7), 0);
  CHECK_INT(strip_snap(&g, 99), 60);
}

TEST(amount_strip_maps_x_to_value) {
  StripGeom g = amount_geom(AMOUNT_BOTTLE, UNITS_OZ);
  CHECK(!g.invert);
  CHECK_INT(strip_value_at(&g, 15), 5);
  CHECK_INT(strip_value_at(&g, 185), 120);
  CHECK_INT(strip_nudge(&g, 40, +1), 45);
  CHECK_INT(strip_nudge(&g, 120, +1), 120);
  CHECK_INT(strip_x_for(&g, 5), 15);
  CHECK_INT(strip_x_for(&g, 120), 185);
}

int main(void) {
  RUN(time_strip_maps_x_to_minutes_ago);
  RUN(time_strip_knob_position);
  RUN(time_strip_nudge_moves_toward_now_on_up);
  RUN(snap_rounds_to_nearest_step_and_clamps);
  RUN(amount_strip_maps_x_to_value);
  FINISH();
}
