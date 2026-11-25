# Ideas: what the nightly idea builder has done

Each night (every other night) one idea is built on the `ideas` branch. Nothing here is live until Marvin says
**"live"** in a chat with Claude. Newest first.

## Done

- **25 Nov 2026: ATS Mini band scan graph.** Next on the list. The ATS Mini has no scan command over USB, so Band
  Watch steps it with its `F` (set frequency) command and takes the signal level (RSSI) and SNR from the status line
  it already sends every half second, waiting for a line that is on the new frequency. Ready-made ranges, a graph with
  the noise level, the signals found (strongest first, each counted once), Tune, Go back when done, Stop and a CSV
  file. Files: `public/js/atsscan-data.js` (planning the steps on the radio's grid and band, finding signals, CSV;
  tested in `test/atsscan.test.js` with a pretend noisy band), `public/js/atsscan.js` (the panel part), and a browser
  test "ATS Mini band scan" (the pretend ATS Mini now has pretend stations). Small hooks in `rig.js`: `atsTune` can
  be told which of the radio's bands to use, and the screen picture, memory slots and "follow the dial" wait during a
  scan. Browser-only (Web Serial), so the two servers need no change. Not yet tried on a real ATS Mini: on a real one
  the readings may need **Careful** to settle.
- **Also 25 Nov: the ideas branch was moved onto 1.41.0** (it was still based on 1.25.0), and the memory slots
  were kept. **Browser tests no longer ask the real CelesTrak** (they get an empty answer): cloud test machines can't
  reach it, and it allows one fetch every 2 hours anyway.
- **19 Nov 2026: ATS Mini memory slots (view, tune, add, change, clear, backup).** First on the list, and Marvin has
  an ATS Mini. Uses the radio's own `$` (list slots) and `#` (set a slot) commands from its MIT firmware
  (github.com/esp32-si4732/ats-mini, docs/source/remote.md); the code is Band Watch's own. Files:
  `public/js/atsmem-data.js` (reading and writing the radio's lines, tested in `test/atsmem.test.js`),
  `public/js/atsmem.js` (the panel part), browser tests "ATS Mini memory slots" with the pretend ATS Mini.
  Works only in the browser (Web Serial), so the two servers need no change. Not yet tried on a real ATS Mini.

## Next in line

1. A "Check now" button in Settings > Updates.
2. Propagation forecast chart for the next 12 hours.
3. DX cluster spots (only from a source whose terms allow it).
4. Club Log / LoTW ADIF upload helper (no passwords stored).
5. Small fixes and polish. Found on 25 Nov: about 11 browser tests fail on main itself in a cloud session, besides
   the known ones (for example "large text on a phone" scrolls sideways by 81px, "RTL-SDR settings" and "FT4 decoder"
   expect settings saved before newer options such as the attenuator and RTTY were added, and "decoder: sound-card
   input" reads `sampleRate` of nothing). Worth a night of its own.
