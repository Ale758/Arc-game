/*
  ARC — livelli
  Ogni livello è un "disegno tecnico" con:
  - launcher: punto di ancoraggio della fionda
  - ground: segmenti di terreno (rettangoli). Gli spazi tra i segmenti sono voragini.
  - obstacles: rettangoli. Campo "type" opzionale:
      "wall"    (default) — muro statico immobile
      "rotator" — muro che ruota di continuo attorno al proprio centro (campo `speed`, rad/ms)
      un muro "wall" può anche avere un campo `movement` (come i target mobili)
      per scorrere avanti e indietro
  - portals: coppie di portali { x1,y1, x2,y2, r }. La pallina che tocca un
    'ingresso' viene teletrasportata all'altro, mantenendo la velocità.
  - windZones: rettangoli { x,y,w,h, fx, fy } che applicano una spinta costante
    alla pallina finché il suo centro si trova al loro interno.
  - targets: array di bersagli, eventualmente con `movement` (asse y o x).
  - par: numero di tiri per ottenere 3 stelle.

  Sistema di coordinate: canvas 960x600. Il terreno "standard" ha la superficie a y=560.

  NOTA SUL TARATURA: non ho potuto testare fisicamente questi livelli in un
  vero browser. I valori di `fx`/`fy` (vento) e `speed` (rotanti/mobili) sono
  stime ragionevoli ma vanno provati e probabilmente aggiustati — vedi i
  commenti in cima a js/game.js.
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

  // ===== Nuove meccaniche =====

  {
    id: 9,
    name: "FIG. 09 — VARCO",
    launcher: { x: 110, y: 500 },
    ground: [{ x: 0, w: 960 }],
    obstacles: [{ x: 560, y: 460, w: 26, h: 220 }],
    portals: [{ x1: 350, y1: 538, x2: 760, y2: 460, r: 26 }],
    targets: [{ x: 860, y: 428, r: 20 }],
    par: 2,
  },
  {
    id: 10,
    name: "FIG. 10 — CORRENTE",
    launcher: { x: 110, y: 500 },
    ground: [
      { x: 0, w: 400 },
      { x: 620, w: 340 },
    ],
    obstacles: [],
    windZones: [{ x: 500, y: 420, w: 260, h: 280, fx: 0.0018, fy: 0 }],
    targets: [{ x: 850, y: 538, r: 22 }],
    par: 2,
  },
  {
    id: 11,
    name: "FIG. 11 — INGRANAGGIO",
    launcher: { x: 110, y: 500 },
    ground: [{ x: 0, w: 960 }],
    obstacles: [{ type: "rotator", x: 600, y: 460, w: 120, h: 14, speed: 0.0011 }],
    targets: [{ x: 850, y: 538, r: 22 }],
    par: 3,
  },
  {
    id: 12,
    name: "FIG. 12 — BINARIO",
    launcher: { x: 110, y: 500 },
    ground: [{ x: 0, w: 960 }],
    obstacles: [
      {
        x: 650,
        y: 495,
        w: 26,
        h: 130,
        movement: { axis: "x", center: 650, amplitude: 100, speed: 0.0018 },
      },
    ],
    targets: [{ x: 880, y: 538, r: 20 }],
    par: 3,
  },
  {
    id: 13,
    name: "FIG. 13 — DOPPIO VARCO",
    launcher: { x: 110, y: 500 },
    ground: [
      { x: 0, w: 380 },
      { x: 560, w: 400 },
    ],
    obstacles: [{ x: 700, y: 495, w: 26, h: 130 }],
    portals: [{ x1: 250, y1: 538, x2: 830, y2: 470, r: 24 }],
    windZones: [{ x: 470, y: 420, w: 180, h: 280, fx: 0.0017, fy: 0 }],
    targets: [{ x: 900, y: 538, r: 20 }],
    par: 3,
  },
  {
    id: 14,
    name: "FIG. 14 — PROGETTO OMEGA",
    launcher: { x: 110, y: 500 },
    ground: [
      { x: 0, w: 360 },
      { x: 540, w: 420 },
    ],
    obstacles: [{ type: "rotator", x: 660, y: 460, w: 120, h: 14, speed: 0.0012 }],
    windZones: [{ x: 440, y: 420, w: 200, h: 280, fx: 0.0018, fy: 0 }],
    targets: [
      {
        x: 880,
        y: 460,
        r: 20,
        movement: { axis: "y", center: 460, amplitude: 40, speed: 0.0026 },
      },
    ],
    par: 5,
  },
];

// Ogni segmento di ground diventa un rettangolo pieno alto 40px la cui superficie è GROUND_TOP.
// Portali/zone-vento sono opzionali: garantiamo che esistano sempre come array
// cosi il resto del codice non deve controllare ogni volta se sono definiti.
LEVELS.forEach((level) => {
  level.groundRects = level.ground.map((seg) => ({
    x: seg.x + seg.w / 2,
    y: GROUND_TOP + 20,
    w: seg.w,
    h: 40,
  }));
  level.portals = level.portals || [];
  level.windZones = level.windZones || [];
});
