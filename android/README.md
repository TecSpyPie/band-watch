# HamShack on Google Play (Android)

The Android app is the HamShack website (https://band-watch.ample.run) in an app window, a **Trusted Web
Activity**. It's made with Google's free **Bubblewrap** tool, by a GitHub Actions workflow you start by hand.
Every change to the website shows in the app straight away: you only need a new app build to change the
app's name, icon, colours or package settings.

What's in this folder:

- `twa-manifest.json`: the app's settings for Bubblewrap (package name, website, icons, colours).
- `store-listing.md`: the words, content rating and Data safety answers to paste into Play Console.
- This file: the steps, in order.

The package name is **`io.github.tecspypie.hamshack`**. It can never be changed once the app is on Play, so if
you want a different one, change it now in `twa-manifest.json` (and the default in `server.js` and
`desktop/assetlinks.go`, or set `ANDROID_PACKAGE` on the website).

What works in the app: spots, maps, bands, space weather, satellites, POTA, the decoders (with the phone's
microphone), the logbook, QRZ lookups and the chat. What doesn't: radio control over USB, transmitting, the
RTL-SDR and ClearRX. Those need a PC, and HamShack already says so in plain words where they appear.

---

## 1. Make a Google Play developer account

1. Go to https://play.google.com/console/signup and sign in with the Google account you want to own the app.
2. Choose **Yourself** (a personal account). Pay the one-off registration fee (US$25).
3. Google asks for ID to check who you are, and a contact email and phone number. This can take a few days.
4. Have an Android phone handy: Google asks you to sign in to the Play Console app on it to prove you have one.

Personal accounts made after November 2023 must run a **closed test with at least 12 testers for 14 days in a
row** before the app can go on general sale. Steps 9 and 10 cover that.

## 2. Make your upload key, on your own PC

The upload key proves that a new build really comes from you. **Only you keep it.** It isn't the key the app is
finally signed with: Google keeps that one (Play App Signing), so if you ever lose the upload key, Google can
give you a new one.

You need Java's `keytool`. It comes with any Java 17 (for example the free Temurin 17 from
https://adoptium.net). Then, in a Command Prompt or terminal:

    keytool -genkeypair -v -keystore upload-key.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000

- Choose a strong password made of **letters and numbers only** (no spaces, quotes or `$`, which upset the
  build). Use the same password when it asks for the key's password, or note both.
- It asks for your name and so on: what you type goes inside the key. A callsign is fine.
- Keep `upload-key.jks` and the password somewhere safe and backed up (a password manager is ideal).
- **Never** put the key in the repository, an email or a chat.

## 3. Add four GitHub secrets

The build reads the key from the repository's secrets. Nobody can read a secret back, not even you.

1. Turn the key into text. On Windows (PowerShell, in the folder with the key):

       [Convert]::ToBase64String([IO.File]::ReadAllBytes("upload-key.jks")) | Set-Clipboard

   On Linux or a Mac: `base64 -w0 upload-key.jks` (on a Mac: `base64 -i upload-key.jks`) and copy what it prints.
2. On GitHub: the repository > **Settings > Secrets and variables > Actions > New repository secret**. Add:

   | Name | Value |
   |---|---|
   | `ANDROID_UPLOAD_KEYSTORE_BASE64` | the text you just copied |
   | `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_UPLOAD_KEY_PASSWORD` | the key password (often the same) |
   | `ANDROID_UPLOAD_KEY_ALIAS` | `upload` (or whatever you typed after `-alias`) |

3. Clear your clipboard afterwards.

## 4. Build the app

1. On GitHub: **Actions > Android app (Play Store) > Run workflow**.
2. **Version code:** type `1` the first time. Every build you upload to Play needs a higher number than the
   last one (2, 3, 4...). The version name shown to people is HamShack's own version from `package.json`.
3. Press **Run workflow** and wait (about 10 minutes). The website must be up, because the icons are fetched
   from it.
4. When it's green, open the run and download **hamshack-android-1** at the bottom. Unzip it: inside is
   `app-release-bundle.aab`. That's the file for Play.

The workflow only builds: it never makes a release, pushes code or touches `main`.

## 5. Create the app in Play Console

1. Play Console > **Create app**. Name: `HamShack by M0GLP & M3VRV`. App. Free. Tick the declarations.
2. Work through **Dashboard > Set up your app** using `store-listing.md`: privacy policy
   (https://band-watch.ample.run/privacy), app access (all of it works without signing in), ads (none),
   content rating, target audience, Data safety, and the store listing words and pictures.

## 6. Upload the .aab to a closed test

1. **Test and release > Testing > Closed testing > Create track** (or use the ready-made "Alpha" track).
2. **Create new release**. The first time, Play asks about app signing: accept **Play App Signing**
   (recommended). Play then signs the app for you; your upload key just proves the uploads are yours.
3. Upload `app-release-bundle.aab`, give the release a name (e.g. `1.45.0 (1)`), and save.
4. Under **Testers**, create an email list of your testers (step 9) and copy the opt-in link.
5. **Countries:** choose where the test is available. Send the release for review.

## 7. Get Play's signing fingerprint

1. Play Console > **Test and release > App integrity > App signing** (in some menus it is under **Setup**).
2. Copy the **SHA-256 certificate fingerprint** under **App signing key certificate** (it looks like
   `AB:CD:12:...`, 32 pairs). Also copy the one under **Upload key certificate**: adding both means a build
   you install yourself also opens without an address bar.

## 8. Tell the website about the app

The website proves it belongs to the app at `https://band-watch.ample.run/.well-known/assetlinks.json`. Until
this is set, that address answers "not found" and the app shows a small address bar at the top.

1. Where the website runs (its environment variables, in the hosting dashboard), add:

       ANDROID_CERT_SHA256=<the App signing SHA-256>,<the Upload key SHA-256>

   (comma-separated, no spaces needed). Only if you changed the package name, also add
   `ANDROID_PACKAGE=<your package name>`.
2. Restart or redeploy the website.
3. Open https://band-watch.ample.run/.well-known/assetlinks.json: it should show your package name and the
   fingerprints. Google's checker:
   https://developers.google.com/digital-asset-links/tools/generator (enter the site, package and fingerprint).
4. On a phone with the test app installed, open it: there should be no address bar. (If there still is,
   clear the app's storage or reinstall it once; Android checks the link when the app is installed.)

The Windows app reads the same settings but has no need of them.

## 9. Find 12 or more testers for 14 days

- You need **at least 12 people opted in to the closed test for 14 days in a row**. Aim for 15 to 20, so one or
  two dropping out doesn't restart the clock.
- Good places to ask: your local radio club, the HamShack chat, amateur radio groups and forums. Each tester
  needs a Google account on an Android device.
- Send them the opt-in link from step 6. They tap **Become a tester**, then install HamShack from the Play
  link on that page. They must stay opted in for the whole 14 days.
- Ask them to really use it and send feedback (Play has a private feedback box for testers). Google asks
  about this when you apply.
- Fix anything they find on the website as normal: it shows in the app at once. If you change
  `twa-manifest.json`, build again with a higher version code and upload it to the same closed track.

## 10. Apply for production

1. After 14 days with 12+ testers, Play Console's **Dashboard** shows **Apply for production**.
2. Answer the questions about the test (who tested, what you learnt, what you changed) honestly and briefly.
3. Google reviews it (usually up to 7 days). When approved: **Production > Create new release**, promote the
   tested release (or upload a new .aab with a higher version code), choose countries, and send for review.

## Later updates

- **Website changes:** nothing to do. The app always shows the live site.
- **New app build** (name, icon, colours, Bubblewrap update): run the workflow again with the next version
  code, upload the .aab to a test track, then promote it to production.
- **Bubblewrap version:** the workflow pins `@bubblewrap/cli@1.28.0`. When updating it, check which Android
  build-tools version it needs and change `BUILD_TOOLS` in `.github/workflows/android.yml` to match.
