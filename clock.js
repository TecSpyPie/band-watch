// A clock that tests can move forward (only through the BW_TEST hooks), so cache expiry can be tested.
"use strict";
let offset = 0;
module.exports = {
  now: () => Date.now() + offset,
  advance: (ms) => { offset += ms; },
  resetClock: () => { offset = 0; },
};
