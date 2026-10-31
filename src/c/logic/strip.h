// Geometry and value mapping for a horizontal slider strip. Plain C.
#pragma once
#include <stdbool.h>
#include <stdint.h>

typedef struct {
  int16_t x, w;            // track left edge and width in px
  int32_t min, max, step;
  bool invert;             // true: min sits at the right end
} StripGeom;

// Time strip: 0..60 minutes ago, step 5, Now (0) at the right end.
StripGeom strip_time_geom(void);

// Value under pixel x, snapped to a step and clamped.
int32_t strip_value_at(const StripGeom *g, int x);

// Knob centre x for a value.
int strip_x_for(const StripGeom *g, int32_t value);

// Nearest step (relative to min), clamped to [min, max].
int32_t strip_snap(const StripGeom *g, int32_t value);

// Move one step; dir +1 moves the knob right, -1 left.
int32_t strip_nudge(const StripGeom *g, int32_t value, int dir);
