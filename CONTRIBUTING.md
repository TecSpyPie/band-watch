# Working on Band Watch

Thanks for helping. Band Watch is a free (MIT) ham radio app by M3VRV: live band conditions, decoders
(FT8, FT4, WSPR, CW, SSTV), FT8/FT4 transmitting, satellites, POTA, a logbook and radio control. It runs as a
web page served by a small server, either Node.js (`server.js`) or the Windows app (`desktop/`, in Go).

**How changes get in:** make a branch, open a **pull request**, and the owner (M3VRV) decides. Nothing goes to
`main` without the owner's say-so, because **pushing to `main` with a new version publishes a release** that
every Band Watch on Windows offers to install.

Ideas without code are just as welcome: open an **Issue** describing what you'd like and why.

## Running and testing

    npm start              # the Node server on $PORT (default 8080)
    npm test               # unit and API tests (no network needed); CI runs these
    npm run test:browser   # end-to-end tests in headless Chrome (needs Playwright)
    npm run test:go        # the Go server's tests, and the API/browser suites against it

- Add tests for what you change. Signal-processing code (decoders, encoders) is tested by making a signal and
  decoding it back, with noise; see `test/ft8.test.js`, `test/sstv.test.js`, `test/ftxtx.test.js`.
- On Windows, one test ("RTL-SDR: starts rtl_tcp…") fails because its pretend `rtl_tcp` is a shell script.
  It passes on Linux (CI).

## Where things are

    server.js, qrz.js, clock.js   the Node server: page, /api/* feeds (cached), QRZ, the RTL-SDR bridge
    desktop/                      the same server in Go (BandWatch.exe); desktop/setup is the installer
    public/index.html             the page; public/js/*.js one file per part (plain scripts, loaded in order)
    public/js/ft8-worker.js       the decoder worker: FT8, FT4, WSPR, CW and SSTV run here
    public/js/ft8.js              FT8/FT4 messages, LDPC, decoder (used by the worker and for transmitting)
    public/js/ftxtx.js, tx.js     FT8/FT4 transmitting: the on-air signal and QSO steps; keying and the Transmit box
    public/js/sstv.js, sstvui.js  SSTV modes, encoder and decoder; the picture panel and gallery
    public/js/satmath.js, sats.js satellites: orbit maths (vendored satellite.js) and the panel
    public/js/vendor/             third-party code, each with its licence at the top
    test/                         node:test suites; test/fixtures for recorded data

## Rules that matter

**Transmitting.** Band Watch keys real radios. Keep every one of these:
- Nothing transmits unless the user has switched **Enable TX** on, and it is **off every time Band Watch starts**
  (never saved).
- **Stop TX** and **Esc** stop at once: sound off and the radio unkeyed (the unkey is sent twice).
- Every transmission has its own timer that unkeys the radio, whatever happens to the sound.
- No transmitting without a callsign and locator, with a receive-only radio, outside DATA-USB (Yaesu) / USB, or
  with any part of the signal outside an amateur band.
- Watchdogs stop calling when nobody answers. Signals must be clean (FT8/FT4 use GFSK with ramps, as WSJT-X).
- Band Watch never changes the radio's power. Power and where in a band the licence allows are the operator's.
- Receive-only parts (the Radio panel) must never send transmit or power commands; a browser test checks this.

**Data sources.** Read a source's terms before using it, and keep to them:
- **No SOTA.** SOTA's API terms don't allow software written with AI without their approval. Don't add it back
  unless the owner has that approval in writing.
- **PSK Reporter** is run by a volunteer: keep the cache (5 min) and don't poll more often.
- **POTA**: every 2 minutes at most. **CelesTrak** (satellites): at most once per 2 hours per browser, and stop for
  2 hours after any answer that isn't 200 (their usage policy; repeated errors get an IP blocked).
- Credit sources in the README's Licence section.

**Privacy and secrets.**
- Never store or log passwords. QRZ keys stay in the user's browser and are only passed through, never kept
  on the server.
- No personal details (names, emails, addresses) in code, commits, tests or docs, other than callsigns used as
  examples. Commit with your GitHub "noreply" email.

**Code.**
- Plain JavaScript in the browser, no build step and no npm dependencies. A third-party library goes in
  `public/js/vendor/` with its licence, and only if it's MIT/BSD-style.
- An API change goes in **both** servers (`server.js` and `desktop/*.go`), with tests for both.
- Words on screen are plain, friendly English for radio amateurs, not programmers ("Couldn't reach POTA just
  now", not "fetch failed: 502"). Explain what to do next.
- Keep it working with every theme (colours come from CSS variables: `--text`, `--cool`, `--warm`…), on a
  phone, and with a keyboard. Buttons have labels or `aria-label`s.
- Check the code before adding a feature: a lot is already there (see CHANGELOG.md).

## Releasing (the owner)

1. Add an entry at the top of `CHANGELOG.md` and to `VERSION_HISTORY` in `public/js/options.js`.
2. Raise `version` in `package.json`, `VERSION` in `public/sw.js`, and every `?v=` in `public/*.html` and the
   `public/js` files that load others (`decoders.js`, `ft8-worker.js`, `sats.js`).
3. Push to `main`. GitHub Actions tests, builds `BandWatch-Setup.exe` and the zip, and publishes release
   `v<version>`. Band Watch on Windows then offers **Settings > Updates > Install update**.
4. Update the web copies.
