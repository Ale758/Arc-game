/*
  ARC — libreria di livelli personali
  Modulo indipendente: tiene il salvataggio (localStorage) dei livelli creati
  con l'editor, con un nome a scelta, e le funzioni di codifica/decodifica
  condivise tra editor.js (crea/esporta) e game.js (gioca dal menu).
*/

const MyLevels = (function () {
  const KEY = "arc-game-my-levels-v1";

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function persist(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) {
      /* nessun salvataggio disponibile: la libreria resta valida solo per questa sessione */
    }
  }

  let entries = load();

  function genId() {
    return "lvl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  return {
    // Elenco leggero (senza i dati completi del livello) per mostrare la lista
    list() {
      return entries
        .slice()
        .sort((a, b) => b.savedAt - a.savedAt)
        .map((e) => ({ id: e.id, name: e.name, savedAt: e.savedAt }));
    },
    get(id) {
      const found = entries.find((e) => e.id === id);
      return found ? found.level : null;
    },
    // Se id è null crea una nuova voce (ritorna il nuovo id); se id esiste
    // già, aggiorna quella voce invece di duplicarla.
    upsert(id, name, levelData) {
      const finalName = (name || "").trim() || "Livello senza nome";
      if (id) {
        const idx = entries.findIndex((e) => e.id === id);
        if (idx !== -1) {
          entries[idx] = { id, name: finalName, level: levelData, savedAt: Date.now() };
          persist(entries);
          return id;
        }
      }
      const newId = genId();
      entries.push({ id: newId, name: finalName, level: levelData, savedAt: Date.now() });
      persist(entries);
      return newId;
    },
    remove(id) {
      entries = entries.filter((e) => e.id !== id);
      persist(entries);
    },
    count() {
      return entries.length;
    },
  };
})();

window.MyLevels = MyLevels;

// ---------- Codifica / decodifica livello (condivisa) ----------
// CANVAS_W, CANVAS_H, GROUND_TOP sono globali definiti in js/levels.js,
// caricato prima di questo file.
const LevelCodec = (function () {
  function clampNum(v, lo, hi, fallback) {
    const n = Number(v);
    if (!isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  function encode(level) {
    const payload = {
      v: 2,
      launcher: level.launcher,
      obstacles: level.obstacles.map((o) => ({ type: o.type, x: o.x, y: o.y, w: o.w, h: o.h })),
      portals: level.portals || [],
      windZones: level.windZones || [],
      gravityZones: level.gravityZones || [],
      targets: level.targets.map((t) => ({ x: t.x, y: t.y, r: t.r })),
      par: level.par,
    };
    return btoa(JSON.stringify(payload));
  }

  function decode(code) {
    const payload = JSON.parse(atob(code.trim()));
    if (!payload || typeof payload !== "object") throw new Error("payload non valido");
    if (!payload.launcher || typeof payload.launcher.x !== "number" || typeof payload.launcher.y !== "number") {
      throw new Error("lanciatore mancante");
    }
    if (!Array.isArray(payload.targets) || payload.targets.length === 0) {
      throw new Error("nessun bersaglio");
    }
    const safeObstacles = (Array.isArray(payload.obstacles) ? payload.obstacles : []).slice(0, 60).map((o) => ({
      type: o.type === "bouncer" ? "bouncer" : "wall",
      x: clampNum(o.x, -50, CANVAS_W + 50, CANVAS_W / 2),
      y: clampNum(o.y, -50, CANVAS_H + 50, GROUND_TOP - 60),
      w: clampNum(o.w, 5, 600, 30),
      h: clampNum(o.h, 5, 600, 100),
    }));
    const safeTargets = payload.targets.slice(0, 20).map((t) => ({
      x: clampNum(t.x, -50, CANVAS_W + 50, CANVAS_W / 2),
      y: clampNum(t.y, -50, CANVAS_H + 50, GROUND_TOP - 20),
      r: clampNum(t.r, 8, 80, 20),
    }));
    const safePortals = (Array.isArray(payload.portals) ? payload.portals : []).slice(0, 6).map((p) => ({
      x1: clampNum(p.x1, -50, CANVAS_W + 50, CANVAS_W / 2),
      y1: clampNum(p.y1, -50, CANVAS_H + 50, GROUND_TOP - 20),
      x2: clampNum(p.x2, -50, CANVAS_W + 50, CANVAS_W / 2),
      y2: clampNum(p.y2, -50, CANVAS_H + 50, GROUND_TOP - 20),
      r: clampNum(p.r, 10, 50, 24),
    }));
    const safeWind = (Array.isArray(payload.windZones) ? payload.windZones : []).slice(0, 6).map((z) => ({
      x: clampNum(z.x, -50, CANVAS_W + 50, CANVAS_W / 2),
      y: clampNum(z.y, -50, CANVAS_H + 50, CANVAS_H / 2),
      w: clampNum(z.w, 20, CANVAS_W, 200),
      h: clampNum(z.h, 20, CANVAS_H, 200),
      fx: clampNum(z.fx, -0.01, 0.01, 0.0018),
      fy: clampNum(z.fy, -0.01, 0.01, 0),
    }));
    const safeGravity = (Array.isArray(payload.gravityZones) ? payload.gravityZones : []).slice(0, 6).map((z) => ({
      x: clampNum(z.x, -50, CANVAS_W + 50, CANVAS_W / 2),
      y: clampNum(z.y, -50, CANVAS_H + 50, CANVAS_H / 2),
      w: clampNum(z.w, 20, CANVAS_W, 200),
      h: clampNum(z.h, 20, CANVAS_H, 200),
      strength: clampNum(z.strength, 0, 3.5, 2.1),
    }));
    const par = clampNum(payload.par, 1, 30, safeTargets.length + 1);

    return {
      id: "custom",
      name: "LIVELLO PERSONALIZZATO",
      launcher: {
        x: clampNum(payload.launcher.x, -50, CANVAS_W + 50, 110),
        y: clampNum(payload.launcher.y, -50, CANVAS_H + 50, 500),
      },
      ground: [{ x: 0, w: CANVAS_W }],
      groundRects: [{ x: CANVAS_W / 2, y: GROUND_TOP + 20, w: CANVAS_W, h: 40 }],
      obstacles: safeObstacles,
      portals: safePortals,
      windZones: safeWind,
      gravityZones: safeGravity,
      targets: safeTargets,
      par,
    };
  }

  return { encode, decode };
})();

window.LevelCodec = LevelCodec;
