Band Watch by M3vrv - Windows
=============================

Band Watch is one program, BandWatch.exe. It needs nothing else installed
(unless Smart App Control blocks it, see below): it runs a small server on this PC only (http://localhost:8073) and opens it
in your web browser.

Try it without installing
  Unzip this folder and double-click BandWatch.exe (if Windows allows it,
  see Smart App Control below).

Install with BandWatch-Setup.exe (easiest)
  Double-click BandWatch-Setup-<version>.exe and answer its questions. It
  installs for you only (no administrator rights needed) into C:\BandWatch,
  or any drive or folder you choose (answer No to "Install in this
  folder?" to pick one). An older copy installed by install.bat is removed
  if you agree. It adds desktop and Start menu shortcuts, lists
  Band Watch in Settings > Apps (uninstall it from there), checks Smart App
  Control and offers Node.js if needed, then opens Band Watch.
  "BandWatch-Setup-<version>.exe /S" installs with no questions.
  Smart App Control blocks unsigned programs, and BandWatch-Setup.exe isn't
  signed either: if it's on, use install.bat from the zip instead (below).

Install with install.bat (adds desktop and Start menu shortcuts)
  1. Right-click the downloaded zip > Properties, tick "Unblock" at the
     bottom and click OK. Then right-click the zip > Extract All.
     (Unblocking first stops Windows blocking the installer itself.)
  2. Double-click install.bat. It copies Band Watch to
     C:\BandWatch (the same folder as BandWatch-Setup.exe uses) and adds the shortcuts. You can also choose to
     start it with Windows (it then runs in the background, ready to open).
     "Install Band Watch (automatic).bat" does the same with the usual choices.
  3. Open "Band Watch by M3vrv" from the desktop or Start menu.

If Windows SmartScreen says "Windows protected your PC", click "More info" then
"Run anyway". BandWatch.exe isn't signed with a paid certificate, so Windows
doesn't recognise it yet.

Smart App Control
  If Smart App Control is on (Windows Security > App & browser control), Windows
  blocks BandWatch.exe and offers no "Run anyway", because the exe isn't signed
  with a paid code-signing certificate. The installer checks for this and offers
  two ways round it; you choose:
    - Install Node.js (free, signed by its publisher, so Windows allows it).
      The Band Watch shortcuts then run Band Watch with Node.js. Everything
      works the same, except the Quit button: use Start menu > Stop Band Watch.
    - Or turn Smart App Control off yourself: Windows Security > App & browser
      control > Smart App Control settings > Off. That allows every unsigned
      program, not only Band Watch. On Windows 11 25H2 and later you can turn
      it back on there; on older versions only by resetting Windows.

Listening
  The Listen panel tunes public web receivers (the WebSDR at the University
  of Twente, or a KiwiSDR or WebSDR whose address you enter). In this Windows
  app the receiver plays inside Band Watch, and clicking the band scope, the
  band plan or a frequency in Band activity retunes it. Click inside the
  receiver once if you don't hear anything: browsers need a click before they
  play sound.

Your own RTL-SDR (RTL-SDR Blog V4 or any RTL-SDR dongle)
  Band Watch can listen through your own dongle instead of a web receiver.
  1. Install the RTL-SDR Blog drivers for Windows (they support the Blog V4):
     see the Quick Start Guide on https://www.rtl-sdr.com. It includes
     setting the dongle's USB driver with Zadig, as for any RTL-SDR program.
  2. Start rtl_tcp from those drivers, in a Command Prompt:
       rtl_tcp -a 127.0.0.1
     (Leave it running. Smart App Control may block rtl_tcp.exe the same way
     it blocks BandWatch.exe; see Smart App Control above.)
  3. In Band Watch, Listen > Receiver > "My RTL-SDR", then press Listen.
  You get a spectrum and waterfall (click them to tune), USB, LSB, CW, AM, FM
  and broadcast FM, from 500 kHz to 1,766 MHz. Below 28.8 MHz the V4 switches
  in its built-in HF upconverter by itself.
  Settings > RTL-SDR receiver has:
    - Connection: the rtl_tcp address (a Raspberry Pi or other PC on your
      home network works too), the dongle number if you have more than one,
      "Start rtl_tcp for me" (Band Watch runs rtl_tcp.exe itself when you
      press Listen: give its location, or put rtl_tcp.exe next to
      BandWatch.exe), Start/Stop rtl_tcp buttons that show what rtl_tcp
      says, "Reconnect if the connection drops", and Test connection.
    - Dongle: RTL-SDR Blog V4 (HF through its upconverter, automatic),
      Blog V3 (HF by direct sampling below 24 MHz, switched for you) or
      another RTL-SDR (24 MHz and up).
    - Sample rate: 0.96, 1.92 or 2.4 MS/s (a 480 kHz, 960 kHz or 1.2 MHz
      waterfall; the higher rates need a faster PC).
    - Filter widths for SSB, CW, AM and FM (also on the Listen panel),
      squelch, audio AGC speed, and broadcast FM de-emphasis (50 us for the
      UK and Europe, 75 us for the Americas).
    - Receiver: RF gain, frequency correction (PPM), the RTL2832 AGC,
      automatic audio level, bias tee.
    - Waterfall: follow the noise floor, range and speed.
  Only tick Bias tee if an active antenna or preamp needs power from the dongle.

FT8 and FT4 decoder
  The "FT8 / FT4 decoder" panel decodes like WSJT-X, inside Band Watch:
  1. Choose FT8 or FT4, and where the audio comes from:
       - My RTL-SDR: press "Tune to FT8 on 20 m" (it follows the Listen
         panel's band), then Listen.
       - This computer's sound input: a radio's audio into the PC, or a
         virtual audio cable from another receiver program.
  2. Press Start decoding. Decodes appear at the end of each 15 s (FT8) or
     7.5 s (FT4) cycle: time, signal-to-noise (dB), time offset (DT),
     audio frequency (Hz) and the message. CQ calls are tinted green, and
     messages with your callsign red. Click a callsign for its details.
  3. "Results window" opens the decodes in their own window, to put
     beside Band Watch or on another screen, with CQ-only and search.
  Your PC clock must be right to within a second (Windows: Settings >
  Time & language > Date & time > Sync now). Band Watch only receives;
  to transmit, use WSJT-X.

Updating
  Run the new install.bat, or just start the new BandWatch.exe: if an older
  Band Watch is running (including the older Node.js versions), it is stopped
  and the new one takes over.

Stop
  Settings > Quit Band Watch, or Start menu > Band Watch by M3vrv > Stop Band Watch.

Uninstall
  Start menu > Band Watch by M3vrv > Uninstall Band Watch.
  BandWatch.exe doesn't need Node.js. Keep Node.js only if Smart App Control
  blocks BandWatch.exe on this PC (see above).

Build date and version
  Settings > About this build shows the version, when it was built (UTC),
  whether it's running as BandWatch.exe or with Node.js, when the server
  started, and what's new in each version. The same date is in
  BUILD-INFO.txt in the install folder, in BandWatch.exe's Properties >
  Details > Comments, and in Settings > Apps > Band Watch by M3vrv (the
  install date is shown there too).

Notes
  - Band Watch needs an internet connection: it fetches live spots from
    PSK Reporter and solar and sunspot data from NOAA.
  - Your QRZ password is sent only to QRZ.com to sign in and is never stored.
  - Settings and profiles are kept in your web browser. Use Settings >
    Profiles > Save to a file to keep a copy.
  - Everything is in C:\BandWatch, including the log, bandwatch.log.
  - The online version is always at https://band-watch.ample.run
