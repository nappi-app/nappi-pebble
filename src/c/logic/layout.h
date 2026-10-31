// Home-screen geometry and hit-testing for Emery (200x228). Plain C.
//
//   +--------------------------+ y=0
//   | header (24)              |
//   +--------------------------+ y=28
//   |  [tile 0]    [tile 1]    |  96x96 tiles, 4px gutters
//   |  [tile 2]    [tile 3]    |
//   +--------------------------+ y=224..228 page dots
#pragma once
#include <stdbool.h>
#include <stdint.h>

#define SCREEN_W 200
#define SCREEN_H 228
#define HEADER_H 24
#define TILES_PER_PAGE 4
#define TILE_W 96
#define TILE_H 96
#define TILE_X0 2
#define TILE_X1 102
#define TILE_Y0 28
#define TILE_Y1 128

typedef struct {
  int16_t x, y, w, h;
} Rect;

bool rect_contains(Rect r, int x, int y);

int layout_page_count(int tiles);
int layout_tiles_on_page(int tiles, int page);
Rect layout_tile_rect(int slot);

// Index into the layout list of the tile under (x, y) on `page`, or -1.
int layout_hit(int tiles, int page, int x, int y);

// Splits `area` into cols x rows cells separated by `gap`, row-major, into out[].
void layout_grid(Rect area, int cols, int rows, int gap, Rect *out);
