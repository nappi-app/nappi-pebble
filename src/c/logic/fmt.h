// Text formatting for the watch. Plain C so it runs under host tests.
#pragma once
#include <stddef.h>
#include <stdint.h>

// "2h ago", "now", or "--" when there is no timestamp (then <= 0).
void fmt_ago(char *buf, size_t n, int32_t now, int32_t then);

// "4:12" or "1:12:04".
void fmt_clock(char *buf, size_t n, int32_t seconds);

// Amount given x10 in the display unit: "4 oz", "2.5 oz", "120 ml".
void fmt_amount(char *buf, size_t n, int32_t x10, int units);

// "45m", "1h", "1h 12m".
void fmt_duration_min(char *buf, size_t n, int minutes);

// Elapsed time at minute resolution: "<1m" (also for negative skew), "5m", "1h", "1h 12m".
void fmt_elapsed_min(char *buf, size_t n, int32_t seconds);

// Time-strip readout: "Now - 2:41 PM", "20 min ago - 2:21 PM", or 24-hour "Now - 14:41".
// hour/minute are the wall-clock time the strip selects.
#include <stdbool.h>
void fmt_strip_time(char *buf, size_t n, int minutes_ago, int hour, int minute, bool is24h);
