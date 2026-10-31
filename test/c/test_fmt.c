#include "test.h"
#include "fmt.h"
#include "protocol.h"

TEST(ago_formats_each_range) {
  char b[16];
  fmt_ago(b, sizeof b, 1000, 0);        CHECK_STR(b, "--");
  fmt_ago(b, sizeof b, 1000, 970);      CHECK_STR(b, "now");
  fmt_ago(b, sizeof b, 1000, 910);      CHECK_STR(b, "1m ago");
  fmt_ago(b, sizeof b, 10000, 10000 - 59 * 60);  CHECK_STR(b, "59m ago");
  fmt_ago(b, sizeof b, 100000, 100000 - 3600);   CHECK_STR(b, "1h ago");
  fmt_ago(b, sizeof b, 100000, 100000 - (2 * 3600 + 59 * 60)); CHECK_STR(b, "2h ago");
  fmt_ago(b, sizeof b, 1000000, 1000000 - 86400);      CHECK_STR(b, "1d ago");
  fmt_ago(b, sizeof b, 1000000, 1000000 - 3 * 86400);  CHECK_STR(b, "3d ago");
}

TEST(ago_treats_a_future_timestamp_as_now) {
  char b[16];
  fmt_ago(b, sizeof b, 1000, 1500);
  CHECK_STR(b, "now");
}

TEST(ago_never_overflows_a_small_buffer) {
  char b[4];
  fmt_ago(b, sizeof b, 1000000, 1000000 - 3 * 86400);
  CHECK(strlen(b) <= 3);
}

TEST(clock_formats_minutes_then_hours) {
  char b[16];
  fmt_clock(b, sizeof b, 0);     CHECK_STR(b, "0:00");
  fmt_clock(b, sizeof b, 59);    CHECK_STR(b, "0:59");
  fmt_clock(b, sizeof b, 61);    CHECK_STR(b, "1:01");
  fmt_clock(b, sizeof b, 3599);  CHECK_STR(b, "59:59");
  fmt_clock(b, sizeof b, 3600);  CHECK_STR(b, "1:00:00");
  fmt_clock(b, sizeof b, 4324);  CHECK_STR(b, "1:12:04");
  fmt_clock(b, sizeof b, -5);    CHECK_STR(b, "0:00");
}

TEST(amount_in_oz_and_ml) {
  char b[16];
  fmt_amount(b, sizeof b, 40, UNITS_OZ);    CHECK_STR(b, "4 oz");
  fmt_amount(b, sizeof b, 25, UNITS_OZ);    CHECK_STR(b, "2.5 oz");
  fmt_amount(b, sizeof b, 1200, UNITS_ML);  CHECK_STR(b, "120 ml");
  fmt_amount(b, sizeof b, 1250, UNITS_ML);  CHECK_STR(b, "125 ml");
  fmt_amount(b, sizeof b, 125, UNITS_ML);   CHECK_STR(b, "12.5 ml");
  fmt_amount(b, sizeof b, 0, UNITS_OZ);     CHECK_STR(b, "0 oz");
}

TEST(strip_time_readout) {
  char b[32];
  fmt_strip_time(b, sizeof b, 0, 14, 41, false);   CHECK_STR(b, "Now - 2:41 PM");
  fmt_strip_time(b, sizeof b, 20, 14, 21, false);  CHECK_STR(b, "20 min ago - 2:21 PM");
  fmt_strip_time(b, sizeof b, 60, 0, 5, false);    CHECK_STR(b, "60 min ago - 12:05 AM");
  fmt_strip_time(b, sizeof b, 5, 12, 0, false);    CHECK_STR(b, "5 min ago - 12:00 PM");
  fmt_strip_time(b, sizeof b, 0, 14, 41, true);    CHECK_STR(b, "Now - 14:41");
}

TEST(duration_minutes) {
  char b[16];
  fmt_duration_min(b, sizeof b, 0);   CHECK_STR(b, "0m");
  fmt_duration_min(b, sizeof b, 45);  CHECK_STR(b, "45m");
  fmt_duration_min(b, sizeof b, 60);  CHECK_STR(b, "1h");
  fmt_duration_min(b, sizeof b, 72);  CHECK_STR(b, "1h 12m");
}

TEST(elapsed_min_boundaries) {
  char b[16];
  fmt_elapsed_min(b, sizeof b, -5);    CHECK_STR(b, "<1m");
  fmt_elapsed_min(b, sizeof b, 0);     CHECK_STR(b, "<1m");
  fmt_elapsed_min(b, sizeof b, 59);    CHECK_STR(b, "<1m");
  fmt_elapsed_min(b, sizeof b, 60);    CHECK_STR(b, "1m");
  fmt_elapsed_min(b, sizeof b, 3599);  CHECK_STR(b, "59m");
  fmt_elapsed_min(b, sizeof b, 3600);  CHECK_STR(b, "1h");
  fmt_elapsed_min(b, sizeof b, 3660);  CHECK_STR(b, "1h 1m");
  fmt_elapsed_min(b, sizeof b, 4324);  CHECK_STR(b, "1h 12m");
}

TEST(elapsed_min_never_overflows_a_small_buffer) {
  char b[4];
  fmt_elapsed_min(b, sizeof b, 4324);  CHECK(strlen(b) <= 3);
  fmt_elapsed_min(b, sizeof b, 30);    CHECK_STR(b, "<1m");
  fmt_elapsed_min(b, sizeof b, -5);    CHECK_STR(b, "<1m");
}

int main(void) {
  RUN(ago_formats_each_range);
  RUN(ago_treats_a_future_timestamp_as_now);
  RUN(ago_never_overflows_a_small_buffer);
  RUN(clock_formats_minutes_then_hours);
  RUN(amount_in_oz_and_ml);
  RUN(strip_time_readout);
  RUN(duration_minutes);
  RUN(elapsed_min_boundaries);
  RUN(elapsed_min_never_overflows_a_small_buffer);
  FINISH();
}
