#include "ready_gate.h"

void rg_init(ReadyGate *g) {
  g->phone_spoke = false;
  g->fallback_fired = false;
}

void rg_on_connection(ReadyGate *g, bool connected) {
  (void)connected;   // either way the JS context on the other side is new
  rg_init(g);
}

void rg_on_phone_message(ReadyGate *g) {
  g->phone_spoke = true;
}

void rg_on_fallback(ReadyGate *g) {
  if (!g->phone_spoke) g->fallback_fired = true;
}

bool rg_may_send(const ReadyGate *g) {
  return g->phone_spoke || g->fallback_fired;
}

bool rg_not_responding(const ReadyGate *g) {
  return g->fallback_fired && !g->phone_spoke;
}
