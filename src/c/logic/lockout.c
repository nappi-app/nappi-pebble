#include "lockout.h"
#include <string.h>

void lockout_init(Lockout *l) {
  memset(l, 0, sizeof(*l));
}

void lockout_clear(Lockout *l, int action) {
  if (action >= 0 && action < ACTION_COUNT) l->seen[action] = false;
}

bool lockout_try(Lockout *l, int action, uint32_t now_ms) {
  if (action < 0 || action >= ACTION_COUNT) return false;
  // Unsigned subtraction keeps this right across the 32-bit millisecond wrap.
  if (l->seen[action] && (uint32_t)(now_ms - l->last_ms[action]) < LOCKOUT_MS) return false;
  l->seen[action] = true;
  l->last_ms[action] = now_ms;
  return true;
}
