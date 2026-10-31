#include "test.h"
#include "amount.h"
#include "strip.h"
#include "protocol.h"

TEST(defaults_per_unit) {
  CHECK_INT(amount_default(AMOUNT_BOTTLE, UNITS_OZ), 40);
  CHECK_INT(amount_default(AMOUNT_BOTTLE, UNITS_ML), 1200);
  CHECK_INT(amount_default(AMOUNT_PUMP, UNITS_OZ), 40);
  CHECK_INT(amount_default(AMOUNT_PUMP, UNITS_ML), 1200);
}

TEST(geometry_limits) {
  StripGeom g = amount_geom(AMOUNT_BOTTLE, UNITS_OZ);
  CHECK_INT(g.x, 15); CHECK_INT(g.w, 170);
  CHECK_INT(g.min, 5); CHECK_INT(g.max, 120); CHECK_INT(g.step, 5);
  g = amount_geom(AMOUNT_PUMP, UNITS_OZ);
  CHECK_INT(g.min, 5); CHECK_INT(g.max, 200); CHECK_INT(g.step, 5);
  g = amount_geom(AMOUNT_BOTTLE, UNITS_ML);
  CHECK_INT(g.min, 100); CHECK_INT(g.max, 3600); CHECK_INT(g.step, 50);
  g = amount_geom(AMOUNT_PUMP, UNITS_ML);
  CHECK_INT(g.min, 100); CHECK_INT(g.max, 6000); CHECK_INT(g.step, 50);
}

TEST(convert_is_unrounded_to_step) {
  CHECK_INT(amount_convert(40, UNITS_OZ, UNITS_ML), 1183);
  CHECK_INT(amount_convert(1200, UNITS_ML, UNITS_OZ), 41);
  CHECK_INT(amount_convert(40, UNITS_OZ, UNITS_OZ), 40);
}

static int32_t conv_snap(int screen, int32_t x10, int from, int to) {
  StripGeom g = amount_geom(screen, to);
  int32_t v = strip_snap(&g, amount_convert(x10, from, to));
  CHECK_INT((v - g.min) % g.step, 0);
  CHECK(v >= g.min && v <= g.max);
  return v;
}

TEST(conversion_edge_cases_snap_and_clamp) {
  CHECK_INT(conv_snap(AMOUNT_BOTTLE, 120, UNITS_OZ, UNITS_ML), 3550);
  CHECK_INT(conv_snap(AMOUNT_PUMP, 200, UNITS_OZ, UNITS_ML), 5900);
  CHECK_INT(conv_snap(AMOUNT_BOTTLE, 3600, UNITS_ML, UNITS_OZ), 120);
  CHECK_INT(conv_snap(AMOUNT_BOTTLE, 100, UNITS_ML, UNITS_OZ), 5);
}

int main(void) {
  RUN(defaults_per_unit);
  RUN(geometry_limits);
  RUN(convert_is_unrounded_to_step);
  RUN(conversion_edge_cases_snap_and_clamp);
  FINISH();
}
