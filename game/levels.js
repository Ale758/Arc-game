/*
  ARC — livelli
  Ogni livello è un "disegno tecnico" con:
  - launcher: punto di ancoraggio della fionda
  - ground: segmenti di terreno (rettangoli). Gli spazi tra i segmenti sono voragini.
  - obstacles: rettangoli statici (muri). angle in radianti (opzionale)
  - targets: array di bersagli. Ognuno può muoversi (movement) su asse y o x.
  - par: numero di tiri per ottenere 3 stelle (vedi calcolo stelle in game.js)

  Sistema di coordinate: canvas 960x600. Il terreno "standard" ha la superficie a y=560.
*/

const CANVAS_W = 960;
const CANVAS_H = 600;
const GROUND_TOP = 560;

const LEVELS = [
  {
    id: 1,
    name: "FIG. 01 — PRIMO LANCIO",
    launcher: { x: 110, y: 500 },
    ground: [{ x: 0, w: 960 }],
    obstacles: [],
    targets: [{ x: 800, y: 538, r: 22 }],
    par: 1,
  },
  {
    id: 2,
    name: "FIG. 02 — OLTRE IL MURO",
    launcher: { x: 110, y: 500 },
    ground: [{ x: 0, w: 960 }],
    obstacles: [{ x: 500, y: 495, w: 28, h: 130 }],
    targets: [{ x: 820, y: 538, r: 22 }],
    par: 2,
  },
  {
    id: 3,
    name: "FIG. 03 — IL VUOTO",
    launcher: { x: 110, y: 500 },
    ground: [
      { x: 0, w: 380 },
      { x: 540, w: 420 },
    ],
    obstacles: [],
    targets: [{ x: 820, y: 538, r: 22 }],
    par: 2,
  },
  {
    id: 4,
    name: "FIG. 04 — LA SPORGENZA",
    launcher: { x: 110, y: 500 },
    ground: [{ x: 0, w: 960 }],
    obstacles: [
      { x: 470, y: 495, w: 26, h: 130 },
      { x: 800, y: 470, w: 160, h: 40 },
    ],
    targets: [{ x: 800, y: 428, r: 20 }],
    par: 3,
  },
  {
    id: 5,
    name: "FIG. 05 — DOPPIO BERSAGLIO",
    launcher: { x: 110, y: 500 },
    ground: [{ x: 0, w: 960 }],
    obstacles: [{ x: 660, y: 495, w: 26, h: 130 }],
    targets: [
      { x: 470, y: 538, r: 20 },
      { x: 850, y: 538, r: 20 },
    ],
    par: 3,
  },
  {
    id: 6,
    name: "FIG. 06 — BERSAGLIO MOBILE",
    launcher: { x: 110, y: 500 },
    ground: [{ x: 0, w: 960 }],
    obstacles: [],
    targets: [
      {
        x: 800,
        y: 500,
        r: 20,
        movement: { axis: "y", center: 500, amplitude: 42, speed: 0.0022 },
      },
    ],
    par: 3,
  },
  {
    id: 7,
    name: "FIG. 07 — IL LABIRINTO",
    launcher: { x: 110, y: 500 },
    ground: [
      { x: 0, w: 360 },
      { x: 480, w: 480 },
    ],
    obstacles: [{ x: 660, y: 495, w: 26, h: 130 }],
    targets: [{ x: 880, y: 538, r: 20 }],
    par: 3,
  },
  {
    id: 8,
    name: "FIG. 08 — PROGETTO FINALE",
    launcher: { x: 110, y: 500 },
    ground: [
      { x: 0, w: 380 },
      { x: 500, w: 460 },
    ],
    obstacles: [{ x: 660, y: 495, w: 26, h: 130 }],
    targets: [
      {
        x: 860,
        y: 470,
        r: 20,
        movement: { axis: "y", center: 470, amplitude: 40, speed: 0.0028 },
      },
    ],
    par: 4,
  },
];

// Ogni segmento di ground diventa un rettangolo pieno alto 40px la cui superficie è GROUND_TOP
LEVELS.forEach((level) => {
  level.groundRects = level.ground.map((seg) => ({
    x: seg.x + seg.w / 2,
    y: GROUND_TOP + 20,
    w: seg.w,
    h: 40,
  }));
});
