Band Watch by M3vrv - Windows
=============================

Band Watch is one program, BandWatch.exe. It needs nothing else installed
(unless Smart App Control blocks it, see below): it runs a small server on this PC only (http://localhost:8073) and shows
it in a window of its own, using Microsoft Edge (part of Windows) or Chrome. Everything runs on this PC: it
isn't the website. If neither browser is found it opens in your normal web browser instead.

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

Your radio (CAT control over its USB cable)
  Band Watch tunes your radio when you click a spot, the band scope, the band
  plan, a shortwave station or the Radio panel, and follows its dial. It needs
  Chrome or Edge (Band Watch opens in Edge by itself). Close other programs that
  use the radio's CAT port (WSJT-X, a logger) first.
  Yaesu FT-991A (also FT-710, FTDX10, FTDX101)
    1. Install the Silicon Labs CP210x USB driver (yaesu.com, the radio's page).
    2. Settings > Radio control > Radio make: Yaesu. Baud rate 4800 (the
       FT-991A's factory setting, menu 031 CAT RATE).
    3. Press Connect radio at the top and pick the Enhanced COM Port.
  Icom IC-7300 (also IC-705, IC-7610, IC-9700 and other CI-V radios)
    1. Install the Silicon Labs CP210x USB driver from icomjapan.com
       (Support > Firmware/Drivers > IC-7300).
    2. On the radio: MENU > SET > Connectors > CI-V, and set
         CI-V USB Port:       Unlink from [REMOTE]
         CI-V USB Baud Rate:  Auto
         CI-V Transceive:     ON   (so Band Watch follows the radio's dial)
    3. Settings > Radio control > Radio make: Icom. Icom model: IC-7300.
       Baud rate: 115200.
    4. Press Connect radio at the top and pick the radio's port (Silicon Labs
       CP210x, or "USB to UART").
    The IC-7300 has a sound card built in: the Decoder's "Audio from" can take
    the radio's audio straight from its USB cable, for FT8 and FT4.
  Kenwood (TS-590, TS-890, TS-990, TS-480, TS-2000)
    Install Kenwood's virtual COM port driver, pick Kenwood, match the baud
    rate to the radio's menu, and press Connect radio.
  ATS Mini
    No driver needed. On the radio: Settings > USB Port > Ad hoc. Pick ATS Mini
    and press Connect radio. Only one program can use it at a time: close ATS
    Mini Controller (or disconnect it there) first.
  Malahit DSP2
    Pick Malahit, press Connect radio and choose its "Malahit CAT" port.
    Windows may need the Malahit USB CAT driver from malahiteam.com.
  If it doesn't connect, Settings > Radio control says what went wrong.

ClearRX by M3VRV (radio audio processor)
  A program of its own: download ClearRX-Windows.zip from the release page,
  unzip it into C:\BandWatch\ClearRX and run ClearRX.exe. Pick "Sound from" (your radio's USB Audio CODEC, a line-in or a
  mixer) and "Play to" (your speakers), press Start and choose a preset:
  SSB voice, Weak DX, CW or AM broadcast. While ClearRX is open, Band Watch's
  Listen can send the RTL-SDR's sound through it ("Send my RTL-SDR sound
  through ClearRX"). Its settings are kept in clearrx-settings.json.

Your own RTL-SDR (RTL-SDR Blog V4 or any RTL-SDR dongle)
  Band Watch can listen through your own dongle instead of a web receiver.
  1. Set the dongle's USB driver once with Zadig, as for any RTL-SDR program.
     Windows sees the dongle without this, but no program can use it.
       a. Download Zadig from https://zadig.akeo.ie and run it.
       b. Options > List All Devices.
       c. Pick "Bulk-In, Interface (Interface 0)" (or RTL2838UHIDIR /
          RTL2832U). Not your keyboard, mouse or radio.
       d. Make sure the right-hand box says WinUSB, then Replace Driver.
       e. Unplug the dongle, plug it back in, and restart Band Watch.
  2. In Band Watch, Listen > Receiver > "My RTL-SDR", then press Listen.
     Band Watch comes with rtl_tcp.exe (from the RTL-SDR Blog drivers V1.4.0,
     which support the Blog V4; see README-rtl-sdr.txt) and starts it for you.
     (Smart App Control may block rtl_tcp.exe the same way it blocks
     BandWatch.exe; see Smart App Control above.)
  You get a spectrum and waterfall (click them to tune), USB, LSB, CW, AM, FM
  and broadcast FM, from 500 kHz to 1,766 MHz. Below 28.8 MHz the V4 switches
  in its built-in HF upconverter by itself.
  Settings > RTL-SDR receiver has:
    - Connection: the rtl_tcp address (a Raspberry Pi or other PC on your
      home network works too), the dongle number if you have more than one,
      "Start rtl_tcp for me" (Band Watch runs rtl_tcp.exe itself when you
      press Listen: it uses the one next to BandWatch.exe, or give the
      location of another), Start/Stop rtl_tcp buttons that show what rtl_tcp
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

Updating
  Band Watch looks for a new version once a day. Settings > About this build
  shows it, with an Install update button: Band Watch downloads the new
  installer from its GitHub page, checks it, and installs it over your copy,
  then opens again. Or run a newer BandWatch-Setup.exe yourself: it asks
  "Update Band Watch from ... to ...?" and updates in place. You never need
  to uninstall first.

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
