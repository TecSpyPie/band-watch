# Code signing policy

Band Watch's Windows files (BandWatch.exe and BandWatch-Setup.exe) are built by GitHub Actions
from this public repository, from a tagged commit, by the workflow in
`.github/workflows/release.yml`. Nothing is built or signed on anyone's own PC.

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).
*(Applied for: until SignPath Foundation approves the project, releases are unsigned and
Windows shows a SmartScreen warning.)*

## Team roles

- Committers and reviewers: [M3vrv](https://github.com/TecSpyPie) (the repository owner)
- Approvers: [M3vrv](https://github.com/TecSpyPie)

Every release is approved by hand in SignPath before it is signed.

## Privacy

Band Watch runs on your own PC and sends nothing about you to the Band Watch author.
It fetches public data: spots from PSK Reporter (for the grid square you choose) and
solar and space-weather data from NOAA. If you sign in to QRZ.com, your QRZ username
and password go only to QRZ.com and the password is never stored. The RTL-SDR
receiver connects only to rtl_tcp on your own PC or home network. Settings are kept
in your web browser.

This program will not transfer any information to other networked systems unless
specifically requested by the user or the person installing or operating it.
