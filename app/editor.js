/*
  ARC — editor di livelli
  Modulo indipendente con il proprio canvas statico (nessuna fisica qui:
  serve solo a piazzare oggetti). Il "Playtest" e l'importazione passano il
  livello disegnato al motore di gioco vero tramite window.ArcGame.playCustom().

  LIMITI DELLA V1 (scelta per ridurre il rischio di livelli rotti/impossibili
  da giocare, dato che non posso playtestarli io stesso in un browser):
  - il terreno è sempre a larghezza piena, senza voragini
  - niente portali / correnti / ingranaggi — solo muri e bersagli
  - il par è calcolato automaticamente (bersagli + 1)
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
    target: document.getElementById("tool-target"),
    launcher: document.getElementById("tool-launcher"),
    delete: document.getElementById("tool-delete"),
  };
  const btnClear = document.getElementById("btn-editor-clear");
  const btnPlaytest = document.getElementById("btn-editor-playtest");
  const btnExport = document.getElementById("btn-editor-export");
  const exportOutput = document.getElementById("editor-export-output");
  const btnCopyCode = document.getElementById("btn-editor-copy-code");
  const importInput = document.getElementById("editor-import-input");
  const btnImport = document.getElementById("btn-editor-import");
  const statusEl = document.getElementById("editor-status");
  const importStatusEl = document.getElementById("editor-import-status");

  // ---------- Stato editor ----------
  let tool = "wall";
  let launcher = { x: 110, y: 500 };
  let obstacles = []; // { x, y, w, h } — rettangoli centrati
  let targets = []; // { x, y, r }
  let dragStart = null;
  let dragCurrent = null;

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
  function buildLevelFromEditor() {
    return {
      id: "custom",
      name: "LIVELLO PERSONALIZZATO",
      launcher: { x: launcher.x, y: launcher.y },
      ground: [{ x: 0, w: CANVAS_W }],
      groundRects: [{ x: CANVAS_W / 2, y: GROUND_TOP + 20, w: CANVAS_W, h: 40 }],
      obstacles: obstacles.map((o) => ({ type: "wall", x: o.x, y: o.y, w: o.w, h: o.h })),
      portals: [],
      windZones: [],
      targets: targets.map((t) => ({ x: t.x, y: t.y, r: t.r })),
      par: targets.length + 1,
    };
  }

  function encodeLevel(level) {
    const payload = {
      v: 1,
      launcher: level.launcher,
      obstacles: level.obstacles.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h })),
      targets: level.targets.map((t) => ({ x: t.x, y: t.y, r: t.r })),
      par: level.par,
    };
    return btoa(JSON.stringify(payload));
  }

  function decodeLevel(code) {
    const payload = JSON.parse(atob(code.trim()));
    if (!payload || typeof payload !== "object") throw new Error("payload non valido");
    if (!payload.launcher || typeof payload.launcher.x !== "number" || typeof payload.launcher.y !== "number") {
      throw new Error("lanciatore mancante");
    }
    if (!Array.isArray(payload.targets) || payload.targets.length === 0) {
      throw new Error("nessun bersaglio");
    }
    const safeObstacles = (Array.isArray(payload.obstacles) ? payload.obstacles : []).slice(0, 60).map((o) => ({
      type: "wall",
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
      portals: [],
      windZones: [],
      targets: safeTargets,
      par,
    };
  }

  // ---------- Stato / validazione ----------
  function updateStatus() {
    if (targets.length === 0) {
      statusEl.textContent = "Aggiungi almeno un bersaglio prima di testare o esportare.";
      statusEl.classList.add("warn");
    } else {
      statusEl.textContent = `${obstacles.length} ostacoli · ${targets.length} bersagli · par stimato ${targets.length + 1}`;
      statusEl.classList.remove("warn");
    }
  }

  function removeNearestAt(p) {
    const RADIUS = 30;
    let bestType = null;
    let bestIndex = -1;
    let bestDist = RADIUS;
    targets.forEach((t, i) => {
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      if (d < bestDist) {
        bestDist = d;
        bestType = "target";
        bestIndex = i;
      }
    });
    obstacles.forEach((o, i) => {
      const d = Math.hypot(p.x - o.x, p.y - o.y);
      if (d < bestDist) {
        bestDist = d;
        bestType = "obstacle";
        bestIndex = i;
      }
    });
    if (bestType === "target") targets.splice(bestIndex, 1);
    else if (bestType === "obstacle") obstacles.splice(bestIndex, 1);
  }

  // ---------- Rendering (statico, nessuna fisica) ----------
  function drawRectOutline(x, y, w, h) {
    ctx.save();
    ctx.fillStyle = "rgba(232, 238, 245, 0.06)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#e8eef5";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function renderEditor() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "#0f2a4a";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    for (let x = 0; x <= CANVAS_W; x += 20) {
      ctx.strokeStyle = x % 100 === 0 ? "rgba(232, 238, 245, 0.16)" : "rgba(232, 238, 245, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, CANVAS_H);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += 20) {
      ctx.strokeStyle = y % 100 === 0 ? "rgba(232, 238, 245, 0.16)" : "rgba(232, 238, 245, 0.08)";
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(CANVAS_W, y + 0.5);
      ctx.stroke();
    }

    drawRectOutline(0, GROUND_TOP, CANVAS_W, 40);
    obstacles.forEach((o) => drawRectOutline(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h));

    if (tool === "wall" && dragStart && dragCurrent) {
      const x1 = Math.min(dragStart.x, dragCurrent.x);
      const y1 = Math.min(dragStart.y, dragCurrent.y);
      const w = Math.abs(dragCurrent.x - dragStart.x);
      const h = Math.abs(dragCurrent.y - dragStart.y);
      ctx.save();
      ctx.strokeStyle = "#ffb020";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, w, h);
      ctx.setLineDash([]);
      ctx.restore();
    }

    targets.forEach((t) => {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.strokeStyle = "#ff5c5c";
      ctx.lineWidth = 2;
      [1, 0.6].forEach((f) => {
        ctx.beginPath();
        ctx.arc(0, 0, t.r * f, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    });

    ctx.save();
    ctx.strokeStyle = "rgba(232, 238, 245, 0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(launcher.x - 14, GROUND_TOP);
    ctx.lineTo(launcher.x - 14, launcher.y);
    ctx.moveTo(launcher.x + 14, GROUND_TOP);
    ctx.lineTo(launcher.x + 14, launcher.y);
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(launcher.x, launcher.y, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
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
    if (tool === "wall") {
      dragStart = p;
      dragCurrent = p;
      canvas.setPointerCapture(evt.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (evt) => {
    if (tool === "wall" && dragStart) {
      dragCurrent = pointFromEvent(evt);
      renderEditor();
    }
  });

  function finishWallDrag(evt) {
    if (tool !== "wall" || !dragStart) return;
    const p2 = pointFromEvent(evt);
    const x1 = Math.min(dragStart.x, p2.x);
    const y1 = Math.min(dragStart.y, p2.y);
    const w = Math.abs(p2.x - dragStart.x);
    const h = Math.abs(p2.y - dragStart.y);
    if (w >= 12 && h >= 12) {
      obstacles.push({ x: x1 + w / 2, y: y1 + h / 2, w, h });
    }
    dragStart = null;
    dragCurrent = null;
    updateStatus();
    renderEditor();
  }
  canvas.addEventListener("pointerup", finishWallDrag);
  canvas.addEventListener("pointercancel", finishWallDrag);

  // ---------- Toolbar ----------
  Object.entries(toolButtons).forEach(([key, btn]) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      tool = key;
      Object.values(toolButtons).forEach((b) => b && b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
  if (toolButtons.wall) toolButtons.wall.classList.add("active");

  btnClear.addEventListener("click", () => {
    obstacles = [];
    targets = [];
    launcher = { x: 110, y: 500 };
    exportOutput.value = "";
    exportOutput.classList.add("hidden");
    updateStatus();
    renderEditor();
  });

  btnPlaytest.addEventListener("click", () => {
    if (targets.length === 0) {
      updateStatus();
      return;
    }
    const level = buildLevelFromEditor();
    const code = encodeLevel(level);
    if (window.ArcGame) window.ArcGame.playCustom(level, code);
  });

  btnExport.addEventListener("click", () => {
    if (targets.length === 0) {
      updateStatus();
      return;
    }
    const level = buildLevelFromEditor();
    const code = encodeLevel(level);
    exportOutput.value = code;
    exportOutput.classList.remove("hidden");
    if (window.Achievements) {
      const def = window.Achievements.unlock("architect");
      if (def) showEditorToast(`🏆 Obiettivo sbloccato: ${def.name}`);
    }
  });

  btnCopyCode.addEventListener("click", () => copyText(exportOutput.value));

  btnImport.addEventListener("click", () => {
    const raw = importInput.value.trim();
    importStatusEl.textContent = "";
    if (!raw) return;
    try {
      const level = decodeLevel(raw);
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
  });

  btnEditorMenu.addEventListener("click", () => {
    screenEditorEl.classList.add("hidden");
    screenMenuEl.classList.remove("hidden");
  });

  renderEditor();
  updateStatus();
})();
