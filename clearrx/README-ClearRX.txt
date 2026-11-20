ClearRX by M3VRV & King Coder - radio audio processor (version 1.3.0)

Install
  1. Unzip this folder somewhere to keep it, for example C:\BandWatch\ClearRX
  2. Double-click ClearRX.exe. It opens in a window of its own.
  3. For a desktop icon: right-click ClearRX.exe > Show more options >
     Send to > Desktop (create shortcut).

Use
  - My radio: pick RTL-SDR, Yaesu, Icom, ATS Mini, Malahit or Other / mixer.
    ClearRX finds that radio's sound input, sets a good starting preset and
    shows a tip for it.
  - Sound from: your radio's USB Audio CODEC, the PC's line-in, a mixer or a sound card.
  - Play to: your speakers or headphones (not the radio's USB sound).
  - Press Start (allow the sound input the first time), then pick a preset:
    SSB voice, Weak DX, CW, AM broadcast, or Off. A preset sets the modules below
    (and the graphic EQ's curve).
  - The effects rack: each stage is a module card with an on/off switch, its
    controls, a Reset button and up/down arrows. The sound goes through the modules
    from the top to the bottom, so the order matters: use the arrows to move a
    module (the sound fades for a moment, so there is no click), or "Default
    order" to put them all back. The modules, in the usual order:
      Noise blanker (clicks and crackles), Band-pass filter (low cut and high cut,
      for example 300-2700 Hz for SSB or 400-800 Hz for CW), CW peak filter,
      Manual notch (a whistle you choose), Auto notch, Hiss remover (see below),
      Noise reduction, Squelch
      (quiet between signals; it listens where it sits, so put it before the
      compressors), Steady volume (AGC speed), Graphic EQ, Bass and treble,
      Compressor / limiter.
  - Hiss remover: takes out steady hiss and band noise, and leaves voices alone.
    Strength (6 to 30 dB) is how far the noise goes down. By itself it follows the
    noise as it changes. For the best result, tune to an empty bit of the band (just
    the hiss, nobody talking), press "Learn noise" and wait 1.5 seconds: it learns that
    hiss and takes it out from then on, even after ClearRX restarts. "Forget it" goes
    back to following the noise by itself. It makes the sound about 11 ms late.
  - Graphic EQ: ten sliders, 100 Hz to 5 kHz, up or down 12 dB. Pick Flat, SSB
    punch, Weak DX, CW or AM warm, or drag the sliders (arrow keys work too).
    Reset puts it flat. Above the sliders is a 3D spectrum scope: pitch from left to
    right, time from the front (now) to the back (a few seconds ago), loudness as
    height, with the EQ's curve glowing along the front edge. Before / After shows the
    sound going in or coming out. "3D scope" switches it off (it uses some of the
    computer's power); it pauses by itself when hidden or scrolled out of view.
  - Compressor / limiter: threshold, ratio and make-up gain, with a gain-reduction
    meter. The limiter keeps the sound under -1 dB so it never clips.
  - Output meter (bottom): how loud the sound going out is. CLIP lights, with a
    warning, when it is at its limit: turn the Volume down or switch on the
    compressor / limiter.
  - Your own changes make the preset "Custom". Everything, including the order, is
    kept for next time.
  - While ClearRX is open, Band Watch's Listen shows "Send my RTL-SDR sound
    through ClearRX".
  - Settings are kept in clearrx-settings.json next to ClearRX.exe.
  - Close it with "Close ClearRX" at the bottom of its window.

If Windows or your virus checker blocks ClearRX.exe: it isn't signed yet, and
new unsigned programs are sometimes flagged by mistake. Band Watch works
without it. Source code: https://github.com/TecSpyPie/band-watch (clearrx folder).
