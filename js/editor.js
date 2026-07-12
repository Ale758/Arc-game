/*
  ARC — editor di livelli
  Modulo indipendente con il proprio canvas statico (nessuna fisica qui:
  serve solo a piazzare oggetti). Il "Playtest" e l'importazione passano il
  livello disegnato al motore di gioco vero tramite window.ArcGame.playCustom().

  Strumenti disponibili: muro, trampolino, bersaglio, lanciatore, portale
  (due clic per la coppia), zona vento, zona antigravità, cancella.

  Il terreno è sempre a larghezza piena, senza voragini (scelta per ridurre
  il rischio di livelli impossibili, dato che non posso playtestarli io
  stesso in un browser) e il par è calcolato automaticamente (bersagli + 1).
  Chi vuole di più può comunque editare LEVELS in js/levels.js a mano.
*/

(function () {
  "use strict";

  const canvas = document.getElementById("editor-canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  const screenMenuEl = document.getElementById("screen-menu");
  const screenEditorEl = document.getElementById("screen-editor");
  const btnOpenEditor = document.getElementById("btn-open-editor");
  const btnEditorMenu = document.getElementById("btn-editor-menu");

  const toolButtons = {
    wall: document.getElementById("tool-wall"),
    bouncer: document.getElementById("tool-bouncer"),
    target: document.getElementById("tool-target"),
    launcher: document.getElementById("tool-launcher"),
    portal: document.getElementById("tool-portal"),
    wind: document.getElementById("tool-wind"),
    gravity: document.getElementById("tool-gravity"),
    delete: document.getElementById("tool-delete"),
  };
  const DRAG_TOOLS = ["wall", "bouncer", "wind", "gravity"];

  const btnClear = document.getElementById("btn-editor-clear");
  const btnPlaytest = document.getElementById("btn-editor-playtest");
  const btnExport = document.getElementById("btn-editor-export");
  const exportOutput = document.getElementById("editor-export-output");
  const btnCopyCode = document.getElementById("btn-editor-copy-code");
  const importInput = document.getElementById("editor-import-input");
  const btnImport = document.getElementById("btn-editor-import");
  const statusEl = document.getElementById("editor-status");
  const importStatusEl = document.getElementById("editor-import-status");
  const nameInput = document.getElementById("editor-level-name");
  const btnSave = document.getElementById("btn-editor-save");
  const myLevelsListEl = document.getElementById("editor-my-levels-list");

  // ---------- Stato editor ----------
  let tool = "wall";
  let launcher = { x: 110, y: 500 };
  let obstacles = []; // { x, y, w, h, type: "wall"|"bouncer" }
  let targets = []; // { x, y, r }
  let portals = []; // { x1, y1, x2, y2, r }
  let windZones = []; // { x, y, w, h, fx, fy }
  let gravityZones = []; // { x, y, w, h, strength }
  let pendingPortalPoint = null; // primo punto di un portale in attesa del secondo clic
  let dragStart = null;
  let dragCurrent = null;

  // Direzioni del vento: il tasto "Vento" le cicla ad ogni click quando è
  // già lo strumento attivo, cosi si può scegliere la direzione senza
  // affollare la toolbar con 4 bottoni separati.
  const WIND_DIRECTIONS = [
    { label: "💨 Vento →", fx: 0.0018, fy: 0 },
    { label: "💨 Vento ←", fx: -0.0018, fy: 0 },
    { label: "💨 Vento ↑", fx: 0, fy: -0.0018 },
    { label: "💨 Vento ↓", fx: 0, fy: 0.0018 },
  ];
  let windDirIndex = 0;

  // ---------- Utility ----------
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function clampNum(v, lo, hi, fallback) {
    const n = Number(v);
    if (!isFinite(n)) return fallback;
    return clamp(n, lo, hi);
  }
  function pointFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (CANVAS_W / rect.width),
      y: (evt.clientY - rect.top) * (CANVAS_H / rect.height),
    };
  }

  // ---------- Toast locale (riusa l'elemento #toast globale) ----------
  function showEditorToast(message) {
    const toastEl = document.getElementById("toast");
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.remove("hidden");
    requestAnimationFrame(() => toastEl.classList.add("visible"));
    setTimeout(() => {
      toastEl.classList.remove("visible");
      setTimeout(() => toastEl.classList.add("hidden"), 220);
    }, 1800);
  }

  function fallbackCopyText(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showEditorToast("Copiato negli appunti ✓");
    } catch (e) {
      showEditorToast("Copia non riuscita: seleziona e copia a mano");
    }
  }

  function copyText(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => showEditorToast("Copiato negli appunti ✓"))
        .catch(() => fallbackCopyText(text));
    } else {
      fallbackCopyText(text);
    }
  }

  // ---------- Codifica / decodifica livello ----------
  // encode/decode ora vivono in js/mylevels.js come window.LevelCodec,
  // condivisi anche col menu principale (per giocare i livelli salvati).
  function buildLevelFromEditor() {
    return {
      id: "custom",
      name: "LIVELLO PERSONALIZZATO",
      launcher: { x: launcher.x, y: launcher.y },
      ground: [{ x: 0, w: CANVAS_W }],
      groundRects: [{ x: CANVAS_W / 2, y: GROUND_TOP + 20, w: CANVAS_W, h: 40 }],
      obstacles: obstacles.map((o) => ({ type: o.type, x: o.x, y: o.y, w: o.w, h: o.h })),
      portals: portals.map((p) => ({ x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, r: p.r })),
      windZones: windZones.map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h, fx: z.fx, fy: z.fy })),
      gravityZones: gravityZones.map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h, strength: z.strength })),
      targets: targets.map((t) => ({ x: t.x, y: t.y, r: t.r })),
      par: targets.length + 1,
    };
  }

  // ---------- Stato / validazione ----------
  function updateStatus() {
    if (targets.length === 0) {
      statusEl.textContent = "Aggiungi almeno un bersaglio prima di testare o esportare.";
      statusEl.classList.add("warn");
      return;
    }
    const extras = [];
    if (portals.length) extras.push(`${portals.length} portali`);
    if (windZones.length) extras.push(`${windZones.length} zone vento`);
    if (gravityZones.length) extras.push(`${gravityZones.length} zone antigravità`);
    if (pendingPortalPoint) extras.push("portale: manca il secondo punto");
    const extraText = extras.length ? ` · ${extras.join(", ")}` : "";
    statusEl.textContent = `${obstacles.length} ostacoli · ${targets.length} bersagli${extraText} · par stimato ${targets.length + 1}`;
    statusEl.classList.remove("warn");
  }

  // Cancella: se il punto e' dentro un oggetto rettangolare (muro, trampolino,
  // zona vento/antigravita) lo elimina (il piu piccolo, se ce ne sono di
  // sovrapposti); altrimenti cerca il bersaglio o l'estremo di portale piu
  // vicino entro un raggio.
  function removeNearestAt(p) {
    const rectCandidates = [];
    obstacles.forEach((o, i) => {
      if (p.x > o.x - o.w / 2 && p.x < o.x + o.w / 2 && p.y > o.y - o.h / 2 && p.y < o.y + o.h / 2) {
        rectCandidates.push({ list: obstacles, index: i, area: o.w * o.h });
      }
    });
    windZones.forEach((z, i) => {
      if (p.x > z.x - z.w / 2 && p.x < z.x + z.w / 2 && p.y > z.y - z.h / 2 && p.y < z.y + z.h / 2) {
        rectCandidates.push({ list: windZones, index: i, area: z.w * z.h });
      }
    });
    gravityZones.forEach((z, i) => {
      if (p.x > z.x - z.w / 2 && p.x < z.x + z.w / 2 && p.y > z.y - z.h / 2 && p.y < z.y + z.h / 2) {
        rectCandidates.push({ list: gravityZones, index: i, area: z.w * z.h });
      }
    });
    if (rectCandidates.length) {
      rectCandidates.sort((a, b) => a.area - b.area);
      rectCandidates[0].list.splice(rectCandidates[0].index, 1);
      return;
    }

    const RADIUS = 30;
    let bestDist = RADIUS;
    let best = null;
    targets.forEach((t, i) => {
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      if (d < bestDist) {
        bestDist = d;
        best = { list: targets, index: i };
      }
    });
    portals.forEach((pt, i) => {
      const d = Math.min(Math.hypot(p.x - pt.x1, p.y - pt.y1), Math.hypot(p.x - pt.x2, p.y - pt.y2));
      if (d < bestDist) {
        bestDist = d;
        best = { list: portals, index: i };
      }
    });
    if (best) best.list.splice(best.index, 1);
  }

  // ---------- Rendering (statico, nessuna fisica) ----------
  const EDITOR_STARS = Array.from({ length: 40 }, () => ({
    x: Math.random() * CANVAS_W,
    y: Math.random() * CANVAS_H,
    size: Math.random() < 0.75 ? 2 : 3,
  }));

  function drawPixelBlock(x, y, w, h) {
    const shade = Math.max(3, Math.min(6, Math.round(Math.min(w, h) * 0.12)));
    ctx.save();
    ctx.fillStyle = "#6b4229";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#472b1a";
    ctx.fillRect(x, y + h - shade, w, shade);
    ctx.fillRect(x + w - shade, y, shade, h);
    ctx.fillStyle = "#8a5a3c";
    ctx.fillRect(x, y, w, shade);
    ctx.fillRect(x, y, shade, h);
    ctx.strokeStyle = "#0a0614";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.restore();
  }

  function drawTrampolineBlock(x, y, w, h) {
    ctx.save();
    ctx.fillStyle = "#ff5fd1";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#a83b8a";
    ctx.fillRect(x, y + h - 4, w, 4);
    ctx.fillStyle = "#ffffff";
    for (let i = 6; i < w - 4; i += 10) ctx.fillRect(x + i, y + 5, 4, 3);
    ctx.strokeStyle = "#0a0614";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.restore();
  }

  function drawPixelCircle(cx, cy, r, color) {
    const pixelSize = Math.max(2, Math.round(r / 4));
    ctx.save();
    ctx.fillStyle = color;
    for (let py = -r; py < r; py += pixelSize) {
      for (let px = -r; px < r; px += pixelSize) {
        if (Math.hypot(px + pixelSize / 2, py + pixelSize / 2) <= r) {
          ctx.fillRect(cx + px, cy + py, pixelSize, pixelSize);
        }
      }
    }
    ctx.restore();
  }

  function drawPortalPreview(p) {
    ctx.save();
    ctx.strokeStyle = "rgba(45, 226, 230, 0.3)";
    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x1, p.y1);
    ctx.lineTo(p.x2, p.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    [
      [p.x1, p.y1],
      [p.x2, p.y2],
    ].forEach(([x, y]) => {
      drawPixelCircle(x, y, p.r, "#2de2e6");
      drawPixelCircle(x, y, p.r * 0.6, "#1b1035");
      drawPixelCircle(x, y, p.r * 0.3, "#2de2e6");
    });
  }

  function drawWindZonePreview(z) {
    ctx.save();
    ctx.strokeStyle = "rgba(45, 226, 230, 0.3)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
    ctx.setLineDash([]);
    ctx.fillStyle = "#2de2e6";
    const s = 4;
    const horizontal = Math.abs(z.fx || 0) >= Math.abs(z.fy || 0);
    if (horizontal) {
      const dir = (z.fx || 0) >= 0 ? 1 : -1;
      ctx.fillRect(z.x - 8 * dir, z.y - 8, s, s);
      ctx.fillRect(z.x - 4 * dir, z.y - 4, s, s);
      ctx.fillRect(z.x, z.y, s, s);
      ctx.fillRect(z.x - 4 * dir, z.y + 4, s, s);
      ctx.fillRect(z.x - 8 * dir, z.y + 8, s, s);
    } else {
      const dir = (z.fy || 0) >= 0 ? 1 : -1;
      ctx.fillRect(z.x - 8, z.y - 8 * dir, s, s);
      ctx.fillRect(z.x - 4, z.y - 4 * dir, s, s);
      ctx.fillRect(z.x, z.y, s, s);
      ctx.fillRect(z.x + 4, z.y - 4 * dir, s, s);
      ctx.fillRect(z.x + 8, z.y - 8 * dir, s, s);
    }
    ctx.restore();
  }

  function drawGravityZonePreview(z) {
    ctx.save();
    ctx.strokeStyle = "rgba(190, 120, 255, 0.3)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
    ctx.setLineDash([]);
    ctx.fillStyle = "#be78ff";
    ctx.fillRect(z.x - 2, z.y - 2, 4, 4);
    ctx.fillRect(z.x - 22, z.y + 16, 4, 4);
    ctx.fillRect(z.x + 22, z.y - 16, 4, 4);
    ctx.restore();
  }

  function renderEditor() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "#1b1035";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "rgba(255, 248, 231, 0.5)";
    EDITOR_STARS.forEach((s) => ctx.fillRect(s.x, s.y, s.size, s.size));

    drawPixelBlock(0, GROUND_TOP, CANVAS_W, 40);

    windZones.forEach(drawWindZonePreview);
    gravityZones.forEach(drawGravityZonePreview);

    obstacles.forEach((o) => {
      if (o.type === "bouncer") drawTrampolineBlock(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      else drawPixelBlock(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
    });

    portals.forEach(drawPortalPreview);
    if (pendingPortalPoint) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "#2de2e6";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pendingPortalPoint.x, pendingPortalPoint.y, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (DRAG_TOOLS.includes(tool) && dragStart && dragCurrent) {
      const x1 = Math.min(dragStart.x, dragCurrent.x);
      const y1 = Math.min(dragStart.y, dragCurrent.y);
      const w = Math.abs(dragCurrent.x - dragStart.x);
      const h = Math.abs(dragCurrent.y - dragStart.y);
      ctx.save();
      ctx.strokeStyle = "#ffd23f";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, w, h);
      ctx.setLineDash([]);
      ctx.restore();
    }

    targets.forEach((t) => {
      drawPixelCircle(t.x, t.y, t.r, "#ff3860");
      drawPixelCircle(t.x, t.y, t.r * 0.62, "#1b1035");
      drawPixelCircle(t.x, t.y, t.r * 0.3, "#ff3860");
    });

    ctx.save();
    ctx.fillStyle = "rgba(255, 248, 231, 0.5)";
    ctx.fillRect(launcher.x - 15, launcher.y, 4, Math.max(0, GROUND_TOP - launcher.y));
    ctx.fillRect(launcher.x + 11, launcher.y, 4, Math.max(0, GROUND_TOP - launcher.y));
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(launcher.x - 3, launcher.y - 3, 6, 6);
    ctx.restore();
  }

  // ---------- Input ----------
  canvas.addEventListener("pointerdown", (evt) => {
    const p = pointFromEvent(evt);
    if (tool === "launcher") {
      launcher = { x: clamp(p.x, 40, CANVAS_W - 40), y: clamp(p.y, 80, GROUND_TOP - 10) };
      renderEditor();
      return;
    }
    if (tool === "target") {
      targets.push({ x: clamp(p.x, 20, CANVAS_W - 20), y: clamp(p.y, 20, GROUND_TOP - 5), r: 20 });
      updateStatus();
      renderEditor();
      return;
    }
    if (tool === "delete") {
      removeNearestAt(p);
      updateStatus();
      renderEditor();
      return;
    }
    if (tool === "portal") {
      const clamped = { x: clamp(p.x, 24, CANVAS_W - 24), y: clamp(p.y, 24, GROUND_TOP - 10) };
      if (!pendingPortalPoint) {
        pendingPortalPoint = clamped;
      } else {
        portals.push({ x1: pendingPortalPoint.x, y1: pendingPortalPoint.y, x2: clamped.x, y2: clamped.y, r: 24 });
        pendingPortalPoint = null;
      }
      updateStatus();
      renderEditor();
      return;
    }
    if (DRAG_TOOLS.includes(tool)) {
      dragStart = p;
      dragCurrent = p;
      canvas.setPointerCapture(evt.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (evt) => {
    if (DRAG_TOOLS.includes(tool) && dragStart) {
      dragCurrent = pointFromEvent(evt);
      renderEditor();
    }
  });

  function finishDragShape(evt) {
    if (!DRAG_TOOLS.includes(tool) || !dragStart) return;
    const p2 = pointFromEvent(evt);
    const x1 = Math.min(dragStart.x, p2.x);
    const y1 = Math.min(dragStart.y, p2.y);
    const w = Math.abs(p2.x - dragStart.x);
    const h = Math.abs(p2.y - dragStart.y);
    if (w >= 12 && h >= 12) {
      const cx = x1 + w / 2;
      const cy = y1 + h / 2;
      if (tool === "wall") obstacles.push({ x: cx, y: cy, w, h, type: "wall" });
      else if (tool === "bouncer") obstacles.push({ x: cx, y: cy, w, h, type: "bouncer" });
      else if (tool === "wind") {
        const dir = WIND_DIRECTIONS[windDirIndex];
        windZones.push({ x: cx, y: cy, w, h, fx: dir.fx, fy: dir.fy });
      } else if (tool === "gravity") gravityZones.push({ x: cx, y: cy, w, h, strength: 2.1 });
    }
    dragStart = null;
    dragCurrent = null;
    updateStatus();
    renderEditor();
  }
  canvas.addEventListener("pointerup", finishDragShape);
  canvas.addEventListener("pointercancel", finishDragShape);

  // ---------- Toolbar ----------
  Object.entries(toolButtons).forEach(([key, btn]) => {
    if (!btn || key === "wind") return;
    btn.addEventListener("click", () => {
      tool = key;
      pendingPortalPoint = null;
      dragStart = null;
      dragCurrent = null;
      Object.values(toolButtons).forEach((b) => b && b.classList.remove("active"));
      btn.classList.add("active");
      updateStatus();
      renderEditor();
    });
  });
  if (toolButtons.wall) toolButtons.wall.classList.add("active");

  // Il tasto vento è speciale: un primo click lo seleziona, i click
  // successivi (mentre è già lo strumento attivo) cambiano la direzione.
  if (toolButtons.wind) {
    toolButtons.wind.addEventListener("click", () => {
      if (tool === "wind") {
        windDirIndex = (windDirIndex + 1) % WIND_DIRECTIONS.length;
        toolButtons.wind.textContent = WIND_DIRECTIONS[windDirIndex].label;
      } else {
        tool = "wind";
        pendingPortalPoint = null;
        dragStart = null;
        dragCurrent = null;
        Object.values(toolButtons).forEach((b) => b && b.classList.remove("active"));
        toolButtons.wind.classList.add("active");
        toolButtons.wind.textContent = WIND_DIRECTIONS[windDirIndex].label;
      }
      updateStatus();
      renderEditor();
    });
  }

  btnClear.addEventListener("click", () => {
    obstacles = [];
    targets = [];
    portals = [];
    windZones = [];
    gravityZones = [];
    pendingPortalPoint = null;
    launcher = { x: 110, y: 500 };
    currentSaveId = null;
    nameInput.value = "";
    exportOutput.value = "";
    exportOutput.classList.add("hidden");
    updateStatus();
    renderEditor();
    renderMyLevelsList();
  });

  btnPlaytest.addEventListener("click", () => {
    if (targets.length === 0) {
      updateStatus();
      return;
    }
    const level = buildLevelFromEditor();
    const code = window.LevelCodec.encode(level);
    if (window.ArcGame) window.ArcGame.playCustom(level, code);
  });

  btnExport.addEventListener("click", () => {
    if (targets.length === 0) {
      updateStatus();
      return;
    }
    const level = buildLevelFromEditor();
    const code = window.LevelCodec.encode(level);
    exportOutput.value = code;
    exportOutput.classList.remove("hidden");
    if (window.Achievements) {
      const def = window.Achievements.unlock("architect");
      if (def) showEditorToast(`🏆 Obiettivo sbloccato: ${def.name}`);
    }
  });

  btnCopyCode.addEventListener("click", () => copyText(exportOutput.value));

  // ---------- Salvataggio nella libreria personale (localStorage) ----------
  let currentSaveId = null;

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderMyLevelsList() {
    const entries = window.MyLevels ? window.MyLevels.list() : [];
    myLevelsListEl.innerHTML = "";
    if (entries.length === 0) {
      myLevelsListEl.innerHTML = '<p class="my-levels-empty">Nessun livello salvato ancora.</p>';
      return;
    }
    entries.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "my-level-item" + (entry.id === currentSaveId ? " current" : "");
      item.innerHTML = `
        <span class="my-level-name">${escapeHtml(entry.name)}</span>
        <div class="my-level-actions">
          <button class="hud-btn" data-action="edit" title="Ricarica per modificare">✏️</button>
          <button class="hud-btn" data-action="delete" title="Elimina">🗑</button>
        </div>
      `;
      item.querySelector('[data-action="edit"]').addEventListener("click", () => {
        SoundEngine.playClick();
        loadSavedLevelIntoEditor(entry.id);
      });
      item.querySelector('[data-action="delete"]').addEventListener("click", () => {
        if (!confirm(`Eliminare "${entry.name}"?`)) return;
        window.MyLevels.remove(entry.id);
        if (currentSaveId === entry.id) currentSaveId = null;
        SoundEngine.playClick();
        renderMyLevelsList();
      });
      myLevelsListEl.appendChild(item);
    });
  }

  function loadSavedLevelIntoEditor(id) {
    const level = window.MyLevels.get(id);
    if (!level) return;
    launcher = { x: level.launcher.x, y: level.launcher.y };
    obstacles = (level.obstacles || []).map((o) => ({ ...o }));
    targets = (level.targets || []).map((t) => ({ ...t }));
    portals = (level.portals || []).map((p) => ({ ...p }));
    windZones = (level.windZones || []).map((z) => ({ ...z }));
    gravityZones = (level.gravityZones || []).map((z) => ({ ...z }));
    pendingPortalPoint = null;
    dragStart = null;
    dragCurrent = null;
    currentSaveId = id;
    const meta = window.MyLevels.list().find((e) => e.id === id);
    nameInput.value = meta ? meta.name : "";
    updateStatus();
    renderEditor();
    renderMyLevelsList();
    showEditorToast(`Caricato "${nameInput.value}" — puoi continuare a modificarlo`);
  }

  btnSave.addEventListener("click", () => {
    if (targets.length === 0) {
      updateStatus();
      return;
    }
    if (!window.MyLevels) return;
    const level = buildLevelFromEditor();
    const name = nameInput.value.trim() || "Livello senza nome";
    currentSaveId = window.MyLevels.upsert(currentSaveId, name, level);
    nameInput.value = name;
    SoundEngine.playClick();
    showEditorToast(`Salvato come "${name}" ✓`);
    renderMyLevelsList();
  });

  // Espone il caricamento anche al menu principale, per "✏️ Modifica" dalla
  // libreria di livelli (vedi game.js).
  window.ArcEditor = {
    loadSavedLevel(id) {
      screenMenuEl.classList.add("hidden");
      screenEditorEl.classList.remove("hidden");
      loadSavedLevelIntoEditor(id);
    },
  };

  btnImport.addEventListener("click", () => {
    const raw = importInput.value.trim();
    importStatusEl.textContent = "";
    if (!raw) return;
    try {
      const level = window.LevelCodec.decode(raw);
      if (window.ArcGame) window.ArcGame.playCustom(level, raw);
    } catch (e) {
      importStatusEl.textContent = "Codice non valido: controlla di averlo copiato per intero.";
    }
  });

  btnOpenEditor.addEventListener("click", () => {
    screenMenuEl.classList.add("hidden");
    screenEditorEl.classList.remove("hidden");
    updateStatus();
    renderEditor();
    renderMyLevelsList();
  });

  btnEditorMenu.addEventListener("click", () => {
    screenEditorEl.classList.add("hidden");
    screenMenuEl.classList.remove("hidden");
  });

  renderEditor();
  updateStatus();
  renderMyLevelsList();
})();
