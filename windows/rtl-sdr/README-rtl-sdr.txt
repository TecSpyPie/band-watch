rtl_tcp for Band Watch
======================

Band Watch includes these files so "Listen > My RTL-SDR" works straight away with
an RTL-SDR dongle (including the RTL-SDR Blog V4):

  rtl_tcp.exe, rtlsdr.dll, pthreadVC2.dll   from rtl-sdr (RTL-SDR Blog version)
  msvcr100.dll                              Microsoft Visual C++ 2010 runtime,
                                            shipped with the same driver release

They are the unchanged 64-bit files from the RTL-SDR Blog driver release V1.4.0:
  https://github.com/rtlsdrblog/rtl-sdr-blog/releases/tag/V1.4.0

rtl-sdr is free software by the Osmocom rtl-sdr authors (Steve Markgraf,
Dimitri Stolnikov, Hoernchen, Kyle Keen and others) and RTL-SDR Blog, released
under the GNU General Public License, version 2 or later. Its licence is in
COPYING-rtl-sdr.txt next to this file. Its complete source code for this version is at:
  https://github.com/rtlsdrblog/rtl-sdr-blog/tree/V1.4.0
and a copy is attached to each Band Watch release on GitHub as
rtl-sdr-blog-V1.4.0-source.tar.gz:
  https://github.com/TecSpyPie/band-watch/releases

Band Watch itself is a separate program under the MIT licence (LICENSE). It
runs rtl_tcp.exe as its own process when you press Listen.

Windows still needs the dongle's USB driver set once with Zadig, as for any
RTL-SDR program: see the Quick Start Guide on https://www.rtl-sdr.com.
