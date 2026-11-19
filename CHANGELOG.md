# What's new

## 1.32.0 (19 Nov 2026)
- **Send SSTV pictures.** In SSTV mode, **Send a picture**: choose a picture (or use the one received), the mode
  (any of the 19), how it fits, and text for the top and bottom (your callsign must be on it). The preview is exactly
  what goes out; the red bar counts down while it's sent. Same safety as FT8: nothing goes out unless **Enable TX** is
  on (and it goes off again after each picture), **Stop TX** / **Esc** stop at once, and the radio unkeys itself at
  the end. **Tune to SSTV** now also puts the radio in its data mode (DATA-USB / DATA-LSB).
- **Safer band checks for FT8 and FT4 too.** Band Watch now checks every part of a signal against the UK band plan,
  not just the band's edges: it won't transmit in gaps with no UK allocation (60 m has several: FT8 on 5357 kHz with
  1500 Hz audio would be at 5358.5 kHz, outside the UK block, and Band Watch says what TX audio setting would fit),
  in beacon or CW-only segments, or in a segment narrower than the signal (SSTV stays out of the 500 Hz data segments).

## 1.31.0 (19 Nov 2026)
- **SSTV pictures.** A new decoder mode, **SSTV (pictures)**, receives slow-scan TV in all the common analogue modes:
  Martin M1/M2, Scottie S1/S2/DX, Robot 36/72, PD 50/90/120/160/180/240/290, Wraase SC2-180 and Pasokon P3/P5/P7.
  - Starts by itself when a picture's **VIS code** is heard, and the picture builds line by line.
  - **Straightens slanted pictures** by itself, following each line's sync pulse (tested with sound cards 300 and
    1000 ppm off).
  - **Missed the start?** Pick the mode and **Start now**: the lines are found from their sync pulses.
    **Stop picture** keeps what has arrived.
  - A **Gallery** of the last 16 pictures, kept in your browser: click one to see it big, **Save** as PNG.
  - **Tune to SSTV** goes to the band's SSTV frequency in the right sideband (14.230 USB, 7.171 LSB…); the ISS sends
    SSTV on 145.800 MHz FM during its events.
  - Tested by making every mode's test card into SSTV audio, with noise and a sound card off speed, and decoding it back.

## 1.30.0 (19 Nov 2026)
- **Transmit FT8 and FT4.** With FT8 or FT4 as the decoder's mode, a new **Transmit** box keys your radio over its
  USB cable (Yaesu `TX1;`/`TX0;`, Kenwood `TX1;`/`RX;`, Icom CI-V `1C 00`) and plays the signal into the radio's USB
  sound (FT-991A: *USB Audio CODEC*).
  - **Reply** on a decode answers that station; **Call CQ** calls CQ. Band Watch then sends the usual messages (grid,
    report, R-report, RR73, 73) as the other station answers, in the right slot, and stops after the 73.
  - **Log QSO** puts the QSO in the logbook (call, grid, both reports, frequency, mode); Band Watch also fills it in
    by itself when the QSO completes.
  - **Tune** sends a steady tone for 10 s to set **Level** with the radio's ALC meter. **TX audio** sets where in
    the passband you transmit (1500 Hz to start).
  - A clean signal: Gaussian-shaped tones and soft ramps, as WSJT-X sends them (tested: Band Watch's own decoder
    reads it back, and it's over 50 dB down 120–300 Hz away).
  - **Early decode** (13.6 s into an FT8 cycle, 6.0 s for FT4, as WSJT-X does), so replies go out in the very next
    slot. A second pass at the end of the cycle adds any stations that started late.
  - **Safety:** nothing is sent unless **Enable TX** is on (off every time Band Watch starts); **Stop TX** or **Esc**
    stops at once; every over unkeys itself (and again 0.3 s later); no transmitting without your callsign and
    locator, with a receiver-only radio, outside DATA-USB (Yaesu) / USB, or outside the amateur bands; it stops
    after 6 overs with no answer (10 CQs). Your power and where your licence lets you transmit are for you to set.
  - Tested with a pretend radio only: try it first at low power, ideally into a dummy load, watching the ALC.

## 1.29.0 (19 Nov 2026)
- **Click a satellite for everything about it.** Click its dot on the world map, its name in the Satellites list or
  in the passes table, and a card opens with:
  - **Identifiers**: short name and OSCAR number (e.g. AO-7, AMSAT-OSCAR 7), full name, NORAD catalogue number,
    international ID with the launch year, and callsigns where there are well-known ones (the ISS: NA1SS, RS0ISS…).
  - **Right now**: up in your sky or below the horizon, where to point, how far away it is and whether it's coming
    or going, the point on Earth it's over (with the grid square), height, speed, and how far it can reach.
  - **Orbit**: how long one lap takes, how high it flies, its tilt and how old the orbit data is.
  - **In your sky**: a round sky chart of this pass (or the next one) from horizon to horizon, with rise and set
    times; while it's up, an orange dot shows where it is now.
  - **Radio**: its frequencies, Doppler-corrected while it's up (click one to tune there and follow it).
  - **Next passes** for the coming 3 days, and links to AMSAT's status page, N2YO and CelesTrak.

## 1.28.0 (19 Nov 2026)
- **Satellites.** A new **Satellites** panel shows the ISS and amateur radio satellites over your locator: which
  are up now (where to point, how high, how far, coming or going), the **next passes** in the coming 24 hours
  (rise time in UTC, highest point, direction and how long), and **dots on the world map**.
  - Starts with the ISS, SO-50, AO-27, AO-7, AO-73, RS-44 and IO-117. **Add a satellite** puts any of the ~100
    amateur satellites on the list; ✕ takes one off. **Passes above** hides low passes (0°, 10°, 20°, 30°).
  - **Tell me 5 minutes before a pass** pops up a reminder.
  - While a satellite is up, its frequencies are shown **with the Doppler shift worked out**: what to listen on
    and what to send on. Click the frequency and Listen (and your radio, if it's connected) tunes there and keeps
    following the Doppler shift until you click it again or the satellite sets.
  - Orbits come from CelesTrak, fetched by the page itself no more than once every 2 hours (CelesTrak's rule) and
    kept in your browser, so it works in the Windows app and on the web. The orbit maths is satellite.js (MIT).
  - Check AMSAT's status page (linked in the panel) to see which satellites are working before a pass.

## 1.27.0 (19 Nov 2026)
- **RTL-SDR attenuator.** An **ATT** switch (Off, 10, 20, 30 dB) on the Radio panel and next to RF gain in Listen
  turns the dongle's RF gain down by that much, to the nearest step the tuner has, for very strong signals or a
  noisy band (handy on HF). With RF gain on Auto it counts down from full gain (49.6 dB). Your RF gain setting is
  kept, so ATT Off puts it straight back. The S-meter, spectrum and waterfall drop with it.

## 1.26.0 (19 Nov 2026)
- **ClearRX 1.2.0: more sound controls.** A **noise blanker** for clicks and crackles (electric fences, ignition,
  static crashes), an **AGC speed** (Fast, Medium, Slow) for Steady volume, a **squelch** that keeps quiet between
  signals, **Bass** and **Treble**, and a **manual notch** at a frequency you choose. They stay as they are when you
  pick a preset (Off switches them off). Band Watch uses them too when it sends your RTL-SDR sound through ClearRX.
  Download the new `ClearRX-Windows.zip` and unzip it over the old one.

## 1.25.1 (19 Nov 2026)
- **The Radio panel's S-meter works with the RTL-SDR.** While your RTL-SDR is playing and no connected radio is
  giving a reading, the needle follows the signal level in the channel you're tuned to, shown as "≈S5 (RTL-SDR)".
  An RTL-SDR isn't calibrated like a radio, so it's a rough guide (S9 is about −45 dBFS). A connected Yaesu, Icom
  or ATS Mini still drives the meter itself.

## 1.25.0 (19 Nov 2026)
- **Receive controls on the Radio panel** for Yaesu (FT-991A, FT-710, FTdx10, FTdx101) and Icom (IC-7300, IC-705,
  IC-7610 and others): **AF gain** and **RF gain** sliders, **AGC** (FAST, MID, SLOW, AUTO), the preamp (IPO, AMP1,
  AMP2), **ATT**, **NB**, **DNR** and **Auto notch**. Band Watch reads them from the radio when it connects and every
  few seconds after, so turning the radio's own knobs shows here too. Receive only: nothing here transmits.

## 1.24.2 (19 Nov 2026)
- **ClearRX 1.1.0: My radio.** Buttons for **RTL-SDR, Yaesu, Icom, ATS Mini, Malahit and Other / mixer**. Pick
  yours and ClearRX finds its sound input (the radio's USB Audio CODEC, or the line-in for the ATS Mini), sets a good
  starting preset (SSB voice, or AM broadcast for the ATS Mini) and shows a tip for that radio, such as where the
  IC-7300's USB audio level is. RTL-SDR points you to Band Watch's Listen, which sends its sound through ClearRX.
  Download the new `ClearRX-Windows.zip` and unzip it over the old one.

## 1.24.1 (19 Nov 2026)
- **ClearRX is now its own download** (`ClearRX-Windows.zip` on the release page), not inside the Band Watch
  installer. Microsoft Defender wrongly flagged the 1.24.0 installer as unwanted software, most likely because
  ClearRX.exe is new and not signed yet; this way a false alarm on ClearRX can't stop Band Watch installing.
  Unzip it into `C:\BandWatch\ClearRX` and run `ClearRX.exe`; Band Watch's installer then adds its shortcuts.

## 1.24.0 (18 Nov 2026)
- **New: ClearRX by M3VRV**, a radio audio processor that comes with Band Watch for Windows. It's a program of its
  own (its own desktop icon and window), made for ham radio: it takes the sound from your radio's USB sound card,
  a line-in, a mixer or any sound card, and plays it to the speakers you choose, cleaned up. Presets for SSB voice,
  Weak DX, CW and AM broadcast, or your own: a voice filter, a steep CW peak filter, an auto notch for whistles,
  noise reduction (light, medium, strong) and a steady-volume compressor. Input and output meters, a warning when
  the sound coming in is too loud, a before-and-after spectrum, and a switch to hear it without ClearRX to compare.
  Its settings are kept on your PC.
- **Linked to Band Watch, not built in:** while ClearRX is open, Listen shows **Send my RTL-SDR sound through
  ClearRX**. Tick it and the RTL-SDR's sound is cleaned up with ClearRX's settings; ClearRX shows **Band Watch is
  using these settings**. Close ClearRX and Band Watch carries on as before.
- The installer adds ClearRX's shortcuts, and closes ClearRX before an update. The Help guide has a ClearRX section.

## 1.23.0 (18 Nov 2026)
- **Help guide:** a **Help** button at the top opens a guide to every part of Band Watch, with pictures and simple
  numbered steps: getting started, connecting your radio, the Radio panel, Listen, your RTL-SDR (with the Zadig
  steps), the bands and scope, shortwave stations, the decoders, POTA, Wanted alerts, the logbook, the ATS Mini,
  own windows, settings and updates, and what to do if something doesn't work. It follows your colours and works
  offline.
- **Icom IC-7300 set-up steps** in Settings > Radio control, the Help guide, README-Windows.txt and the GitHub page:
  the CP210x driver, MENU > SET > Connectors > CI-V (USB Port: Unlink from [REMOTE], Baud Rate: Auto, Transceive: ON),
  then Icom, IC-7300, 115200 baud. The Zadig steps for the RTL-SDR are spelled out too.

## 1.22.0 (18 Nov 2026)
- **Listen goes with the Radio panel:** when you pop the radio out, the Listen panel goes into the same window, under
  it. Pressing **Listen** there now starts the sound (your RTL-SDR, or a receiver playing inside Band Watch) in that
  window. Before, browsers wouldn't start sound from a click in another window, so nothing played until the radio
  was back. Bringing the radio back stops that window's sound and says to press Listen again.
- **Everything 3D and sharp:** every part of Band Watch now sits on a raised card with a crisp lit edge; buttons stand
  up and press in; the boxes you type in, the map, the band scope and the receiver are set into the card; table
  headings and the top bar are raised; headings and the big band name are crisper. High contrast and Night stay
  flat, for reading.

## 1.21.0 (18 Nov 2026)
- **Radio panel: waterfall and Pop out.** A waterfall now runs under the panel's spectrum, like the scope on a real
  radio: live from your RTL-SDR (about ten rows a second), or built from the stations spotted there. Click it to
  tune. **Pop out ⧉** on the panel puts the whole radio in a window of its own, to move onto another screen; it gets
  a bigger spectrum and waterfall there, and **Back in Band Watch** brings it home.
- **A more 3D, glossy radio:** a brushed-metal face with screws in the corners and a deeper case, glass over the
  meter and the display, shiny keys that stand up and press in, and a ridged tuning knob with a shine on its cap.

## 1.20.0 (18 Nov 2026)
- **Radio panel:** Band Watch as the front of a transceiver. A big glowing frequency display (click it to type a
  frequency, like 14.2 or 7074), an analogue S-meter with a needle, a close-up spectrum around the dial (live from
  your RTL-SDR, or drawn from the stations spotted there; click it to tune), band keys that remember where you were
  on each band, mode keys, a tuning step and span, and a tuning knob you can drag round, scroll, or turn with the
  arrow keys. Your radio follows it, and so does Listen. The S-meter is read from the FT-991A (and other Yaesus),
  Icom radios and the ATS Mini. There's no transmit button: Band Watch only tunes and listens.

## 1.19.0 (18 Nov 2026)
- **Shortwave stations on air:** a new panel listing the broadcasters on the air right now, from the EiBi
  shortwave schedule (eibispace.de, free to use in other software). Each shows its frequency, language, country,
  target area and times. Filter by band (long wave, medium wave, 120 m to 11 m), language or a search; tick
  **Also starting in the next hour** to see what's coming up. Click a frequency to tune there in AM: your ATS Mini,
  or whichever radio is connected, follows. The schedule is fetched twice a day.

## 1.18.0 (18 Nov 2026)
- **ATS Mini digital readout:** a live readout over the picture of the radio's screen, updated twice a second: a big
  frequency, band, mode, SNR, and an LED-style S-meter with S-units (S7, S9+10…) and dBµV. It follows your Colour
  choice; put it at the top or bottom of the picture, or untick **Digital readout** to hide it.

## 1.17.0 (17 Nov 2026)
- **Malahit DSP2 support:** pick **Malahit** in Settings > Radio control, press Connect radio and choose its
  **Malahit CAT** port. Band Watch tunes it from 10 kHz to 2 GHz (HF, and VHF/UHF like 2 m FM) when you click a spot,
  the scope or the band plan, and follows its dial. Works with the DSP1 and DSP3 too. Windows may need the Malahit
  USB CAT driver from malahiteam.com.
- **ATS Mini screen fix:** the live screen was black on ATS Mini firmware older than 2.41, which doesn't know the quick
  picture command. Band Watch now checks the firmware version and uses the older command when needed (and tries the
  other one if no picture comes). The panel shows the firmware version.
- **Which port:** Settings and the radio panels now say which USB device Band Watch is connected to, e.g.
  "Espressif (ATS Mini)". Browsers don't tell web pages the COM number; Edge's port list shows it, e.g. (COM4).
- **Using an ATS Mini:**
  1. On the ATS Mini (firmware 2.34 or later): **Settings > USB Port > Ad hoc**.
  2. Plug it into your PC with its USB cable.
  3. In Band Watch: **Settings > Radio control > Radio make > ATS Mini**, then **Connect radio** and pick its port.
  4. The **ATS Mini** panel shows a live picture of the radio's screen with buttons for band, tune, mode, volume and
     light. Press **⧉** on it to put it on another screen.

## 1.16.0 (17 Nov 2026)
- **Own windows, for more than one screen:** the Bands table, Map, Band scope, Listen, ATS Mini, Decoder, POTA,
  Wanted, Logbook and Band activity each have a small **⧉** button. Press it and that part moves into a window of its
  own that you can drag onto another screen. It keeps working there (radio, sound, waterfall, decoding) and matches
  your theme. Band Watch remembers where you put each window. Press **Back to the main window**, **Bring it back**, or
  just close the window to put it back.

## 1.15.0 (17 Nov 2026)
- **ATS Mini panel:** when your radio make is ATS Mini, a new panel shows a **live picture of the radio's own
  screen**, about every 1½ seconds, with buttons for Band, Tune, Push, Mode and Volume, Connect, **Choose port** and
  **Save picture**. Untick Live screen for a simpler screen Band Watch draws from the radio's status (frequency, band,
  mode, signal and SNR).
- **Radio ports:** with an FT-991A and an ATS Mini both plugged in, changing the radio make no longer reconnects to the
  other radio's port. Each make uses its own port, and Band Watch asks you to pick one if it doesn't know it yet.

## 1.14.0 (17 Nov 2026)
- **ATS Mini support:** Band Watch can now control the ATS Mini pocket receiver (SI4732, firmware 2.34 or later)
  over its USB cable. In **Settings > Radio control**, pick **ATS Mini** and press Connect radio (on the radio, set
  Settings > USB Port to **Ad hoc** first). Click a spot, the band scope or the band plan and the ATS Mini changes
  band and mode by itself, then tunes the exact frequency. Turn its dial and Band Watch follows. Settings shows its
  frequency, band, signal strength and SNR. It covers 150 kHz to 30 MHz (AM, LSB, USB) and 64 to 108 MHz FM.

## 1.13.1 (17 Nov 2026)
- **rtl_tcp comes with Band Watch:** the Windows installer now puts `rtl_tcp.exe` (from the RTL-SDR Blog
  drivers V1.4.0, which support the Blog V4) next to Band Watch, so **Listen > My RTL-SDR** works straight
  away: no more "Band Watch couldn't find rtl_tcp". The files are the RTL-SDR Blog release's own, unchanged
  and checked against its fingerprint when Band Watch is built. rtl-sdr is GPL-2.0: its licence is in
  `C:\BandWatch\COPYING-rtl-sdr.txt`, and its source is attached to this release. The dongle still needs its
  USB driver set once with Zadig, as for any RTL-SDR program.

## 1.13.0 (17 Nov 2026)
- **Icom and Kenwood radio control:** Settings > Radio control has a new **Radio make** choice. Icom radios
  (IC-7300, IC-705, IC-7610, IC-9700 and other CI-V radios) and Kenwood radios (TS-590, TS-890, TS-990,
  TS-480, TS-2000) are tuned and followed just like the Yaesu radios, with USB-D / DATA-USB on digital
  frequencies. If an Icom's CI-V address was changed in its menu, Band Watch picks it up from the radio.
- **Send to QRZ:** the logbook sends your contacts straight into your QRZ.com logbook, using the API key from
  QRZ's logbook settings (QRZ needs a subscription for this). Each contact is sent once and marked "QRZ ✓",
  and you can have new contacts sent as soon as you log them.
- **Updates in Settings:** a new **Updates** section at the top of Settings says whether you have the newest
  version, has the **Install update** button, and links to Band Watch on GitHub, all versions, and the
  Windows installer.
- **Fixed: Listen with your RTL-SDR looked dead** when rtl_tcp wasn't running. The Windows app now starts
  rtl_tcp by itself when you press Listen, and any problem shows in red under the Listen button and as a pop-up.
- **Fixed: "Play inside Band Watch" with the Twente WebSDR.** Since 1 November the Twente receiver won't run
  inside another app, so it now opens in its own window, and the tick box says why. KiwiSDRs and other WebSDRs
  still play inside Band Watch.

## 1.12.3 (17 Nov 2026)
- **Its own window:** on Windows, Band Watch now opens in an app window of its own, with no address bar or
  tabs and its own button on the taskbar, instead of a tab in your browser. It uses Microsoft Edge (which
  comes with Windows) or Chrome, so radio control works too. To have a normal browser tab again, set
  BANDWATCH_WINDOW=browser.
- **Brighter, glossy colours:** shinier buttons, softly lit panels, glowing activity bars and a brighter teal
  and amber in the Light and Dark colours. High contrast and Night stay plain on purpose.

## 1.12.2 (17 Nov 2026)
- **Updates from inside Band Watch:** Settings > About this build says when a newer version is out. In the
  Windows app, **Install update** downloads it from GitHub, checks it against the release's checksums, and
  installs it over your copy, then Band Watch reopens. It checks once a day and tells you.
- **The installer updates in place:** if Band Watch is already installed it asks one question, "Update Band
  Watch from 1.12.1 to 1.12.2?", and goes over the old copy. A copy in the old AppData folder moves to
  C:\BandWatch by itself, so there's no need to uninstall first.

## 1.12.1 (17 Nov 2026)
- SOTA spots removed. SOTA's API terms don't allow AI-written software without their approval, and the address
  Band Watch used had been retired. POTA activators stay, now checked every two minutes.

## 1.12.0 (17 Nov 2026)
- **Radio control:** Band Watch tunes your Yaesu FT-991A (and FT-710, FTDX10, FTDX101) over its USB cable when
  you click a spot, the scope, the band plan or a decoder, and follows the radio when you turn its dial.
  DATA-USB on FT8, FT4 and WSPR frequencies. Works in Chrome or Edge on the PC the radio is plugged into.
- **Parks on the air:** live POTA activators, filtered by band and mode, on the map and the band scope,
  with alerts for new ones. Click to tune, one click to log. (1.12.0 also showed SOTA; removed in 1.12.1.)
- **Logbook:** log contacts from a decode, an activator or a callsign lookup; edit, search, delete and undo;
  export ADIF for LoTW, eQSL, QRZ Logbook and Club Log, and import ADIF from other loggers.
- **Wanted alerts:** callsigns, prefixes and grid squares you want, and new grid squares not in your log yet,
  from the spots, your decodes and POTA, with a sound and a notification.
- **WSPR and CW decoders** in the decoder panel, beside FT8 and FT4.

## 1.11.1 (16 Nov 2026)
- Everything goes in C:\BandWatch, including the log. install.bat installs there too, and
  removes the older copy in AppData.

## 1.11.0
- Live band scope: real spectrum and waterfall from your RTL-SDR, with spotted stations marked.
  Switch back to the spot-based scope any time.

## 1.10.0
- RTL-SDR settings: dongle type (Blog V4, V3 with direct sampling, others), sample rate up to
  2.4 MS/s, filter widths, squelch, AGC speed, FM de-emphasis.
- Build date and version in Settings > About this build.

## 1.9.0
- FT8 and FT4 decoders with a results window.
- RTL-SDR connection settings, and Band Watch can start rtl_tcp for you.
- One-file Windows installer, BandWatch-Setup.exe, installing to C:\BandWatch.

## 1.8.0
- RTL-SDR Blog V4 receiver through rtl_tcp, with waterfall and click-to-tune.

## 1.7.0
- Windows installer that checks Smart App Control; install page for phones and PCs.
