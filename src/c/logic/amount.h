// Amount strip (bottle / pump) limits and unit conversion. Values are x10 of
// the display unit. Plain C.
#pragma once
#include <stdint.h>
#include "strip.h"

#define AMOUNT_BOTTLE 0
#define AMOUNT_PUMP 1

StripGeom amount_geom(int screen, int units);
int32_t amount_default(int screen, int units);

// Convert an x10 amount between units (UNITS_OZ / UNITS_ML), rounding half up.
// The result is not on a step; pass it through strip_snap with the target geom.
int32_t amount_convert(int32_t x10, int from_units, int to_units);
