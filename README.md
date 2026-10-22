# BikeMi Explorer / original Playwright synchronization

Start with **LEGGIMI_PRIMA.md**. This is an updated Node/Express/Playwright application, NOT a static-only rewrite.

## Architecture

```text
Phone browser: map, consent-based GPS, Italian/English UI
    |
    | protected HTTP API over HTTPS
    v
Node + Express backend
    |
    +-- Playwright persistent Chromium profile for each local user ID
    |       -> BikeMi login -> SMS -> OTP -> saved authenticated session
    |       -> /profile/trips -> document.body.innerText
    |
    +-- original ride-parser.ts -> SQLite rides -> matched visited station IDs
    |
    +-- official public GBFS station feed -> station catalogue
```

The original `src/ride-parser.ts` is byte-identical. The actual provider methods `requestSms`, `submitOtp`, `hasRideHistory`, `rideHistoryRows` retain the original implementation. Runtime guards and session-directory configuration were added around the browser lifecycle.

No file upload, paste, browser extension, bookmarklet, external browser service or invented personal API is used to acquire BikeMi trips.

## Prerequisites and local start

Node 22+, npm and a system able to run Chromium. Use the original dependency lockfile. Do not copy the uploaded Windows `node_modules` onto Linux or a Raspberry Pi; `npm ci` installs suitable modules for the destination.

```sh
npm ci
npm run setup
npm run browser:install
npm start
```

Linux dependencies: `npx playwright install --with-deps chromium`.

`npm start` compiles TypeScript and runs the server. Default bind address is `127.0.0.1:3000`. Do not expose the service as plain HTTP over the public internet. Put it behind an HTTPS reverse proxy and configure `BEHIND_PROXY=true` only when requests arrive through your own single trusted proxy.

`npm run setup` creates `.env` only if absent. The access key is randomly generated and not written to console logs. Open `.env` privately and copy the value of `EXPLORER_ACCESS_KEY` into the application's site-access screen.

The site key is separate from BikeMi authentication. It protects the private backend from anyone guessing a profile ID. It grants access to ALL local profiles on this personal/family installation; it is not multi-tenant authorization for unrelated users. Do not distribute it as a public app login.

## Persistent data

`data/bikemi.sqlite`: original tables for connections, rides, station snapshots and sync status, plus additive tables for durable visits, successful-sync history and current station catalogue.

`data/bikemi_sessions/<userId>/`: original Playwright persistent Chromium profiles. These contain authentication material and must be protected like account credentials. They are not served over HTTP or committed to GitHub.

An OTP is submitted to BikeMi but never saved or logged. As in the original project, the profile telephone number is stored in SQLite and is NOT returned by API status endpoints. Raw private trip history is stored on the server as in the original project; this edition does not claim to retain station IDs only. The browser also caches the derived dashboard on the device. GPS coordinates are used in memory only and are never sent to this API.

Make private backups with the application stopped. To migrate, copy the original SQLite database and keep the original local user ID. Copying browser profiles may require a fresh BikeMi login on a different operating system. Use one backend process and one persistent volume; do not horizontally scale instances over the same session directories.

## Hosting options

**Recommended:** keep the repository on GitHub, run both frontend and backend on a Node/Chromium host with persistent disk, and put HTTPS in front. Leave `public/config.js` `apiBase` empty.

**Optional split:** serve `public/` from GitHub Pages and run the same backend elsewhere. Set `apiBase` to its HTTPS origin. Set backend `ALLOWED_ORIGINS` to the exact Pages origin, e.g. `https://OWNER.github.io`, without repository path or trailing slash. Multiple trusted origins may be comma-separated.

The `.github/workflows/pages.yml` workflow is manual and publishes ONLY `public/`. It explicitly checks that an HTTPS backend is configured. It does not run persistent Playwright jobs or store sessions in Actions artifacts.

For same-origin hosting the private-site session uses an HttpOnly SameSite=Strict cookie, marked Secure under HTTPS and lasting seven days. For split hosting, a signed seven-day bearer token is held only in the browser tab's sessionStorage; closing that tab can require entering the private-site key again, but not necessarily another BikeMi SMS. Logging out clears device state and the cookie/token. Existing stolen bearer tokens are not individually revocable; rotate the server access key to revoke all site tokens. This is a personal deployment, not a complete public identity service.

The key must not be written to `public/config.js`, a URL, the Pages workflow, browser localStorage or GitHub. Protect the site from XSS and do not add untrusted scripts. The map uses only local scripts and external public OSM tiles.

## Docker

A Dockerfile and Compose definition are supplied as deployment templates; a Docker image build has NOT been run in this environment.

```sh
npm run setup
docker compose up --build -d
```

The Dockerfile installs a browser matching the locked Playwright package. Compose keeps the database and browser profiles in a named volume and binds the HTTP port to localhost. Use a trusted HTTPS reverse proxy for access from a phone outside the host. Do not use ephemeral disk, browserless function runtimes or short-lived serverless requests for the original multi-step SMS/session mechanism. The server must remain available while handling a pending OTP and a sync request.

## Source acquisition and limitations

The original code navigates to `https://bikemi.com/log-in`, enters `input[name="nationalPhoneNumber"]`, submits `form#create-verification-form`, fills the verification-code field, then waits for `form#enter-code-form` to disappear. The browser verifies the authenticated route `/profile/trips`.

The original history reader waits briefly, then reads `document.body.innerText`. The unchanged parser recognizes rendered Italian trip lines and older generic rows. No internal endpoint, bypass of authentication or promised complete-pagination routine was introduced. Only use accounts you control or have permission to access.

A BikeMi UI change, delayed page rendering, changed login flow, expired session or verification challenge may require intervention. A zero-row parse is an error/warning and never overwrites the last successful sync. No fresh login or live private-history verification was possible here. Tests do not guarantee that BikeMi's current private DOM matches the original selectors.

The original date parser represents rendered dates as UTC rather than resolving Europe/Rome offsets. It remains unchanged to preserve its existing derived ride IDs. This UI does not present those timestamps as accurate trip-time analytics; sync timestamps use their actual ISO instant. Correcting historical ride-time semantics would require a separate migration decision.

The list of stations is public GBFS. A saved snapshot is provided for initial display; its date is shown. Temporary feed failures do not discard retrieved trips. Stations absent from a later complete feed become inactive for completion counts while old visited IDs are retained. No GPS proximity, arbitrary manual marking or fuzzy ambiguous name match creates a visit.

## Relevant API routes

All except health and site login require the private-site session.

```text
GET  /api/health
POST /api/explorer/login            {key}
POST /api/explorer/logout
GET  /api/explorer/profiles
GET  /api/bikemi/connection/:userId
POST /api/bikemi/connect/start      {userId, phoneNumber}
POST /api/bikemi/connect/verify     {userId, authAttemptId, otp}
POST /api/bikemi/connect/cancel     {userId}
POST /api/bikemi/session/check      {userId}
POST /api/bikemi/sync               {userId}
GET  /api/bikemi/dashboard/:userId
GET  /api/bikemi/stations
POST /api/explorer/reset            {userId}
```

Errors return fixed codes, not raw Playwright exceptions. API responses have `Cache-Control: no-store`. Input validation, per-profile operation locks and limited SMS/site-login rates are included. Browser contexts waiting for SMS are closed after five minutes. Reset affects this app only, not the BikeMi account; a future sync can retrieve those trips again.

## Tests

```sh
npm run check
npm test
```

`npm test` compiles and runs 41 Node checks, including HTTP integration with a simulated BikeMi browser. The original Vitest tests are retained under `test/`; their equivalent core behaviors are included in the executed Node checks. Optional `npm run test:legacy` runs that suite when Vitest's native dependencies are installed normally.

`tests/component_checks.py` is an in-memory Chromium DOM harness with simulated network, API, tiles and GPS. It requires Python, Pillow, Playwright and a local Chromium executable. Set `CHROMIUM_TEST_PATH` as appropriate. It does not contact BikeMi.

## Primary technical references

- GitHub Pages static hosting: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- GitHub Pages custom publishing workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- Playwright Node library: https://playwright.dev/docs/library
- Playwright Docker prerequisites: https://playwright.dev/docs/docker
- Browser same-origin restrictions: https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
- Secure-context and consent requirements for GPS: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition

This is a personal project, not an official BikeMi application.
