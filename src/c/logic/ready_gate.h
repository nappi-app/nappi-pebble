// Whether the watch may send to PebbleKit JS yet. JS starts a fresh context on
// every launch and every reconnect, so readiness is per connection: sending
// waits until the phone has said anything (its first message is JS_READY), or
// until a fallback timer fires so a lost ready message cannot wedge the app.
// Plain C.
#pragma once
#include <stdbool.h>

#define READY_FALLBACK_MS 8000

typedef struct {
  bool phone_spoke;
  bool fallback_fired;
} ReadyGate;

void rg_init(ReadyGate *g);
// Any change in the phone connection: forget readiness (fresh JS context).
void rg_on_connection(ReadyGate *g, bool connected);
// Any message from the phone, JS_READY included.
void rg_on_phone_message(ReadyGate *g);
// The fallback timer fired; a no-op once the phone has spoken.
void rg_on_fallback(ReadyGate *g);
// phone_spoke || fallback_fired
bool rg_may_send(const ReadyGate *g);
// Sending only because of the fallback: the phone app has not answered.
bool rg_not_responding(const ReadyGate *g);
