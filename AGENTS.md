# AGENTS.md

Guidance for AI agents (and humans) working on nappi-pebble. Read this first; it points at the documents that hold the detail.

## What this is

nappi-pebble is a Pebble Time 2 (Emery, 200x228, colour e-paper, touch) watchapp for logging a baby's feeds, diapers, potty, sleep and pumping to the [nappi](https://nappi.app) baby tracker through nappi's public API. A C watch app handles the UI; PebbleKit JS on the phone handles the token, HTTP, cache and offline queue; the two talk over AppMessage. Goal: two taps from the launcher to a logged entry.

The project is at v0.1.0 and is in daily use on a Pebble Time 2 with a real phone and the real nappi API.

## Where to read

| You need to know | Read |
|---|---|
| What the app does, per feature, and what it deliberately does not do | [docs/PRODUCT.md](docs/PRODUCT.md) |
| How it is built, why, the rules for changing it, and the known limitations | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (decision records in section 8, rules in section 9, limitations in section 10) |
| App store fields, description, assets and the publish checklist | [docs/store-listing.md](docs/store-listing.md) |
| Pebble SDK API details | <https://developer.repebble.com/llms.txt>. Fetch the `.md` version of any page before using an API; do not rely on memory. |
| nappi API details | <https://nappi.app/app/api/reference> and <https://api.nappi.app/v1/openapi.json>. ARCHITECTURE.md section 3.1 lists the facts the design depends on. |
| General Pebble app and watchface practice | The vendored `pebble-watchface` skill, `.claude/skills/pebble-watchface/` (see below) |

`docs/superpowers/` is git-ignored scratch space for agent plans and specs. Nothing in it is authoritative; the two main docs are.

## Commands

```sh
npm ci                          # install (pebble-clay is the only dependency)
npm test                        # JS tests (node:test), then host-side C tests; needs no Pebble tooling
npm run test:js                 # JS half only
npm run test:c                  # C half only (gcc, -Wall -Wextra -Werror -pedantic)
pebble clean && pebble build    # emery .pbw (SDK 4.33.1); needs the Pebble SDK
SEED=1 TWO_BABIES=1 npm run mock   # fake nappi API on http://127.0.0.1:4010, with some history
pebble install --emulator emery
pebble logs --emulator emery
pebble screenshot --emulator emery out.png
pebble emu-button click select down up back   # drive buttons; add --duration 900 for a long press
```

Mock tokens: `dev-token` (good), `expired-token`, `revoked-token`, `free-token` (no Premium). `PORT`, `HOST`, `SEED` and `TWO_BABIES` configure the mock (see `test/support/serve.js`).

`npm test` must pass before you call work done. CI runs the same command on every push to `main` and on pull requests. `pebble build` is not in CI; run it yourself for any change under `src/c/` or to `package.json`, because the host C tests do not compile the SDK glue.

### Driving settings in the emulator

`pebble emu-app-config --emulator emery` opens the Clay page and listens on `http://localhost:<port>/close?`. The page's Save button redirects there with the form values. To skip the browser, GET that URL yourself with the URL-encoded JSON, for example `{"token":{"value":"dev-token"},"baseUrl":{"value":"http://localhost:4010"}}`. The port is in the generated `~/pebble-tool-emu-app-config-*.html` (`return_to=`), which the tool deletes once used. Units are two settings: `"bottleUnits":{"value":"ml"}` and `pumpUnits`.

Verification `curl`s against the mock share the app's token, so they use up the app's 12 reads a minute.

## Repository map

```
src/pkjs/        phone: index.js (the only file touching Pebble globals), app.js (engine), api.js, queue.js,
                 commands.js, optimistic.js, state.js, protocol.js (source of truth), wire.js, settings.js, config.js, ...
src/c/           watch UI and SDK glue: main.c comm.c grid_view.c ui.c home.c sheets.c timer_view.c
src/c/logic/     plain C, no SDK includes, host-tested: model fmt layout touch_fsm lockout strip amount nav
                 send_flow ready_gate, and protocol.h (mirror of protocol.js)
test/            *.test.js (node:test); c/ (host C tests + Makefile); support/ (mock nappi, engine harness, dev server)
resources/icons  1-bit tile icons and the menu icon;  art/ their SVG sources and nappi's logo
store/           appstore icons;  tools/ scripts that render icons and store assets
docs/            ARCHITECTURE.md, PRODUCT.md, store-listing.md; screenshots/ (emulator captures used by the README, PRODUCT.md and the store)
.claude/skills/   vendored third-party skill: pebble-watchface
package.json     the app manifest too: uuid, targetPlatforms, messageKeys, resources
```

## Vendored skill: pebble-watchface

`.claude/skills/pebble-watchface/` is a third-party agent skill by coredevices, copied into this repo so it is available to anyone working here. Source and updates: <https://github.com/coredevices/pebble-watchface-agent-skill> (the copy targets SDK 4.33.1, the same as this project). It has SDK guides for watchapps, drawing and animation, a list of SDK doc URLs, project scaffolding and validation scripts, and templates.

Use it for general Pebble questions, not as the authority on this app:

- It is written mainly for watchfaces. It has no coverage of the touch API, and rules such as "always tick by minute" do not all apply to an app with a running-timer screen (ARCHITECTURE.md ADR-016).
- Where it disagrees with `docs/ARCHITECTURE.md`, the architecture doc wins.
- Do not edit it in place. To update it, re-copy it from upstream. Its scripts scaffold new projects; do not run them in this repo.

## Rules that bite

These are the short version. ARCHITECTURE.md section 9 has the full list and the reasons.

1. **nappi has no delete.** Never log, retry or confirm in a way that can create a duplicate or a false "logged". All logging goes through `ui_send`; never show a checkmark from anywhere else. On "no reply" the watch says "Not confirmed" and must not invite a retry.
2. **Protocol changes touch three files together**: `src/pkjs/protocol.js`, `src/c/logic/protocol.h` and `package.json` `pebble.messageKeys`. `test/protocol-sync.test.js` enforces it. **After changing `messageKeys`, run `pebble clean` before `pebble build`**, or the generated `MESSAGE_KEY_*` header goes stale and the build fails or silently uses old keys. Never reuse a retired command id (5 is retired).
3. **Changing `WatchState` (`logic/model.h`) means bumping `PERSIST_VERSION` in `comm.c`** and updating the `sizeof` check beside the struct.
4. **Put decisions in `src/c/logic/`** (no Pebble headers) with a test in `test/c/`. Keep SDK glue thin.
5. **Text-only UI changes call `grid_view_redraw`; only structural changes call `grid_view_commit`.** Commit rebuilds hit targets and can cancel a touch in progress.
6. **Never pop a window from inside that window's appear or state handler.** Defer with a 0 ms `AppTimer` and use `window_stack_remove`.
7. **pkjs is ES2015 only** (bundled by webpack 1): no async/await, no object spread, no trailing commas in calls. `test/syntax.test.js` is a tripwire; `pebble build` is the authority. Only `index.js` may use `Pebble`, `localStorage`, `XMLHttpRequest`.
8. **Respect nappi's limits**: 12 reads and 30 writes a minute per token, no background polling, ETag only on `entries/latest`, `Idempotency-Key` only on `POST /entries`.
9. **Emery only.** Geometry is hard-coded to 200x228. `main.c` has an `#error` for other platforms; do not add a platform without doing the screen abstraction first (ARCHITECTURE.md ADR-002).
10. **The token never goes to the watch**, and the API address must be `https://` unless it is localhost or a private network address.
11. **Never change the app UUID** in `package.json` (`9d7f77ad-...`): it is how the store matches releases to the listing. Bump `version` for every release.

## Gotchas

- Emulator XHR reports a refused connection only through `readystatechange` (status 0). `xhr-transport.js` handles it and has a watchdog; do not simplify that away.
- The emulator cannot inject touch. Touch code in `grid_view.c` can only be checked on a real watch; the gesture logic is covered by `test/c/test_touch.c`.
- Clay builds its widgets from the config passed to its constructor, so `index.js` creates a new Clay per settings page.
- The first touch after the watch idles (`non_navigational`) is ignored on purpose.
- An interrupted `pebble sdk install` can leave a partial SDK directory that the tool still reports as installed (builds fail with a `NODE_PATH` error). Fix: `pebble sdk uninstall 4.33.1` then `pebble sdk install 4.33.1`.
- Tile icons in `art/icons/*.svg` are rendered to 1-bit PNGs by `node tools/make-icons.js` (after `npm i --no-save @resvg/resvg-js pngjs`); `grid_view.c` recolours them. Store icons come from `art/nappi-logo.png` via `tools/make-store-assets.js`.
- The tile icons, the logo, and icons derived from them are nappi's artwork. The MIT license does not cover them; do not relicense or redistribute them elsewhere.

## Doing the work

- **Match the surrounding code.** Comment density, naming and idiom follow the neighbouring files. Comments explain why, not what.
- **Test first for logic.** New phone behaviour gets a `node:test` against the mock harness (`test/support/harness.js`); new watch decisions get a host C test. The mock is contract-tested; extend it when you need new API behaviour, and record any assumption at the top of `mock-nappi.js`.
- **Keep the docs true.** When a change alters what a user sees, update the relevant feature in `docs/PRODUCT.md`. When it alters a protocol key, module boundary, timing constant, persisted format or a rule, update `docs/ARCHITECTURE.md` (add an ADR for a new decision; supersede, do not rewrite, an old one). Fix `docs/store-listing.md` if store copy would now be wrong. Do not paste test counts or line numbers into docs.
- **Be honest about verification.** Host tests and the emulator cannot show touch, the ready handshake, send flow, exit-after-log or real-API behaviour. If you change those paths, run the manual checklist in ARCHITECTURE.md section 10 or say which parts you could not check.
- **Commits**: short imperative subject in the style of `git log` ("Hold watch sends until PebbleKit JS has spoken"). Keep `npm test` green at every commit. Commit and push only when asked.

## Definition of done

1. `npm test` passes.
2. `pebble clean && pebble build` succeeds if you touched `src/c/`, `package.json` or `wscript`.
3. For a behaviour change, you ran it in the emulator against `npm run mock` where the emulator can show it, and said what it cannot.
4. PRODUCT.md and ARCHITECTURE.md match the code.
5. Nothing in `docs/superpowers/`, `.superpowers/`, `build/`, `node_modules/` or `*.pbw` is committed.
