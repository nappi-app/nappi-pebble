#include "layout.h"

bool rect_contains(Rect r, int x, int y) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

int layout_page_count(int tiles) {
  if (tiles <= 0) return 1;
  return (tiles + TILES_PER_PAGE - 1) / TILES_PER_PAGE;
}

int layout_tiles_on_page(int tiles, int page) {
  if (page < 0 || tiles <= page * TILES_PER_PAGE) return 0;
  int left = tiles - page * TILES_PER_PAGE;
  return left < TILES_PER_PAGE ? left : TILES_PER_PAGE;
}

Rect layout_tile_rect(int slot) {
  Rect r;
  r.x = (slot % 2 == 0) ? TILE_X0 : TILE_X1;
  r.y = (slot / 2 == 0) ? TILE_Y0 : TILE_Y1;
  r.w = TILE_W;
  r.h = TILE_H;
  return r;
}

int layout_hit(int tiles, int page, int x, int y) {
  int count = layout_tiles_on_page(tiles, page);
  for (int slot = 0; slot < count; slot++) {
    if (rect_contains(layout_tile_rect(slot), x, y)) return page * TILES_PER_PAGE + slot;
  }
  return -1;
}

void layout_grid(Rect area, int cols, int rows, int gap, Rect *out) {
  int cw = (area.w - gap * (cols - 1)) / cols;
  int ch = (area.h - gap * (rows - 1)) / rows;
  for (int row = 0; row < rows; row++) {
    for (int col = 0; col < cols; col++) {
      Rect *r = &out[row * cols + col];
      r->x = (int16_t)(area.x + col * (cw + gap));
      r->y = (int16_t)(area.y + row * (ch + gap));
      r->w = (int16_t)cw;
      r->h = (int16_t)ch;
    }
  }
}
