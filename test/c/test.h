// Tiny assertion harness for host-side tests of src/c/logic (no Pebble SDK).
#pragma once
#include <stdio.h>
#include <string.h>

static int g_checks = 0;
static int g_failures = 0;

#define CHECK(cond) do { \
  g_checks++; \
  if (!(cond)) { g_failures++; printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); } \
} while (0)

#define CHECK_INT(actual, expected) do { \
  long a_ = (long)(actual); long e_ = (long)(expected); g_checks++; \
  if (a_ != e_) { g_failures++; printf("  FAIL %s:%d: %s = %ld, expected %ld\n", __FILE__, __LINE__, #actual, a_, e_); } \
} while (0)

#define CHECK_STR(actual, expected) do { \
  const char *a_ = (actual); const char *e_ = (expected); g_checks++; \
  if (strcmp(a_, e_) != 0) { g_failures++; printf("  FAIL %s:%d: %s = \"%s\", expected \"%s\"\n", __FILE__, __LINE__, #actual, a_, e_); } \
} while (0)

#define TEST(name) static void name(void)
#define RUN(name) do { int before_ = g_failures; name(); printf("%s %s\n", g_failures == before_ ? "  ok  " : "  FAIL", #name); } while (0)

#define FINISH() do { \
  printf("%d checks, %d failed\n", g_checks, g_failures); \
  return g_failures ? 1 : 0; \
} while (0)
