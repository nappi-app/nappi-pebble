#include "test.h"
#include "nav.h"

static void three_zones(Nav *n) {
  NavZone z[3] = {
    { ZONE_ADJUST, 0, 0 },
    { ZONE_ADJUST, 0, 0 },
    { ZONE_CHOICE, 2, 1 },
  };
  nav_init(n, z, 3);
}

TEST(select_walks_zones_then_activates_choice) {
  Nav n; three_zones(&n);
  CHECK_INT(n.zone, 0);
  NavEffect e = nav_select(&n);
  CHECK_INT(e.kind, NAV_MOVED); CHECK_INT(n.zone, 1);
  e = nav_select(&n);
  CHECK_INT(e.kind, NAV_MOVED); CHECK_INT(n.zone, 2); CHECK_INT(n.item, 1);
  e = nav_up(&n);
  CHECK_INT(e.kind, NAV_MOVED); CHECK_INT(n.item, 0);
  e = nav_up(&n);
  CHECK_INT(n.item, 1);
  e = nav_down(&n);
  CHECK_INT(n.item, 0);
  e = nav_down(&n);
  CHECK_INT(n.item, 1);
  e = nav_select(&n);
  CHECK_INT(e.kind, NAV_ACTIVATE); CHECK_INT(e.zone, 2); CHECK_INT(e.item, 1);
}

TEST(back_walks_zones_then_leaves) {
  Nav n; three_zones(&n);
  nav_select(&n); nav_select(&n);
  NavEffect e = nav_back(&n);
  CHECK_INT(e.kind, NAV_MOVED); CHECK_INT(n.zone, 1);
  e = nav_back(&n);
  CHECK_INT(e.kind, NAV_MOVED); CHECK_INT(n.zone, 0);
  e = nav_back(&n);
  CHECK_INT(e.kind, NAV_LEAVE);
}

TEST(adjust_zone_up_and_down_report_direction) {
  Nav n; three_zones(&n);
  NavEffect e = nav_up(&n);
  CHECK_INT(e.kind, NAV_ADJUST); CHECK_INT(e.dir, 1); CHECK_INT(e.zone, 0);
  e = nav_down(&n);
  CHECK_INT(e.kind, NAV_ADJUST); CHECK_INT(e.dir, -1);
}

TEST(single_item_choice_zone) {
  Nav n;
  NavZone z[1] = { { ZONE_CHOICE, 1, 0 } };
  nav_init(&n, z, 1);
  nav_up(&n);   CHECK_INT(n.item, 0);
  nav_down(&n); CHECK_INT(n.item, 0);
  NavEffect e = nav_select(&n);
  CHECK_INT(e.kind, NAV_ACTIVATE); CHECK_INT(e.item, 0);
}

TEST(select_on_last_adjust_zone_does_nothing) {
  Nav n;
  NavZone z[2] = { { ZONE_ADJUST, 0, 0 }, { ZONE_ADJUST, 0, 0 } };
  nav_init(&n, z, 2);
  nav_select(&n);
  NavEffect e = nav_select(&n);
  CHECK_INT(e.kind, NAV_NONE); CHECK_INT(n.zone, 1);
}

int main(void) {
  RUN(select_walks_zones_then_activates_choice);
  RUN(back_walks_zones_then_leaves);
  RUN(adjust_zone_up_and_down_report_direction);
  RUN(single_item_choice_zone);
  RUN(select_on_last_adjust_zone_does_nothing);
  FINISH();
}
