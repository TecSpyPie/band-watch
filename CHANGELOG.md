# What's new

## 1.45.0 (28 Nov 2026)
- **3D band scope.** Press **3D view** under the band scope to see the live band from your RTL-SDR as a 3D landscape: the band from left to right (the same span as the scope above), the last few seconds going back into the distance and fading, and each signal rising above the noise as a peak, coloured from blue up to amber. The frequency you're tuned to is a bright line running into the distance. It follows the band and span you pick, needs the live RTL-SDR scope (it says so if the receiver isn't running), draws only while it's on screen, and HamShack remembers whether it's on. Like ClearRX's 3D scope, it's plain drawing with no add-ons. New `public/js/rfscope3d.js`, with tests.

## 1.44.3 (27 Nov 2026)
- **ClearRX 1.6.2: no more silent PC sound.** Installing VB-CABLE often makes "CABLE Input" Windows' default speakers, so ClearRX's "Default speakers" quietly played back into the cable and you heard nothing. ClearRX now shows which speakers are the default ("Default speakers (CABLE Input …)"). It won't start if that would go round in a circle, it says plainly when nobody would hear it, and it tells you how to fix it: pick your speakers in "Play to", and set them back as the default in Windows Settings > System > Sound > Output. This is also the first ClearRX you can get with ClearRX's own Update button.
- **Release notes: ClearRX with internet radio, WebSDR, KiwiSDR or YouTube.** Every release now has step-by-step instructions for using ClearRX with the free **VB-CABLE**: install it, set your speakers back as Windows' default, send the browser into "CABLE Input" in the Volume mixer, then press PC sound in ClearRX and Play to your speakers.

## 1.44.2 (27 Nov 2026)
- **ClearRX 1.6.1 updates itself.** When a newer ClearRX is out, a green **Update to …** button shows on ClearRX's toolbar. Press it and ClearRX downloads the new version from HamShack's release, checks it against the release's check numbers, puts it in place and restarts. The open window reloads by itself and your settings stay. Each release now also carries `clearrx-version.txt` so ClearRX can tell what's new. You install 1.6.1 by hand once; after that it updates itself. HamShack already updates itself in Settings > Updates.

## 1.44.1 (27 Nov 2026)
- **ClearRX 1.6.0: PC sound.** A new **PC sound** button under My radio cleans up sound that's already playing on the PC: an internet radio, a WebSDR or KiwiSDR in the browser, or a recording. Windows can't hand a program "what the PC is playing" on its own, so it uses the free VB-CABLE (vb-audio.com): set your browser's output to "CABLE Input" in Windows' Volume mixer, and ClearRX finds "CABLE Output" for you and plays the cleaned-up sound to your speakers. It explains each step, says plainly if there's no cable yet, and won't start if "Play to" is the cable it's listening to (that would howl). It warns about Stereo Mix, which hears ClearRX too.
- **ClearRX download:** the release notes and ClearRX's read-me now say to unzip into `C:\BandWatch`. The zip has its own ClearRX folder, so unzipping into `C:\BandWatch\ClearRX` made a folder inside a folder.

## 1.44.0 (27 Nov 2026)
- **Band Watch is now HamShack by M0GLP & M3VRV.** The new name is on the pages, the help, the phone app, the Windows installer, the shortcuts and Settings > Apps. Nothing else changes: your settings, logbook and radio setup carry over, the program is still `BandWatch.exe` in `C:\BandWatch`, and updates keep coming the same way. The old "Band Watch" shortcuts are swapped for "HamShack" ones when you update.
- **ClearRX 1.5.0: a new look.** A toolbar of big buttons, a big graph showing the sound before and after ClearRX with the EQ as a curve you can drag point by point (log or linear scale), effects in panels with a fold arrow and a green power button, and a status bar with a green-yellow-red output meter.

## 1.43.1 (27 Nov 2026)
- **Plain-English messages when something can't be reached.** POTA, Send to QRZ and the chat used to show the browser's own wording ("Failed to fetch") or a number from the server ("the server answered 502"). They now say what happened and what to do next, for example "Couldn't reach POTA. Check your internet connection; HamShack will try again." The words come from a new `public/js/networds.js`.
- **Send to QRZ stops when the connection drops**, instead of trying every contact and failing each one in turn.
- **Chat: reports can't be faked.** For reports, only the address added by the proxy in front of HamShack counts, so one person can't pose as three reporters with made-up addresses and take someone's message down. Web version; no API change.

## 1.43.0 (27 Nov 2026)
- **Chat: Report.** Each message from someone else now has **Report** next to **Hide**. Tap it, then tap again to confirm. When three different people report a message it's removed for everyone, and screens already showing it drop it on their next refresh. Who reported a message is kept only as a scrambled code that changes every time the server restarts, and is never shown to anyone. Reports are limited to 10 a minute per address. **Hide** still hides one callsign on your own screen only. New: `POST /api/chat` with `{ room, report }` (web version; the Windows app's chat already points to the website).
- **Space weather forecast from HamShack.** The forecast panel used to ask NOAA for the Kp forecast and 3-day text from every visitor's browser. HamShack now fetches it once every 30 minutes and shares it, in both the website and the Windows app (new route `GET /api/forecast`). If NOAA can't be reached, the last copy is shown.
- **Tests.** The browser tests no longer need the internet for CelesTrak or the contest calendar. Each test server gets its own chat, so one run can't break the next. The digital voice test now only counts real frequency or mode changes, not the radio's normal "what frequency?" reads. Its no-transmit check is unchanged.

## 1.42.0 (26 Nov 2026)
- **Chat.** A new Chat panel to talk to other HamShack users: a General room plus one room per band (160 m to 70 cm). Enter your callsign at the top of the page first. Messages are plain text, up to 300 characters; one message every 3 seconds and 12 a minute per address, and the newest 200 per room are kept for 48 hours. Anyone using HamShack can read them, so don't post anything private. **Hide** next to a callsign hides their messages on your screen only. Chat is on the website, where everyone meets: in the Windows app the panel links to it (a chat on one PC would only ever have you in it). New server route `GET/POST /api/chat` (web version).
- **Contests this week.** A panel listing contests in the next 8 days from the WA7BNM Contest Calendar, with times in UTC, "On now" and "In 20 min" tags, and a link to each contest's page. New server route `GET /api/contests` in both the Node and the Windows server: fetched at most once every 6 hours and shared by everyone, an older copy served if the calendar can't be reached, and only items that link to the calendar itself.
- **Who's hearing me.** A world map of the stations that decoded your FT8 or FT4 signal, from PSK Reporter (best report per station, strong in blue, weak in orange), with how many heard you, the farthest and the bands, over 15 minutes to 24 hours. It uses the existing `/api/myreports` route and its 5-minute cache. It only reads reports and never transmits.
- **Worked map.** Countries and 4-character grid squares from your HamShack logbook, on a world map, for all bands or one. Countries come from callsign prefixes: a guide, not an official DXCC count.
- **Log from a spot.** A small **Log** button next to each callsign in the spots list and the activity table opens the logbook with that call, frequency, mode, locator and report filled in.
- **Space weather forecast and aurora alert.** NOAA's 3-day Kp forecast as bars (observed and forecast), the chance of a radio blackout today, and what it means for aurora at your latitude. Tick **Aurora alert** and HamShack tells you (on the page, and as a notification if you allow it) when Kp reaches your level; **Use my latitude** suggests one.
- **Morse trainer.** Copy real callsigns by ear: live callsigns from the spots or a practice list, with character speed, Farnsworth spacing and tone, and a running score. It plays through this device's speaker only and never keys your radio.
- **Shack screen.** A full-screen "best band now" view for a spare tablet or monitor: the best band, the top six bands, UTC and local time, SFI and Kp, and how old the spots are. It keeps the screen awake; tap anywhere or press Esc to close.
- **Web version: no more red error on every load.** The website has no RTL-SDR bridge, and it now says so plainly (`/api/sdr` answers `{ "available": false }`) instead of a 404, so browsers stop logging an error. Nothing changes in the Windows app.

## 1.41.0 (21 Nov 2026)
- **Looks: a glowing keyboard focus.** In Radio front panel, Glass and depth and Space station, whatever you reach with the Tab key now has a soft glow in the look's own colour around its outline, so it stands out on metal, glass and space. Mouse clicks don't show it. High contrast and Night stay plain.
- **Sharper screens and smooth motion.** The RTL-SDR spectrum in Listen is now drawn at your screen's full sharpness (crisp line, scale and numbers on high-DPI screens), and the waterfall no longer blanks when the scale is redrawn. The ATS Mini's drawn screen (without Live screen) is drawn at twice the size so its text stays sharp; the radio's own live picture still shows as crisp pixels. In Radio front panel, Glass and depth and Space station, panels now drift gently into place when the page opens or a section is shown, and buttons ease when hovered and pressed. Changing the look or theme in Settings now fades softly from one to the other (in browsers that can). None of the motion happens if your computer asks for reduced motion; High contrast and Night stay plain.
- **Looks: light that follows your mouse.** In Radio front panel, Glass and depth and Space station, a soft light now moves across the panel under your mouse (white on the metal and glass, blue in space), so the panels feel lit and solid. It's drawn behind the text, so everything stays sharp. Only with a mouse, never with reduced motion (and glass under "reduce transparency" stays plain); High contrast and Night stay plain as always.
- **ClearRX: a Hiss remover that can learn your noise.** A new rack module, straight after the auto notch (off to start with). It splits the sound into 257 narrow slices of pitch about 190 times a second, works out how much of each slice is just noise and turns those slices down, so steady hiss and band noise go while voices keep their level. **Strength** (6 to 30 dB, 15 to start) is how far the noise goes down. On its own it follows the noise as it changes. **Learn noise**: tune to an empty bit of the band, press it, and in 1.5 seconds it learns that hiss exactly; the learnt noise is kept in `clearrx-settings.json` (as `snrProfile`, kept at a Volume of 1 so it still fits when you turn the Volume up or down) and used from the next start, and **Forget it** clears it. The card says what it's using and about how many dB it is taking out. Switching it on or off fades, so there's no click. It makes the sound about 11 ms late. Older settings files and saved orders get it in the right place, switched off. HamShack's Listen passes the on/off and Strength through to ClearRX (it follows the noise by itself there). Receive only: nothing transmits.

## 1.40.0 (20 Nov 2026)
- **Antenna A/B: FT8 and FT4 reports too.** A new **Reports from** choice (WSPR, FT8 and FT4, or Both; WSPR stays the default) lets you compare antennas with the FT8 or FT4 reports of your own callsign from PSK Reporter. New server route `GET /api/myreports?call=M3VRV&mins=120` (in both the Node and the Windows server): FT8 and FT4 reports of that sending callsign, last 24 hours at most, cached 5 minutes per callsign (concurrent requests share one PSK Reporter call, an old copy is served if a refresh fails, and a failure answers 502 without details), and it identifies HamShack to PSK Reporter by its public project address, never anyone's email. Matching is as before (same receiver, same band, same source; per-receiver averages), with a slot of 15 s for FT8 and 7.5 s for FT4 that must sit inside one period; WSPR and FT8/FT4 are never mixed and the table has a Source column. PSK Reporter only returns the latest report per receiver, so while you are logging a period with FT8/FT4 chosen and the page is showing, HamShack collects the reports itself: once when logging starts and then every 5 minutes (never more often), keeps them in your browser per callsign (7 days, 20,000 reports at most; the status line shows the receivers so far) and Compare uses all of them, so matches build up as stations hear you on each antenna. **Clear FT8 history** empties it. WSPR keeps its 20 s wait and 10-minute memory. Analysis only: nothing transmits.
- **RTL-SDR: recovers from a stuck rtl_tcp.** If rtl_tcp connects and sends its header but then no samples for about 9 seconds (or every reconnect gets the header and nothing else), HamShack now notices instead of looping on "Connection lost". If HamShack started that rtl_tcp it restarts it by itself (at most twice in 10 minutes, then it stops and says so). If you started it yourself, HamShack doesn't touch it: it says "rtl_tcp is connected but not sending any signal. It may be stuck: close and restart it." and offers a **Restart receiver** button that starts HamShack's own copy (and tells you plainly if another rtl_tcp is holding the port). Receive only. No server API change.
- **2 m and 70 cm, a UK band plan for them, and My repeaters.** The band lists, activity table, spots map, band scope and Listen now include **2 m** and **70 cm** (PSK Reporter spots, FT8 on 144.174 and 432.174 MHz; no extra PSK Reporter requests, same 5-minute cache). The UK band plan gains both bands from the RSGB plan in plain words: CW and beacons, narrow band and FT8, satellites, FM simplex (calling 145.500 and 433.500), repeater inputs and outputs, APRS (144.800 and 433.800) and digital voice and hotspot areas. The new **My repeaters** panel is your own list of repeaters (callsign, output, shift, CTCSS or DCS/colour code, mode, locator or town, notes), kept in your browser, with distance and heading from your locator and nearest first; **Tune** sets your radio or RTL-SDR to the output to listen (receive only: it never sets shift or tone and never transmits). You can import a CSV you downloaded (read in your browser, never uploaded; only import lists you're allowed to use for your own station), and there are links to ukrepeater.net, Hearham and RepeaterBook. HamShack bundles and fetches no repeater data.
- **Optional "Support" link (hidden until set).** HamShack stays 100% free: nothing is locked, and there are no popups, timers or reminders. The owner can set one support link in `public/js/support.js` (Ko-fi, GitHub Sponsors, Buy Me a Coffee or Liberapay, https only). Until then nothing shows. Once set, a small "Support" button appears in the header next to Help, and Help gets a "Support the project" section with an optional Supporters list. The README has a matching placeholder and `docs/FUNDING.yml.example` explains GitHub's Sponsor button.
- **ClearRX: a 3D spectrum scope in the graphic EQ.** Above the EQ's sliders, a 3D terrain of the sound: pitch left to right (50 Hz to 6 kHz), time front to back (now at the front, older rows fading away behind), loudness as height and colour. The EQ's curve glows along the front edge with a marker for each of the ten bands and moves as you drag the sliders. **Before / After** shows the sound going in or coming out of ClearRX, and **3D scope** switches it off (both are remembered). It pauses when the page is hidden or the scope is scrolled out of view, and updates slower if your computer asks for reduced motion.
- **Credits: "by M3VRV & King Coder".** HamShack and ClearRX now credit both the owner (M3VRV) and the AI partner, King Coder, in their titles, headers, installer and Windows file details.
- **ClearRX: an effects rack.** ClearRX now works like a rack of effect modules. Each stage is a card with its own
  **on/off switch**, its controls, a **Reset** button and **up/down arrows** to put it in a different place: the sound goes
  through the modules from top to bottom, so the order matters (a compressor after the EQ works on the EQ's louder sound).
  Changing the order fades the sound out and back in over a few milliseconds, so there is no click. The noise blanker,
  band-pass filter (voice filter, with low and high cut sliders), CW peak, manual notch, auto notch, noise reduction,
  squelch, steady volume (AGC) and bass/treble are modules now, and the presets (SSB voice, Weak DX, CW, AM broadcast,
  Off) set them. New: a **10-band graphic EQ** (100 Hz to 5 kHz, plus or minus 12 dB, with Flat, SSB punch, Weak DX, CW
  and AM warm curves; each preset picks its own), a **compressor / limiter** (threshold, ratio, make-up gain, a limiter
  that holds the sound under -1 dB, and a gain-reduction meter), and an **Output meter** at the bottom with a CLIP warning.
  The order, EQ and compressor are kept in `clearrx-settings.json` (older files get the usual order, a flat EQ and the
  compressor off). HamShack's Listen uses them too when it sends your RTL-SDR sound through ClearRX; with the usual
  order and no EQ or compressor it sounds exactly as before. Download the new `ClearRX-Windows.zip` and unzip it over the
  old one.
- **Glass look, deeper.** Settings > Look > Glass and depth now has three clear layers: a deep soft gradient behind (a background picture you chose stays, slightly blurred and dimmed), panels as frosted glass with a bevelled light edge and soft stacked shadows, and the header, section menu, buttons, chips, dialogs, toast and map tip raised above them (buttons press in when clicked; dialogs get the deepest shadow and blur the page behind). The map, waterfall and scope stay sharp. Buttons no longer blur on their own, which keeps it light on the computer. Follows "reduce transparency", "more contrast" and "reduce motion" settings; High contrast and Night still stay plain.
- **A real world map for the spots panel.** The "40 m spots" panel (any band: it follows the band you pick) now has a
  **Map / Bowl** switch, **Map** by default (your choice is remembered; **Bowl** is the old simple chart). The map
  has real coastlines (Natural Earth 110m land, public domain, built in, so no map tiles and no internet map service),
  you as a ringed dot, a dot for every spot on the band with a curved great-circle path from you, coloured and sized by
  signal (none, weak, fair, good, strong) and fading as spots get older, the night side shaded with the Sun marked, and
  satellites, POTA and APRS when switched on. Rest the pointer on a dot (or tap) for callsign, distance, beam heading,
  signal and mode; click for the station window. Mouse wheel or +/- buttons or pinch to zoom, drag to move, double-click
  or the home button to reset. Works in all themes, on a phone and in the map's own window. It only uses the spots
  already fetched: no extra PSK Reporter requests.
- **Decoders fixes (receive only).** The results window now shows RTTY text the same way it shows CW; the text box replaces the table for CW and RTTY, goes away for other modes, learns the mode even if opened late, and follows Clear. Starting a decoder from the sound input no longer says "Waiting for the next cycle" for CW and RTTY (which have no cycles); SSTV and APRS get their own wording.
- **Antenna A/B (analysis only).** A new panel to compare two antennas, or before and after a change, using real WSPR
  reports of your own callsign. Press **Now on antenna A / B** whenever you switch (or type the times), name the antennas,
  then **Compare**: reports come from wspr.live straight to your browser (one lookup per click, up to 7 days). Only
  receivers that heard you on both antennas on the same band are compared, with the average SNR difference per band, by
  direction and by distance, and a warning when there are fewer than 10. HamShack never transmits or controls the radio
  for this (FT8 and FT4 reports from PSK Reporter are in the first entry of this list).
- **RTTY decoder (receive only).** The Decoders panel has a new mode, **RTTY (radioteletype)**: 45.45 baud and 170 Hz
  shift as standard (50 and 75 baud, 425 and 850 Hz shift too), Baudot letters and figures, in a scrolling text box with
  Clear. Set the lower tone (2125 Hz mark / 2295 Hz space by default) or click **Find the tones**; **Reverse** swaps mark and
  space (for USB), and **Unshift on space** is on by default. The RTTY settings only show when RTTY is the mode. HamShack
  never transmits RTTY. `node tools/rtty-wav.js` writes a test recording.
- **Section menu and folding.** A slim bar under the title (it stays on screen as you scroll) has a button for each
  panel that is showing: Clock, Radio panel, Listen, Decoders, POTA, Satellites, Logbook and so on. Click one to glide
  to that panel; the panel you're looking at is highlighted, and on a narrow screen the bar slides sideways. Add-on
  panels (Rotator, Digital voice) and the ATS Mini appear in it only while they're switched on.
  - **Fold a panel** with the small arrow by its name: only its name stays, the rest is hidden. Nothing stops
    running (decoders, radio, Listen). Folded panels are remembered and shown with a dashed outline in the menu;
    clicking one unfolds it.
  - **Settings > Show the section menu** turns the bar off. Works in every theme and look; own windows and the
    results window are unchanged.

## 1.39.0 (19 Nov 2026)
- **Digital voice add-on** (Settings > Add-ons: DMR, BrandMeister and Fusion). HamShack can't make or send DMR or
  Fusion (C4FM) voice itself: both use the AMBE voice codec, which is patented and only built into radios and hotspots.
  What the add-on does:
  - **One-click C4FM on a Yaesu radio** (FT-991A and others): the UK digital voice calling frequencies (145.375 MHz on
    2 m, 438.6125 MHz on 70 cm) or a frequency you type, on 2 m or 70 cm only. It sets the frequency and C4FM mode
    (`MD0E;`) and nothing else: HamShack never transmits here, you talk on your own microphone.
  - **BrandMeister (DMR):** links to Hoseline (listen to talkgroups in your browser), the talkgroup list and Last
    heard, with talkgroups to try (235 UK, 91 worldwide, 92 Europe, 9990 Parrot).
  - **DMR over the internet:** a short guide. To listen, Hoseline in your browser (no radio). To talk, something with
    the AMBE codec: a DMR radio and a hotspot (Pi-Star or WPSD), or an app such as DroidStar with an AMBE USB stick;
    either way your licence and a DMR ID from RadioID.net. Links to each project's own page.
  - **UK repeaters:** links to the Fusion, DMR and full repeater lists at ukrepeater.net (RSGB ETCC).
  - **Your hotspot:** save your Pi-Star or WPSD dashboard address (e.g. http://pi-star.local/) and open it from here.
  - BrandMeister and ukrepeater.net data isn't copied into HamShack: neither says it may be reused, so HamShack
    links to their own pages.

## 1.38.0 (19 Nov 2026)
- **CB channels to listen to** (Listen panel): pick a UK 27/81 FM channel (1–40; channel 19 is 27.78125 MHz) or a
  European CEPT channel (1–40; channel 19 is 27.185 MHz) and Listen tunes there in FM. Listen only: HamShack never
  transmits on CB. Best with an RTL-SDR (WebSDRs may not cover 27 MHz).
- **Help: Licences and exams (UK).** The three UK licences, how the RSGB exams are taken online at home with a remote
  invigilator, what the Intermediate exam is like, and links to the RSGB's guides, course finder and syllabus videos.
- **Help: Good operating, a code of practice:** listen first, identify, keep to the band plan, the power you need, a
  clean signal, courtesy, emergency traffic first, and more.

## 1.37.0 (19 Nov 2026)
- **APRS on 2 m** (Decoder, Mode: APRS). With your RTL-SDR on **144.800 MHz FM** (Tune to APRS), or the ISS on
  145.825 MHz, HamShack decodes APRS packets (1200 baud AFSK, AX.25): who, where (distance and beam heading from
  you), the path, and what they report: positions (plain, compressed and Mic-E from car and hand-held radios), course,
  speed and height, weather stations (temperature, wind, humidity, pressure), status and messages. Stations with a
  position show as orange diamonds on the world map. Tested by making APRS audio, with noise and an FM radio's tone
  tilt, and decoding it back.
- **For testers:** "Report a problem" and "Suggest an idea" forms on GitHub (New issue).

## 1.36.0 (19 Nov 2026)
- **Add-ons** (Settings, under "Show these sections"): extra panels that stay out of the way until you tick them.
- **Rotator add-on:** turn your antenna from HamShack. Connect the rotator controller's own USB port (Chrome or
  Edge) as Yaesu GS-232A, GS-232B (azimuth and elevation), EasyComm II (K3NG and many home-built controllers) or
  Hy-Gain DCU-1.
  - A compass dial shows where the beam points (solid) and where it's turning to (dashed); click the dial to turn
    there, or use N / E / S / W, or type a heading.
  - **Point at** a locator or a callsign HamShack has heard (from decodes, spots or POTA), short or long path, with
    the distance.
  - **Follow a satellite** across its pass (azimuth, and elevation on an az/el rotator); below the horizon it waits
    pointing where the satellite will rise. It only sends a new heading when it has moved 2° or more.
  - The rotator only moves when you ask; **Stop** or **Esc** stops it.
- **Fix: updating could fail with "couldn't write pthreadVC2.dll … being used by another process".** An rtl_tcp left
  running from the HamShack folder (after HamShack was stopped suddenly) held its files open. The installer now
  ends that rtl_tcp first; rtl_tcp from anywhere else is left alone.

## 1.35.0 (19 Nov 2026)
- **New looks with depth** (Settings > Look; High contrast and Night keep the plain look):
  - **Radio front panel:** brushed-metal panels with screws in the corners, bevelled keys that press in, lit keys
    that glow, and amber LCD-style clocks and readouts.
  - **Glass and depth:** frosted-glass panels floating over soft colour, lifting under the mouse.
  - **Space station:** a starfield and Earth's glow behind the page, drifting at different depths as the mouse moves
    (still for people who ask their computer for reduced motion), with glowing blue panels.
  - **Classic** is the look you had before.

## 1.34.0 (19 Nov 2026)
- **CW keyboard** (Decoder, CW mode). Type, and each letter is sent in Morse as you type it: you hear it and see its
  dots and dashes, the one sounding now picked out.
  - **Practice** (how it starts every time) plays to your speakers only: nothing is sent. Good for learning, with
    **Farnsworth spacing** (letters at full speed, gaps stretched to 5–15 WPM overall).
  - **On the air** keys your radio and sends a clean keyed tone (5 ms raised-cosine edges, no key clicks) into its
    USB sound in DATA-USB; it goes back to receive 0.8 s after your last letter (break-in). Same safety as FT8:
    Enable TX must be on, Stop / Stop TX / Esc stop at once (and clear what's queued), CW only inside the amateur
    bands (CW segments are fine for CW).
  - Message buttons: **CQ**, **Call**, **Report**, **73**, **AGN?**, **QRZ?**, with your callsign, theirs, your
    locator and the report filled in; change them under "Change the messages". Prosigns: `<SK>`, `<KN>`, `<AR>`, `<BT>`…
  - Speed 5–45 WPM and the tone's pitch. Tested: HamShack's CW decoder reads back what it sends at 12, 20 and 28 WPM.

## 1.33.0 (19 Nov 2026)
- **Decode table your way** (in the Decoder panel and the Results window, which follow each other):
  - **Columns and time zone:** tick which columns to show (Time, Mode, dB, DT, Audio Hz, Frequency).
  - **Frequency** column: the frequency on the air (the radio's dial plus the audio offset), e.g. 7,075.234 kHz.
    HamShack now notes the dial with every decode, so **Log** on a decode gets the right frequency too.
  - **Resize** a column by dragging the edge of its heading (or the arrow keys on a focused edge); Reset column widths.
  - **Times in UTC, your local time, or any time zone** (all of them), with a clock above the table (and UTC beside it).
- **Add completed QSOs to the logbook by themselves:** a tick box in the Transmit box. A finished FT8/FT4 QSO goes
  straight into the logbook (call, grid, both reports, frequency, mode; to QRZ too if that's on), once, with Undo.
  Log QSO still fills in the form to check first.

## 1.32.0 (19 Nov 2026)
- **Send SSTV pictures.** In SSTV mode, **Send a picture**: choose a picture (or use the one received), the mode
  (any of the 19), how it fits, and text for the top and bottom (your callsign must be on it). The preview is exactly
  what goes out; the red bar counts down while it's sent. Same safety as FT8: nothing goes out unless **Enable TX** is
  on (and it goes off again after each picture), **Stop TX** / **Esc** stop at once, and the radio unkeys itself at
  the end. **Tune to SSTV** now also puts the radio in its data mode (DATA-USB / DATA-LSB).
- **Safer band checks for FT8 and FT4 too.** HamShack now checks every part of a signal against the UK band plan,
  not just the band's edges: it won't transmit in gaps with no UK allocation (60 m has several: FT8 on 5357 kHz with
  1500 Hz audio would be at 5358.5 kHz, outside the UK block, and HamShack says what TX audio setting would fit),
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
  - **Reply** on a decode answers that station; **Call CQ** calls CQ. HamShack then sends the usual messages (grid,
    report, R-report, RR73, 73) as the other station answers, in the right slot, and stops after the 73.
  - **Log QSO** puts the QSO in the logbook (call, grid, both reports, frequency, mode); HamShack also fills it in
    by itself when the QSO completes.
  - **Tune** sends a steady tone for 10 s to set **Level** with the radio's ALC meter. **TX audio** sets where in
    the passband you transmit (1500 Hz to start).
  - A clean signal: Gaussian-shaped tones and soft ramps, as WSJT-X sends them (tested: HamShack's own decoder
    reads it back, and it's over 50 dB down 120–300 Hz away).
  - **Early decode** (13.6 s into an FT8 cycle, 6.0 s for FT4, as WSJT-X does), so replies go out in the very next
    slot. A second pass at the end of the cycle adds any stations that started late.
  - **Safety:** nothing is sent unless **Enable TX** is on (off every time HamShack starts); **Stop TX** or **Esc**
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
  pick a preset (Off switches them off). HamShack uses them too when it sends your RTL-SDR sound through ClearRX.
  Download the new `ClearRX-Windows.zip` and unzip it over the old one.

## 1.25.1 (19 Nov 2026)
- **The Radio panel's S-meter works with the RTL-SDR.** While your RTL-SDR is playing and no connected radio is
  giving a reading, the needle follows the signal level in the channel you're tuned to, shown as "≈S5 (RTL-SDR)".
  An RTL-SDR isn't calibrated like a radio, so it's a rough guide (S9 is about −45 dBFS). A connected Yaesu, Icom
  or ATS Mini still drives the meter itself.

## 1.25.0 (19 Nov 2026)
- **Receive controls on the Radio panel** for Yaesu (FT-991A, FT-710, FTdx10, FTdx101) and Icom (IC-7300, IC-705,
  IC-7610 and others): **AF gain** and **RF gain** sliders, **AGC** (FAST, MID, SLOW, AUTO), the preamp (IPO, AMP1,
  AMP2), **ATT**, **NB**, **DNR** and **Auto notch**. HamShack reads them from the radio when it connects and every
  few seconds after, so turning the radio's own knobs shows here too. Receive only: nothing here transmits.

## 1.24.2 (19 Nov 2026)
- **ClearRX 1.1.0: My radio.** Buttons for **RTL-SDR, Yaesu, Icom, ATS Mini, Malahit and Other / mixer**. Pick
  yours and ClearRX finds its sound input (the radio's USB Audio CODEC, or the line-in for the ATS Mini), sets a good
  starting preset (SSB voice, or AM broadcast for the ATS Mini) and shows a tip for that radio, such as where the
  IC-7300's USB audio level is. RTL-SDR points you to HamShack's Listen, which sends its sound through ClearRX.
  Download the new `ClearRX-Windows.zip` and unzip it over the old one.

## 1.24.1 (19 Nov 2026)
- **ClearRX is now its own download** (`ClearRX-Windows.zip` on the release page), not inside the HamShack
  installer. Microsoft Defender wrongly flagged the 1.24.0 installer as unwanted software, most likely because
  ClearRX.exe is new and not signed yet; this way a false alarm on ClearRX can't stop HamShack installing.
  Unzip it into `C:\BandWatch\ClearRX` and run `ClearRX.exe`; HamShack's installer then adds its shortcuts.

## 1.24.0 (18 Nov 2026)
- **New: ClearRX by M3VRV**, a radio audio processor that comes with HamShack for Windows. It's a program of its
  own (its own desktop icon and window), made for ham radio: it takes the sound from your radio's USB sound card,
  a line-in, a mixer or any sound card, and plays it to the speakers you choose, cleaned up. Presets for SSB voice,
  Weak DX, CW and AM broadcast, or your own: a voice filter, a steep CW peak filter, an auto notch for whistles,
  noise reduction (light, medium, strong) and a steady-volume compressor. Input and output meters, a warning when
  the sound coming in is too loud, a before-and-after spectrum, and a switch to hear it without ClearRX to compare.
  Its settings are kept on your PC.
- **Linked to HamShack, not built in:** while ClearRX is open, Listen shows **Send my RTL-SDR sound through
  ClearRX**. Tick it and the RTL-SDR's sound is cleaned up with ClearRX's settings; ClearRX shows **HamShack is
  using these settings**. Close ClearRX and HamShack carries on as before.
- The installer adds ClearRX's shortcuts, and closes ClearRX before an update. The Help guide has a ClearRX section.

## 1.23.0 (18 Nov 2026)
- **Help guide:** a **Help** button at the top opens a guide to every part of HamShack, with pictures and simple
  numbered steps: getting started, connecting your radio, the Radio panel, Listen, your RTL-SDR (with the Zadig
  steps), the bands and scope, shortwave stations, the decoders, POTA, Wanted alerts, the logbook, the ATS Mini,
  own windows, settings and updates, and what to do if something doesn't work. It follows your colours and works
  offline.
- **Icom IC-7300 set-up steps** in Settings > Radio control, the Help guide, README-Windows.txt and the GitHub page:
  the CP210x driver, MENU > SET > Connectors > CI-V (USB Port: Unlink from [REMOTE], Baud Rate: Auto, Transceive: ON),
  then Icom, IC-7300, 115200 baud. The Zadig steps for the RTL-SDR are spelled out too.

## 1.22.0 (18 Nov 2026)
- **Listen goes with the Radio panel:** when you pop the radio out, the Listen panel goes into the same window, under
  it. Pressing **Listen** there now starts the sound (your RTL-SDR, or a receiver playing inside HamShack) in that
  window. Before, browsers wouldn't start sound from a click in another window, so nothing played until the radio
  was back. Bringing the radio back stops that window's sound and says to press Listen again.
- **Everything 3D and sharp:** every part of HamShack now sits on a raised card with a crisp lit edge; buttons stand
  up and press in; the boxes you type in, the map, the band scope and the receiver are set into the card; table
  headings and the top bar are raised; headings and the big band name are crisper. High contrast and Night stay
  flat, for reading.

## 1.21.0 (18 Nov 2026)
- **Radio panel: waterfall and Pop out.** A waterfall now runs under the panel's spectrum, like the scope on a real
  radio: live from your RTL-SDR (about ten rows a second), or built from the stations spotted there. Click it to
  tune. **Pop out ⧉** on the panel puts the whole radio in a window of its own, to move onto another screen; it gets
  a bigger spectrum and waterfall there, and **Back in HamShack** brings it home.
- **A more 3D, glossy radio:** a brushed-metal face with screws in the corners and a deeper case, glass over the
  meter and the display, shiny keys that stand up and press in, and a ridged tuning knob with a shine on its cap.

## 1.20.0 (18 Nov 2026)
- **Radio panel:** HamShack as the front of a transceiver. A big glowing frequency display (click it to type a
  frequency, like 14.2 or 7074), an analogue S-meter with a needle, a close-up spectrum around the dial (live from
  your RTL-SDR, or drawn from the stations spotted there; click it to tune), band keys that remember where you were
  on each band, mode keys, a tuning step and span, and a tuning knob you can drag round, scroll, or turn with the
  arrow keys. Your radio follows it, and so does Listen. The S-meter is read from the FT-991A (and other Yaesus),
  Icom radios and the ATS Mini. There's no transmit button: HamShack only tunes and listens.

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
  **Malahit CAT** port. HamShack tunes it from 10 kHz to 2 GHz (HF, and VHF/UHF like 2 m FM) when you click a spot,
  the scope or the band plan, and follows its dial. Works with the DSP1 and DSP3 too. Windows may need the Malahit
  USB CAT driver from malahiteam.com.
- **ATS Mini screen fix:** the live screen was black on ATS Mini firmware older than 2.41, which doesn't know the quick
  picture command. HamShack now checks the firmware version and uses the older command when needed (and tries the
  other one if no picture comes). The panel shows the firmware version.
- **Which port:** Settings and the radio panels now say which USB device HamShack is connected to, e.g.
  "Espressif (ATS Mini)". Browsers don't tell web pages the COM number; Edge's port list shows it, e.g. (COM4).
- **Using an ATS Mini:**
  1. On the ATS Mini (firmware 2.34 or later): **Settings > USB Port > Ad hoc**.
  2. Plug it into your PC with its USB cable.
  3. In HamShack: **Settings > Radio control > Radio make > ATS Mini**, then **Connect radio** and pick its port.
  4. The **ATS Mini** panel shows a live picture of the radio's screen with buttons for band, tune, mode, volume and
     light. Press **⧉** on it to put it on another screen.

## 1.16.0 (17 Nov 2026)
- **Own windows, for more than one screen:** the Bands table, Map, Band scope, Listen, ATS Mini, Decoder, POTA,
  Wanted, Logbook and Band activity each have a small **⧉** button. Press it and that part moves into a window of its
  own that you can drag onto another screen. It keeps working there (radio, sound, waterfall, decoding) and matches
  your theme. HamShack remembers where you put each window. Press **Back to the main window**, **Bring it back**, or
  just close the window to put it back.

## 1.15.0 (17 Nov 2026)
- **ATS Mini panel:** when your radio make is ATS Mini, a new panel shows a **live picture of the radio's own
  screen**, about every 1½ seconds, with buttons for Band, Tune, Push, Mode and Volume, Connect, **Choose port** and
  **Save picture**. Untick Live screen for a simpler screen HamShack draws from the radio's status (frequency, band,
  mode, signal and SNR).
- **Radio ports:** with an FT-991A and an ATS Mini both plugged in, changing the radio make no longer reconnects to the
  other radio's port. Each make uses its own port, and HamShack asks you to pick one if it doesn't know it yet.

## 1.14.0 (17 Nov 2026)
- **ATS Mini support:** HamShack can now control the ATS Mini pocket receiver (SI4732, firmware 2.34 or later)
  over its USB cable. In **Settings > Radio control**, pick **ATS Mini** and press Connect radio (on the radio, set
  Settings > USB Port to **Ad hoc** first). Click a spot, the band scope or the band plan and the ATS Mini changes
  band and mode by itself, then tunes the exact frequency. Turn its dial and HamShack follows. Settings shows its
  frequency, band, signal strength and SNR. It covers 150 kHz to 30 MHz (AM, LSB, USB) and 64 to 108 MHz FM.

## 1.13.1 (17 Nov 2026)
- **rtl_tcp comes with HamShack:** the Windows installer now puts `rtl_tcp.exe` (from the RTL-SDR Blog
  drivers V1.4.0, which support the Blog V4) next to HamShack, so **Listen > My RTL-SDR** works straight
  away: no more "HamShack couldn't find rtl_tcp". The files are the RTL-SDR Blog release's own, unchanged
  and checked against its fingerprint when HamShack is built. rtl-sdr is GPL-2.0: its licence is in
  `C:\BandWatch\COPYING-rtl-sdr.txt`, and its source is attached to this release. The dongle still needs its
  USB driver set once with Zadig, as for any RTL-SDR program.

## 1.13.0 (17 Nov 2026)
- **Icom and Kenwood radio control:** Settings > Radio control has a new **Radio make** choice. Icom radios
  (IC-7300, IC-705, IC-7610, IC-9700 and other CI-V radios) and Kenwood radios (TS-590, TS-890, TS-990,
  TS-480, TS-2000) are tuned and followed just like the Yaesu radios, with USB-D / DATA-USB on digital
  frequencies. If an Icom's CI-V address was changed in its menu, HamShack picks it up from the radio.
- **Send to QRZ:** the logbook sends your contacts straight into your QRZ.com logbook, using the API key from
  QRZ's logbook settings (QRZ needs a subscription for this). Each contact is sent once and marked "QRZ ✓",
  and you can have new contacts sent as soon as you log them.
- **Updates in Settings:** a new **Updates** section at the top of Settings says whether you have the newest
  version, has the **Install update** button, and links to HamShack on GitHub, all versions, and the
  Windows installer.
- **Fixed: Listen with your RTL-SDR looked dead** when rtl_tcp wasn't running. The Windows app now starts
  rtl_tcp by itself when you press Listen, and any problem shows in red under the Listen button and as a pop-up.
- **Fixed: "Play inside HamShack" with the Twente WebSDR.** Since 1 November the Twente receiver won't run
  inside another app, so it now opens in its own window, and the tick box says why. KiwiSDRs and other WebSDRs
  still play inside HamShack.

## 1.12.3 (17 Nov 2026)
- **Its own window:** on Windows, HamShack now opens in an app window of its own, with no address bar or
  tabs and its own button on the taskbar, instead of a tab in your browser. It uses Microsoft Edge (which
  comes with Windows) or Chrome, so radio control works too. To have a normal browser tab again, set
  BANDWATCH_WINDOW=browser.
- **Brighter, glossy colours:** shinier buttons, softly lit panels, glowing activity bars and a brighter teal
  and amber in the Light and Dark colours. High contrast and Night stay plain on purpose.

## 1.12.2 (17 Nov 2026)
- **Updates from inside HamShack:** Settings > About this build says when a newer version is out. In the
  Windows app, **Install update** downloads it from GitHub, checks it against the release's checksums, and
  installs it over your copy, then HamShack reopens. It checks once a day and tells you.
- **The installer updates in place:** if HamShack is already installed it asks one question, "Update Band
  Watch from 1.12.1 to 1.12.2?", and goes over the old copy. A copy in the old AppData folder moves to
  C:\BandWatch by itself, so there's no need to uninstall first.

## 1.12.1 (17 Nov 2026)
- SOTA spots removed. SOTA's API terms don't allow AI-written software without their approval, and the address
  HamShack used had been retired. POTA activators stay, now checked every two minutes.

## 1.12.0 (17 Nov 2026)
- **Radio control:** HamShack tunes your Yaesu FT-991A (and FT-710, FTDX10, FTDX101) over its USB cable when
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
- RTL-SDR connection settings, and HamShack can start rtl_tcp for you.
- One-file Windows installer, BandWatch-Setup.exe, installing to C:\BandWatch.

## 1.8.0
- RTL-SDR Blog V4 receiver through rtl_tcp, with waterfall and click-to-tune.

## 1.7.0
- Windows installer that checks Smart App Control; install page for phones and PCs.
