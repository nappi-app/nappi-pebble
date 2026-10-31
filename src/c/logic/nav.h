// Focus navigation across a sheet's zones (strips and choice rows) for the
// physical buttons. Plain C.
#pragma once
#include <stdint.h>

typedef enum { ZONE_ADJUST, ZONE_CHOICE } ZoneKind;
typedef struct { ZoneKind kind; uint8_t count; uint8_t start; } NavZone;  // count/start for CHOICE

#define NAV_MAX_ZONES 4

typedef struct {
  NavZone zones[NAV_MAX_ZONES];
  uint8_t zone_count, zone, item;
} Nav;

typedef enum { NAV_NONE, NAV_MOVED, NAV_ADJUST, NAV_ACTIVATE, NAV_LEAVE } NavEffectKind;
typedef struct { NavEffectKind kind; int zone, item, dir; } NavEffect;

void nav_init(Nav *n, const NavZone *zones, int count);
NavEffect nav_up(Nav *n);      // ADJUST: {NAV_ADJUST, dir=+1}; CHOICE: item-1 wrapping
NavEffect nav_down(Nav *n);    // ADJUST: {NAV_ADJUST, dir=-1}; CHOICE: item+1 wrapping
NavEffect nav_select(Nav *n);  // ADJUST: next zone or NAV_NONE on the last; CHOICE: NAV_ACTIVATE
NavEffect nav_back(Nav *n);    // previous zone, or NAV_LEAVE from the first
