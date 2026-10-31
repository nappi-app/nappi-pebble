#include "grid_view.h"
#include "comm.h"
#include <string.h>

#define MAX_LIVE_VIEWS 8
#define CORNER 6
#define TILE_CORNER 12

static GridView *s_live[MAX_LIVE_VIEWS];
static GridView *s_top;
static GridView *s_touch_owner;
static GridView *s_tick_owner;
static int s_next_id;
static bool s_touch_notice_shown;   // the "touch is off" notice appears once per launch

static uint32_t now_ms(void) {
  time_t s;
  uint16_t ms;
  time_ms(&s, &ms);
  return (uint32_t)s * 1000u + ms;
}

static GRect grect(Rect r) {
  return GRect(r.x, r.y, r.w, r.h);
}

static GRect inset(Rect r, int dx, int dy, int h) {
  return GRect(r.x + dx, r.y + dy, r.w - 2 * dx, h);
}

static bool focusable(const GridCell *c) {
  return c->enabled && c->kind != CELL_TEXT && c->kind != CELL_STRIP;
}

// ---- drawing ----

static void draw_text(GContext *ctx, const char *text, const char *font, GRect box, GTextAlignment align, GColor color) {
  if (!text[0]) return;
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, text, fonts_get_system_font(font), box, GTextOverflowModeTrailingEllipsis, align, NULL);
}

// Icons are tiny 1-bit-palette bitmaps, loaded on first use and kept for the life of the app.
#define ICON_SIZE 24
#define ICON_CACHE 8
static struct { uint32_t res; GBitmap *bmp; } s_icons[ICON_CACHE];

static GBitmap *icon_bitmap(uint32_t res) {
  for (int i = 0; i < ICON_CACHE; i++) {
    if (s_icons[i].res == res) return s_icons[i].bmp;
    if (!s_icons[i].res) {
      s_icons[i].res = res;
      s_icons[i].bmp = gbitmap_create_with_resource(res);
      return s_icons[i].bmp;
    }
  }
  APP_LOG(APP_LOG_LEVEL_ERROR, "icon cache full (%d), icon %lu not drawn", ICON_CACHE, (unsigned long)res);
  return NULL;
}

// The bitmap's opaque palette entry is its ink: recolour it to the tile's text colour.
static void draw_icon(GContext *ctx, uint32_t res, int x, int y, GColor ink) {
  GBitmap *bmp = icon_bitmap(res);
  if (!bmp) return;
  GColor *palette = gbitmap_get_palette(bmp);
  if (palette) {
    for (int i = 0; i < 2; i++) {
      if (palette[i].a) palette[i] = ink;
    }
  }
  graphics_context_set_compositing_mode(ctx, GCompOpSet);
  graphics_draw_bitmap_in_rect(ctx, bmp, GRect(x, y, ICON_SIZE, ICON_SIZE));
}

static int corner_of(const GridCell *c) {
  return c->kind == CELL_TILE ? TILE_CORNER : CORNER;
}

static void draw_cell(GContext *ctx, const GridView *gv, int i) {
  const GridCell *c = &gv->cells[i];
  bool pressed = gv->pressed == i;
  GColor bg = c->bg;
  GColor fg = c->fg;
  // Headers and text are never tappable; only real controls look disabled.
  if (!c->enabled && c->kind != CELL_HEADER && c->kind != CELL_TEXT) {
    bg = GColorLightGray;
    fg = GColorDarkGray;
  }
  // A chosen chip is filled in rather than outlined.
  bool chosen_chip = c->selected && c->enabled && c->kind == CELL_CHIP;
  if (chosen_chip) {
    bg = GColorBlack;
    fg = GColorWhite;
  }
  if (pressed) {
    GColor swap = bg;
    bg = fg;
    fg = swap;
  }
  Rect r = c->rect;

  if (c->kind == CELL_TEXT) {
    const char *font = c->font == FONT_CLOCK ? FONT_KEY_BITHAM_42_MEDIUM_NUMBERS
                     : c->font == FONT_VALUE ? FONT_KEY_GOTHIC_28_BOLD : FONT_KEY_GOTHIC_18;
    graphics_context_set_text_color(ctx, fg);
    graphics_draw_text(ctx, c->l1, fonts_get_system_font(font), grect(r), GTextOverflowModeWordWrap,
                       c->font == FONT_BODY ? GTextAlignmentLeft : GTextAlignmentCenter, NULL);
    return;
  }

  graphics_context_set_fill_color(ctx, bg);
  graphics_fill_rect(ctx, grect(r), c->kind == CELL_HEADER ? 0 : corner_of(c), c->kind == CELL_HEADER ? GCornerNone : GCornersAll);

  if (c->kind == CELL_HEADER) {
    draw_text(ctx, c->l1, FONT_KEY_GOTHIC_18_BOLD, GRect(r.x + 6, r.y, r.w - 60, r.h), GTextAlignmentLeft, fg);
    draw_text(ctx, c->l2, FONT_KEY_GOTHIC_14, GRect(r.x + r.w - 76, r.y + 3, 60, r.h - 3), GTextAlignmentRight, fg);
    if (c->has_dot) {
      // White rim so the dot reads on any baby accent colour.
      GPoint centre = GPoint(r.x + r.w - 8, r.y + r.h / 2);
      graphics_context_set_fill_color(ctx, GColorWhite);
      graphics_fill_circle(ctx, centre, 6);
      graphics_context_set_fill_color(ctx, c->dot);
      graphics_fill_circle(ctx, centre, 4);
    }
  } else if (c->kind == CELL_STRIP) {
    // Readout centred in the top half; track and knob in the bottom half.
    draw_text(ctx, c->title, FONT_KEY_GOTHIC_14_BOLD, GRect(r.x, r.y + (r.h / 2 - 14) / 2 - 3, r.w, 18),
              GTextAlignmentCenter, fg);
    int track_y = r.y + r.h - 10;
    graphics_context_set_fill_color(ctx, GColorLightGray);
    graphics_fill_rect(ctx, GRect(c->geom.x, track_y - 2, c->geom.w, 4), 2, GCornersAll);
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_circle(ctx, GPoint(strip_x_for(&c->geom, c->strip_value), track_y), 8);
  } else if (c->kind == CELL_TILE) {
    // Laid out like the nappi app's tiles: icon top left, detail top right, name bold bottom left, "ago" under it.
    if (c->icon) draw_icon(ctx, c->icon, r.x + 8, r.y + 6, fg);
    draw_text(ctx, c->l2, FONT_KEY_GOTHIC_14_BOLD, GRect(r.x + 34, r.y + 4, r.w - 40, 18), GTextAlignmentRight, fg);
    draw_text(ctx, c->title, FONT_KEY_GOTHIC_24_BOLD, GRect(r.x + 8, r.y + r.h - 54, r.w - 12, 30), GTextAlignmentLeft, fg);
    draw_text(ctx, c->l1, FONT_KEY_GOTHIC_18, GRect(r.x + 8, r.y + r.h - 28, r.w - 12, 24), GTextAlignmentLeft, fg);
  } else if (c->kind == CELL_BUTTON) {
    bool has_sub = c->l1[0] != '\0';
    bool small = r.h < 40 || (r.w < 100 && strlen(c->title) > 7);
    int h = small ? 22 : (has_sub ? 28 : 30);
    const char *font = small ? FONT_KEY_GOTHIC_18_BOLD : FONT_KEY_GOTHIC_24_BOLD;
    // Narrow columns (Potty's three) step down once more rather than truncate.
    if (small && graphics_text_layout_get_content_size(c->title, fonts_get_system_font(font), GRect(0, 0, 400, h),
                                                       GTextOverflowModeWordWrap, GTextAlignmentCenter).w > r.w - 4) {
      font = FONT_KEY_GOTHIC_14_BOLD;
    }
    draw_text(ctx, c->title, font,
              GRect(r.x + 2, r.y + (r.h - h) / 2 - (small ? 3 : (has_sub ? 7 : 4)), r.w - 4, h), GTextAlignmentCenter, fg);
    if (has_sub) draw_text(ctx, c->l1, FONT_KEY_GOTHIC_14, GRect(r.x + 2, r.y + r.h / 2 + 8, r.w - 4, 16), GTextAlignmentCenter, fg);
  } else {  // chip
    draw_text(ctx, c->title, FONT_KEY_GOTHIC_18_BOLD, GRect(r.x, r.y + (r.h - 22) / 2 - 2, r.w, 22), GTextAlignmentCenter, fg);
  }

  if (c->selected && c->kind != CELL_HEADER && !chosen_chip) {
    graphics_context_set_stroke_color(ctx, GColorBlack);
    graphics_context_set_stroke_width(ctx, 3);
    graphics_draw_round_rect(ctx, grect(r), corner_of(c));
  }
  if (!gv->has_nav && gv->show_focus && gv->focus == i) {
    graphics_context_set_stroke_color(ctx, GColorBlack);
    graphics_context_set_stroke_width(ctx, 3);
    graphics_draw_round_rect(ctx, GRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2), corner_of(c));
  }
}

// Nav views ring the whole current zone (ADJUST) or its current item (CHOICE).
static void draw_zone_focus(GContext *ctx, const GridView *gv) {
  if (gv->nav.zone_count == 0) return;
  int z = gv->nav.zone;
  int first = gv->zone_cell[z];
  int n = gv->zone_cells[z];
  if (gv->nav.zones[z].kind == ZONE_CHOICE) {
    if (gv->nav.item >= n) return;
    first += gv->nav.item;
    n = 1;
  }
  if (first < 0 || n <= 0 || first + n > gv->count) return;
  Rect u = gv->cells[first].rect;
  int x1 = u.x + u.w, y1 = u.y + u.h;
  for (int i = first + 1; i < first + n; i++) {
    Rect r = gv->cells[i].rect;
    if (r.x < u.x) u.x = r.x;
    if (r.y < u.y) u.y = r.y;
    if (r.x + r.w > x1) x1 = r.x + r.w;
    if (r.y + r.h > y1) y1 = r.y + r.h;
  }
  graphics_context_set_stroke_color(ctx, GColorBlack);
  graphics_context_set_stroke_width(ctx, 3);
  graphics_draw_round_rect(ctx, GRect(u.x + 1, u.y + 1, x1 - u.x - 2, y1 - u.y - 2), CORNER);
}

static void draw_dots(GContext *ctx, const GridView *gv) {
  if (gv->pages <= 1) return;
  int total = gv->pages * 10 - 4;
  int x = (SCREEN_W - total) / 2 + 3;
  for (int p = 0; p < gv->pages; p++) {
    graphics_context_set_fill_color(ctx, p == gv->page ? GColorBlack : GColorDarkGray);
    graphics_fill_circle(ctx, GPoint(x + p * 10, SCREEN_H - 3), p == gv->page ? 3 : 2);
  }
}

static void draw_overlay(GContext *ctx, const GridView *gv) {
  if (gv->overlay == 1) {
    GRect box = GRect(10, 56, 180, 116);
    graphics_context_set_fill_color(ctx, GColorIslamicGreen);
    graphics_fill_rect(ctx, box, 10, GCornersAll);
    graphics_context_set_stroke_color(ctx, GColorWhite);
    graphics_context_set_stroke_width(ctx, 7);
    graphics_draw_line(ctx, GPoint(82, 96), GPoint(97, 111));
    graphics_draw_line(ctx, GPoint(97, 111), GPoint(122, 80));
    draw_text(ctx, gv->message, FONT_KEY_GOTHIC_24_BOLD, GRect(14, 128, 172, 36), GTextAlignmentCenter, GColorWhite);
  } else if (gv->overlay == 2 || gv->overlay == 3) {
    GRect box = GRect(10, 80, 180, 68);
    graphics_context_set_fill_color(ctx, gv->overlay == 2 ? GColorRed : GColorDarkGray);
    graphics_fill_rect(ctx, box, 10, GCornersAll);
    draw_text(ctx, gv->message, FONT_KEY_GOTHIC_24_BOLD, GRect(16, 88, 168, 56), GTextAlignmentCenter, GColorWhite);
  }
}

static void layer_update(Layer *layer, GContext *ctx) {
  GridView *gv = *(GridView **)layer_get_data(layer);
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, layer_get_bounds(layer), 0, GCornerNone);
  for (int i = 0; i < gv->count; i++) draw_cell(ctx, gv, i);
  if (gv->has_nav && gv->show_focus) draw_zone_focus(ctx, gv);
  draw_dots(ctx, gv);
  draw_overlay(ctx, gv);
}

static void redraw(GridView *gv) {
  if (gv->layer) layer_mark_dirty(gv->layer);
}

// ---- cells ----

void grid_view_clear(GridView *gv) {
  gv->count = 0;
}

GridCell *grid_view_add(GridView *gv, CellKind kind, Rect rect, const char *title, const char *l1,
                        const char *l2, GColor bg) {
  if (gv->count >= GRID_MAX_CELLS) {
    // Hand back a scratch cell so a caller's writes cannot corrupt a real one.
    static GridCell s_overflow;
    APP_LOG(APP_LOG_LEVEL_ERROR, "grid_view_add: more than %d cells, dropping one", GRID_MAX_CELLS);
    memset(&s_overflow, 0, sizeof(s_overflow));
    return &s_overflow;
  }
  GridCell *c = &gv->cells[gv->count++];
  memset(c, 0, sizeof(*c));
  c->rect = rect;
  c->kind = kind;
  c->enabled = true;
  c->bg = bg;
  c->fg = gcolor_legible_over(bg);
  if (title) snprintf(c->title, sizeof(c->title), "%s", title);
  if (l1) snprintf(c->l1, sizeof(c->l1), "%s", l1);
  if (l2) snprintf(c->l2, sizeof(c->l2), "%s", l2);
  return c;
}

void grid_view_commit(GridView *gv) {
  TouchTarget targets[TOUCH_MAX_RECTS];
  int n = 0;
  for (int i = 0; i < gv->count && n < TOUCH_MAX_RECTS; i++) {
    // Disabled and text cells get an empty rect so indices stay aligned.
    Rect r = gv->cells[i].rect;
    if (!focusable(&gv->cells[i])) r.w = r.h = 0;
    targets[n].rect = r;
    targets[n].key = gv->cells[i].key;
    n++;
  }
  touch_fsm_set_targets(&gv->fsm, targets, n);
  // A press survives only if its cell kept its key; otherwise the FSM has cancelled it.
  gv->pressed = touch_fsm_pressed(&gv->fsm);
  if (gv->focus >= gv->count) gv->focus = gv->count - 1;
  redraw(gv);
}

void grid_view_redraw(GridView *gv) {
  redraw(gv);
}

static void click_config(void *ctx);

void grid_view_set_zones(GridView *gv, const NavZone *zones, const int *first_cell, const int *cell_count, int count) {
  if (count > NAV_MAX_ZONES) count = NAV_MAX_ZONES;
  if (count < 0) count = 0;
  nav_init(&gv->nav, zones, count);
  for (int i = 0; i < count; i++) {
    gv->zone_cell[i] = first_cell[i];
    gv->zone_cells[i] = cell_count[i];
  }
  gv->has_nav = count > 0;
  gv->show_focus = true;
  // Re-run the click config so Back is subscribed if the window is already up.
  window_set_click_config_provider_with_context(gv->window, click_config, gv);
  redraw(gv);
}

void grid_view_focus(GridView *gv, int index) {
  gv->focus = index;
  gv->show_focus = true;
  redraw(gv);
}

// ---- overlays ----

static void overlay_expired(void *data) {
  GridView *gv = data;
  gv->overlay_timer = NULL;
  gv->overlay = 0;
  redraw(gv);
  void (*done)(GridView *) = gv->overlay_done;
  gv->overlay_done = NULL;
  if (done) done(gv);
}

void grid_view_flash(GridView *gv, int kind, const char *message, int ms, void (*done)(GridView *gv)) {
  if (gv->overlay_timer) app_timer_cancel(gv->overlay_timer);
  gv->overlay = kind;
  snprintf(gv->message, sizeof(gv->message), "%s", message ? message : "");
  gv->overlay_done = done;
  gv->overlay_timer = app_timer_register((uint32_t)ms, overlay_expired, gv);
  redraw(gv);
}

// ---- touch ----

static void press_tick(void *data);

static void stop_press_timer(GridView *gv) {
  if (gv->press_timer) {
    app_timer_cancel(gv->press_timer);
    gv->press_timer = NULL;
  }
}

static void apply_result(GridView *gv, TouchResult r) {
  if (r.cancel >= 0 && gv->pressed == r.cancel) {
    gv->pressed = -1;
    redraw(gv);
  }
  if (r.press >= 0) {
    gv->pressed = r.press;
    gv->show_focus = false;
    redraw(gv);
  }
  if (r.swipe != 0) {
    gv->pressed = -1;
    redraw(gv);
    if (gv->h.on_swipe) gv->h.on_swipe(gv, r.swipe);
  }
  if (r.activate >= 0) {
    gv->pressed = -1;
    redraw(gv);
    if (gv->h.on_activate) gv->h.on_activate(gv, r.activate, false);
  }
  if (r.long_press >= 0) {
    gv->pressed = -1;
    redraw(gv);
    vibes_short_pulse();
    if (gv->h.on_activate) gv->h.on_activate(gv, r.long_press, true);
  }
}

static void press_tick(void *data) {
  GridView *gv = data;
  gv->press_timer = NULL;
  apply_result(gv, touch_fsm_tick(&gv->fsm, now_ms()));
  if (gv->fsm.active && gv->press_timer == NULL) gv->press_timer = app_timer_register(100, press_tick, gv);
}

static int strip_at(const GridView *gv, int x, int y) {
  for (int i = 0; i < gv->count; i++) {
    const GridCell *c = &gv->cells[i];
    if (c->kind != CELL_STRIP || !c->enabled) continue;
    Rect r = c->rect;
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
  }
  return -1;
}

static void touch_handler(const TouchEvent *e, void *context) {
  GridView *gv = context;
  if (e->non_navigational || gv->overlay) return;

  // A strip owns the whole gesture from its touchdown, wherever the finger goes.
  // Every touchdown resets it, so a missed liftoff cannot swallow the next tap.
  if (e->type == TouchEvent_Touchdown) gv->strip_drag = strip_at(gv, e->x, e->y);
  if (gv->strip_drag >= 0) {
    if (e->type == TouchEvent_Liftoff) {
      gv->strip_drag = -1;
    } else if (gv->h.on_strip) {
      gv->h.on_strip(gv, gv->strip_drag, e->x);
    }
    return;
  }

  switch (e->type) {
    case TouchEvent_Touchdown:
      apply_result(gv, touch_fsm_down(&gv->fsm, e->x, e->y, now_ms()));
      stop_press_timer(gv);
      gv->press_timer = app_timer_register(100, press_tick, gv);
      break;
    case TouchEvent_PositionUpdate:
      apply_result(gv, touch_fsm_move(&gv->fsm, e->x, e->y, now_ms()));
      break;
    case TouchEvent_Liftoff:
      stop_press_timer(gv);
      apply_result(gv, touch_fsm_up(&gv->fsm, e->x, e->y, now_ms()));
      gv->pressed = -1;
      redraw(gv);
      break;
  }
}

// ---- buttons ----

static int next_focusable(const GridView *gv, int from, int dir) {
  for (int step = 1; step <= gv->count; step++) {
    int i = from + dir * step;
    if (i < 0 || i >= gv->count) return -1;
    if (focusable(&gv->cells[i])) return i;
  }
  return -1;
}

static void move_focus(GridView *gv, int dir) {
  if (!gv->show_focus || gv->focus < 0) {
    gv->show_focus = true;
    if (gv->focus < 0 || !focusable(&gv->cells[gv->focus])) {
      int first = next_focusable(gv, -1, 1);
      gv->focus = first < 0 ? 0 : first;
    }
    redraw(gv);
    return;
  }
  int next = next_focusable(gv, gv->focus, dir);
  if (next < 0) {
    // Ran off an end: on a paged view, turn the page and land on the near end.
    if (gv->h.on_swipe && gv->pages > 1) {
      int before = gv->page;
      gv->h.on_swipe(gv, dir > 0 ? SWIPE_LEFT : SWIPE_RIGHT);
      if (gv->page != before) {
        next = dir > 0 ? next_focusable(gv, -1, 1) : next_focusable(gv, gv->count, -1);
        // Going forward, land on the first tile rather than the header.
        if (dir > 0 && next >= 0 && gv->cells[next].kind == CELL_HEADER) {
          int body = next_focusable(gv, next, 1);
          if (body >= 0) next = body;
        }
        if (next >= 0) gv->focus = next;
      }
    }
    redraw(gv);
    return;
  }
  gv->focus = next;
  redraw(gv);
}

// Nav views: the first press after a touch only brings the ring back.
static bool reveal_focus(GridView *gv) {
  if (gv->show_focus) return false;
  gv->show_focus = true;
  redraw(gv);
  return true;
}

static void apply_nav(GridView *gv, NavEffect e) {
  switch (e.kind) {
    case NAV_ADJUST:
      if (gv->h.on_adjust) gv->h.on_adjust(gv, e.zone, e.dir);
      redraw(gv);
      break;
    case NAV_MOVED:
      redraw(gv);
      break;
    case NAV_ACTIVATE:
      if (e.item < gv->zone_cells[e.zone] && gv->h.on_activate) gv->h.on_activate(gv, gv->zone_cell[e.zone] + e.item, false);
      break;
    case NAV_LEAVE:
      window_stack_pop(true);
      break;
    case NAV_NONE:
      break;
  }
}

static void up_click(ClickRecognizerRef r, void *ctx) {
  GridView *gv = ctx;
  if (gv->overlay) return;
  if (gv->has_nav) {
    if (!reveal_focus(gv)) apply_nav(gv, nav_up(&gv->nav));
    return;
  }
  move_focus(gv, -1);
}

static void down_click(ClickRecognizerRef r, void *ctx) {
  GridView *gv = ctx;
  if (gv->overlay) return;
  if (gv->has_nav) {
    if (!reveal_focus(gv)) apply_nav(gv, nav_down(&gv->nav));
    return;
  }
  move_focus(gv, 1);
}

static void back_click(ClickRecognizerRef r, void *ctx) {
  GridView *gv = ctx;
  // Back always acts, so one press still leaves a sheet after a touch.
  gv->show_focus = true;
  redraw(gv);
  apply_nav(gv, nav_back(&gv->nav));
}

static void select_click(ClickRecognizerRef r, void *ctx) {
  GridView *gv = ctx;
  if (gv->overlay) return;
  if (gv->has_nav) {
    if (!reveal_focus(gv)) apply_nav(gv, nav_select(&gv->nav));
    return;
  }
  if (!gv->show_focus) {
    move_focus(gv, 1);
    return;
  }
  if (gv->focus >= 0 && gv->focus < gv->count && focusable(&gv->cells[gv->focus]) && gv->h.on_activate) {
    gv->h.on_activate(gv, gv->focus, false);
  }
}

static void select_long_click(ClickRecognizerRef r, void *ctx) {
  GridView *gv = ctx;
  if (gv->overlay) return;
  if (gv->has_nav) return;
  if (gv->show_focus && gv->focus >= 0 && gv->focus < gv->count && focusable(&gv->cells[gv->focus]) && gv->h.on_activate) {
    vibes_short_pulse();
    gv->h.on_activate(gv, gv->focus, true);
  }
}

static void click_config(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_UP, up_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_long_click_subscribe(BUTTON_ID_SELECT, 500, select_long_click, NULL);
  // Without zones Back keeps its default: pop the window.
  GridView *gv = ctx;
  if (gv->has_nav) window_single_click_subscribe(BUTTON_ID_BACK, back_click);
}

// ---- tick ----

static void tick_handler(struct tm *tick_time, TimeUnits units) {
  if (s_tick_owner && s_tick_owner->h.on_tick) s_tick_owner->h.on_tick(s_tick_owner);
}

static void apply_tick(GridView *gv) {
  if (s_tick_owner != gv) return;
  tick_timer_service_unsubscribe();
  if (gv->tick_secs > 0) {
    tick_timer_service_subscribe(gv->tick_secs == 1 ? SECOND_UNIT : MINUTE_UNIT, tick_handler);
  }
}

void grid_view_set_tick(GridView *gv, int secs) {
  gv->tick_secs = secs;
  apply_tick(gv);
}

// ---- window lifecycle ----

static void window_appear(Window *window) {
  GridView *gv = window_get_user_data(window);
  s_top = gv;

  bool touch_on = touch_service_is_enabled();
  if (touch_on) {
    s_touch_owner = gv;
    touch_service_subscribe(touch_handler, gv);
  } else {
    // No touch events will arrive: work from the buttons, with the ring showing.
    gv->show_focus = true;
    if (!gv->has_nav && (gv->focus < 0 || gv->focus >= gv->count || !focusable(&gv->cells[gv->focus]))) {
      int first = next_focusable(gv, -1, 1);
      if (first >= 0) gv->focus = first;
    }
  }

  s_tick_owner = gv;
  apply_tick(gv);
  if (gv->h.on_state) gv->h.on_state(gv);

  if (!touch_on && !s_touch_notice_shown && !gv->overlay) {
    s_touch_notice_shown = true;
    grid_view_flash(gv, 3, "Touch is off. Using buttons.", 2500, NULL);
  }
}

static void window_disappear(Window *window) {
  GridView *gv = window_get_user_data(window);
  stop_press_timer(gv);
  gv->pressed = -1;
  gv->strip_drag = -1;
  if (s_touch_owner == gv) {
    touch_service_unsubscribe();
    s_touch_owner = NULL;
  }
  if (s_tick_owner == gv) {
    tick_timer_service_unsubscribe();
    s_tick_owner = NULL;
  }
  if (s_top == gv) s_top = NULL;
}

static void window_load(Window *window) {
  GridView *gv = window_get_user_data(window);
  Layer *root = window_get_root_layer(window);
  gv->layer = layer_create_with_data(layer_get_bounds(root), sizeof(GridView *));
  *(GridView **)layer_get_data(gv->layer) = gv;
  layer_set_update_proc(gv->layer, layer_update);
  layer_add_child(root, gv->layer);
}

static void window_unload(Window *window) {
  GridView *gv = window_get_user_data(window);
  stop_press_timer(gv);
  if (gv->overlay_timer) app_timer_cancel(gv->overlay_timer);
  for (int i = 0; i < MAX_LIVE_VIEWS; i++) {
    if (s_live[i] == gv) s_live[i] = NULL;
  }
  if (gv->h.on_unload) gv->h.on_unload(gv);
  layer_destroy(gv->layer);
  window_destroy(window);
  free(gv);
}

GridView *grid_view_create(const GridHandlers *handlers, void *ctx) {
  GridView *gv = calloc(1, sizeof(GridView));
  if (!gv) return NULL;
  if (s_next_id == 0x7fffffff) s_next_id = 0;
  gv->id = ++s_next_id;
  gv->h = *handlers;
  gv->ctx = ctx;
  gv->focus = -1;
  gv->pressed = -1;
  gv->strip_drag = -1;
  gv->pages = 1;
  touch_fsm_init(&gv->fsm);

  gv->window = window_create();
  window_set_touch_bridge_disabled(gv->window, true);   // this view reads raw touch itself
  window_set_user_data(gv->window, gv);
  window_set_background_color(gv->window, GColorWhite);
  window_set_window_handlers(gv->window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload,
    .appear = window_appear,
    .disappear = window_disappear,
  });
  window_set_click_config_provider_with_context(gv->window, click_config, gv);

  bool placed = false;
  for (int i = 0; i < MAX_LIVE_VIEWS; i++) {
    if (!s_live[i]) {
      s_live[i] = gv;
      placed = true;
      break;
    }
  }
  if (!placed) APP_LOG(APP_LOG_LEVEL_ERROR, "no free live-view slot (%d); state updates will skip this view", MAX_LIVE_VIEWS);
  return gv;
}

void grid_view_push(GridView *gv) {
  window_stack_push(gv->window, true);
}

GridView *grid_view_top(void) {
  return s_top;
}

int grid_view_id(const GridView *gv) {
  return gv ? gv->id : 0;
}

int grid_view_top_id(void) {
  return grid_view_id(s_top);
}

void grid_view_notify_state(void) {
  for (int i = 0; i < MAX_LIVE_VIEWS; i++) {
    GridView *gv = s_live[i];
    if (gv && gv->h.on_state) gv->h.on_state(gv);
  }
}
