# nappi-pebble: Product

| | |
|---|---|
| Status | Current. Describes what the code does at v0.1.0, in daily use. |
| Last reviewed | 2026-10-29 |
| Audience | Anyone who needs to know what the app does and what it will not do: product, support, store copy, engineers |
| Read with | [ARCHITECTURE.md](ARCHITECTURE.md) (how and why it is built), [store-listing.md](store-listing.md) (store copy), [../AGENTS.md](../AGENTS.md) |

## How to maintain this document

- Describe **behaviour the user can see**. Reasons, protocols and timing belong in ARCHITECTURE.md; link to the ADR instead of repeating it.
- Every feature is one `F-nn` entry with the same four parts: **Summary**, **How it works**, **nappi call**, **Limits**. Keep that shape so entries can be scanned and diffed.
- IDs are never reused. A removed feature moves to section 6 with its ID.
- Update the feature index (section 3) in the same edit that adds, changes or removes an entry.
- When store copy changes, update `store-listing.md` too; the two must not disagree.
- Set `Last reviewed` only after re-reading against the running app or the code.

## 1. Summary

nappi-pebble logs a baby's feeds, diapers, potty visits, sleep and pumping to [nappi](https://nappi.app) from a Pebble Time 2. You open it from the launcher, tap a large colour tile, and the entry is logged. Most things take two taps, so it works one-handed with a baby in the other arm. Each tile also shows how long ago that thing last happened, so a glance answers "when did baby last eat?".

**Principles**

1. **Two taps to log.** Everything common is a big tile and a big button; nothing needs scrolling to reach the top actions.
2. **Never log by accident.** nappi has no delete, so a stray touch must not create an entry: lift-off activation, drag-out cancel, a short lockout after each log, deliberate Stop buttons, and no swipe that changes data.
3. **Never lie about what happened.** "Logged" appears only when the phone has the entry; silence is shown as "Not confirmed", not as success or failure.
4. **Work offline.** Entries queue on the phone and send when it reconnects, without double-logging.
5. **Name the baby.** Every confirmation says which baby it was logged for.

## 2. Requirements and compatibility

| Need | Detail |
|---|---|
| Watch | Pebble Time 2 (Emery). Other models are not supported. |
| Phone | The Pebble companion app with PebbleKit JS (the Core Devices app, tested with Android). The phone must be connected to the watch to log. |
| nappi account | **nappi Premium**; nappi's API is a Premium feature. |
| API token | Created in nappi (see [nappi's API docs](https://nappi.app/app/api/reference)) and pasted into the app's settings. A dedicated token for the watch is recommended, because rate limits are per token. |
| Network | The phone needs internet to deliver entries. The watch itself needs none. |

## 3. Feature index

| ID | Feature | State |
|---|---|---|
| F-01 | [Home grid](#f-01-home-grid) | Built |
| F-02 | [Running-timer banner and timer screen](#f-02-running-timer-banner-and-timer-screen) | Built |
| F-03 | [Diaper](#f-03-diaper) | Built |
| F-04 | [Bottle](#f-04-bottle) | Built |
| F-05 | [Nursing](#f-05-nursing) | Built |
| F-06 | [Sleep](#f-06-sleep) | Built |
| F-07 | [Pump](#f-07-pump) | Built |
| F-08 | [Potty](#f-08-potty) | Built |
| F-09 | [Time strip (backdating)](#f-09-time-strip-backdating) | Built |
| F-10 | [Amount strip and units](#f-10-amount-strip-and-units) | Built |
| F-11 | [Multiple babies](#f-11-multiple-babies) | Built |
| F-12 | [Logging feedback and offline delivery](#f-12-logging-feedback-and-offline-delivery) | Built |
| F-13 | [Status and errors](#f-13-status-and-errors) | Built |
| F-14 | [Phone settings](#f-14-phone-settings) | Built |
| F-15 | [Button fallback](#f-15-button-fallback) | Built |
| F-16 | [Exit after logging](#f-16-exit-after-logging) | Built |
| F-17 | [Instant launch from cache](#f-17-instant-launch-from-cache) | Built |

## 4. Features

### F-01: Home grid

- **Summary:** The first screen: a header and a grid of large colour tiles, four per page, one per action.
- **How it works:**
  - Header (24 px): the baby's name on the baby's accent colour, a status line, and a status dot. The status line is "N pending" when entries are waiting, otherwise nappi's status ("Offline", "Bad token", ...), or red "No phone app" if the phone app is not answering. The dot is green when synced, red on a problem, grey when showing cached or no data.
  - Tiles are 96x96 px with the nappi icon, the action name and two lines: how long ago it last happened ("2h ago", "--" if never) and the latest detail (diaper type, bottle amount in the bottle unit, nursing side last used, last sleep length, pump amount, potty outcome). For Sleep the "ago" counts from when the sleep ended.
  - A tile with a running timer is highlighted and shows the elapsed time in minutes (`<1m`, `12m`, `1h`, `1h 12m`) and "Sleeping", the side, or "Pumping" ("Paused" when paused).
  - Default order: Sleep, Nursing, Bottle, Diaper (page 1); Pump, Potty, Status (page 2). The order and which tiles show are set in the phone settings (F-14). A **Status** tile is always last. Page dots appear only when there is more than one page; swipe left or right (or use the buttons) to change page.
  - Colours: diaper amber, bottle pink, nursing orange, sleep blue, pump lavender, potty green, status grey.
  - Tapping a tile: Diaper, Bottle, Potty and Status open their sheets. Nursing opens its start sheet, or the timer screen if running. Sleep and Pump start at once on a tap and open the timer screen if running; a **long press** opens the start sheet instead (F-06, F-07). On other tiles a long press is the same as a tap.
  - Tapping the header opens the timer screen if a timer is running (the header becomes the banner, F-02), otherwise the baby switcher if there is more than one baby (F-11).
  - Elapsed and "ago" values refresh once a minute and may lag by up to a minute; a new state from the phone refreshes them at once.
- **nappi call:** `GET entries/latest` and `GET timers` on launch and about once a minute while open (ARCHITECTURE.md ADR-008).
- **Limits:** Emery layout only. The first touch after the watch has been idle is ignored on purpose (a wrist bump must not log); touch again.

### F-02: Running-timer banner and timer screen

- **Summary:** While a sleep, nursing or pump timer runs, the header becomes a banner and one tap reaches a big clock with a deliberate Stop button.
- **How it works:**
  - Banner text: "Sleeping 1h 12m", "Nursing L 12m", "Pumping 5m"; "... paused ..." for paused timers.
  - The timer screen shows a large `m:ss` (or `h:mm:ss`) clock that ticks every second while running and freezes while paused, plus a **Stop** button. Nursing also has **Switch side**.
  - **Stop** on sleep and nursing logs the entry at once and returns Home. **Stop** on a pump timer opens the pump amount screen (F-07). Stopping is never a single tap from Home.
  - **Switch side** stops the nursing timer and starts it on the other side, so a feed becomes two nursing entries (ARCHITECTURE.md ADR-010). There is deliberately no swipe to switch.
  - The screen closes itself if the timer ends elsewhere (another phone, another caregiver).
- **nappi call:** `POST timers/{type}/stop`, and for Switch side a stop followed by `POST timers/nursing/start`.
- **Limits:** A running timer's start time cannot be changed (the API cannot); backdating is only offered when starting. Timers are shared with everyone in the household, so they can change under you; the app reconciles on each refresh.

### F-03: Diaper

- **Summary:** Log a diaper in two taps.
- **How it works:** Tap **Diaper**. A sheet shows the time strip (F-09, opens at Now) and four large buttons: **Wet**, **Poo**, **Mixed**, **Dry**. Tapping one logs it and shows the confirmation (F-12).
- **nappi call:** `POST entries` `{type: "diaper", diaper_type}` with an `Idempotency-Key`.
- **Limits:** None beyond the shared ones in F-12.

### F-04: Bottle

- **Summary:** Log a bottle with an amount and a type.
- **How it works:** Tap **Bottle**. A sheet shows the time strip, an oz/ml unit pair, the amount strip (F-10), and two buttons that log: **Formula** and **Breast milk**. There is no type toggle; the "Default bottle type" setting decides which button has focus first (relevant for the buttons). The amount starts at the last amount logged on this screen, or 4 oz / 120 ml the first time.
- **nappi call:** `POST entries` `{type: "bottle", amount, unit, bottle_type}`; the unit is the one shown when you tapped.
- **Limits:** The watch offers only formula and breast milk, though nappi has more bottle types. Range 0.5 to 12 oz or 10 to 360 ml.

### F-05: Nursing

- **Summary:** Time a nursing session by side.
- **How it works:** Idle: tap **Nursing**. The start sheet shows the time strip, then **Left** and **Right** side by side, then a full-width **Both**. Choosing one starts the timer (confirmation "Nursing ..."). Running: the tile and banner show the side and elapsed time; tap to open the timer screen (F-02) to Stop or Switch side. The tile's detail line when idle is the last side used.
- **nappi call:** `POST timers/nursing/start` `{side, start_time?}`; `POST timers/nursing/stop`.
- **Limits:** Nursing is timer-only because nappi needs durations for a logged nursing entry. The side cannot be changed on a running timer; Switch side makes two entries. "Both" exists only when starting.

### F-06: Sleep

- **Summary:** Start and stop a sleep timer.
- **How it works:** A **tap** on Sleep starts the timer immediately ("Sleep started"). A **long press** opens the start sheet with the time strip so the start can be backdated up to 60 minutes. While running, tap the tile or banner to open the timer screen and Stop ("Sleep saved").
- **nappi call:** `POST timers/sleep/start` (an `already_running` reply counts as success); `POST timers/sleep/stop`.
- **Limits:** Only start can be backdated. The sleep type (nap or night) is chosen by nappi.

### F-07: Pump

- **Summary:** Time a pumping session and optionally record how much.
- **How it works:** Start like Sleep: tap to start now, long press to backdate. Stop on the timer screen opens **How much?**: a unit pair, the amount strip, and **Log** or **Skip amount**. Both end the timer.
- **nappi call:** `POST timers/pumping/start`; `POST timers/pumping/stop` `{amount?, unit?}`.
- **Limits:** Range 0.5 to 20 oz or 10 to 600 ml; the amount screen starts at the last pump amount (default 4 oz / 120 ml). One total, not per side.

### F-08: Potty

- **Summary:** Log a potty visit.
- **How it works:** Tap **Potty**. A sheet shows the time strip and **Potty**, **Accident**, **Sat dry**.
- **nappi call:** `POST entries` `{type: "potty", outcome}`.
- **Limits:** None beyond F-12.

### F-09: Time strip (backdating)

- **Summary:** A slider for "when did this happen" on every log sheet and on timer start sheets.
- **How it works:** A band under the header reads "Now - 2:41 PM" or "20 min ago - 2:21 PM" (24-hour clock if the watch is set that way); the clock time is the moment that would be logged. Drag, or tap anywhere on the band. Now is the far right; 60 minutes ago is the far left, in 5-minute steps. It always opens at Now.
- **Where:** Diaper, Potty, Bottle, Nursing start, and the Sleep and Pump start sheets (reached by long press).
- **nappi call:** The chosen time is sent as `time` (entries) or `start_time` (timers); "Now" sends no time so nappi's clock decides.
- **Limits:** 60 minutes, though nappi accepts up to 48 hours.

### F-10: Amount strip and units

- **Summary:** A slider for quantities, with a per-screen unit.
- **How it works:** Bottle and the pump "How much?" screen each have an **oz | ml** chip pair above an amount strip; more is to the right. Steps are 0.5 oz or 5 ml. Tapping a unit converts the amount to the nearest step and is remembered for that screen. Bottle and Pump have separate units; tiles show amounts in the unit of their screen. A log keeps the unit it was entered in even if the unit is changed before it is delivered. The last amount logged on each screen is remembered across launches.
- **nappi call:** `amount` plus `unit` on the entry or timer stop.
- **Limits:** See F-04 and F-07 for ranges. Changing a unit in the phone settings while a sheet is open does not update the open sheet.

### F-11: Multiple babies

- **Summary:** One app, several babies, with guards against logging for the wrong one.
- **How it works:** With one baby the header just shows the name. With more, tap the header for a sheet with one big button per baby (the switcher lists up to four). Each baby has an accent colour used in the header and on the log sheets, and every confirmation names the baby ("Phoebe: Wet"). A `*` after the name means another baby has a timer running. The active baby is remembered across launches; the default is chosen in the phone settings. The tile layout is shared by all babies. Every log is for exactly one baby; there is no "both" mode. Every command also names the baby it was meant for, and the phone refuses it if the active baby has changed since ("Baby changed. Try again").
- **nappi call:** `GET babies`; the other babies get a timers-only read so the `*` can show.
- **Limits:** The switcher shows at most four babies. With two babies a refresh costs about three of the 12 reads per minute.

### F-12: Logging feedback and offline delivery

- **Summary:** What the watch says after you tap, and what happens when the phone is offline.
- **How it works:**
  - After a tap the screen shows **Sending...**. When the phone acknowledges the entry the watch vibrates once and shows a **checkmark with a caption** ("Phoebe: Wet", "Sleep started"), then returns Home. "Logged" means the **phone has the entry**; delivery to nappi follows, and the header shows "N pending" until it is delivered.
  - While one log is awaiting its answer, a second is refused ("Still sending"). After a log, tapping the same action again within 1.5 seconds is ignored.
  - If the phone does not answer in time: "Not confirmed. Check nappi" (double pulse). The entry may or may not have been logged, so the app does not suggest trying again; it asks the phone for fresh data so the tile times show what landed.
  - If the entry never left the watch ("Not sent. Try again"), or the phone refuses it (no token, no baby, "Not logged"), nothing was logged and you can tap again at once. If nappi later rejects a queued entry for good, the watch vibrates and says "nappi rejected a log".
  - Without a connection to nappi, entries queue on the phone in order and send when it reconnects, each with a key so a retry cannot double-log. An entry delivered long after you tapped is recorded at the time you tapped, not the time it arrived. Pending entries still appear on the tiles.
  - If you press Back while "Sending..." is up, the result still shows on whatever screen you are on, but the app does not navigate for you.
- **nappi call:** `POST entries` with an `Idempotency-Key`; timers rely on the API's own idempotence.
- **Limits:** There is no way to edit or delete an entry from the watch, because nappi's API has none. Entries sent from a phone that is closed or out of range wait until it is back.

### F-13: Status and errors

- **Summary:** The app says what is wrong and, where it can, how to fix it.
- **How it works:** The **Status** tile (last in the layout) shows the connection state and the number of entries waiting. Tapping it opens the Status sheet with a sentence and a **Refresh** button (which skips the once-a-minute limit). Refresh says "Refreshing..." or "Phone not connected".

  | Situation | Header / tile | Sheet text |
  |---|---|---|
  | Fine | Synced (or "N pending") | Connected to nappi |
  | No token | No token | Enter your API token in the phone app's settings |
  | Token rejected | Bad token | Token not accepted. Check the phone settings |
  | Token expired | Expired | Token expired. Create a new one |
  | No Premium | No Premium | nappi Premium is required |
  | No internet on the phone | Offline | Phone can't reach nappi. Entries are queued |
  | Rate limited | Wait Ns | Rate limited. Retry in N s |
  | No babies | No baby | No babies in this nappi household |
  | Phone app not answering | red "No phone app" | n/a |
  | Showing saved data | grey dot, tile "Cached" | Showing the last saved state. Waiting for the phone |

- **nappi call:** Derived from error codes and HTTP status.
- **Limits:** There is no persistent "last error" line; errors show as the status and as banners.

### F-14: Phone settings

- **Summary:** A settings page in the Pebble phone app (Clay).
- **How it works:**
  - **API token:** pasted from nappi; never sent to the watch.
  - **Baby:** a picker, filled in once the token works.
  - **Bottle units / Pump units:** oz or ml each.
  - **Home screen tiles:** for each action, a position (1st, 2nd, ...) or Hidden. Tiles fill the grid four to a page in that order; Status is always last.
  - **Default bottle type:** Formula or Breast milk (which button has focus first).
  - **Exit after logging:** see F-16.
  - **Developer / API address:** defaults to nappi's API. Must start with `https://`; `http://` is accepted only for localhost and private network addresses (for testing against a mock). Anything else is ignored.
- **Limits:** Saving a different token clears the cached data. The units can also be changed from the watch (F-10).

### F-15: Button fallback

- **Summary:** Everything works without touch, for when touch is turned off in the watch's system settings.
- **How it works:** If touch is off when a screen opens, the focus ring shows at once and the app says once "Touch is off. Using buttons." (the notice blocks the buttons for about 2.5 seconds). On Home: Up/Down move the focus between tiles, Select opens the focused tile, long Select is a long press. On sheets with strips, each strip, the unit pair and the action buttons form a sequence of zones: Up/Down move the knob on a strip (Up is toward Now or more, and selects ml on the unit pair) or cycle the buttons; Select moves to the next zone, or logs the focused button; Back moves to the previous zone and leaves the sheet from the first. The first press after a touch only reveals the focus ring.
- **Limits:** Strips move one step per click. Back is repurposed as "previous zone" on these sheets.

### F-16: Exit after logging

- **Summary:** An optional mode that closes the app after a successful log so the watch returns to the watchface.
- **How it works:** With the setting on, after the checkmark the app waits until the phone has delivered the write (and everything else queued) to nappi, then exits. While waiting it shows "Saving...". If delivery is not confirmed in time, the app does not exit: it says "Saved on your phone. Will send later" and returns Home, because the phone side stops when the app closes and the write would otherwise wait until the next launch.
- **Limits:** A backlog (for example during a rate limit) keeps the app open. If the phone is offline, the app always stays open.

### F-17: Instant launch from cache

- **Summary:** The grid appears immediately with the last known data while the phone refreshes.
- **How it works:** The watch keeps the last state it received. On launch it shows it with a grey dot and "Cached" on the Status tile until the phone sends fresh state. If the watch has no data at exit, nothing is kept, so old data cannot reappear as "Synced".
- **Limits:** The cache is saved at exit, so a force quit or crash leaves an older state.

## 5. Screen reference

```
+--------------------------+  y=0
| Phoebe *      N pending o|  header 24 px: name or banner, status line, dot
+------------+-------------+  y=28
|  [icon]    |  [icon]     |
|  Sleep     |  Nursing    |  tiles 96x96, 4 px gutters
|  2h ago    |  1h ago     |  line 1: how long ago (or elapsed, if running)
|  45m       |  Left       |  line 2: latest detail
+------------+-------------+
|  Bottle    |  Diaper     |
|  3h ago    |  1h ago     |
|  4 oz      |  Wet        |
+------------+-------------+  y=224..228 page dots
```

Real screens, from the emulator against the mock API (the emulator has no touch, so a focus ring shows):

| Home, page 1 | Home, page 2 | Diaper | Bottle | Nursing timer |
|---|---|---|---|---|
| ![Home grid, page 1](screenshots/emery_1_home.png) | ![Home grid, page 2](screenshots/emery_2_page2.png) | ![Diaper sheet](screenshots/emery_3_diaper.png) | ![Bottle sheet](screenshots/emery_4_bottle.png) | ![Nursing timer screen](screenshots/emery_5_timer.png) |

Sheets (Diaper, Potty, Bottle, Nursing start, Sleep/Pump start, Pump "How much?"): header "<baby>: <title>", then the time strip, then (Bottle and Pump) the unit pair and amount strip, then the action buttons. Switch baby is a list of baby buttons. Status is a text block and Refresh.

## 6. Out of scope and removed

| Item | State | Why |
|---|---|---|
| Edit or delete an entry | Not possible | nappi's API has no edit or delete. |
| Solids, medication, growth | Not supported | Solids and medication are read-only in the API; growth is not wanted on a watch. |
| Activity logging | Removed (was in the first spec) | Cut to keep the screen small. A saved layout that still lists it is tolerated. See ARCHITECTURE.md ADR-018. |
| Bottle presets and the Custom amount screen | Replaced by the amount strip (F-10) | One control instead of six buttons plus a screen. |
| Swipe on the nursing timer to switch side | Removed on purpose | A stray swipe would create two undeletable entries. |
| Backdate a running timer | Not possible | The API cannot change a running timer's start. |
| Voice entry, watchface, "log for both babies" | Not planned | Out of scope for v1. |
| Other bottle types (tube, cow, goat, soy, other) | Not offered | Only formula and breast milk are on the watch. |
| Round or other Pebble models | Not supported | Emery only. A Gabbro port is on the roadmap. |

## 7. Roadmap and open questions

| Item | State |
|---|---|
| Test on a real Time 2 and the real nappi API; first store release | Next (see [store-listing.md](store-listing.md)) |
| Launcher glance and timeline pins | Not started |
| Gabbro (Pebble Round 2) port | Not started |
| Which store to publish to (Rebble or the Core Devices app store) | Open |
| Does nappi's own timer notification mirror to the watch? | Open |
| Permission to use nappi's artwork in the store listing | Open; see store-listing.md |
| Strip adjustment by repeating button clicks | Planned |
