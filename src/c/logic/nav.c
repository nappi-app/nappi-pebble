#include "nav.h"

static NavEffect effect(NavEffectKind kind, const Nav *n, int dir) {
  NavEffect e = { kind, n->zone, n->item, dir };
  return e;
}

void nav_init(Nav *n, const NavZone *zones, int count) {
  if (count > NAV_MAX_ZONES) count = NAV_MAX_ZONES;
  if (count < 0) count = 0;
  for (int i = 0; i < count; i++) n->zones[i] = zones[i];
  n->zone_count = (uint8_t)count;
  n->zone = 0;
  n->item = count > 0 ? zones[0].start : 0;
}

static NavEffect step(Nav *n, int dir) {
  if (n->zone_count == 0) return effect(NAV_NONE, n, 0);
  const NavZone *z = &n->zones[n->zone];
  if (z->kind == ZONE_ADJUST) return effect(NAV_ADJUST, n, dir);
  if (z->count > 0) {
    // dir +1 is Up, which moves to the previous item.
    int item = (int)n->item - dir;
    if (item < 0) item = z->count - 1;
    if (item >= z->count) item = 0;
    n->item = (uint8_t)item;
  }
  return effect(NAV_MOVED, n, 0);
}

NavEffect nav_up(Nav *n) { return step(n, +1); }
NavEffect nav_down(Nav *n) { return step(n, -1); }

NavEffect nav_select(Nav *n) {
  if (n->zone_count == 0) return effect(NAV_NONE, n, 0);
  if (n->zones[n->zone].kind == ZONE_CHOICE) return effect(NAV_ACTIVATE, n, 0);
  if (n->zone + 1 >= n->zone_count) return effect(NAV_NONE, n, 0);
  n->zone++;
  n->item = n->zones[n->zone].start;
  return effect(NAV_MOVED, n, 0);
}

NavEffect nav_back(Nav *n) {
  if (n->zone == 0) return effect(NAV_LEAVE, n, 0);
  n->zone--;
  n->item = n->zones[n->zone].start;
  return effect(NAV_MOVED, n, 0);
}
