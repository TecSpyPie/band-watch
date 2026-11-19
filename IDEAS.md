# Ideas: what the nightly idea builder has done

Each night (every other night) one idea is built on the `ideas` branch. Nothing here is live until Marvin says
**"live"** in a chat with Claude. Newest first.

## Done

- **19 Nov 2026: ATS Mini memory slots (view, tune, add, change, clear, backup).** First on the list, and Marvin has
  an ATS Mini. Uses the radio's own `$` (list slots) and `#` (set a slot) commands from its MIT firmware
  (github.com/esp32-si4732/ats-mini, docs/source/remote.md); the code is Band Watch's own. Files:
  `public/js/atsmem-data.js` (reading and writing the radio's lines, tested in `test/atsmem.test.js`),
  `public/js/atsmem.js` (the panel part), browser tests "ATS Mini memory slots" with the pretend ATS Mini.
  Works only in the browser (Web Serial), so the two servers need no change. Not yet tried on a real ATS Mini.

## Next in line

1. ATS Mini band scan graph.
2. A "Check now" button in Settings > Updates.
3. Propagation forecast chart for the next 12 hours.
4. DX cluster spots (only from a source whose terms allow it).
5. Club Log / LoTW ADIF upload helper (no passwords stored).
6. Small fixes and polish.
