#include "test.h"
#include "layout.h"

TEST(page_counts) {
  CHECK_INT(layout_page_count(0), 1);
  CHECK_INT(layout_page_count(1), 1);
  CHECK_INT(layout_page_count(4), 1);
  CHECK_INT(layout_page_count(5), 2);
  CHECK_INT(layout_page_count(8), 2);
  CHECK_INT(layout_page_count(9), 3);
}

TEST(tiles_on_each_page) {
  CHECK_INT(layout_tiles_on_page(5, 0), 4);
  CHECK_INT(layout_tiles_on_page(5, 1), 1);
  CHECK_INT(layout_tiles_on_page(5, 2), 0);
  CHECK_INT(layout_tiles_on_page(3, 0), 3);
  CHECK_INT(layout_tiles_on_page(8, 1), 4);
  CHECK_INT(layout_tiles_on_page(8, -1), 0);
}

TEST(tile_rects_are_big_ordered_and_on_screen) {
  for (int i = 0; i < TILES_PER_PAGE; i++) {
    Rect r = layout_tile_rect(i);
    CHECK_INT(r.w, 96);
    CHECK(r.h >= 90);
    CHECK(r.x >= 0 && r.x + r.w <= SCREEN_W);
    CHECK(r.y >= HEADER_H && r.y + r.h <= SCREEN_H);
  }
  Rect a = layout_tile_rect(0), b = layout_tile_rect(1), c = layout_tile_rect(2), d = layout_tile_rect(3);
  CHECK(a.y == b.y && c.y == d.y);
  CHECK(a.x == c.x && b.x == d.x);
  CHECK(b.x > a.x && c.y > a.y);
}

TEST(tile_rects_do_not_overlap_and_keep_a_gutter) {
  for (int i = 0; i < TILES_PER_PAGE; i++) {
    for (int j = i + 1; j < TILES_PER_PAGE; j++) {
      Rect p = layout_tile_rect(i), q = layout_tile_rect(j);
      bool apart = p.x + p.w + 3 < q.x + 1 || q.x + q.w + 3 < p.x + 1 || p.y + p.h + 3 < q.y + 1 || q.y + q.h + 3 < p.y + 1;
      CHECK(apart);
    }
  }
}

TEST(hit_testing_maps_points_to_layout_indices) {
  for (int i = 0; i < TILES_PER_PAGE; i++) {
    Rect r = layout_tile_rect(i);
    CHECK_INT(layout_hit(8, 0, r.x + r.w / 2, r.y + r.h / 2), i);
    CHECK_INT(layout_hit(8, 1, r.x + r.w / 2, r.y + r.h / 2), i + 4);
  }
}

TEST(hit_testing_misses_header_gutters_and_empty_slots) {
  Rect a = layout_tile_rect(0), b = layout_tile_rect(1), c = layout_tile_rect(2);
  CHECK_INT(layout_hit(8, 0, 100, 5), -1);
  CHECK_INT(layout_hit(8, 0, a.x + a.w + 1, a.y + 10), -1);
  CHECK_INT(layout_hit(8, 0, a.x + 10, a.y + a.h + 1), -1);
  CHECK_INT(layout_hit(5, 1, c.x + 5, c.y + 5), -1);
  CHECK_INT(layout_hit(5, 1, b.x + 5, b.y + 5), -1);
  CHECK_INT(layout_hit(5, 1, a.x + 5, a.y + 5), 4);
}

TEST(rect_containment_is_inclusive_of_the_origin_and_exclusive_of_the_far_edge) {
  Rect r = { 10, 20, 30, 40 };
  CHECK(rect_contains(r, 10, 20));
  CHECK(rect_contains(r, 39, 59));
  CHECK(!rect_contains(r, 40, 30));
  CHECK(!rect_contains(r, 20, 60));
  CHECK(!rect_contains(r, 9, 30));
}

TEST(grid_splits_an_area_row_major_with_gaps) {
  Rect out[6];
  Rect area = { 0, 0, 100, 100 };
  layout_grid(area, 2, 2, 4, out);
  CHECK_INT(out[0].w, 48); CHECK_INT(out[0].h, 48);
  CHECK_INT(out[1].x, 52); CHECK_INT(out[1].y, 0);
  CHECK_INT(out[2].x, 0);  CHECK_INT(out[2].y, 52);
  CHECK_INT(out[3].x, 52); CHECK_INT(out[3].y, 52);

  Rect area3 = { 10, 20, 100, 60 };
  layout_grid(area3, 3, 2, 2, out);
  CHECK_INT(out[0].x, 10);
  CHECK_INT(out[0].w, 32);
  CHECK_INT(out[5].x, 10 + 2 * 34);
  CHECK_INT(out[5].y, 20 + 31);
}

int main(void) {
  RUN(page_counts);
  RUN(tiles_on_each_page);
  RUN(tile_rects_are_big_ordered_and_on_screen);
  RUN(tile_rects_do_not_overlap_and_keep_a_gutter);
  RUN(hit_testing_maps_points_to_layout_indices);
  RUN(hit_testing_misses_header_gutters_and_empty_slots);
  RUN(rect_containment_is_inclusive_of_the_origin_and_exclusive_of_the_far_edge);
  RUN(grid_splits_an_area_row_major_with_gaps);
  FINISH();
}
