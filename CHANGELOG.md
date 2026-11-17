# What's new

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
