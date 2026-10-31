# nappi-pebble: Architecture

| | |
|---|---|
| Status | Current. Matches the code at v0.1.0, which is in daily use on a Time 2 with the real nappi API. |
| Last reviewed | 2026-10-29 |
| Audience | Anyone changing the code: engineers and agents |
| Read with | [PRODUCT.md](PRODUCT.md) (what the app does), [../AGENTS.md](../AGENTS.md) (how to work in the repo), [store-listing.md](store-listing.md) (release checklist) |

## How to maintain this document

- **One fact, one place.** Behaviour a user can see belongs in PRODUCT.md. Why the code is shaped the way it is belongs here. Commands and workflow belong in AGENTS.md.
- **Decisions are append-only.** Never delete or renumber an ADR in section 8. To change a decision, add a new ADR, set the old one's status to `Superseded by ADR-nnn`, and update the sections that describe the current shape.
- **Update this file in the same commit** as any change that touches a protocol key, a module boundary, a timing constant named here, the persisted formats, or a rule in section 9.
- **Do not copy numbers that change** (test counts, line counts). Point at the file that holds them instead.
- Set `Last reviewed` when you have re-read the whole file against the code, not when you edit one line.

## 1. Purpose and scope

nappi-pebble is a Pebble Time 2 (Emery, 200x228, colour e-paper, touch) watchapp that logs a baby's feeds, diapers, potty, sleep and pumping to [nappi](https://nappi.app) through nappi's public API. The goal is two taps from the launcher to a logged entry, with one hand free.

This document covers the system's structure, the contracts between its parts, the reasoning behind non-obvious choices, and the rules for changing it. It does not describe screens and flows in user terms (PRODUCT.md) or the release process (store-listing.md).

## 2. System overview

```
 Watch app (C, UI only)  <--AppMessage-->  PebbleKit JS (phone)  --HTTPS-->  api.nappi.app
 src/c/                                    src/pkjs/
   grid_view / home / sheets / timer_view    app.js     engine: cache, refresh, commands
   ui.c      send flow glue                  queue.js   durable ordered write queue
   comm.c    AppMessage, outbox, persist     api.js     typed nappi client
   logic/    plain C, host-tested            state.js   builds the compact state dict
                                             config.js  Clay settings page
```

Three places hold state, and they never share a store:

| Where | What | Lifetime |
|---|---|---|
| Phone `localStorage` | `nappi-pebble.settings` (token, baby, units, layout, base URL), `nappi-pebble.cache` (babies, latest entries, ETags, timers), `nappi-pebble.queue` (pending writes) | Survives app restarts; cleared when the app is uninstalled |
| Watch persistent storage | The last `WatchState` (keys 100 and up), last bottle and pump amounts (111, 112) | Written at exit; read at launch |
| nappi | The truth for entries and timers | Shared with other caregivers' devices |

The watch never holds the token and never touches the network. Everything it shows is the last `STATE` message from the phone, formatted on the watch.

### Technology

| Concern | Choice |
|---|---|
| Platform | Pebble Time 2 only (`targetPlatforms: ["emery"]`), SDK 4.33.1, `pebble` tool 5.0.38 or newer |
| Watch language | C, with SDK-free logic under `src/c/logic/` |
| Phone language | JavaScript in PebbleKit JS, bundled by the SDK's webpack 1 (ES2015 syntax only) |
| Settings UI | [Clay](https://github.com/pebble/clay) (`pebble-clay`), with a fresh instance per settings page |
| Tests | `node:test` for JS, plain gcc binaries for C logic, a contract-tested in-memory mock of the nappi API |
| CI | GitHub Actions runs `npm ci && npm test` on push to `main` and on pull requests. `pebble build` is local only. |

## 3. Constraints that shape the design

### 3.1 nappi API

Source of truth: `https://api.nappi.app/v1/openapi.json` and <https://nappi.app/app/api/reference>. Check them before relying on anything below; this section records only what the design depends on.

- Bearer token, and the token's owner needs nappi Premium. Tokens are created in nappi's connections page and shown once.
- **Rate limits: 12 reads and 30 writes per minute per token**, with `Retry-After` on 429. nappi asks for at most one poll a minute. A 304 is assumed (not documented) to count as a read.
- ETag and `If-None-Match` exist **only** on the two `entries/latest` endpoints. `Idempotency-Key` exists **only** on `POST /entries`.
- **No edit or delete endpoints.** Solids and medication are read-only. This single fact is behind most of the app's caution (ADR-006, ADR-010).
- Timers (sleep, nursing, pumping) are household-shared: another phone can start, pause or stop them. Start on a running timer returns 200 `already_running`. Stop on a stopped timer returns 409 `timer_not_running`. Timers carry `paused` and `elapsed_seconds`.
- Times must be ISO 8601 with an offset. Amounts are millilitres unless `unit: "oz"` is sent; latest-entry responses always report ml. Nursing `side: both` is valid only when starting a timer. A logged nursing entry needs durations, so live nursing goes through timers.
- Error bodies are `{"error": {"code", "message"}}`. Codes the docs name: `unauthorized`, `token_expired`, `premium_required`, `timer_not_running`. The docs give no code for 429 or 404, so the client branches on HTTP status.
- Calls the app makes: `GET /v1/babies`, `GET /v1/babies/{id}/entries/latest?types=...`, `GET /v1/babies/{id}/timers`, `POST /v1/babies/{id}/entries`, `POST /v1/babies/{id}/timers/{sleep|nursing|pumping}/start|stop`.
- The assumptions the mock had to make because the docs are silent are listed at the top of `test/support/mock-nappi.js`. Real-API behaviour that contradicts one of them is a bug in the mock first.

### 3.2 Pebble platform

- The watch heap is small and there is no filesystem; persistent storage is key/value, with a 256-byte limit per value (hence the chunked state blob).
- Emery's touch API is raw (`Touchdown`, `PositionUpdate`, `Liftoff`). Taps, drag-out cancel, long press and swipes are decided in our own state machine (ADR-009).
- E-paper: no continuous animation. Home redraws once a minute; only the running-timer screen redraws every second.
- PebbleKit JS stops when the watchapp exits, and starts a fresh context on every reconnect, so readiness is per connection (ADR-007).
- PebbleKit JS in the emulator reports a refused connection only through `readystatechange`, not `onerror`.
- Changing `messageKeys` requires `pebble clean`; see section 9.

## 4. Components

### 4.1 Phone (`src/pkjs/`)

| File | Responsibility |
|---|---|
| `index.js` | The **only** file that touches Pebble globals (`Pebble`, `localStorage`, `XMLHttpRequest`, timers, Clay). Wires them into `createApp`. |
| `app.js` | The engine. Owns the cache, the read budget, throttled refresh, the queue flush, command handling and state building. Everything it needs from the runtime is injected, so it runs under test. |
| `api.js` | nappi client. Takes a `transport(req) -> Promise<{status, headers, body}>`. Maps error bodies to `ApiError {code, status, retryAfter}`. |
| `xhr-transport.js` | Transport over XHR with its own watchdog (ADR-008 note), since the emulator's XHR can hang silently. |
| `queue.js` | Durable, ordered write queue with idempotency keys, late-delivery stamping and the rules for what is retried, dropped or done. |
| `commands.js` | Pure: watch command dict to queue jobs (`entry`, `timer_start`, `timer_stop`). Validates ranges, throws `BadCommand`. |
| `optimistic.js` | Pure: predicts what a queued job will look like in the cache so the watch can show it at once. |
| `state.js` | Pure: cache + settings to the compact `STATE` dict (epoch seconds and small enums; the watch formats text). |
| `protocol.js` | **Source of truth** for enums, command ids, status codes and the AppMessage key list. |
| `wire.js` | Logical dict to numeric AppMessage keys (array keys like `LAST[7]` spread to consecutive ids). |
| `settings.js`, `config.js` | Settings blob and defaults; Clay config builder and response parser, including the base-URL rule (ADR-014). |
| `babies.js`, `time.js`, `uuid.js` | Active-baby resolution, ISO 8601 helpers, v4 UUIDs. |

### 4.2 Watch (`src/c/`)

| File | Responsibility |
|---|---|
| `main.c` | Init/deinit. `#error` for any platform other than Emery. |
| `comm.c` | AppMessage: inbox/outbox, a 4-slot send FIFO with bounded retry, the ready gate, the phone-connection handler, and the persisted `WatchState`. |
| `grid_view.c/.h` | **One reusable window type** (`GridView`) made of cells (tiles, buttons, chips, header, text, strips). Home and every sheet are GridViews, so touch and the button fallback are written once. Owns drawing, focus, overlays, tick subscription. |
| `ui.c` | Colours, per-baby accents, and `ui_send`: the glue between a tap and the send flow (timers, vibes, overlays). Navigation back to Home. |
| `home.c` | Home grid, header/banner, paging, what each tile does when activated. |
| `sheets.c` | Diaper, potty, bottle, nursing start, timer start, pump amount, baby switcher, status. |
| `timer_view.c` | The running-timer screen (clock, Stop, Switch side). |
| `logic/` | Plain C with no SDK includes, compiled and tested on the host (below). |

`src/c/logic/` modules: `model` (WatchState and all tile/banner/status text), `fmt` (time and amount formatting), `layout` (grid geometry and hit tests), `touch_fsm` (gestures), `lockout` (per-action debounce), `strip` and `amount` (slider maths and limits), `nav` (button zones), `send_flow` (the confirm state machine), `ready_gate` (when the watch may send), and `protocol.h` (mirror of `protocol.js`).

### 4.3 Shared protocol

`protocol.js` is the source of truth. `src/c/logic/protocol.h` and `package.json#pebble.messageKeys` must agree with it; `test/protocol-sync.test.js` fails the build if they do not.

- **Phone to watch:** `JS_READY` (first message on every start), then `STATE` (several keys: `STATUS`, `BABY_*`, `LAST[7]`, `INFO[7]`, `TIMER_*[3]`, `TIMER_AT`, `BOTTLE_UNITS`, `PUMP_UNITS`, `EXIT_AFTER_LOG`, `DEFAULT_BOTTLE`, `LAYOUT`, `PENDING`, `OTHER_TIMERS`, `RETRY_AFTER`), and `ACK_ID` + `ACK_STATUS`.
- **Watch to phone:** `CMD` + `CMD_ID` + `ARG1..ARG4` (+ `BABY_INDEX` on every write). Commands: `REFRESH`, `LOG_DIAPER`, `LOG_BOTTLE`, `LOG_POTTY`, `TIMER_START`, `TIMER_STOP`, `SWITCH_BABY`, `TIMER_SWITCH`, `SET_UNITS`. Id 5 (`LOG_ACTIVITY`) is retired and must not be reused.
- Argument meanings per command are documented above `CMD` in `protocol.js`; read them there rather than from a copy.
- Payloads carry epoch seconds and small ints. Amounts travel as value x10 (so 2.5 oz is 25), and **the unit travels with the command** (ADR-015).
- `ACK_ID 0` with `ACK_STATUS REJECTED` is the phone telling the watch, unprompted, that nappi refused a write it had already confirmed.
- Watch-only ack statuses `COMM_ACK_NOT_SENT` (-1) and `COMM_ACK_NO_REPLY` (-2) are never on the wire.

## 5. Key flows

### 5.1 Launch

1. Watch `init`: `ui_init`, `comm_init` (loads the persisted `WatchState`, marks it `from_cache`), pushes Home. It sends nothing.
2. Phone `ready` event runs `app.start()`: sends `JS_READY`, then (with a token and a cached baby list) the cached state, then a forced refresh.
3. A refresh flushes the write queue, then reads `entries/latest` (with `If-None-Match`) and `timers` for the active baby, plus `timers` for each other baby, then sends `STATE`. The first `STATE` clears `from_cache`.

### 5.2 Logging an entry (the critical path)

1. Tap on a sheet button calls `ui_send(...)`. It refuses if a command is already in flight ("Still sending") or the action is inside its 1.5 s lockout, then `comm_send`s and shows "Sending...".
2. `comm.c` holds the command until the ready gate opens, then hands it to AppMessage (retrying a busy or NACKing outbox, never a timed-out send).
3. Phone `write()` checks token, baby and `BABY_INDEX`, turns the command into jobs (`commands.js`), enqueues them (each gets a UUID key and `queuedAt`), applies them optimistically to the cache, then sends **`ACK` first, then `STATE`** (whose `PENDING` already counts the new write), then flushes the queue in the background.
4. The watch shows the checkmark and vibrates **only on the ACK**. Delivery to nappi happens afterwards; the ACK means "safely queued on the phone".
5. After the flush the phone schedules one debounced re-read (4 s) and sends a final `STATE`.

If no ACK arrives within 6 s, or AppMessage gives up after the send, the watch says "Not confirmed. Check nappi" and asks for a forced refresh, so the next state shows whether the entry landed (ADR-006).

### 5.3 Timers

Start and stop are queue jobs like any write. The watch ticks the clock locally from `TIMER_ELAPSED` + `TIMER_AT`; the phone rolls elapsed seconds forward by the time since its snapshot (paused timers are not rolled). Switch side is a stop followed by a start on the other side (ADR-010). A refresh reconciles with whatever other devices did.

### 5.4 Refresh and the read budget

Nothing polls in the background. Reads happen on launch, at most once a minute while a Home or timer screen is open (the watch asks every 60 s; the phone throttles to 60 s since the last refresh unless the request is forced), on baby switch when that baby's data is stale, and as one debounced re-read after a write. See ADR-008.

## 6. Data and state

### 6.1 Phone

- **Settings** (`nappi-pebble.settings`): token, babyId, bottleUnits, pumpUnits, baseUrl, layout (ordered action names, Status appended by `state.js`), defaultBottleType, exitAfterLog. The token never goes to the watch.
- **Cache** (`nappi-pebble.cache`): babies; per baby `latest`, `etag`, `timers`, `timersAt`, `fetchedAt`; and `others` (whether another baby has a running timer). Cleared when the token changes. Queued writes are laid back over every read (ADR-012).
- **Queue** (`nappi-pebble.queue`): array of `{kind, babyId, body, timerType?, key, queuedAt}`, strictly ordered. The first job that cannot be delivered holds the rest back.

### 6.2 Watch

- **`WatchState`** (`logic/model.h`) is the decoded `STATE`. It is persisted as a raw blob in 200-byte chunks (keys 101+), validated by `PERSIST_VERSION * 100000 + sizeof(WatchState)` under key 100.
  - Changing `WatchState` **requires bumping `PERSIST_VERSION`** in `comm.c` and updating the `sizeof` check next to the struct (a compile error reminds you). Size alone cannot catch a reordering of equal-sized fields.
  - Only `int32_t`, `uint8_t`, `bool` and `char` members, so the size matches on the host and on the 32-bit watch.
- **Last amounts**: keys 111 (bottle) and 112 (pump), stored in ml x10 and converted to the screen's current unit when read. Persist keys are allocated in `comm.c` and `sheets.c`; keep the ranges disjoint until they are consolidated (section 10).
- Writes happen at exit only, and the blob is deleted if the watch has no data, so an old state cannot come back as "Synced".

## 7. Timing constants

These are load-bearing; change them together with the reasoning in the ADR that names them.

| Constant | Value | Where | Why |
|---|---|---|---|
| Lockout per action | 1500 ms | `logic/lockout.h` | No delete in the API: absorb double taps |
| Ack wait | 6000 ms | `ui.c` `ACK_WAIT_MS` | Longer than comm's retries (4 x 600 ms) plus a round trip. Armed when the command first reaches AppMessage. |
| Exit wait | 6000 ms | `ui.c` `EXIT_WAIT_MS` | How long exit-after-log waits for delivery |
| "Sending..." overlay | 15000 ms | `ui.c` `SENDING_MS` | Outlasts the ready fallback plus the ack wait; every result replaces it |
| Ready fallback | 8000 ms | `logic/ready_gate.h` | A lost `JS_READY` must not wedge the app |
| Outbox | 4 slots, 4 tries, 600 ms apart | `comm.c` | Retries busy outbox, disconnect, NACK |
| Long press / swipe | 500 ms / 40 px | `logic/touch_fsm.h` | |
| Refresh throttle | 60 s | `app.js` `MIN_REFRESH_MS` | nappi asks for one poll a minute |
| Re-read after write | 4 s debounce; skipped with fewer than 4 reads left | `app.js` | Leaves room for the next refresh |
| Late-write stamp | queued more than 30 s ago | `queue.js` `STALE_MS` | See ADR-011 |
| XHR timeout / watchdog | 20 s / 25 s | `xhr-transport.js` | |

## 8. Decision records

Format: **Status** (Accepted, or Superseded by ADR-nnn), **Context**, **Decision**, **Consequences**, **Code**.

### ADR-001: C watch app plus PebbleKit JS phone engine

- Status: Accepted (2026-10-24)
- Context: The watch needs a fast, touch-first UI; talking to nappi needs HTTPS, a token, retries and offline persistence. Moddable/Alloy JS was the alternative.
- Decision: UI in C on the watch; all network, token, cache and queue logic in PebbleKit JS on the phone. The watch holds no secrets and does no I/O beyond AppMessage.
- Consequences: Two languages and a protocol to keep in sync (ADR-004). The token stays on the phone. Offline behaviour is a phone concern, so the watch can be dumb and fast.
- Code: `src/c/`, `src/pkjs/`.

### ADR-002: Emery only, touch first, buttons as a fallback

- Status: Accepted (2026-10-24)
- Context: Pebble Time 2 is the only touch device targeted. A round Gabbro port is wanted later.
- Decision: `targetPlatforms: ["emery"]` and layout in absolute 200x228 coordinates (`logic/layout.h` and literals in `sheets.c`, `timer_view.c`, `grid_view.c`). `main.c` has an `#error` for other platforms. Buttons work everywhere and are the primary path when touch is disabled in system settings.
- Consequences: Simple, fast layout code now. A Gabbro port means moving every rect behind a screen-size abstraction first (section 10). Nobody can add a platform by accident.
- Code: `main.c`, `logic/layout.[ch]`, `grid_view.c`.

### ADR-003: Plain-C logic layer, host-tested; SDK glue kept thin

- Status: Accepted (2026-10-24)
- Context: The Pebble emulator cannot inject touch, and device testing is slow. Logic bugs in a UI app are expensive.
- Decision: Every decision that can be made without the SDK lives in `src/c/logic/`, includes no Pebble headers, and is compiled by `test/c/Makefile` with `-std=c99 -Wall -Wextra -Werror -pedantic`. SDK-facing files (`comm.c`, `ui.c`, `grid_view.c`, `home.c`, `sheets.c`, `timer_view.c`) own timers, drawing, vibes and the window stack and call into logic modules.
- Consequences: The riskiest bugs live in the glue, which is not host-testable (section 10). New decision logic goes into `logic/` with a test; do not add a `pebble.h` host stub.
- Code: `src/c/logic/`, `test/c/`.

### ADR-004: One protocol definition, enforced by a test

- Status: Accepted (2026-10-24)
- Context: Message keys and enums are duplicated across JS, C and `package.json`; drift fails silently on a real device.
- Decision: `protocol.js` is the source of truth. `protocol.h` and `package.json` messageKeys are checked against it by `test/protocol-sync.test.js`. Array keys (`LAST[7]`) and the `wire.js` translation are part of that check.
- Consequences: A new key is edited in three places in one commit, then `pebble clean`. Retired ids are left unused, not reassigned.
- Code: `src/pkjs/protocol.js`, `src/c/logic/protocol.h`, `package.json`.

### ADR-005: The phone owns a durable, ordered write queue with idempotency keys

- Status: Accepted (2026-10-24)
- Context: The phone is often offline or rate limited; a retry must never double-log; the API has no delete.
- Decision: Every write becomes a job with a UUID `Idempotency-Key` created at enqueue time, persisted before the watch is ACKed, and delivered strictly in order. 429, 5xx and network errors stop the queue and retry later (a 429 schedules its own retry); 401/403 stop it as an auth failure; other 4xx drop the job and tell the watch (`REJECTED`); a stop that returns 409 `timer_not_running` counts as done.
- Consequences: Entries are safe to retry. Timer start and stop are not covered by an idempotency key (the API offers none) and rely on the API's own `already_running` and `timer_not_running` semantics. A job that fails deterministically with 5xx blocks later writes with no cap (section 10).
- Code: `queue.js`, `app.js` `flushQueue`.

### ADR-006: The watch tells the truth about what it knows

- Status: Accepted (2026-10-28, after review)
- Context: There is no delete, so "logged" shown for an entry that never arrived, or a prompt to retry something that did, is the worst failure the app can have.
- Decision:
  - The checkmark and vibration appear only when the phone's ACK for that command id arrives.
  - **One logging command in flight**: while one awaits its ACK, `ui_send` refuses another ("Still sending"). Baby switch, units and Refresh bypass this slot and can never show a checkmark.
  - **No reply means unknown, not failed**: after an AppMessage give-up or the 6 s ack timeout the watch shows "Not confirmed. Check nappi" (no suggestion to retry), requests one forced refresh, and does not clear the lockout. A late OK ACK is ignored; the refreshed state tells the story.
  - Refusals that mean nothing was logged (`NOT_SENT`, `NO_TOKEN`, `NO_BABY`, `WRONG_BABY`, `ERROR`) show an error and clear the lockout so the user can tap again at once.
  - Leaving the view does not lose the result: a late OK ACK still shows the checkmark on the top view but never navigates or exits.
  - The ack timer and the exit timer belong to the flow in `ui.c`, not to any view, so Back or a later overlay cannot cancel them.
  - Every write carries `BABY_INDEX`; the phone refuses it (`WRONG_BABY`) if that is no longer the active baby.
- Consequences: The state machine is `logic/send_flow` (host-tested); `ui.c` supplies timers, vibes and overlays. The ACK means "queued on the phone", so a checkmark is not proof nappi has the entry; the Status tile's pending count and exit-after-log cover that gap.
- Code: `logic/send_flow.[ch]`, `ui.c`, `app.js` `write`.

### ADR-007: The watch waits for PebbleKit JS before sending (`JS_READY`)

- Status: Accepted (2026-10-28)
- Context: PebbleKit JS holds messages that arrive before its `ready` event for a limited time. Sending at launch relied on NACK retries and could time out the user-visible wait.
- Decision: The phone's `start()` sends `{ JS_READY: 1 }` first on every launch, token or not. `comm.c` accepts commands (up to 4) but does not transmit until the phone has said anything on **this connection**. Readiness is per connection: `comm.c` forgets it on every phone-connection change and arms an 8 s fallback at launch and on each reconnect. If the fallback fires first, commands go out anyway and Home shows red "No phone app" until the phone speaks. If the gate is closed and the phone is disconnected, queued commands are given up as "not sent". The decision is `logic/ready_gate`. The watch sends no refresh at launch; the phone does.
- Consequences: A dropped ready message cannot wedge the app; the cost is an 8 s wait on the first send if the fallback has to fire.
- Code: `logic/ready_gate.[ch]`, `comm.c`, `app.js` `start`.

### ADR-008: Strict read budget, no background polling

- Status: Accepted (2026-10-24)
- Context: 12 reads/min and 30 writes/min per token; nappi asks for at most one poll a minute; a baby with a running timer should not wake the phone constantly.
- Decision: The engine counts its own reads in a sliding minute and meters the client. Refresh is throttled to one a minute unless forced. Each refresh costs 2 reads for the active baby plus 1 timers read per other baby. The debounced post-write re-read is "light" (active baby only) and skipped when fewer than 4 reads remain; because the queue is replayed over every read (ADR-012), skipping it costs freshness, not correctness. Read and write limits are independent: a write 429 sets `writeBlockedUntil` only and schedules its own retry. The ETag is kept per baby. A dedicated token is recommended because limits are per token. The XHR transport has a watchdog because the emulator's XHR can fail silently.
- Consequences: The tile "ago" values can be up to a minute stale. Verification `curl`s against the mock share the app's token and eat its 12 reads.
- Code: `app.js`, `api.js`, `xhr-transport.js`.

### ADR-009: Hand-rolled touch state machine with identity-keyed targets

- Status: Accepted (2026-10-24; identity keys added 2026-10-28)
- Context: Touch events are raw. The system gesture recognizers have no long press and no pressed highlight, and their swipe fires only on a fast flick.
- Decision: `logic/touch_fsm` decides tap (activates on liftoff only if the finger never left its target), drag-out cancel, long press (500 ms, suppresses the tap) and swipe (40 px). A target is a rect plus a small `key`. When targets are replaced during a gesture, the gesture survives only if its target keeps the same rect **and** key. Text-only updates call `grid_view_redraw` (no hit-rect change); only real structure changes call `grid_view_commit`. Home sets the key to the action id so a layout change mid-press cancels instead of activating the wrong tile.
- Consequences: A once-a-second refresh can no longer swallow a tap on Stop. Cells are still addressed by position inside each view; inserting a cell silently retargets handlers (section 10).
- Code: `logic/touch_fsm.[ch]`, `grid_view.c`.

### ADR-010: Timer semantics follow what the API can do

- Status: Accepted (2026-10-24; swipe removed 2026-10-28)
- Context: The API cannot change a running timer's side or start time and has no delete.
- Decision: "Switch side" is a stop followed by a start on the other side, so one feed becomes two nursing entries. Backdating is offered only when starting, never on a running timer. The spec's swipe-to-switch was removed because a stray swipe would create two undeletable entries; only the Switch side button does it. Paused timers (which the original spec ignored) show "Paused" with the clock frozen and are not rolled forward. Stopping needs the timer screen's Stop button, never one tap from Home.
- Consequences: The nursing history shows per-side entries. The Stop retried after a lost response could stop a timer another device has just started (section 10).
- Code: `commands.js` (`TIMER_SWITCH`), `timer_view.c`, `app.js` `rolledTimers`.

### ADR-011: Late writes carry the tap time; prompt writes carry none

- Status: Accepted (2026-10-24)
- Context: A job queued while offline must record when it happened. A prompt job that carries the phone's clock can be rejected as "in the future" if the phone runs ahead of the server.
- Decision: A job delivered more than 30 s after it was queued is stamped with its queue time (`time`, `start_time` or `end_time`, with the offset at that time). A prompt job carries no time and the server's clock decides. Backdated entries set an explicit time from the strip.
- Consequences: Found by running the offline scenario in the emulator. Timestamps in the queue use the phone's timezone offset at the queued instant.
- Code: `queue.js` `stamped`, `time.js`.

### ADR-012: Optimistic cache, with the queue replayed over every read

- Status: Accepted (2026-10-24)
- Context: The watch should show a log at once, and a refresh must not make a still-queued log vanish.
- Decision: `optimistic.js` applies each job to the cached `latest` and `timers`. After every read, `readEverything` replays `queue.all()` for that baby over the server data. A rejected job clears all ETags (so the next read replaces the wrong guess) and sends the watch an unprompted `REJECTED`.
- Consequences: Pending entries appear on tiles before nappi has them; the Status tile shows the pending count.
- Code: `optimistic.js`, `app.js` `replayQueue`.

### ADR-013: The watch cache is shown as cached, and written at exit

- Status: Accepted (2026-10-28)
- Context: The grid should appear instantly on launch, but stale data must not look live.
- Decision: The persisted `WatchState` is read at launch with `from_cache` set, cleared by the first state from the phone. While set, Home's dot is grey and the Status tile and sheet say it is cached. Red "No phone app" outranks grey. The blob is written at exit only (the Persistent Storage guide asks for launch/exit writes, and a timer timestamp changes on every message so "write on change" would be "write always"). With no data at exit the blob is deleted.
- Consequences: A force quit or crash skips the write, so the next launch shows an older state. The Home header does not show the word "Cached"; the grey dot does that job (section 10).
- Code: `comm.c`, `logic/model.[ch]`, `home.c`.

### ADR-014: The token only travels over https, or to this phone or a private network

- Status: Accepted (2026-10-28)
- Context: The "API address" setting exists so the app can be tested against a mock; a bad value would send the bearer token somewhere else.
- Decision: The settings store and the Clay parser accept `https:` addresses, or `http:` only for `localhost`, `[::1]` and `127.*`, `10.*`, `172.16-31.*`, `192.168.*`. The check reads the text exactly as an HTTP client would and rejects `user@` prefixes, look-alike suffixes, backslashes, whitespace and octal octets. A rejected value from the Clay page is ignored (the previous value kept) and logged; the field's description states the rule. A bad value an earlier install saved falls back to the default at read time.
- Code: `settings.js`, `config.js`, tests `settings.test.js`, `config.test.js`.

### ADR-015: Units are per screen and travel with the command

- Status: Accepted (2026-10-25)
- Context: Parents may measure bottles in oz and pumping in ml. A queued write must not change meaning if the setting changes before it is delivered.
- Decision: Bottle and Pump have separate units (Clay: "Bottle units", "Pump units"; an old single `units` value seeds both). The oz/ml chips on the amount screens send `SET_UNITS`; the phone saves, ACKs and pushes state. `LOG_BOTTLE` and the pump `TIMER_STOP` carry the unit they were entered in (`ARG4`); the phone falls back to its saved unit only if the argument is absent or invalid. Amounts travel x10.
- Consequences: A queued `SET_UNITS` that is later NACKed, or a unit change made in the phone settings while a sheet is open, can leave the sheet showing a stale unit until it is reopened; the amount is still logged in the unit the sheet showed.
- Code: `commands.js`, `app.js` `setUnits`, `sheets.c`, `logic/amount.[ch]`.

### ADR-016: Home ticks once a minute; only the timer screen shows seconds

- Status: Accepted (2026-10-28)
- Context: A second-level tick redraws everything and keeps the CPU awake for as long as a timer runs, and it also made touch cancellation frequent before ADR-009.
- Decision: Home subscribes to the minute tick and shows elapsed time in minutes (`<1m`, `12m`, `1h`, `1h 12m`; `fmt_elapsed_min`). The timer screen keeps an `m:ss` clock and a one-second tick while the timer is running (none when paused).
- Consequences: Home elapsed times can lag by up to a minute; a new state message refreshes them at once.
- Code: `home.c`, `timer_view.c`, `logic/fmt.[ch]`.

### ADR-017: Exit-after-log waits for delivery, and stays open when unsure

- Status: Accepted (2026-10-28)
- Context: PebbleKit JS stops with the app, so exiting right after the checkmark would strand the write in the phone queue until the next launch.
- Decision: With the setting on, after the checkmark the app waits for the first state received **after** the ACK. If that state has `pending == 0` it exits. Otherwise it shows "Saving..." and keeps waiting for a state with `pending == 0` (a backlog therefore takes this path). The wait has its own timer and is tied to the view that started it. On timeout the app stays open ("Saved on your phone. Will send later") and goes Home. `exit_reason_set(APP_EXIT_ACTION_PERFORMED_SUCCESSFULLY)` is called only on the delivered path. An unprompted `REJECTED` ends the wait without exiting.
- Code: `logic/send_flow.[ch]`, `ui.c`.

### ADR-018: Activity logging was removed; the API client still supports it

- Status: Accepted (2026-10-25)
- Context: The first spec had an Activity tile.
- Decision: The tile, sheet, command, message keys and Clay entry were removed from the watch and phone. A saved layout that still lists `activity` is tolerated. The API client and mock still implement activities so they remain a faithful model of nappi.
- Code: `protocol.js` (retired `LOG_ACTIVITY` id 5), `state.js` `layoutIds`.

### ADR-019: Test against a contract-tested mock, not the live API

- Status: Accepted (2026-10-24)
- Context: There was no API token when the app was built, and tests should not depend on the network or on rate limits.
- Decision: `test/support/mock-nappi.js` is an in-memory nappi built from the published OpenAPI spec, with its own contract tests (`mock-*.test.js`). The engine harness (`test/support/harness.js`) wires the real engine to the mock with a controllable clock and network. `npm run mock` serves the same mock over HTTP for the emulator.
- Consequences: The mock encodes assumptions about undocumented behaviour (listed at its top). Behaviour seen against the real API that contradicts one is a bug in the mock first.
- Code: `test/support/`.

## 9. Rules for changing the code

1. **Protocol changes**: edit `protocol.js`, `protocol.h` and `package.json#pebble.messageKeys` together; add the argument meanings to the comment above `CMD`; run `pebble clean` before `pebble build`; keep `JS_READY` first on start. Do not reuse retired ids.
2. **`WatchState` changes**: bump `PERSIST_VERSION` in `comm.c` and update the `sizeof` check in `model.h`. Use only fixed-width integer, `bool` and `char` members.
3. **Decision logic goes in `src/c/logic/`** with a host test. Glue files should not grow `if` ladders that could be tested.
4. **Text-only changes call `grid_view_redraw`**, not `grid_view_commit`. Only structure changes (cells added, moved, removed) commit, because commit rebuilds hit targets.
5. **Do not pop windows from inside a window's own appear or state handler.** Defer with a 0 ms `AppTimer` and close with `window_stack_remove` (see `timer_view.c`). A pop nested in a pop leaves the window stack in a bad state.
6. **Add a send path through `ui_send`** for anything that logs. Never show a checkmark from anywhere else. Anything that is not a log (baby switch, units, refresh) calls `comm_send` directly and reports a failed send itself.
7. **Never invite a retry on "unknown".** Only a refusal that proves nothing was logged may clear a lockout.
8. **pkjs stays ES2015** (no async/await, object spread, or trailing commas in calls). `test/syntax.test.js` is a tripwire; `pebble build` is the authority. Only `index.js` may touch Pebble globals.
9. **Keep timers out of views.** A timer whose firing affects protocol state (ack, exit) lives in `ui.c` or `comm.c`, never on a window that can be popped.
10. **Honour the API's limits.** Any new request must be counted in the read budget (use the metered client) and must not poll.
11. **Cell indices are positional.** When changing a view's cells, re-check every handler that switches on an index.
12. **Log, do not hide, a capped resource.** Dropped cells, a full live-view table or a full icon cache log at error level.

## 10. Testing and known limitations

### Automated coverage (`npm test`)

- JS: the mock's contract, API client, queue, engine, state builder, settings, Clay config, protocol sync, and the real `index.js` under fake Pebble globals.
- C logic: `touch_fsm`, `send_flow`, `ready_gate`, `fmt`, `model`, `amount`, `strip`, `nav`, `layout`, `lockout`.

### Emulator checks (with the mock server)

Launch from cache, status states, every sheet, diaper and bottle logging, sleep/nursing/pump timers, switch side, baby switching, paging with buttons, backdating with the time strip driven by buttons, and offline queue then recovery.

### What automation cannot reach

The emulator has no touch injection, and the SDK glue (`grid_view.c` touch handler, `comm.c`, `ui.c`) is not host-testable. The gesture, send-flow and ready-gate decisions are unit-tested; the glue around them is checked by hand on a Time 2 with a real phone.

### Manual checklist for changes to touch, `comm.c`, `ui.c` or the send flow

1. With a sleep timer running, tap Stop, the tiles, and long-press Sleep/Pump repeatedly for a minute; no tap is lost.
2. Log a diaper straight after launch and straight after reconnecting the phone; "logged" appears only after the ACK.
3. With the phone app closed, log: expect "Not confirmed" (never "logged"), no second entry after a deliberate wait-and-check, and queued delivery when the phone returns.
4. Press Back during "Sending..."; the app must not get stuck or exit later.
5. Exit-after-log with the phone offline: the app stays open and says the entry is saved.
6. Switch baby with Bluetooth off: error, still on the sheet.
7. Turn touch off in system settings: the app is usable by buttons and says so.
8. Check that "Saved on your phone. Will send later" fits its banner and that long readouts ("60 min ago - 12:41 PM") fit the strip.

### Known limitations and follow-ups

Ordered roughly by how much they matter.

| Item | Detail |
|---|---|
| Stop retried after a lost response | May stop a timer another device has just started. A 409 is treated as done. |
| Queue not tied to the token | Changing the token clears the cache but not queued writes, which then 404 and surface as "nappi rejected a log". A 401/403 halts the whole queue. |
| Queue has no retry cap or age-out | A job that fails forever with 5xx blocks later writes. 408 and 425 are dropped though retryable. |
| `SET_UNITS` NACK / settings-page unit change | An open sheet can disagree with the phone's saved unit until reopened (ADR-015). |
| Wrong-baby guard compares an index, not an id | If the baby list is reordered between watch and phone, indexes can line up by coincidence. Not guarded when the watch has no data. |
| Full outbox reads as "Phone not connected" | `comm_send` returns the same `false` for both. |
| Nursing Stop and Switch share one lockout | A Stop within 1.5 s of a switch is dropped with no message. |
| No persistent last-error line on the Status sheet | Errors show in the header and as banners only. |
| Home header does not say "Cached" | Only the grey dot and the Status tile/sheet do. The header status line is the pending count while the persisted status is OK. |
| Baby switcher shows at most 4 babies | Accent colours cycle after 6. |
| Button fallback is one click per step | A 360 ml strip takes 70 clicks. Back means "previous zone" on sheets with zones. Repeating clicks are the planned fix. |
| Press timer may keep running after a long press opens a sheet | Plausible, never confirmed (depends on when `disappear` runs). |
| Cells addressed by position | Inserting a cell retargets handlers; `timer_view.c` keeps a dummy cell to preserve indices. Stable ids are the fix if views keep multiplying. |
| Geometry hard-coded to 200x228 | See ADR-002. Do the screen abstraction before any Gabbro work. |
| Persist keys allocated in two files | `comm.c` (100+) and `sheets.c` (111, 112) with no registry. The state blob would grow into 111 above 2000 bytes. |
| Inbound AppMessage reads ignore tuple type and length | Only `LAYOUT` checks length. |
| Fonts below 18 pt; `ContentSize` ignored; names cut on a byte boundary | Non-Latin names may not render at all (system fonts cover Latin-1). |
| `comm.c`, `ui.c` and `grid_view.c` have no automated coverage | The send-confirm and ready decisions are extracted and tested; the glue around them is not. Extract more when next touched. |

Declined on purpose: a `pebble.h` host stub, linters before a second contributor, replacing `touch_fsm` with system recognizers, splitting `GridCell.l1` by kind.

## 11. Roadmap

| Item | State |
|---|---|
| First store release | Next. See [store-listing.md](store-listing.md) for the listing and checklist. |
| Launcher glance, timeline pins | Not started |
| Gabbro (Pebble Round 2) port | Not started; needs the screen abstraction first |
| Distribution channel (Rebble vs Core Devices app store) | Open |
| Moddable/Alloy JS instead of C + PebbleKit JS | Decided against for v1 (ADR-001) |
| Does nappi's own timer notification mirror to the watch? | Open; worth a quick check |

## 12. Glossary

| Term | Meaning |
|---|---|
| Cell | One drawable, tappable element in a `GridView` (tile, button, chip, header, text, strip). |
| Sheet | A pushed `GridView` for one action (diaper, bottle, ...). |
| Strip | A horizontal slider cell: the time strip (0 to 60 min ago) or the amount strip. |
| Zone | A group of cells the buttons move between: strips are adjust zones, action buttons are the choice zone. |
| ACK | The phone's reply to a command id, meaning "queued on the phone". Not delivery to nappi. |
| Pending | Writes the phone holds that nappi has not accepted yet (`PENDING`). |
| Ready gate | The rule for when the watch may send to PebbleKit JS (ADR-007). |
| Lockout | The per-action 1.5 s window in which a second tap is ignored. |
