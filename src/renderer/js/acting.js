// Pose-to-pose acting, timed the way cel animation is: an act is an exposure sheet,
// a list of drawings, each held for a number of frames. Nothing is tweened. A move is
// a couple of key drawings, an anticipation the other way, sometimes a smear frame, and holds.
//
// Pose fields (anything left out falls back to the stance underneath):
//   head    head tilt, radians, sprite space       mane   mane flare, + bristles, - settles
//   hair    mane sway, px                          tilt   whole-body lean, degrees, screen
//   bob     vertical offset, px, - is up           sx/sy  squash & stretch (sx < 0 mirrors her)
//   arms    both arms, radians, + raises them      armL / armR   one arm each
//   reach   in directional acts: the arm on the side the act aims at (x the act's reach,
//           a number or a function for a moving target)
//   long    that same arm drawn longer than it is, 1 = as drawn (longL / longR for one arm)
//   smear   [x, y] trail of head multiples, px     echo   [x, y] green/red afterimages, px
//   kickL / kickR   lower legs swinging outward, radians (when sitting)
//   wall    the Blackwall showing through around her, 0-1   phase   columns of her slipping, 0-1
//
// A key can carry a cue as third item: capri.js fires effects and sounds when it's reached.
// Directional acts are drawn leaning to screen-right; played with dir -1 they're mirrored.

export const SHEET_FPS = 12;

const rep = (n, keys) => Array.from({ length: n }, () => keys).flat();

export const NEUTRAL = {
  head: 0, mane: 0, hair: 0, tilt: 0, bob: 0, sx: 1, sy: 1, armL: 0, armR: 0, longL: 1, longR: 1,
  smear: [0, 0], echo: [0, 0], kickL: 0, kickR: 0, wall: 0, phase: 0,
};

export const ACTS = {
  // ---- stances (looping) ----

  // floating: four drawings; the arms lag behind the body (down when she rises, up when she sinks)
  stand: {
    loop: true,
    keys: [
      [6, { bob: 0, hair: -2.5, arms: 0.04 }],
      [4, { bob: -2, hair: 0, arms: 0 }],
      [6, { bob: -4, hair: 2.5, arms: -0.05 }],
      [4, { bob: -2, hair: 0, arms: 0 }],
    ],
  },

  // perched on a window, hands down on the ledge, legs kicking one after the other
  sit: {
    loop: true,
    keys: [
      [5, { kickL: 0.24, kickR: -0.03, hair: -1.5, arms: -0.42 }],
      [2, { kickL: 0.08, kickR: 0.08, arms: -0.42 }],
      [5, { kickL: -0.03, kickR: 0.24, hair: 1.5, arms: -0.42 }],
      [2, { kickL: 0.08, kickR: 0.08, arms: -0.42 }],
      [5, { kickL: 0.24, kickR: -0.03, hair: -1.5, arms: -0.42 }],
      [2, { kickL: 0.08, kickR: 0.08, arms: -0.42 }],
      [5, { kickL: -0.03, kickR: 0.24, hair: 1.5, arms: -0.42 }],
      [10, { kickL: 0.04, kickR: 0.04, head: 0.08, arms: -0.4 }], // a pause, head cocked
    ],
  },

  // leaning in from the edge of the screen, toward the middle
  peek: {
    loop: true,
    directional: true,
    keys: [
      [18, { tilt: 7, head: 0.14, reach: 0.1 }],
      [1, { tilt: 7, head: 0.2, smear: [-6, 0], reach: 0.16 }],
      [14, { tilt: 7.5, head: 0.24, mane: 0.08, reach: 0.18 }],
      [1, { tilt: 6, head: 0.14, reach: 0.12 }],
      [12, { tilt: 6.5, head: 0.12, bob: -2, reach: 0.1 }],
    ],
  },

  // asleep: arms hanging, head dropped; every so often it falls a bit further and she jolts awake
  sleep: {
    loop: true,
    keys: [
      [18, { head: 0.1, mane: -0.12, bob: 2, arms: -0.3 }],
      [1, { head: 0.16, mane: -0.13, bob: 4, arms: -0.34 }],
      [10, { head: 0.21, mane: -0.15, bob: 5, arms: -0.36 }],
      [1, { head: 0.06, mane: -0.08, bob: 0, smear: [0, 8], arms: -0.18 }], // jolt
      [4, { head: 0.08, mane: -0.1, bob: 1, arms: -0.26 }],
    ],
  },

  // ---- one-shot acts ----

  // little nods while the words come out, two drawings on threes
  talk: { priority: 0, keys: rep(2, [[3, { head: 0.04, mane: 0.08 }], [3, { head: 0, mane: 0.03 }]]) },

  // the cocked head: anticipation the other way, a smear, then a long hold
  curious: {
    priority: 1,
    directional: true,
    keys: [
      [1, { head: -0.05, mane: 0.04 }],
      [1, { head: 0.12, mane: 0.15, tilt: 1, smear: [-12, 4] }],
      [10, { head: 0.19, mane: 0.14, tilt: 2 }],
      [6, { head: 0.16, mane: 0.1, tilt: 1.6 }],
      [1, { head: 0.07, tilt: 0.6 }],
    ],
  },

  // head snapping from one side to the other, held each time
  look: {
    priority: 1,
    keys: [
      [1, { head: 0.08, smear: [-8, 0] }],
      [8, { head: 0.16 }],
      [1, { head: 0 }],
      [1, { head: -0.08, smear: [8, 0] }],
      [8, { head: -0.16 }],
      [1, { head: -0.05 }],
      [3, { head: 0 }],
    ],
  },

  // The satellite, the quiet way: a glint, a beat, she notices and snaps to it, her specks
  // catch its light, she reaches for it (slow-in: the drawings bunch up as the hand gets there)
  // and holds. It twinkles back. Her hand drops with a sigh.
  gaze: {
    priority: 1,
    directional: true,
    keys: [
      [3, {}, 'glint'],
      [1, { head: -0.05, bob: 1 }],
      [1, { head: 0.14, mane: 0.12, smear: [-8, 6] }, 'notice'],
      [6, { head: 0.2, mane: 0.1, hair: 0, bob: 0 }],
      [6, { head: 0.23, mane: 0.14, hair: 0, bob: 0 }, 'starlight'],
      [3, { head: 0.23, mane: 0.15, hair: 0, bob: 0, reach: 0.25, long: 1.1 }],
      [3, { head: 0.24, mane: 0.16, hair: 0, bob: 0, reach: 0.55, long: 1.2 }],
      [2, { head: 0.24, mane: 0.16, hair: 0, bob: -1, reach: 0.8, long: 1.3 }],
      [2, { head: 0.25, mane: 0.17, hair: 0, bob: -2, reach: 0.93, long: 1.35 }],
      [14, { head: 0.25, mane: 0.17, hair: 0, bob: -3, reach: 1, long: 1.38 }],
      [1, { head: 0.27, mane: 0.22, hair: 0, bob: -4, reach: 1.02, long: 1.42 }, 'glimmer'],
      [8, { head: 0.25, mane: 0.18, hair: 0, bob: -3, reach: 1, long: 1.38 }],
      [2, { head: 0.14, mane: 0.1, bob: -2, reach: 0.45, long: 1.15 }],
      [2, { head: 0.08, mane: 0.04, bob: -1, reach: 0.12, long: 1.03 }],
      [8, { head: 0.06, mane: -0.04, reach: -0.06 }], // a sigh
      [1, {}],
    ],
  },

  // The satellite, the whole way, after the season's ending: "could we make it up there?"
  // I.   Hush. The glint; her float stops dead and the white specks of her mane lift off,
  //      hanging over her like a sky of her own, linked up like a constellation.
  // II.  She snaps to it and reaches; her stars line up into a road from her fingers to it.
  // III. Anticipation: she sinks and coils, the mane bristles, sparks crawl out of her hand,
  //      cut-in on her eyes.
  // IV.  The red light goes up the road, she's lifted with it, it hits the satellite.
  // V.   It snaps and falls apart. Silence. Then the satellite twinkles back, twice.
  //      Her stars come home and her hand drops.
  uplink: {
    priority: 1,
    directional: true,
    keys: [
      [2, { hair: 0, bob: -2 }, 'glint'],
      [3, { hair: 0, bob: -2 }, 'stars'],
      [3, { hair: 0, bob: -2, mane: 0.05 }],
      [4, { hair: 0, bob: -2, mane: 0.1, head: 0.03 }],
      [1, { hair: 0, bob: -1, head: -0.06 }],
      [1, { hair: 0, bob: -2, head: 0.16, mane: 0.16, smear: [-8, 6] }, 'notice'],
      [5, { hair: 0, bob: -2, head: 0.22, mane: 0.14 }],
      [3, { hair: 0, bob: -2, head: 0.23, mane: 0.15, reach: 0.3, long: 1.15 }],
      [3, { hair: 0, bob: -2, head: 0.24, mane: 0.16, reach: 0.6, long: 1.3 }, 'align'],
      [2, { hair: 0, bob: -3, head: 0.25, mane: 0.17, reach: 0.85, long: 1.42 }],
      [2, { hair: 0, bob: -4, head: 0.25, mane: 0.18, reach: 0.96, long: 1.5 }],
      [9, { hair: 0, bob: -5, head: 0.25, mane: 0.18, reach: 1, long: 1.52 }],
      // the arm pulls back a little as she coils, then shoots out
      [1, { hair: 0, bob: 1, head: 0.24, mane: 0.26, reach: 0.98, long: 1.45, sy: 0.95, sx: 1.03 }, 'charge'],
      [2, { hair: 0, bob: 3, head: 0.23, mane: 0.32, reach: 0.98, long: 1.42, sy: 0.93, sx: 1.04 }],
      [2, { hair: 0, bob: 4, head: 0.23, mane: 0.38, reach: 0.99, long: 1.4, sy: 0.92, sx: 1.05 }],
      [2, { hair: 0, bob: 5, head: 0.22, mane: 0.44, reach: 1, long: 1.4, sy: 0.91, sx: 1.06, echo: [2, 0] }],
      [1, { hair: 0, bob: -10, head: 0.3, mane: 0.7, reach: 1.05, long: 1.78, sy: 1.14, sx: 0.9, echo: [10, -4], smear: [0, 14] }, 'surge'],
      [1, { hair: 0, bob: -16, head: 0.31, mane: 0.86, reach: 1.06, long: 1.7, sy: 1.06, sx: 0.96, echo: [16, -6] }],
      [2, { hair: 0, bob: -19, head: 0.3, mane: 0.8, reach: 1.06, long: 1.66, echo: [9, -3] }],
      [2, { hair: 0, bob: -19, head: 0.28, mane: 0.74, reach: 1.06, long: 1.62, echo: [4, -1] }],
      [5, { hair: 0, bob: -18, head: 0.28, mane: 0.62, reach: 1.05, long: 1.6 }],
      [1, { hair: 0, bob: -15, head: 0.27, mane: 0.5, reach: 1.03, long: 1.55, smear: [0, -8] }, 'break'],
      [7, { hair: 0, bob: -13, head: 0.26, mane: 0.36, reach: 1.02, long: 1.52 }],
      [1, { hair: 0, bob: -13, head: 0.29, mane: 0.4, reach: 1.03, long: 1.54 }, 'twinkle'],
      [4, { hair: 0, bob: -12, head: 0.28, mane: 0.32, reach: 1.02, long: 1.52 }],
      [1, { hair: 0, bob: -12, head: 0.29, mane: 0.34, reach: 1.02, long: 1.53 }, 'glimmer'],
      [7, { hair: 0, bob: -11, head: 0.27, mane: 0.28, reach: 1, long: 1.5 }],
      [2, { bob: -7, head: 0.2, mane: 0.2, reach: 0.7, long: 1.3 }, 'home'],
      [2, { bob: -4, head: 0.14, mane: 0.12, reach: 0.4, long: 1.12 }],
      [2, { bob: -1, head: 0.08, mane: 0.04, reach: 0.12, long: 1.03 }],
      [10, { bob: 1, head: 0.06, mane: -0.06, reach: -0.06 }], // a sigh
      [1, {}],
    ],
  },

  // Job done. Wind-up with the mane pulled in, a stretched smear frame, then the key pose:
  // arms flung up, mane exploding, held while the lines hit. She laughs, head shaking every
  // other drawing, then drops back down with a squash and a small overshoot. She only talks
  // (the "done" panel) once she's coming down, so nothing covers the key pose.
  victory: {
    priority: 4, // nothing cuts this one off
    fps: 24,
    directional: true,
    keys: [
      [3, { sy: 0.9, sx: 1.05, bob: 6, arms: -0.3, mane: -0.15 }],
      [3, { sy: 0.82, sx: 1.1, bob: 10, arms: -0.5, mane: -0.3, head: -0.04 }, 'gather'],
      [1, { sy: 1.24, sx: 0.85, bob: -16, arms: 0.55, mane: 0.45, smear: [0, 22], echo: [12, 0] }, 'launch'],
      [2, { sy: 1.1, sx: 0.94, bob: -30, arms: 1.45, mane: 0.85, echo: [20, -4] }, 'peak'],
      [10, { bob: -36, arms: 1.32, mane: 0.78, head: 0.05 }],
      [2, { bob: -34, arms: 1.18, mane: 0.7, head: -0.08 }, 'laugh'],
      [2, { bob: -38, arms: 1.36, mane: 0.8, head: 0.08 }],
      ...rep(4, [[2, { bob: -34, arms: 1.18, mane: 0.7, head: -0.08 }], [2, { bob: -38, arms: 1.36, mane: 0.8, head: 0.08 }]]),
      [2, { bob: -24, arms: 0.7, mane: 0.45, sy: 1.04 }, 'speak'],
      [2, { bob: -8, arms: 0.15, mane: 0.2, sy: 1.06, sx: 0.96, smear: [0, -12] }],
      [2, { bob: 3, arms: -0.15, mane: -0.06, sy: 0.88, sx: 1.08 }],
      [3, { bob: 1, arms: 0.05, sy: 0.97, sx: 1.02 }],
      [2, { arms: 0 }],
    ],
  },

  // The menace: arm pulled in, then jabbed at your pointer with a jolt of red lightning,
  // held while she grins, and dropped.
  zap: {
    priority: 2,
    fps: 24,
    directional: true,
    keys: [
      [3, { reach: 0.2, long: 0.9, head: -0.06, mane: 0.1, bob: 1 }],
      [1, { reach: 1, long: 1.6, head: 0.12, mane: 0.32, smear: [-10, 0], echo: [6, 0] }, 'zap'],
      [6, { reach: 1, long: 1.52, head: 0.14, mane: 0.26 }],
      [4, { reach: 0.96, long: 1.42, head: 0.18, mane: 0.2 }, 'grin'],
      [10, { reach: 0.9, long: 1.36, head: 0.2, mane: 0.16 }],
      [3, { reach: 0.5, long: 1.15, head: 0.14, mane: 0.08 }],
      [3, { reach: 0.15, head: 0.06 }],
      [1, {}],
    ],
  },

  // Showing you something, the way she'd do it in the show. Her head snaps to it, she coils
  // up leaning away with the arm cocked back behind her, then strikes: one stretched drawing
  // where her construct arm shoots out to more than twice its length, red lightning off the
  // fingertip and the reticle slamming onto it ('lock'). The arm recoils, overshoots, settles.
  point: {
    priority: 2,
    fps: 24,
    directional: true,
    keys: [
      [2, { head: 0.16, mane: 0.15, tilt: 1, smear: [-10, 2] }, 'spot'],
      [3, { head: 0.2, mane: 0.12, tilt: 1.5 }],
      [3, { reach: -0.45, long: 0.8, head: 0.12, tilt: -5, sy: 0.9, sx: 1.06, bob: 5, mane: -0.2 }],
      [2, { reach: -0.55, long: 0.75, head: 0.1, tilt: -6, sy: 0.86, sx: 1.08, bob: 7, mane: -0.28 }, 'coil'],
      [1, { reach: 0.9, long: 2.3, head: 0.24, tilt: 8, sx: 0.94, sy: 1.1, mane: 0.6, smear: [-18, 0], echo: [14, 0] }, 'lock'],
      [1, { reach: 1.08, long: 2, head: 0.22, tilt: 7, mane: 0.55, echo: [8, 0] }],
      [2, { reach: 1.02, long: 1.42, head: 0.19, tilt: 4, mane: 0.4 }],
      [2, { reach: 0.98, long: 1.58, head: 0.18, tilt: 3, mane: 0.3 }],
      [2, { reach: 1, long: 1.5, head: 0.17, tilt: 3, mane: 0.22 }],
    ],
  },

  // ...and held while she explains, leaning in: a jab at it now and then (two taps, like on a
  // screen), and a glance back at you before her eyes go back to it. A stance: it lasts until
  // the guide moves on.
  pointing: {
    loop: true,
    directional: true,
    keys: [
      [12, { reach: 1, long: 1.5, head: 0.17, mane: 0.16, tilt: 3 }],
      [1, { reach: 1.05, long: 1.8, head: 0.2, mane: 0.24, tilt: 4 }, 'tap'],
      [2, { reach: 1, long: 1.52, head: 0.18, mane: 0.18, tilt: 3 }],
      [1, { reach: 1.05, long: 1.8, head: 0.2, mane: 0.24, tilt: 4 }, 'tap'],
      [10, { reach: 1, long: 1.5, head: 0.17, mane: 0.16, tilt: 3, bob: -2 }],
      [1, { reach: 1, long: 1.5, head: 0.02, mane: 0.12, tilt: 2, smear: [10, 0] }],
      [8, { reach: 1, long: 1.5, head: -0.1, mane: 0.1, tilt: 2 }],
      [1, { reach: 1, long: 1.5, head: 0.12, mane: 0.16, tilt: 3, smear: [-10, 0] }],
      [8, { reach: 1, long: 1.5, head: 0.17, mane: 0.16, tilt: 3, bob: -1 }],
    ],
  },

  // Done showing: the line reels back into her finger and the arm is snapped back in.
  unpoint: {
    priority: 2,
    fps: 24,
    directional: true,
    keys: [
      [1, { reach: 0.6, long: 0.9, head: 0.08, tilt: -2, smear: [12, 0], mane: 0.1 }],
      [2, { reach: 0.1, long: 0.85, head: 0.04, tilt: -1 }],
      [2, { reach: -0.06, long: 1, tilt: 0 }],
      [1, {}],
    ],
  },

  // Folding herself away into her biochip: a little cock of the head at you, then the mane
  // and the arms pulled in tight, crouching small.
  fold: {
    priority: 3,
    fps: 24,
    keys: [
      [4, { head: 0.12, mane: 0.12 }],
      [2, { head: 0.06, mane: -0.18, arms: -0.5, sy: 0.93, sx: 1.04 }],
      [3, { mane: -0.36, arms: -0.72, sy: 0.84, sx: 1.08, bob: 4 }],
    ],
  },

  // Before she dives into the window she sits on: head cocked at it, the legs swing up, she
  // coils with the mane pulled in and the arms tucked, then stretches down into it.
  dive: {
    priority: 3,
    keys: [
      [1, { head: -0.05 }],
      [5, { head: 0.18, mane: 0.1, kickL: 0.1, kickR: 0.1 }],
      [2, { head: 0.22, mane: -0.15, sy: 0.9, sx: 1.06, kickL: 0.34, kickR: 0.34, arms: -0.6 }],
      [1, { head: 0.1, mane: -0.28, sy: 1.16, sx: 0.88, smear: [0, -14], arms: -0.7 }],
    ],
  },

  // The other minds in her: her green and red copies pull away from her, hang there
  // flickering, and snap back in.
  split: {
    priority: 3,
    fps: 24,
    keys: [
      [2, { echo: [3, 0], mane: 0.1 }],
      [2, { echo: [10, -2], mane: 0.18, head: 0.05 }],
      [2, { echo: [22, -4], mane: 0.22, head: -0.06 }, 'minds'],
      [6, { echo: [34, -5], mane: 0.24, head: 0.06, bob: -3 }],
      [2, { echo: [41, -6], mane: 0.26, head: -0.05, bob: -3 }],
      [6, { echo: [36, -5], mane: 0.24, head: 0.07, bob: -3 }],
      [1, { echo: [12, 0], sx: 1.08, sy: 0.94, bob: -1 }, 'snap'],
      [1, { sx: 0.96, sy: 1.04, mane: 0.3 }],
      [3, { mane: 0.1 }],
      [1, {}],
    ],
  },

  // bristling, flickering, arms flared, leaning toward you; she stares with all her eyes
  alarm: {
    priority: 2,
    directional: true,
    keys: [
      [1, { mane: 0.34, head: 0.1, tilt: 3, arms: 0.36 }, 'stare'],
      [1, { mane: 0.12, head: 0.1, tilt: 3, arms: 0.24 }],
      ...rep(14, [[1, { mane: 0.34, head: 0.1, tilt: 3, arms: 0.36 }], [1, { mane: 0.12, head: 0.1, tilt: 3, arms: 0.24 }]]),
    ],
  },

  // knocked back by a failure, arms snapped in
  flinch: {
    priority: 2,
    keys: [
      [2, { head: 0.22, tilt: 4, sx: 0.92, sy: 1.06, mane: -0.12, bob: 5, smear: [-10, 0], arms: -0.32 }],
      [5, { head: 0.18, tilt: 3.4, mane: -0.1, bob: 4, arms: -0.22 }],
      [1, { head: 0.09, tilt: 1.5, bob: 2, arms: -0.08 }],
    ],
  },

  // turnaround: the flat cut-out squashes to a sliver and comes back mirrored
  turn: {
    priority: 3,
    fps: 24,
    flip: true,
    keys: [
      [1, { sx: 0.7, sy: 1.02, echo: [6, 0], arms: -0.1 }],
      [1, { sx: 0.25, sy: 1.04, echo: [10, 0], mane: 0.2, arms: -0.2 }],
      [1, { sx: -0.25, sy: 1.04, echo: [10, 0], mane: 0.2, arms: -0.2 }],
      [1, { sx: -0.7, sy: 1.02, arms: -0.1 }],
      [2, { sx: -1, arms: 0.04 }],
    ],
  },

  // a full spin on ones, arms thrown out, afterimages flying
  spin: {
    priority: 3,
    fps: 24,
    keys: [
      [2, { sy: 0.92, sx: 1.05, bob: 3, arms: -0.2 }], // wind-up
      [1, { sx: 0.7, echo: [8, 0], mane: 0.25, arms: 0.15 }],
      [1, { sx: 0.2, echo: [14, 0], mane: 0.35, bob: -4, arms: 0.28 }],
      [1, { sx: -0.3, echo: [14, 0], mane: 0.35, bob: -6, arms: 0.3 }],
      [1, { sx: -0.75, echo: [10, 0], mane: 0.3, bob: -6, arms: 0.3 }],
      [1, { sx: -1, echo: [6, 0], bob: -6, arms: 0.28 }],
      [1, { sx: -0.75, echo: [10, 0], mane: 0.3, bob: -5, arms: 0.3 }],
      [1, { sx: -0.3, echo: [14, 0], mane: 0.35, bob: -4, arms: 0.3 }],
      [1, { sx: 0.2, echo: [14, 0], mane: 0.35, bob: -2, arms: 0.25 }],
      [1, { sx: 0.7, echo: [8, 0], mane: 0.25, arms: 0.15 }],
      [2, { sx: 1.06, sy: 0.95, mane: 0.15, arms: -0.06 }], // overshoot
      [1, { sx: 1 }],
    ],
  },

  // a hop in place: crouch, stretch, hang at the top with the arms up, squash on landing
  hop: {
    priority: 3,
    fps: 24,
    keys: [
      [3, { sy: 0.86, sx: 1.08, bob: 6, mane: -0.08, arms: -0.3 }],
      [1, { sy: 1.18, sx: 0.9, bob: -10, smear: [0, 16], arms: 0.4 }],
      [2, { sy: 1.08, sx: 0.95, bob: -32, mane: 0.15, arms: 0.55 }],
      [4, { bob: -42, mane: 0.3, arms: 0.6 }],
      [2, { sy: 1.06, bob: -26, mane: 0.2, arms: 0.35 }],
      [1, { sy: 1.12, sx: 0.92, bob: -8, smear: [0, -14], arms: 0.15 }],
      [2, { sy: 0.82, sx: 1.12, bob: 5, mane: -0.1, arms: -0.28 }],
      [2, { sy: 0.94, sx: 1.04, bob: 2, arms: 0.06 }],
      [1, {}],
    ],
  },

  // landing after a fall: the impact pushes the arms down, they bounce back past rest
  land: {
    priority: 3,
    fps: 24,
    keys: [
      [2, { sy: 0.72, sx: 1.22, bob: 6, mane: -0.22, arms: -0.4 }],
      [2, { sy: 0.88, sx: 1.08, bob: 3, mane: -0.1, arms: -0.15 }],
      [2, { sy: 1.05, sx: 0.97, mane: 0.1, arms: 0.1 }],
      [1, {}],
    ],
  },

  // plopping down on a window ledge
  plop: {
    priority: 3,
    fps: 24,
    keys: [
      [2, { sy: 0.85, sx: 1.1, mane: -0.12, kickL: 0.3, kickR: 0.3, arms: -0.55 }],
      [2, { sy: 1.05, sx: 0.97, kickL: 0.12, kickR: 0.12, arms: -0.38 }],
      [1, {}],
    ],
  },

  // while falling: stretched, mane blown up, arms flailing every other drawing
  fall: {
    loop: true,
    fps: 24,
    keys: [
      [2, { sy: 1.12, sx: 0.92, mane: 0.36, head: 0.05, smear: [0, -16], armL: 0.8, armR: 0.55 }],
      [2, { sy: 1.1, sx: 0.93, mane: 0.26, head: -0.04, smear: [0, -12], armL: 0.55, armR: 0.82 }],
    ],
  },

  // ---- thrown around (capri.js throwHer) ----

  // picked up: a jolt, arms flung up, the mane bristling, stretched for one drawing
  grabbed: {
    priority: 3,
    fps: 24,
    keys: [
      [1, { sy: 1.1, sx: 0.92, mane: 0.55, armL: 0.95, armR: 0.85, head: -0.06, smear: [0, 10] }],
      [2, { sy: 1.04, sx: 0.97, mane: 0.42, armL: 0.8, armR: 0.72, head: 0.04 }],
      [2, { mane: 0.3, armL: 0.62, armR: 0.5 }],
    ],
  },

  // held up by the pointer: dangling from where you grabbed her (she swings around it, capri.js),
  // legs kicking one after the other, arms up and out
  held: {
    loop: true,
    keys: [
      [3, { armL: 0.62, armR: 0.36, mane: 0.22, head: 0.06, kickL: 0.24, kickR: -0.06, hair: -1.5 }],
      [3, { armL: 0.4, armR: 0.6, mane: 0.17, head: -0.04, kickL: -0.06, kickR: 0.26, hair: 1.5 }],
    ],
  },

  // flying through the air: limbs flailing on ones (her spin, trail and mane come from capri.js)
  tumble: {
    loop: true,
    fps: 24,
    keys: [
      [2, { armL: 1.1, armR: 0.32, mane: 0.5, head: 0.12, kickL: 0.32, kickR: -0.08, sx: 0.95, sy: 1.06 }],
      [2, { armL: 0.38, armR: 1.15, mane: 0.42, head: -0.1, kickL: -0.08, kickR: 0.34, sx: 0.96, sy: 1.05 }],
    ],
  },

  // before she jumps over to another screen: she sinks, leaning toward it, arms pulled back
  crouch: {
    priority: 3,
    fps: 24,
    directional: true,
    keys: [
      [2, { sy: 0.92, sx: 1.04, bob: 3, mane: -0.08, armL: -0.25, armR: -0.25, head: 0.08, tilt: 2 }],
      [3, { sy: 0.82, sx: 1.1, bob: 7, mane: -0.24, armL: -0.5, armR: -0.5, head: 0.15, tilt: 4 }],
      [3, { sy: 0.78, sx: 1.13, bob: 9, mane: -0.3, armL: -0.56, armR: -0.56, head: 0.18, tilt: 5, echo: [2, 0] }],
    ],
  },

  // the jump itself: leading with her reaching arm, the other one back, legs tucked, mane streaming
  leap: {
    loop: true,
    fps: 24,
    directional: true,
    keys: [
      [3, { reach: 0.75, long: 1.25, mane: 0.42, head: 0.14, kickL: 0.36, kickR: 0.3, sy: 1.08, sx: 0.94 }],
      [3, { reach: 0.82, long: 1.3, mane: 0.5, head: 0.16, kickL: 0.3, kickR: 0.38, sy: 1.1, sx: 0.93 }],
    ],
  },

  // knocked down, lying on her side (capri.js turns her): limp, the mane flat, a leg twitching
  ko: {
    loop: true,
    keys: [
      [10, { armL: 0.34, armR: 0.1, mane: -0.18, head: 0.16, kickL: 0.2, kickR: 0.05 }],
      [1, { armL: 0.38, armR: 0.14, mane: -0.14, head: 0.22, kickL: 0.3, kickR: 0.06 }],
      [7, { armL: 0.34, armR: 0.1, mane: -0.18, head: 0.14, kickL: 0.18, kickR: 0.04 }],
    ],
  },

  // back on her feet after a crash: her head shaken hard both ways, then the mane flares the dust off
  shake: {
    priority: 3,
    fps: 24,
    keys: [
      [2, { head: 0.2, mane: 0.3, tilt: 2, smear: [-10, 0] }],
      [2, { head: -0.2, mane: 0.34, tilt: -2, smear: [10, 0] }],
      ...rep(2, [[2, { head: 0.16, mane: 0.3, tilt: 1.5 }], [2, { head: -0.16, mane: 0.32, tilt: -1.5 }]]),
      [1, { head: 0.04, mane: 0.6, sy: 1.05, sx: 0.97 }, 'dust'],
      [3, { head: 0, mane: 0.32 }],
      [4, { mane: 0.12 }],
      [1, {}],
    ],
  },

  // thrown, and down on her feet anyway: a deep crouch, a hand slammed down, a beat, then up
  touchdown: {
    priority: 3,
    fps: 24,
    keys: [
      [2, { sy: 0.62, sx: 1.3, bob: 8, mane: -0.32, armL: -0.95, armR: 0.28, head: 0.12, smear: [0, -12] }],
      [4, { sy: 0.7, sx: 1.22, bob: 7, mane: -0.22, armL: -0.9, armR: 0.22, head: 0.14 }],
      [6, { sy: 0.74, sx: 1.18, bob: 6, mane: -0.16, armL: -0.85, armR: 0.2, head: 0.1 }],
      [1, { sy: 1.12, sx: 0.92, bob: -6, mane: 0.36, armL: 0.2, armR: 0.3, smear: [0, 14] }],
      [2, { sy: 1.03, sx: 0.98, bob: -2, mane: 0.26 }],
      [3, { mane: 0.12 }],
      [1, {}],
    ],
  },

  // ---- your PC (pc.js) ----

  // overheating with your processor: head thrown back, fanning herself with one hand, heat coming
  // off her ('steam'), then a slump
  overheat: {
    priority: 2,
    keys: [
      [2, { head: -0.08, mane: 0.3, armL: -0.3, armR: 1.25, tilt: -1 }, 'steam'],
      [2, { head: -0.1, mane: 0.36, armL: -0.3, armR: 0.82, tilt: -1.5 }],
      ...rep(4, [[2, { head: -0.08, mane: 0.32, armL: -0.3, armR: 1.25, tilt: -1 }, 'steam'], [2, { head: -0.1, mane: 0.38, armL: -0.3, armR: 0.82, tilt: -1.5 }]]),
      [8, { head: 0.08, mane: 0.06, armL: -0.42, armR: -0.4, bob: 3 }],
      [1, {}],
    ],
  },

  // the battery running out: she sags, head down, arms hanging, mane flat
  drained: {
    priority: 2,
    keys: [
      [3, { head: 0.12, mane: -0.12, arms: -0.3, bob: 2 }],
      [14, { head: 0.24, mane: -0.26, arms: -0.55, bob: 6, sy: 0.96, sx: 1.02 }],
      [1, { head: 0.08, mane: -0.1, arms: -0.2, bob: 1, smear: [0, 8] }], // a start
      [10, { head: 0.2, mane: -0.22, arms: -0.5, bob: 5 }],
      [2, { head: 0.1, arms: -0.2 }],
      [1, {}],
    ],
  },

  // ---- idle: what she does with herself when nobody needs her (capri.js idle) ----

  // a stretch: arms up over the mane, up on her toes, a tremble at the top, dropped back past rest
  stretch: {
    priority: 1,
    keys: [
      [2, { arms: -0.12, bob: 2, sy: 0.96, sx: 1.03 }],
      [2, { arms: 0.5, bob: -4, sy: 1.05, sx: 0.97, mane: 0.1, head: -0.06 }],
      [3, { arms: 0.95, bob: -8, sy: 1.08, sx: 0.95, mane: 0.18, head: -0.1 }],
      [8, { arms: 1.05, bob: -9, sy: 1.09, sx: 0.95, mane: 0.2, head: -0.12 }],
      [1, { arms: 1.1, bob: -10, sy: 1.1, sx: 0.94, mane: 0.25, head: -0.13 }],
      [5, { arms: 1.05, bob: -9, sy: 1.09, sx: 0.95, mane: 0.2, head: -0.12 }],
      [2, { arms: 0.3, bob: -2, mane: 0.05 }],
      [2, { arms: -0.18, bob: 3, sy: 0.95, sx: 1.04, mane: -0.08 }],
      [3, { arms: -0.05, bob: 1 }],
      [1, {}],
    ],
  },

  // humming to herself: a lazy sway, the head going the other way, the mane swinging after it
  sway: {
    priority: 1,
    keys: [
      ...rep(2, [
        [4, { tilt: -2.4, head: 0.07, hair: -3, bob: -1, arms: 0.04 }],
        [2, { tilt: -1, head: 0.03, hair: -1, bob: -2 }],
        [4, { tilt: 2.4, head: -0.07, hair: 3, bob: -1, arms: 0.04 }],
        [2, { tilt: 1, head: -0.03, hair: 1, bob: -2 }],
      ]),
      [3, { head: 0.04, mane: 0.06 }],
      [1, {}],
    ],
  },

  // scanning the net: her head sweeps slowly one way then the other, and the Blackwall stirs
  scan: {
    priority: 1,
    directional: true,
    keys: [
      [2, { head: -0.04 }],
      [2, { head: -0.1, mane: 0.04, wall: 0.16 }],
      [3, { head: -0.16, mane: 0.06, wall: 0.24 }, 'notice'],
      [6, { head: -0.18, mane: 0.06, wall: 0.24 }],
      [2, { head: -0.08, wall: 0.18 }],
      [2, { head: 0.04, wall: 0.18 }],
      [2, { head: 0.12, mane: 0.05, wall: 0.22 }],
      [6, { head: 0.18, mane: 0.08, tilt: 1.5, wall: 0.28 }],
      [2, { head: 0.1, tilt: 0.6, wall: 0.14 }],
      [2, { head: 0.02 }],
      [1, {}],
    ],
  },

  // bored stiff: head tipped back, mane drooping, a slow sink, then a shake to snap out of it
  yawn: {
    priority: 1,
    keys: [
      [3, { head: -0.06, bob: 1 }],
      [4, { head: -0.16, mane: -0.08, bob: 2, arms: -0.12 }],
      [12, { head: -0.2, mane: -0.14, bob: 4, arms: -0.2, sy: 0.98 }],
      [2, { head: -0.1, mane: -0.06, bob: 2 }],
      [1, { head: 0.1, mane: 0.2, smear: [-8, 0] }],
      [1, { head: -0.1, mane: 0.22, smear: [8, 0] }],
      [1, { head: 0.06, mane: 0.12 }],
      [3, { mane: 0.04 }],
      [1, {}],
    ],
  },

  // Phasing: for a moment she's what she really is, data out of the Blackwall. Whole columns of her
  // slip out of line, the wall shows through around her, and she snaps back together.
  phase: {
    priority: 2,
    keys: [
      [1, { wall: 0.3, phase: 0.06 }, 'phase'],
      [2, { wall: 0.5, phase: 0.15, mane: 0.1 }],
      [3, { wall: 0.65, phase: 0.26, mane: 0.16, bob: -2 }],
      [2, { wall: 0.7, phase: 0.32, mane: 0.18, bob: -3 }],
      [3, { wall: 0.6, phase: 0.24, mane: 0.16, bob: -3 }],
      [1, { wall: 0.35, phase: 0.06, sx: 1.06, sy: 0.95, echo: [8, 0] }, 'snap'],
      [2, { wall: 0.18, sx: 0.98, sy: 1.02, mane: 0.22 }],
      [3, { wall: 0.08, mane: 0.06 }],
      [1, {}],
    ],
  },

  // a little wave at you (once she likes you): one hand up, wagging on twos
  wave: {
    priority: 1,
    directional: true,
    keys: [
      [2, { reach: 0.4, head: 0.04 }],
      [2, { reach: 1, head: 0.08, mane: 0.08, long: 1.05 }],
      ...rep(3, [[2, { reach: 1.2, head: 0.1, long: 1.05 }], [2, { reach: 0.88, head: 0.08, long: 1.05 }]]),
      [4, { reach: 1, head: 0.1, mane: 0.1 }],
      [2, { reach: 0.35 }],
      [1, {}],
    ],
  },

  // shadowboxing: a couple of quick jabs at nothing, one arm then the other shooting out on ones,
  // a hop back between, and a smug little bounce at the end
  jab: {
    priority: 1,
    fps: 24,
    directional: true,
    keys: [
      [3, { head: 0.08, tilt: -2, armL: -0.2, armR: -0.2, bob: 2, sy: 0.95, sx: 1.03 }],
      [1, { head: 0.14, tilt: 4, reach: 1, long: 1.45, smear: [-10, 0], mane: 0.18 }, 'jab'],
      [3, { head: 0.14, tilt: 3, reach: 0.95, long: 1.35, mane: 0.14 }],
      [2, { head: 0.08, tilt: 0, reach: 0.1, bob: -2 }],
      [1, { head: 0.12, tilt: 4, armL: 0.9, armR: 0.9, longL: 1.4, longR: 1.4, smear: [-10, 0], mane: 0.2 }, 'jab'],
      [3, { head: 0.12, tilt: 3, armL: 0.85, armR: 0.85, longL: 1.3, longR: 1.3, mane: 0.16 }],
      [2, { head: 0.06, tilt: -1, arms: -0.1, bob: -4 }],
      [2, { head: 0.1, mane: 0.12, bob: -8, sy: 1.04, sx: 0.97 }],
      [2, { head: 0.08, mane: 0.06, bob: 2, sy: 0.94, sx: 1.04 }],
      [4, { head: 0.1, mane: 0.08 }],
      [1, {}],
    ],
  },

  // a glitch: she stutters out of sync for a few drawings, her copies jerking off to the sides,
  // a column or two slipping, and she's back like nothing happened
  glitch: {
    priority: 1,
    fps: 24,
    keys: [
      [1, { echo: [14, 0], phase: 0.12, sx: 1.04 }, 'glitch'],
      [2, { echo: [-8, 2], head: 0.1, wall: 0.2 }],
      [1, { echo: [20, -3], phase: 0.2, sx: 0.96, bob: -3 }],
      [2, {}],
      [1, { echo: [-16, 0], phase: 0.1, head: -0.1, wall: 0.25 }, 'glitch'],
      [1, { echo: [6, 0], sx: 1.03 }],
      [6, { head: 0.04 }],
      [1, {}],
    ],
  },

  // leaning right in to look at something on your screen, squinting, holding it, then backing off
  peer: {
    priority: 1,
    directional: true,
    keys: [
      [2, { head: 0.08, tilt: 2 }],
      [3, { head: 0.2, tilt: 6, bob: 3, mane: 0.06, arms: -0.1 }],
      [14, { head: 0.24, tilt: 8, bob: 4, mane: 0.08, arms: -0.14 }],
      [1, { head: 0.28, tilt: 8.5, bob: 4, mane: 0.16 }, 'notice'],
      [8, { head: 0.24, tilt: 8, bob: 4, mane: 0.1, arms: -0.14 }],
      [2, { head: 0.1, tilt: 3, bob: 1 }],
      [1, {}],
    ],
  },

  // happy little bounces in the air, three of them, the mane flipping up each time
  bounce: {
    priority: 1,
    fps: 24,
    keys: [
      ...rep(3, [
        [2, { sy: 0.92, sx: 1.05, bob: 3, arms: -0.15, mane: -0.04 }],
        [1, { sy: 1.08, sx: 0.95, bob: -6, arms: 0.2, smear: [0, 8] }],
        [3, { bob: -16, arms: 0.3, mane: 0.18, head: 0.04 }],
        [2, { sy: 1.04, bob: -8, arms: 0.15, mane: 0.1 }],
      ]),
      [2, { sy: 0.9, sx: 1.06, bob: 3, arms: -0.1 }],
      [2, { bob: 1 }],
      [1, {}],
    ],
  },

  // zero-g: she lets herself drift up, arms floating out, the mane going weightless, and sinks back
  drift: {
    priority: 1,
    keys: [
      [3, { bob: -3, arms: 0.1, hair: 0 }],
      [3, { bob: -9, arms: 0.22, mane: 0.08, hair: 0 }],
      [4, { bob: -16, arms: 0.32, mane: 0.14, head: -0.05, hair: 1 }],
      [8, { bob: -20, arms: 0.36, mane: 0.18, head: -0.08, hair: 2 }],
      [4, { bob: -18, arms: 0.3, mane: 0.16, head: -0.06, hair: 0 }],
      [3, { bob: -11, arms: 0.18, mane: 0.1, hair: -1 }],
      [3, { bob: -4, arms: 0.06, mane: 0.04 }],
      [2, { bob: 1, sy: 0.97, sx: 1.02 }],
      [1, {}],
    ],
  },

  // fixing her mane: a hand up to it, a flick that flares it out, smoothed down, a satisfied tilt
  preen: {
    priority: 1,
    directional: true,
    keys: [
      [2, { reach: 0.5, long: 0.85, head: -0.04 }],
      [3, { reach: 1.05, long: 0.7, head: -0.1, mane: 0.04 }],
      [1, { reach: 1.15, long: 0.75, head: -0.14, mane: 0.36, smear: [8, -4] }, 'dust'],
      [4, { reach: 1.1, long: 0.72, head: -0.12, mane: 0.3 }],
      [3, { reach: 0.95, long: 0.7, head: -0.08, mane: 0.12 }],
      [2, { reach: 0.4, head: 0.04, mane: 0.04 }],
      [6, { head: 0.1, tilt: 1.5 }],
      [1, {}],
    ],
  },

  // a shrug at nothing in particular: shoulders (arms) up, head to one side, held, and dropped
  shrug: {
    priority: 1,
    directional: true,
    keys: [
      [2, { arms: -0.08, bob: 1 }],
      [2, { arms: 0.28, bob: -3, head: 0.1, mane: 0.06 }],
      [8, { arms: 0.34, bob: -4, head: 0.14, mane: 0.08, tilt: 1 }],
      [2, { arms: 0.08, bob: -1, head: 0.06 }],
      [2, { arms: -0.12, bob: 2 }],
      [1, {}],
    ],
  },

  // dancing to something only she hears: hips (tilt) one way, the other arm up, on the beat
  dance: {
    priority: 1,
    keys: [
      ...rep(3, [
        [3, { tilt: -3, head: 0.08, hair: -3, armL: 0.7, armR: -0.2, bob: -2 }],
        [1, { tilt: 0, head: 0, bob: 1, sy: 0.96, sx: 1.03 }],
        [3, { tilt: 3, head: -0.08, hair: 3, armL: -0.2, armR: 0.7, bob: -2 }],
        [1, { tilt: 0, head: 0, bob: 1, sy: 0.96, sx: 1.03 }],
      ]),
      [2, { arms: 0.5, bob: -6, mane: 0.2 }],
      [3, { arms: 0.1, bob: 0 }],
      [1, {}],
    ],
  },

  // nodding off on her feet: the head sinks, sinks a bit more, she jerks awake and shakes it off
  nod: {
    priority: 1,
    keys: [
      [4, { head: 0.08, mane: -0.06, bob: 1, arms: -0.1 }],
      [8, { head: 0.18, mane: -0.12, bob: 3, arms: -0.2 }],
      [6, { head: 0.24, mane: -0.16, bob: 5, arms: -0.26 }],
      [1, { head: 0.02, mane: 0.24, bob: -3, arms: 0.2, smear: [0, 10] }, 'snap'],
      [2, { head: -0.12, mane: 0.2 }],
      [2, { head: 0.12, mane: 0.16 }],
      [3, { head: 0, mane: 0.06 }],
      [1, {}],
    ],
  },

  // over her shoulder: something behind her? a quick look back, a beat, and a look back at you
  behind: {
    priority: 1,
    directional: true,
    keys: [
      [1, { head: 0.04 }],
      [1, { head: -0.16, tilt: -2, smear: [10, 0], mane: 0.1 }],
      [10, { head: -0.24, tilt: -3, mane: 0.08, armL: -0.12, armR: -0.12 }],
      [1, { head: -0.28, tilt: -3.5, mane: 0.14 }, 'notice'],
      [5, { head: -0.24, tilt: -3, mane: 0.08 }],
      [1, { head: 0.04, tilt: 0, smear: [-10, 0] }],
      [4, { head: 0.1 }],
      [1, {}],
    ],
  },

  // sitting: swinging her legs hard, both going, like a kid on a wall
  swing: {
    priority: 1,
    keys: [
      ...rep(3, [
        [2, { kickL: 0.5, kickR: -0.08, hair: -2, arms: -0.42, bob: -1 }],
        [2, { kickL: 0.14, kickR: 0.14, arms: -0.42 }],
        [2, { kickL: -0.08, kickR: 0.5, hair: 2, arms: -0.42, bob: -1 }],
        [2, { kickL: 0.14, kickR: 0.14, arms: -0.42 }],
      ]),
      [6, { kickL: 0.06, kickR: 0.06, head: 0.08, arms: -0.4 }],
      [1, {}],
    ],
  },

  // sitting: leaning back on her hands, head tipped up, legs out, taking it easy for a bit
  lounge: {
    priority: 1,
    keys: [
      [3, { tilt: -2, arms: -0.55, head: -0.04, kickL: 0.12, kickR: 0.12 }],
      [3, { tilt: -4, arms: -0.7, head: -0.1, kickL: 0.22, kickR: 0.2, mane: -0.04 }],
      [18, { tilt: -5, arms: -0.74, head: -0.14, kickL: 0.26, kickR: 0.24, mane: -0.06 }],
      [1, { tilt: -5, arms: -0.74, head: -0.12, kickL: 0.34, kickR: 0.2 }],
      [8, { tilt: -5, arms: -0.74, head: -0.14, kickL: 0.26, kickR: 0.24, mane: -0.06 }],
      [3, { tilt: -2, arms: -0.5, head: -0.04, kickL: 0.1, kickR: 0.1 }],
      [1, {}],
    ],
  },

  // sitting: peering down past her knees at whatever's in the window under her
  below: {
    priority: 1,
    directional: true,
    keys: [
      [2, { head: 0.1, tilt: 2, arms: -0.45 }],
      [3, { head: 0.26, tilt: 5, bob: 2, arms: -0.5, kickL: 0.04, kickR: 0.04 }],
      [12, { head: 0.3, tilt: 6, bob: 3, arms: -0.52, mane: 0.06, kickL: 0.02, kickR: 0.02 }],
      [1, { head: 0.34, tilt: 6.5, bob: 3, mane: 0.14, arms: -0.52 }, 'notice'],
      [6, { head: 0.3, tilt: 6, bob: 3, arms: -0.52, mane: 0.08 }],
      [3, { head: 0.1, tilt: 2, arms: -0.44 }],
      [1, {}],
    ],
  },

  // ---- more of her, bigger (capri.js idle) ----

  // a backflip in the air: crouch, launch, the whole of her turned over on ones, and a stuck landing
  flip: {
    priority: 1,
    fps: 24,
    directional: true,
    keys: [
      [3, { sy: 0.86, sx: 1.08, bob: 6, arms: -0.3, mane: -0.1 }],
      [1, { sy: 1.15, sx: 0.9, bob: -14, arms: 0.5, smear: [0, 16] }],
      [1, { tilt: -45, bob: -30, arms: 0.6, mane: 0.2, echo: [6, 0] }],
      [1, { tilt: -100, bob: -42, arms: 0.3, mane: 0.3, echo: [10, 0] }],
      [1, { tilt: -160, bob: -50, arms: 0.1, mane: 0.36, echo: [12, 0] }],
      [1, { tilt: -215, bob: -50, arms: 0.1, mane: 0.36, echo: [12, 0] }],
      [1, { tilt: -270, bob: -42, arms: 0.3, mane: 0.3, echo: [10, 0] }],
      [1, { tilt: -320, bob: -28, arms: 0.5, mane: 0.2, echo: [6, 0] }],
      [1, { tilt: -360, bob: -12, arms: 0.6, sy: 1.08, sx: 0.94, smear: [0, -12] }],
      [2, { sy: 0.8, sx: 1.14, bob: 5, arms: -0.2, mane: -0.1 }, 'land'],
      [3, { sy: 0.95, sx: 1.03, bob: 2, arms: 0.4, mane: 0.1 }],
      [6, { arms: 0.5, head: 0.1, mane: 0.12 }],
      [1, {}],
    ],
  },

  // rocking out to something only she hears: hard nods on twos, the mane flying up every time
  headbang: {
    priority: 1,
    keys: [
      [2, { head: -0.12, mane: 0.1, bob: -2 }],
      ...rep(5, [
        [2, { head: 0.26, mane: 0.42, bob: 3, arms: -0.2, sy: 0.96 }, 'strum'],
        [2, { head: -0.14, mane: 0.12, bob: -2, arms: 0.1 }],
      ]),
      [3, { head: 0.04, mane: 0.2, arms: 0.6, bob: -4 }],
      [1, {}],
    ],
  },

  // air guitar: one hand on the neck, the other strumming on twos, head bobbing along, a big finish
  guitar: {
    priority: 1,
    directional: true,
    keys: [
      [3, { reach: 0.5, long: 1.1, armL: -0.1, tilt: -2, head: 0.06 }],
      ...rep(4, [
        [2, { reach: 0.5, long: 1.1, armL: 0.2, tilt: -3, head: 0.12, bob: 1 }, 'strum'],
        [2, { reach: 0.5, long: 1.1, armL: -0.25, tilt: -2, head: 0.04, bob: -1 }],
      ]),
      [1, { reach: 0.5, long: 1.1, armL: 1.2, tilt: -5, head: -0.1, mane: 0.4, smear: [0, 10] }, 'sparkle'],
      [6, { reach: 0.5, long: 1.1, armL: 1.1, tilt: -4, head: -0.08, mane: 0.3, bob: -4 }],
      [2, { arms: 0, tilt: 0 }],
      [1, {}],
    ],
  },

  // a sneeze: head back, back, back, then snapped forward with shards of her mane blown off
  sneeze: {
    priority: 1,
    keys: [
      [3, { head: -0.06, mane: 0.04 }],
      [3, { head: -0.14, mane: 0.08, bob: -1 }],
      [4, { head: -0.22, mane: 0.12, bob: -3, arms: 0.1, sy: 1.03 }],
      [1, { head: 0.3, mane: 0.6, bob: 4, sy: 0.9, sx: 1.06, smear: [0, -10], echo: [6, 0] }, 'sneeze'],
      [3, { head: 0.22, mane: 0.36, bob: 3 }],
      [6, { head: 0.08, mane: 0.1 }],
      [1, {}],
    ],
  },

  // hiccups: three little jolts, each one knocking her copies out of line for a drawing
  hiccup: {
    priority: 1,
    keys: [
      ...rep(3, [
        [6, { head: 0.04 }],
        [1, { bob: -6, sy: 1.06, sx: 0.96, mane: 0.2, echo: [8, -2], head: -0.06 }, 'snap'],
        [2, { bob: -2, mane: 0.1 }],
      ]),
      [4, { head: 0.1, tilt: 1.5 }],
      [1, {}],
    ],
  },

  // jelly: squashed and stretched back and forth, like she's made of something soft, and settling
  wobble: {
    priority: 1,
    fps: 24,
    keys: [
      [2, { sy: 0.8, sx: 1.18, bob: 5 }],
      [2, { sy: 1.16, sx: 0.88, bob: -6, mane: 0.2 }],
      [2, { sy: 0.88, sx: 1.1, bob: 3 }],
      [2, { sy: 1.08, sx: 0.94, bob: -3, mane: 0.1 }],
      [2, { sy: 0.95, sx: 1.04, bob: 1 }],
      [2, { sy: 1.03, sx: 0.98 }],
      [1, {}],
    ],
  },

  // a fist pump, twice: yes, and yes
  pump: {
    priority: 1,
    directional: true,
    keys: [
      [2, { reach: -0.3, bob: 2, sy: 0.95 }],
      [1, { reach: 1.3, long: 1.2, bob: -8, mane: 0.3, smear: [0, 10] }, 'snap'],
      [3, { reach: 1.25, long: 1.15, bob: -6, mane: 0.22 }],
      [2, { reach: 0.3, bob: 0 }],
      [1, { reach: 1.35, long: 1.25, bob: -10, mane: 0.36, smear: [0, 12] }, 'sparkle'],
      [6, { reach: 1.3, long: 1.2, bob: -8, mane: 0.26, head: -0.06 }],
      [2, { reach: 0.2 }],
      [1, {}],
    ],
  },

  // facepalm: a hand up over her eyes, head dropped into it, held, a sigh
  facepalm: {
    priority: 1,
    directional: true,
    keys: [
      [2, { reach: 0.6, long: 0.8, head: 0.04 }],
      [2, { reach: 1.15, long: 0.62, head: 0.16, mane: -0.06 }],
      [14, { reach: 1.2, long: 0.6, head: 0.22, mane: -0.12, bob: 2 }],
      [2, { reach: 0.5, long: 0.85, head: 0.06, bob: 1 }],
      [1, {}],
    ],
  },

  // thinking: a hand to her chin, head cocked, a long beat, and the idea lands (the mane lights up)
  think: {
    priority: 1,
    directional: true,
    keys: [
      [2, { reach: 0.5, long: 0.75, head: 0.06 }],
      [10, { reach: 0.85, long: 0.6, head: 0.14, tilt: 1.5 }],
      [8, { reach: 0.85, long: 0.6, head: 0.18, tilt: 2, bob: -1 }],
      [1, { reach: 1.3, long: 1.1, head: -0.04, mane: 0.36, bob: -6, smear: [0, 8] }, 'idea'],
      [6, { reach: 1.25, long: 1.05, head: -0.02, mane: 0.24, bob: -5 }],
      [2, { reach: 0.2 }],
      [1, {}],
    ],
  },

  // a salute, sharp, held, snapped off
  salute: {
    priority: 1,
    directional: true,
    keys: [
      [1, { reach: 0.4, long: 0.9 }],
      [1, { reach: 1.25, long: 0.58, head: -0.04, smear: [6, -4] }],
      [10, { reach: 1.22, long: 0.6, head: -0.06, bob: -1, sy: 1.02 }],
      [1, { reach: 0.6, long: 1.2, smear: [-8, 4] }, 'snap'],
      [2, { reach: 0.1 }],
      [1, {}],
    ],
  },

  // peekaboo: both hands over her face, a beat, and flung open with a bounce
  peekaboo: {
    priority: 1,
    keys: [
      [2, { arms: 0.7, longL: 0.8, longR: 0.8, head: 0.04 }],
      [10, { arms: 1.15, longL: 0.62, longR: 0.62, head: 0.1, sy: 0.97, bob: 2 }],
      [1, { arms: 1.4, longL: 1.2, longR: 1.2, head: -0.06, mane: 0.4, bob: -8, sy: 1.06 }, 'sparkle'],
      [5, { arms: 1.3, longL: 1.1, longR: 1.1, head: -0.04, mane: 0.26, bob: -6 }],
      [2, { arms: 0.2, bob: 0 }],
      [1, {}],
    ],
  },

  // a side stretch: arms up, bent over one way, then the other
  bend: {
    priority: 1,
    keys: [
      [2, { arms: 0.6, bob: -2 }],
      [3, { arms: 1.05, bob: -5, tilt: -8, head: -0.08, hair: -3 }],
      [8, { arms: 1.08, bob: -5, tilt: -11, head: -0.1, hair: -4 }],
      [2, { arms: 1.05, bob: -6, tilt: 0, hair: 0 }],
      [3, { arms: 1.05, bob: -5, tilt: 8, head: 0.08, hair: 3 }],
      [8, { arms: 1.08, bob: -5, tilt: 11, head: 0.1, hair: 4 }],
      [2, { arms: 0.4, tilt: 0, bob: 0 }],
      [1, {}],
    ],
  },

  // zoomies: darting side to side so fast her copies trail her, then stopping dead, very pleased
  zoom: {
    priority: 1,
    fps: 24,
    keys: [
      [1, { tilt: 8, echo: [-18, 0], smear: [-14, 0], mane: 0.3 }],
      [1, { tilt: -8, echo: [18, 0], smear: [14, 0], mane: 0.3 }],
      [1, { tilt: 8, echo: [-22, 0], smear: [-16, 0], mane: 0.34 }],
      [1, { tilt: -8, echo: [22, 0], smear: [16, 0], mane: 0.34 }],
      [1, { tilt: 8, echo: [-18, 0], mane: 0.3 }],
      [1, { tilt: -8, echo: [18, 0], mane: 0.3 }],
      [2, { tilt: 0, sx: 1.08, sy: 0.94, mane: 0.36 }, 'snap'],
      [10, { head: 0.12, mane: 0.16, bob: -2 }],
      [1, {}],
    ],
  },

  // meditating: she rises slowly, arms out, the Blackwall glowing around her, and comes back down
  meditate: {
    priority: 1,
    keys: [
      [4, { arms: 0.1, bob: -4, head: 0.06, hair: 0 }],
      [6, { arms: 0.28, bob: -12, head: 0.1, wall: 0.2, hair: 0 }],
      [12, { arms: 0.34, bob: -20, head: 0.12, wall: 0.42, mane: 0.1, hair: 0 }, 'glow'],
      [10, { arms: 0.32, bob: -22, head: 0.12, wall: 0.5, mane: 0.12, hair: 0 }],
      [6, { arms: 0.2, bob: -12, head: 0.06, wall: 0.24, hair: 0 }],
      [4, { arms: 0.04, bob: -3, wall: 0.06 }],
      [1, {}],
    ],
  },

  // a little pirouette, arms up over her head
  twirl: {
    priority: 1,
    fps: 24,
    keys: [
      [2, { arms: 0.9, bob: -2, mane: 0.1 }],
      [1, { arms: 1.1, sx: 0.6, bob: -6, mane: 0.26, echo: [6, 0] }],
      [1, { arms: 1.15, sx: 0.15, bob: -8, mane: 0.34, echo: [10, 0] }],
      [1, { arms: 1.15, sx: -0.4, bob: -8, mane: 0.34, echo: [10, 0] }],
      [1, { arms: 1.15, sx: -0.85, bob: -8, mane: 0.3 }],
      [1, { arms: 1.15, sx: -0.85, bob: -8, mane: 0.3 }],
      [1, { arms: 1.15, sx: -0.4, bob: -7, mane: 0.34, echo: [10, 0] }],
      [1, { arms: 1.15, sx: 0.15, bob: -5, mane: 0.34, echo: [10, 0] }],
      [1, { arms: 1.1, sx: 0.6, bob: -3, mane: 0.26 }],
      [2, { arms: 0.9, sx: 1.06, sy: 0.96, mane: 0.2 }, 'sparkle'],
      [6, { arms: 0.5, head: 0.08 }],
      [1, {}],
    ],
  },

  // sitting: drumming her hands on the ledge, faster and faster, and a last double hit
  drum: {
    priority: 1,
    keys: [
      ...rep(3, [
        [2, { armL: -0.28, armR: -0.44, head: 0.04, kickL: 0.1, kickR: 0.1 }, 'strum'],
        [2, { armL: -0.44, armR: -0.28, head: -0.02, kickL: 0.1, kickR: 0.1 }],
      ]),
      ...rep(3, [
        [1, { armL: -0.26, armR: -0.44, head: 0.06, kickL: 0.16, kickR: 0.1 }, 'strum'],
        [1, { armL: -0.44, armR: -0.26, head: 0.02, kickL: 0.1, kickR: 0.16 }],
      ]),
      [1, { arms: -0.2, head: 0.1, mane: 0.2, bob: -2 }, 'snap'],
      [6, { arms: -0.42, head: 0.06 }],
      [1, {}],
    ],
  },

  // sitting: both legs kicked up high and held, rocking back on her hands
  kickup: {
    priority: 1,
    keys: [
      [2, { kickL: 0.3, kickR: 0.3, arms: -0.5, tilt: -2 }],
      [3, { kickL: 0.62, kickR: 0.58, arms: -0.62, tilt: -5, head: -0.06, mane: 0.1 }],
      [10, { kickL: 0.66, kickR: 0.62, arms: -0.64, tilt: -6, head: -0.08, mane: 0.12 }],
      [2, { kickL: 0.3, kickR: 0.34, arms: -0.5, tilt: -2 }],
      [3, { kickL: 0.08, kickR: 0.06, arms: -0.42 }],
      [1, {}],
    ],
  },

  // sitting: rocking forward and back on the ledge, humming to herself
  rock: {
    priority: 1,
    keys: [
      ...rep(3, [
        [4, { tilt: 4, head: 0.1, arms: -0.44, kickL: 0.2, kickR: 0.2, bob: 1 }],
        [4, { tilt: -3, head: -0.06, arms: -0.4, kickL: 0.02, kickR: 0.02, bob: -1 }],
      ]),
      [3, { head: 0.06 }],
      [1, {}],
    ],
  },

  // sitting: dozing off on the ledge, head dropping, a jolt that nearly tips her off
  doze: {
    priority: 1,
    keys: [
      [6, { head: 0.1, mane: -0.08, arms: -0.44, kickL: 0.04, kickR: 0.04 }],
      [8, { head: 0.2, mane: -0.14, arms: -0.46, bob: 2, kickL: 0.02, kickR: 0.02 }],
      [6, { head: 0.26, mane: -0.18, arms: -0.48, bob: 3, tilt: 3 }],
      [1, { head: -0.04, mane: 0.3, arms: -0.2, bob: -4, tilt: -3, smear: [0, 10], kickL: 0.4, kickR: 0.36 }, 'snap'],
      [3, { head: -0.1, mane: 0.2, arms: -0.5, kickL: 0.2, kickR: 0.2 }],
      [4, { head: 0.04, arms: -0.42 }],
      [1, {}],
    ],
  },

  // ---- jealous (bond.js) ----

  // glaring at you over another AI: she snaps to it, leans in, mane bristling, holds it, and hisses
  glare: {
    priority: 2,
    directional: true,
    keys: [
      [1, { head: 0.1, mane: 0.32, tilt: 2, smear: [-8, 0] }, 'notice'],
      [9, { head: 0.18, mane: 0.36, tilt: 3, armL: -0.22, armR: -0.22 }],
      [1, { head: 0.22, mane: 0.46, tilt: 3.6, armL: -0.3, armR: -0.3, echo: [4, 0] }, 'hiss'],
      [12, { head: 0.19, mane: 0.38, tilt: 3, armL: -0.25, armR: -0.25 }],
      [2, { head: 0.1, mane: 0.2, tilt: 1 }],
      [1, {}],
    ],
  },

  // sulking: head turned away from you, mane down, arms in
  huff: {
    priority: 2,
    directional: true,
    keys: [
      [1, { head: -0.06, mane: 0.1, smear: [8, 0] }],
      [3, { head: -0.16, mane: -0.08, tilt: -2, armL: -0.28, armR: -0.28 }],
      [16, { head: -0.18, mane: -0.14, tilt: -2.5, armL: -0.32, armR: -0.32, bob: 2 }],
      [2, { head: -0.1, mane: -0.06, tilt: -1 }],
      [1, {}],
    ],
  },
};

export class Player {
  constructor(name, { dir = 0, reach = 1, at = performance.now() } = {}) {
    this.name = name;
    this.act = ACTS[name];
    this.dir = dir;
    this.reach = reach;
    this.start = at;
    this.total = this.act.keys.reduce((n, [hold]) => n + hold, 0);
  }

  get priority() {
    return this.act.priority ?? 0;
  }

  // The drawing on screen at `now` ({ pose, index, cue }), or null once a one-shot act is over.
  sample(now) {
    const fps = this.act.fps || SHEET_FPS;
    let f = Math.floor((now - this.start) / (1000 / fps));
    if (f >= this.total) {
      if (!this.act.loop) return null;
      f %= this.total;
    }
    const { keys } = this.act;
    for (let i = 0; i < keys.length; i++) {
      const [hold, pose, cue] = keys[i];
      if (f < hold) return { pose, index: i, cue };
      f -= hold;
    }
    return null;
  }

  // Turn a drawing into plain fields: mirror it toward the act's direction (`facing` maps
  // screen to sprite space) and spell out arms / reach as armL / armR.
  resolve(pose, facing) {
    const out = { ...pose };
    const lean = this.act.directional && this.dir ? this.dir * facing : 0;
    if (lean) {
      if (pose.head !== undefined) out.head = pose.head * lean;
      if (pose.tilt !== undefined) out.tilt = pose.tilt * this.dir;
      if (pose.smear) out.smear = [pose.smear[0] * lean, pose.smear[1]];
      if (pose.echo) out.echo = [pose.echo[0] * lean, pose.echo[1]];
    }
    if (pose.arms !== undefined) {
      out.armL = pose.arms;
      out.armR = pose.arms;
    }
    if (pose.reach !== undefined) {
      // the left arm of the sprite points to sprite-left; reach can follow a moving target
      const scale = typeof this.reach === 'function' ? this.reach() : this.reach;
      out[lean < 0 ? 'armL' : 'armR'] = pose.reach * scale;
    }
    if (pose.long !== undefined) out[lean < 0 ? 'longL' : 'longR'] = pose.long;
    delete out.arms;
    delete out.reach;
    delete out.long;
    return out;
  }
}
