// Helpers shared by Home and the sheets: colours, the send-and-confirm flow
// (debounce, vibe, checkmark naming the baby), and navigation back to Home.
#pragma once
#include <pebble.h>
#include "grid_view.h"
#include "comm.h"

void ui_init(void);

GColor ui_action_color(int action);
uint32_t ui_action_icon(int action);   // resource id of the tile icon, 0 for none
GColor ui_accent(int index);   // one colour per baby, so each is recognisable
GColor ui_baby_accent(const WatchState *s);
int32_t ui_now(void);

void ui_set_home_window(Window *home);
void ui_pop_to_home(void);

// Call whenever the phone's state arrives: lets a pending exit-after-log finish.
void ui_on_state(void);

// Standard sheet header: "<baby>: <title>" in the baby's accent colour.
void ui_add_header(GridView *gv, const char *title);

// Sends a write command: ignores a repeat within the lockout, refuses a second
// one while the first awaits its ACK ("Still sending"), and tells the user when
// the phone is unreachable. Otherwise it shows "Sending..." and only vibrates
// and shows the checkmark, captioned "<baby>: <what>", once the phone has
// acknowledged the command; a refusal or a failed send shows an error, and
// silence shows "Not confirmed". If the sending view is still in front it then
// returns to Home, or exits (after the phone has delivered the write to nappi).
bool ui_send(int action, const char *what, int cmd, int32_t a1, int32_t a2, int32_t a3, int32_t a4);
