// A window made of tappable cells: tiles, buttons, chips, a header band and
// text blocks. Home and every sheet are GridViews, so touch (through the
// host-tested TouchFsm) and the button fallback are written once.
#pragma once
#include <pebble.h>
#include "logic/layout.h"
#include "logic/touch_fsm.h"
#include "logic/strip.h"
#include "logic/nav.h"

// One capacity for cells and touch rects, so every cell is hit-testable.
#define GRID_MAX_CELLS TOUCH_MAX_RECTS

enum { FONT_BODY = 0, FONT_VALUE = 1, FONT_CLOCK = 2 };

typedef enum {
  CELL_TILE,
  CELL_BUTTON,
  CELL_CHIP,
  CELL_HEADER,
  CELL_TEXT,
  CELL_STRIP           // horizontal slider: readout (title) on top, track below
} CellKind;

typedef struct {
  Rect rect;
  CellKind kind;
  char title[24];
  char l1[100];
  char l2[24];
  GColor bg, fg;
  uint32_t icon;      // CELL_TILE: bitmap resource id drawn top left, 0 for none
  bool selected;
  bool enabled;
  uint8_t font;       // CELL_TEXT: FONT_BODY, FONT_VALUE or FONT_CLOCK
  bool has_dot;       // CELL_HEADER: status dot at the right edge
  GColor dot;
  StripGeom geom;     // CELL_STRIP: track and value range
  int32_t strip_value;
  int16_t key;        // identity for touch: a press whose cell key changes under the finger is cancelled
} GridCell;

typedef struct GridView GridView;

typedef struct {
  void (*on_activate)(GridView *gv, int index, bool long_press);
  void (*on_swipe)(GridView *gv, int direction);   // SWIPE_LEFT / SWIPE_RIGHT
  void (*on_tick)(GridView *gv);
  void (*on_state)(GridView *gv);                  // phone state changed
  void (*on_strip)(GridView *gv, int cell, int x); // touchdown and every move on a strip
  void (*on_adjust)(GridView *gv, int zone, int dir);  // Up/Down on an ADJUST zone
  void (*on_unload)(GridView *gv);
} GridHandlers;

struct GridView {
  int id;                    // nonzero and never reused, unlike the pointer
  Window *window;
  Layer *layer;
  GridCell cells[GRID_MAX_CELLS];
  int count;
  int focus;
  bool show_focus;
  int pressed;
  TouchFsm fsm;
  AppTimer *press_timer;
  GridHandlers h;
  void *ctx;                 // owned by the creator; freed in on_unload
  int page, pages;
  int tick_secs;             // 0, 1 or 60
  int overlay;               // 0 none, 1 check, 2 error banner, 3 neutral notice
  char message[40];
  AppTimer *overlay_timer;
  void (*overlay_done)(GridView *gv);
  int strip_drag;            // strip cell being dragged, or -1
  Nav nav;                   // zone focus for the buttons when has_nav
  bool has_nav;
  int zone_cell[NAV_MAX_ZONES];   // first cell of each zone
  int zone_cells[NAV_MAX_ZONES];  // number of consecutive cells in each zone
};

GridView *grid_view_create(const GridHandlers *handlers, void *ctx);
void grid_view_push(GridView *gv);

void grid_view_clear(GridView *gv);
GridCell *grid_view_add(GridView *gv, CellKind kind, Rect rect, const char *title, const char *l1,
                        const char *l2, GColor bg);
// Call after adding or moving cells so touch hit-testing and drawing pick them up.
void grid_view_commit(GridView *gv);
// Text-only changes: redraw without touching the hit rects, so a finger already down stays tracked.
void grid_view_redraw(GridView *gv);

void grid_view_set_tick(GridView *gv, int secs);
void grid_view_focus(GridView *gv, int index);
// Switch the buttons to zone navigation. A zone's cells are consecutive from
// first_cell; on_activate gets the absolute cell index of a chosen item.
void grid_view_set_zones(GridView *gv, const NavZone *zones, const int *first_cell, const int *cell_count, int count);

// 1 = checkmark with `message` as its caption, 2 = error banner, 3 = neutral notice
// ("Sending..."). Input is ignored while one shows. `done` runs when it expires.
void grid_view_flash(GridView *gv, int kind, const char *message, int ms, void (*done)(GridView *gv));

GridView *grid_view_top(void);
int grid_view_id(const GridView *gv);   // 0 for NULL
int grid_view_top_id(void);             // 0 when no view is on top
void grid_view_notify_state(void);
