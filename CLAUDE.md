# HamShack: notes for Claude

Read CONTRIBUTING.md first: it has the layout, the tests, and the rules. The short version:

- Work on a branch and open a pull request. **Never push to `main`**: a push with a new version publishes a
  release that every Windows install offers. The owner (M3VRV) merges and releases.
- Run `npm test` before you finish, and add tests for what you change (signals: encode, add noise, decode back).
- **Transmitting is safety-critical.** Keep every rule in CONTRIBUTING.md's "Transmitting" list (Enable TX off at
  start and never saved, Stop TX/Esc, an unkey timer on every over, band-edge and mode checks, watchdogs, never
  touching power). Receive-only code must never send TX or power commands.
- **Read a data source's terms before using it.** No SOTA (their terms forbid AI-written software without
  approval). Keep the existing rate limits (PSK Reporter cached 5 min, POTA 2 min, CelesTrak once per 2 hours).
- Plain JavaScript, no build step, no npm dependencies; vendored libraries only in `public/js/vendor/` with
  their licence. API changes go in both servers (`server.js` and `desktop/*.go`).
- No passwords or personal details anywhere. Words on screen: plain English for radio amateurs.
- Check what already exists (CHANGELOG.md) before suggesting or building a "new" feature.
