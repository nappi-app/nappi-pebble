#include "amount.h"
#include "protocol.h"

// 1 oz = 29.5735 ml, held as an integer ratio 295735 / 10000.
#define ML_PER_OZ_NUM 295735
#define ML_PER_OZ_DEN 10000

StripGeom amount_geom(int screen, int units) {
  StripGeom g = { 15, 170, 0, 0, 0, false };
  if (units == UNITS_ML) {
    g.min = 100; g.step = 50;
    g.max = screen == AMOUNT_PUMP ? 6000 : 3600;
  } else {
    g.min = 5; g.step = 5;
    g.max = screen == AMOUNT_PUMP ? 200 : 120;
  }
  return g;
}

int32_t amount_default(int screen, int units) {
  (void)screen;
  return units == UNITS_ML ? 1200 : 40;
}

int32_t amount_convert(int32_t x10, int from_units, int to_units) {
  if (from_units == to_units) return x10;
  if (from_units == UNITS_OZ) {
    return (int32_t)(((int64_t)x10 * ML_PER_OZ_NUM + ML_PER_OZ_DEN / 2) / ML_PER_OZ_DEN);
  }
  return (int32_t)(((int64_t)x10 * ML_PER_OZ_DEN + ML_PER_OZ_NUM / 2) / ML_PER_OZ_NUM);
}
