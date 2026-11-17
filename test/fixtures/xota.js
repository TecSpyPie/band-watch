"use strict";
// Pretend POTA and SOTA feeds, in the shape api.pota.app and api2.sota.org.uk use. Times are UTC without a zone.
const ago = (min) => new Date(Date.now() - min * 60000).toISOString().slice(0, 19);

function potaRows() {
  return [
    { spotId: 1, activator: "g0abc", frequency: "14244", mode: "SSB", reference: "GB-0123", parkName: "Peak District National Park",
      spotTime: ago(3), spotter: "M0XYZ", comments: "59 in IO93", source: "Web", locationDesc: "GB-ENG", grid4: "IO93", grid6: "IO93ah",
      latitude: 53.3, longitude: -1.8, count: 4 },
    { spotId: 2, activator: "N0POTA", frequency: "7074", mode: "FT8", reference: "US-0001", parkName: "Acadia National Park",
      spotTime: ago(9), spotter: "K1ABC", comments: "", locationDesc: "US-ME", grid4: "FN54", grid6: "FN54vh", latitude: 44.35, longitude: -68.21 },
    { spotId: 3, activator: "<script>", frequency: "14000", mode: "CW", reference: "X", spotTime: ago(1) }, // junk: dropped
    { spotId: 4, activator: "EA0TEST", frequency: "nope", mode: "CW", reference: "EA-0002", spotTime: ago(2) }, // no frequency: dropped
  ];
}

function sotaRows() {
  return [
    { id: 11, timeStamp: ago(5), callsign: "M0SPOT", activatorCallsign: "gw0sum", associationCode: "GW", summitCode: "NW-001",
      summitDetails: "Yr Wyddfa, 1085m, 10 Points", frequency: "10.118", mode: "cw", comments: "QRV now" },
  ];
}

module.exports = { potaRows, sotaRows };
