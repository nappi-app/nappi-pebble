// Bottom-sheet style screens opened from Home. Each is a GridView. The log
// sheets open with a time strip at Now (drag or Up/Down to backdate up to an
// hour); Bottle and the pump "How much?" sheet add a unit row and an amount strip.
#pragma once
#include <stdbool.h>

void sheet_diaper(void);
void sheet_potty(void);
void sheet_bottle(void);
void sheet_nursing_start(void);
void sheet_timer_start(int action);   // sleep or pump, backdated start
void sheet_pump_amount(void);         // after stopping a pump timer
void sheet_babies(void);
void sheet_status(void);

void timer_view_open(int timer);
