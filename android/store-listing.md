# HamShack on Google Play: store listing

Everything to copy into Play Console for the app's store listing, content rating and Data safety form.
The parts between the `<!-- -->` marks are checked by `npm test` for Play's length limits (name 30, short
description 80, full description 4000 characters).

## App name

<!-- title -->
HamShack by M0GLP & M3VRV
<!-- /title -->

## Short description

<!-- short -->
Live band conditions, spots, maps, satellites and FT8 for radio amateurs.
<!-- /short -->

## Full description

<!-- full -->
HamShack shows radio amateurs which bands are open from where they are, right now. It's free, open source (MIT licence), and has no adverts, no accounts and no tracking.

WHAT YOU GET ON YOUR PHONE OR TABLET
• Best band now and a bands table, worked out from live PSK Reporter reports of who is hearing whom near your locator.
• A world map of the paths that are open, and of who heard your own signal.
• Sunspots and space weather from NOAA: solar flux, K index, X-ray flares and the forecast, with a plain-English summary.
• Satellites: amateur satellites and the ISS, when they pass over you next, and their frequencies.
• Parks on the Air (POTA): live activators on a list and the map, with alerts.
• Shortwave stations on air now, from the EiBi schedule.
• Decoders for FT8, FT4, WSPR, CW and SSTV, using your phone's microphone (or a USB sound adapter, where your phone supports one) next to your radio's speaker.
• Logbook with one-tap logging and ADIF export for LoTW, eQSL and Club Log, and QRZ.com lookups with your own QRZ account.
• Wanted alerts for callsigns, prefixes and grid squares you still need.
• Contest calendar, UK band plan, world clock and repeater lists.
• HamShack chat: a small public chat with a General room and a room for each band. Report or hide any message.
• Public web receivers (WebSDR and KiwiSDR) to listen around the world.

WHAT NEEDS A COMPUTER
Some parts of HamShack talk to equipment plugged into a computer, and phones can't do that from a web app:
• Radio control over USB (Yaesu, Icom, Kenwood, ATS Mini, Malahit) and FT8/FT4 transmitting need Chrome or Edge on the PC your radio is plugged into.
• The RTL-SDR receiver and live band scope need the free HamShack Windows app.
• ClearRX (cleaner radio sound) is a Windows program.
HamShack tells you this in plain words where it applies, and everything else works as normal. The Windows app is a free download from the project's GitHub page.

YOUR PRIVACY
Your callsign, locator, settings and logbook stay on your device. Only the first four characters of your locator are sent, to fetch spots for your area. Your exact location is never sent. The full privacy policy is at band-watch.ample.run/privacy.

DATA FROM
PSK Reporter, NOAA Space Weather Prediction Center, POTA, CelesTrak, EiBi, the WA7BNM Contest Calendar and QRZ.com (with your own account). Thanks to all of them.

HamShack is made by radio amateurs M0GLP and M3VRV. Ideas and problems are welcome on GitHub: github.com/TecSpyPie/band-watch
<!-- /full -->

## Category and contact

- **App or game:** App
- **Category:** Tools (Communication would also fit; Tools is where most amateur radio apps are)
- **Tags (pick up to 5 that Play offers):** radio, reference, utilities
- **Free or paid:** Free. No in-app purchases, no adverts ("Contains ads": No)
- **Website:** https://band-watch.ample.run
- **Privacy policy:** https://band-watch.ample.run/privacy
- **Email:** Play needs a contact email that is shown publicly. Use one you're happy to show (not added here).

## Graphics Play asks for

- **App icon:** 512 x 512 PNG: `public/icons/icon-512.png`
- **Feature graphic:** 1024 x 500 PNG or JPG. Not in the repository yet: make one from the logo and a screenshot.
- **Phone screenshots:** at least 2 (up to 8), between 320 and 3840 pixels, from a phone running the app.
  Good ones: best band now, the map, satellites, POTA, the FT8 decoder, the chat. `public/help/phone.webp`
  shows the look but take fresh ones in the app (Play wants PNG or JPG).
- **Tablet screenshots:** optional, but help the listing on tablets and Chromebooks.

## Content rating (the IARC questionnaire)

Category: **Reference, news or educational** (or "All other app types"). Answers:

- Violence, fear, sexual content, bad language, drugs, gambling: **No** to all.
- **Do users interact or exchange content?** **Yes**: the public chat (text only, callsign as the name).
  Moderation: anyone can **Report** a message (three reports take it down for everyone), **Hide** all messages
  from a callsign on their own device, and every message is deleted after 48 hours. Posting is rate-limited.
- **Does the app share the user's current location with other users?** **No.**
- **Does the app allow purchases of digital goods?** **No.**
- **Unrestricted internet access / web browser?** **No** for the app itself. Links to other sites open in Chrome.

Expected result: a low rating (Everyone / PEGI 3), with the "Users interact" note.

## Target audience

Choose **18 and over** (or 13+). HamShack is for licensed radio amateurs and has a public chat, so it is
not designed for children; choosing an adult audience keeps it out of Play's Families programme.

## Data safety form

Based on what the code does (`chat.js`, `qrz.js`, `server.js`, `public/js/`). The HamShack server is the
only "developer" server; PSK Reporter and QRZ.com are asked on the user's behalf (service providers, or
transfers the user starts themselves), which Play doesn't count as sharing.

**Overview questions**

- Does your app collect or share any of the required user data types? **Yes**
- Is all of the user data collected by your app encrypted in transit? **Yes** (the site is https only)
- Do you provide a way for users to request that their data is deleted? **Yes**: chat messages are deleted
  automatically after 48 hours; everything else is on the device and goes when the app's data is cleared or the
  app is uninstalled. Requests can also be made on GitHub. (There are no accounts, so no account deletion page
  is needed.)

**Data types to tick** (all: Collected **Yes**, Shared **No**, Optional **Yes**, purpose **App functionality**;
plus **Fraud prevention, security and compliance** for chat, which is rate-limited by address):

| Play's data type | What it is in HamShack | Notes |
|---|---|---|
| Location > Approximate location | The 4-character grid square (about 100 x 200 km) sent to fetch spots | Your exact position never leaves the device. Cached 5 minutes on the server, not stored. |
| Personal info > User IDs | Your callsign (for "who heard me", the chat) and QRZ username if you sign in to QRZ | QRZ password goes straight to QRZ and is never stored. |
| Messages > Other in-app messages | Chat messages | Public by design, kept 48 hours. |

**Not collected** (don't tick): name, email, phone, address, contacts, photos and videos, audio (the decoders
work on the device and send no sound), files, calendar, health, financial info, web browsing, app activity or
analytics, crash logs, device or other IDs, precise location.

**Notes for honesty**

- Internet addresses are held in memory for about a minute to stop chat flooding and repeated QRZ sign-in
  attempts; reporters of chat messages are kept only as a scrambled (salted hash) value. Play doesn't ask
  about IP addresses on their own.
- The hosting company may keep ordinary web request logs.
- The device talks directly to OpenStreetMap, unpkg.com, CelesTrak, NASA SDO and wspr.live for some parts
  (see the privacy page). These are not HamShack's servers.

## Things Play reviewers check for web-based apps

- **Not just a website:** the app installs with its own icon, opens full screen without an address bar, works
  offline with the last copy (service worker), and is genuinely useful. Good.
- **Digital Asset Links:** if `/.well-known/assetlinks.json` isn't set up with Play's key, the app shows an
  address bar at the top. Reviewers notice. Do step 8 of `android/README.md` before sending for review.
- **User-generated content policy (chat):** needs in-app reporting and a way to block users (both there:
  Report and Hide), and rules about what's not allowed. Consider adding a one-line rule above the chat box
  ("Be kind; no abuse, spam or adverts. Report anything that breaks this.").
