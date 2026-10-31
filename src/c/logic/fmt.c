#include "fmt.h"
#include "protocol.h"
#include <stdio.h>

void fmt_ago(char *buf, size_t n, int32_t now, int32_t then) {
  if (then <= 0) {
    snprintf(buf, n, "--");
    return;
  }
  int32_t d = now - then;
  if (d < 60) snprintf(buf, n, "now");
  else if (d < 3600) snprintf(buf, n, "%dm ago", (int)(d / 60));
  else if (d < 86400) snprintf(buf, n, "%dh ago", (int)(d / 3600));
  else snprintf(buf, n, "%dd ago", (int)(d / 86400));
}

void fmt_clock(char *buf, size_t n, int32_t seconds) {
  if (seconds < 0) seconds = 0;
  int h = (int)(seconds / 3600);
  int m = (int)((seconds % 3600) / 60);
  int s = (int)(seconds % 60);
  if (h > 0) snprintf(buf, n, "%d:%02d:%02d", h, m, s);
  else snprintf(buf, n, "%d:%02d", m, s);
}

void fmt_amount(char *buf, size_t n, int32_t x10, int units) {
  const char *unit = units == UNITS_ML ? "ml" : "oz";
  int whole = (int)(x10 / 10);
  int frac = (int)(x10 % 10);
  if (frac == 0) snprintf(buf, n, "%d %s", whole, unit);
  else snprintf(buf, n, "%d.%d %s", whole, frac, unit);
}

void fmt_duration_min(char *buf, size_t n, int minutes) {
  if (minutes < 60) snprintf(buf, n, "%dm", minutes);
  else if (minutes % 60 == 0) snprintf(buf, n, "%dh", minutes / 60);
  else snprintf(buf, n, "%dh %dm", minutes / 60, minutes % 60);
}

void fmt_elapsed_min(char *buf, size_t n, int32_t seconds) {
  if (seconds < 60) snprintf(buf, n, "<1m");
  else fmt_duration_min(buf, n, (int)(seconds / 60));
}

void fmt_strip_time(char *buf, size_t n, int minutes_ago, int hour, int minute, bool is24h) {
  char when[16];
  if (is24h) {
    snprintf(when, sizeof when, "%02d:%02d", hour, minute);
  } else {
    int h12 = hour % 12;
    if (h12 == 0) h12 = 12;
    snprintf(when, sizeof when, "%d:%02d %s", h12, minute, hour >= 12 ? "PM" : "AM");
  }
  if (minutes_ago <= 0) snprintf(buf, n, "Now - %s", when);
  else snprintf(buf, n, "%d min ago - %s", minutes_ago, when);
}
