# What's new

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
