#include "strip.h"

StripGeom strip_time_geom(void) {
  StripGeom g = { 15, 170, 0, 60, 5, true };
  return g;
}

int32_t strip_snap(const StripGeom *g, int32_t value) {
  if (value < g->min) value = g->min;
  if (value > g->max) value = g->max;
  int32_t steps = (value - g->min + g->step / 2) / g->step;
  int32_t v = g->min + steps * g->step;
  if (v > g->max) v = g->min + ((g->max - g->min) / g->step) * g->step;
  return v;
}

int32_t strip_value_at(const StripGeom *g, int x) {
  int32_t off = x - g->x;
  if (off < 0) off = 0;
  if (off > g->w) off = g->w;
  if (g->invert) off = g->w - off;
  int32_t range = g->max - g->min;
  int32_t v = g->min + (off * range + g->w / 2) / g->w;
  return strip_snap(g, v);
}

int strip_x_for(const StripGeom *g, int32_t value) {
  if (value < g->min) value = g->min;
  if (value > g->max) value = g->max;
  int32_t range = g->max - g->min;
  int32_t off = range ? ((value - g->min) * g->w + range / 2) / range : 0;
  if (g->invert) off = g->w - off;
  return g->x + (int)off;
}

int32_t strip_nudge(const StripGeom *g, int32_t value, int dir) {
  int32_t delta = (dir > 0 ? 1 : -1) * g->step;
  if (g->invert) delta = -delta;
  return strip_snap(g, strip_snap(g, value) + delta);
}
