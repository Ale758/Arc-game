/*
  ARC — motore di gioco
  Fisica: Matter.js (via CDN, vedi index.html)
  Rendering: Canvas 2D disegnato a mano (stile "disegno tecnico / blueprint")

  Se i livelli ti sembrano troppo facili/difficili una volta provati nel
  browser, i valori da tarare sono qui sotto: POWER_SCALE, MAX_DRAG e la
  gravità del mondo (world.gravity.y).
*/

(function () {
  "use strict";

  // ---------- Costanti di gioco ----------
  const POWER_SCALE = 0.16; // moltiplicatore velocità di lancio in base al drag
  const MAX_DRAG = 95; // distanza massima di trazione della fionda (px)
  const CATCH_RADIUS = 46; // raggio entro cui puoi afferrare la pallina
  const SETTLE_SPEED = 0.05; // sotto questa velocità la pallina è "ferma"
  const SETTLE_FRAMES = 45; // frame consecutivi fermi prima del reset
  const OUT_OF_BOUNDS_Y = CANVAS_H + 120;

  // Meccanica "inchiostro permanente": ogni tiro mancato lascia un segno che
  // diventa un ostacolo fisico reale per i tiri successivi nello stesso livello.
  const TRAIL_MIN_DIST = 10; // distanza minima tra due punti campionati della scia
  const TRAIL_THICKNESS = 5; // spessore dei segmenti di inchiostro solidificato
  const TRAIL_EXCLUDE_LAUNCHER_R = 70; // non solidificare inchiostro troppo vicino al lancio

  // Juice: scuotimento schermo e particelle
  const SHAKE_DECAY = 0.88;
  const PARTICLE_GRAVITY = 0.15;

  const STORAGE_KEY = "arc-game-progress-v1";
  const TUTORIAL_KEY = "arc-game-tutorial-seen-v1";
  const SHARE_URL = ""; // opzionale: incolla qui l'URL pubblicato, verrà aggiunto ai testi condivisi

  // ---------- Riferimenti DOM ----------
  const screenMenu = document.getElementById("screen-menu");
  const screenGame = document.getElementById("screen-game");
  const levelGrid = document.getElementById("level-grid");
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const hud = document.getElementById("hud");
  const hudLevelName = document.getElementById("hud-level-name");
  const hudShots = document.getElementById("hud-shots");
  const hudTargets = document.getElementById("hud-targets");
  const hudInk = document.getElementById("hud-ink");
  const btnReset = document.getElementById("btn-reset");
  const btnMenu = document.getElementById("btn-menu");
  const overlayComplete = document.getElementById("overlay-complete");
  const overlayStars = document.getElementById("overlay-stars");
  const overlayShotsUsed = document.getElementById("overlay-shots-used");
  const btnRetry = document.getElementById("btn-retry");
  const btnNext = document.getElementById("btn-next");
  const btnOverlayMenu = document.getElementById("btn-overlay-menu");
  const btnShare = document.getElementById("btn-share");
  const btnShareProgress = document.getElementById("btn-share-progress");
  const overlayTutorial = document.getElementById("overlay-tutorial");
  const btnTutorialOk = document.getElementById("btn-tutorial-ok");
  const toast = document.getElementById("toast");

  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  // ---------- Audio: sblocco al primo gesto + tasto muto ----------
  const btnMute = document.getElementById("btn-mute");

  function unlockAudioOnce() {
    SoundEngine.unlock();
    document.removeEventListener("pointerdown", unlockAudioOnce);
    document.removeEventListener("keydown", unlockAudioOnce);
  }
  document.addEventListener("pointerdown", unlockAudioOnce);
  document.addEventListener("keydown", unlockAudioOnce);

  function updateMuteButton() {
    btnMute.textContent = SoundEngine.isMuted() ? "🔇" : "🔊";
  }
  btnMute.addEventListener("click", () => {
    SoundEngine.toggleMute();
    updateMuteButton();
    SoundEngine.playClick();
  });
  updateMuteButton();

  // ---------- Persistenza progressi ----------
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }

  function saveProgress(progress) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (e) {
      /* localStorage non disponibile: il gioco funziona comunque, solo senza salvataggio */
    }
  }

  let progress = loadProgress(); // { [levelId]: bestStars }

  // ---------- Stato di gioco ----------
  const Engine = Matter.Engine;
  const World = Matter.World;
  const Bodies = Matter.Bodies;
  const Body = Matter.Body;
  const Events = Matter.Events;

  let engine, world;
  let currentLevelIndex = 0;
  let ballBody = null;
  let ballHeld = true; // true finché non viene lanciata
  let targetBodies = [];
  let hitTargetIds = new Set();
  let shotsUsed = 0;
  let settleCounter = 0;
  let levelDone = false;
  let rafId = null;

  let isDragging = false;
  let dragPoint = null; // punto corrente del trascinamento (mondo canvas)
  let pointerId = null;

  // Inchiostro permanente / juice
  let currentTrail = []; // punti della scia del tiro in corso
  let inkTrails = []; // scie "asciugate" già solidificate (array di array di punti)
  let particles = []; // frammenti tecnici generati da impatti/colpi
  let shakeMag = 0; // intensità corrente dello scuotimento schermo
  let tutorialActive = false;
  let lastCompletionStars = 0;
  let toastTimeout = null;

  // ---------- Costruzione livello ----------
  function buildLevel(index) {
    const level = LEVELS[index];

    engine = Engine.create();
    engine.world.gravity.y = 1;
    world = engine.world;

    hitTargetIds = new Set();
    shotsUsed = 0;
    settleCounter = 0;
    levelDone = false;
    ballHeld = true;
    currentTrail = [];
    inkTrails = [];
    particles = [];
    shakeMag = 0;

    const bodies = [];

    // Terreno
    level.groundRects.forEach((g) => {
      bodies.push(
        Bodies.rectangle(g.x, g.y, g.w, g.h, {
          isStatic: true,
          friction: 0.9,
          restitution: 0.1,
          label: "ground",
        })
      );
    });

    // Muri di contenimento invisibili (soffitto e bordo sinistro), il fondo/i lati
    // restano "aperti" cosi la pallina puo cadere fuori (voragine / tiro sbagliato)
    bodies.push(
      Bodies.rectangle(CANVAS_W / 2, -20, CANVAS_W * 2, 40, {
        isStatic: true,
        label: "ceiling",
      })
    );

    // Ostacoli statici
    level.obstacles.forEach((o) => {
      const body = Bodies.rectangle(o.x, o.y, o.w, o.h, {
        isStatic: true,
        angle: o.angle || 0,
        friction: 0.6,
        restitution: 0.35,
        label: "obstacle",
      });
      bodies.push(body);
    });

    World.add(world, bodies);

    // Target (creati separatamente, li teniamo tracciati per il movimento)
    targetBodies = level.targets.map((t, i) => {
      const body = Bodies.circle(t.x, t.y, t.r, {
        isStatic: true,
        isSensor: false,
        restitution: 0,
        friction: 0.8,
        label: "target",
      });
      body.targetIndex = i;
      body.targetDef = t;
      World.add(world, body);
      return body;
    });

    spawnBall(level);
    updateHud(level);
    setupCollisionHandler();
    maybeShowTutorial(index);
  }

  function spawnBall(level) {
    if (ballBody) {
      World.remove(world, ballBody);
    }
    ballBody = Bodies.circle(level.launcher.x, level.launcher.y, 16, {
      isStatic: true,
      restitution: 0.55,
      friction: 0.4,
      frictionAir: 0.0008,
      density: 0.004,
      label: "ball",
    });
    World.add(world, ballBody);
    ballHeld = true;
    settleCounter = 0;
    currentTrail = [];
  }

  const BOUNCE_MIN_SPEED = 1.5; // sotto questa velocità di impatto non si sente nulla (contatti di appoggio)
  const BOUNCE_REF_SPEED = 14; // velocità di impatto considerata "forte" per il volume del suono
  let lastBounceTime = 0;

  function setupCollisionHandler() {
    Events.on(engine, "collisionStart", (event) => {
      if (levelDone) return;
      event.pairs.forEach((pair) => {
        const a = pair.bodyA;
        const b = pair.bodyB;
        const ball = a.label === "ball" ? a : b.label === "ball" ? b : null;
        if (!ball) return;
        const other = ball === a ? b : a;

        if (other.label === "target") {
          registerTargetHit(other);
          return;
        }
        if (other.label === "ground" || other.label === "obstacle" || other.label === "ink") {
          const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
          const now = performance.now();
          if (speed > BOUNCE_MIN_SPEED && now - lastBounceTime > 40) {
            lastBounceTime = now;
            const intensity = Math.min(speed / BOUNCE_REF_SPEED, 1);
            SoundEngine.playBounce(intensity);
            spawnBurst(ball.position.x, ball.position.y, "rgba(232, 238, 245, 0.7)", 3 + Math.round(intensity * 3), [1, 2 + intensity * 3]);
            shakeMag = Math.min(shakeMag + intensity * 5, 10);
            if (intensity > 0.35) vibrate(Math.round(10 + intensity * 20));
          }
        }
      });
    });
  }

  function registerTargetHit(targetBody) {
    if (hitTargetIds.has(targetBody.targetIndex)) return;
    hitTargetIds.add(targetBody.targetIndex);
    SoundEngine.playTargetHit(hitTargetIds.size - 1);
    spawnBurst(targetBody.position.x, targetBody.position.y, "#ff5c5c", 12, [2, 5]);
    shakeMag = Math.min(shakeMag + 6, 12);
    vibrate([15, 30, 15]);
    const level = LEVELS[currentLevelIndex];
    updateHud(level);
    if (hitTargetIds.size >= targetBodies.length) {
      finishLevel();
    }
  }

  function finishLevel() {
    levelDone = true;
    const level = LEVELS[currentLevelIndex];
    const stars = computeStars(level, shotsUsed);
    lastCompletionStars = stars;
    const best = Math.max(stars, progress[level.id] || 0);
    progress[level.id] = best;
    saveProgress(progress);
    SoundEngine.playLevelComplete(stars);
    targetBodies.forEach((b) => spawnBurst(b.position.x, b.position.y, "#ffb020", 14, [2, 6]));
    shakeMag = Math.min(shakeMag + 9, 14);
    vibrate([20, 40, 20, 40, 30]);
    showCompleteOverlay(stars, shotsUsed);
  }

  function computeStars(level, shots) {
    if (shots <= level.par) return 3;
    if (shots <= level.par + 2) return 2;
    return 1;
  }

  // ---------- Ciclo di gioco ----------
  function tick(timestamp) {
    Engine.update(engine, 1000 / 60);
    updateMovingTargets(timestamp);
    if (!levelDone) {
      checkBallState();
      recordTrailPoint();
    }
    updateParticles();
    shakeMag = shakeMag > 0.1 ? shakeMag * SHAKE_DECAY : 0;
    render();
    rafId = requestAnimationFrame(tick);
  }

  function recordTrailPoint() {
    if (!ballBody || ballHeld) return;
    if (currentTrail.length > 400) return; // limite di sicurezza per tiri molto lunghi
    const p = ballBody.position;
    const last = currentTrail[currentTrail.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= TRAIL_MIN_DIST) {
      currentTrail.push({ x: p.x, y: p.y });
    }
  }

  function updateMovingTargets(timestamp) {
    targetBodies.forEach((body) => {
      const def = body.targetDef;
      if (!def.movement) return;
      const m = def.movement;
      const offset = Math.sin(timestamp * m.speed) * m.amplitude;
      if (m.axis === "y") {
        Body.setPosition(body, { x: def.x, y: m.center + offset });
      } else {
        Body.setPosition(body, { x: m.center + offset, y: def.y });
      }
    });
  }

  function checkBallState() {
    if (!ballBody || ballHeld) return;

    if (
      ballBody.position.y > OUT_OF_BOUNDS_Y ||
      ballBody.position.x < -150 ||
      ballBody.position.x > CANVAS_W + 150
    ) {
      SoundEngine.playMiss();
      vibrate(25);
      resetShotBall();
      return;
    }

    const speed = Math.hypot(ballBody.velocity.x, ballBody.velocity.y);
    if (speed < SETTLE_SPEED) {
      settleCounter++;
      if (settleCounter > SETTLE_FRAMES) {
        resetShotBall();
      }
    } else {
      settleCounter = 0;
    }
  }

  function resetShotBall() {
    commitTrail();
    const level = LEVELS[currentLevelIndex];
    spawnBall(level);
    updateHud(level);
  }

  // Trasforma la scia del tiro appena concluso in ostacoli fisici permanenti.
  // I punti troppo vicini al lanciatore vengono esclusi spezzando la scia in
  // tratti separati, cosi non si creano segmenti che "saltano" nel vuoto.
  function commitTrail() {
    const level = LEVELS[currentLevelIndex];
    const launcher = level.launcher;
    const runs = [];
    let run = [];
    currentTrail.forEach((pt) => {
      const nearLauncher = Math.hypot(pt.x - launcher.x, pt.y - launcher.y) < TRAIL_EXCLUDE_LAUNCHER_R;
      if (nearLauncher) {
        if (run.length >= 2) runs.push(run);
        run = [];
      } else {
        run.push(pt);
      }
    });
    if (run.length >= 2) runs.push(run);

    const bodies = [];
    runs.forEach((pts) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len < 3) continue;
        bodies.push(
          Bodies.rectangle((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, len, TRAIL_THICKNESS, {
            isStatic: true,
            angle: Math.atan2(dy, dx),
            friction: 0.5,
            restitution: 0.3,
            label: "ink",
          })
        );
      }
      inkTrails.push(pts);
    });
    if (bodies.length) World.add(world, bodies);
    currentTrail = [];
  }

  // ---------- Particelle e feedback tattile ----------
  function spawnBurst(x, y, color, count, speedRange) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const speed = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.25,
        color,
        len: 6 + Math.random() * 6,
      });
    }
  }

  function updateParticles() {
    particles = particles.filter((p) => {
      p.life += 1 / 60;
      p.vy += PARTICLE_GRAVITY;
      p.x += p.vx;
      p.y += p.vy;
      return p.life < p.maxLife;
    });
  }

  function vibrate(pattern) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        /* Vibration API non disponibile: nessun problema, si prosegue senza */
      }
    }
  }

  // ---------- Input (fionda) ----------
  function canvasPointFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
    };
  }

  function clampDrag(launcher, point) {
    const dx = point.x - launcher.x;
    const dy = point.y - launcher.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= MAX_DRAG) return point;
    const ratio = MAX_DRAG / dist;
    return { x: launcher.x + dx * ratio, y: launcher.y + dy * ratio };
  }

  canvas.addEventListener("pointerdown", (evt) => {
    if (levelDone || !ballHeld) return;
    const p = canvasPointFromEvent(evt);
    const level = LEVELS[currentLevelIndex];
    const dist = Math.hypot(p.x - level.launcher.x, p.y - level.launcher.y);
    if (dist <= CATCH_RADIUS + MAX_DRAG) {
      isDragging = true;
      pointerId = evt.pointerId;
      dragPoint = clampDrag(level.launcher, p);
      Body.setPosition(ballBody, dragPoint);
      canvas.setPointerCapture(evt.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (evt) => {
    if (!isDragging || evt.pointerId !== pointerId) return;
    const p = canvasPointFromEvent(evt);
    const level = LEVELS[currentLevelIndex];
    dragPoint = clampDrag(level.launcher, p);
    Body.setPosition(ballBody, dragPoint);
  });

  function releaseDrag(evt) {
    if (!isDragging || evt.pointerId !== pointerId) return;
    isDragging = false;
    const level = LEVELS[currentLevelIndex];
    const dx = level.launcher.x - dragPoint.x;
    const dy = level.launcher.y - dragPoint.y;
    // Trazione troppo debole: annulla il lancio e riporta la pallina all'ancoraggio
    if (Math.hypot(dx, dy) < 8) {
      Body.setPosition(ballBody, level.launcher);
      dragPoint = null;
      return;
    }
    Body.setStatic(ballBody, false);
    Body.setVelocity(ballBody, { x: dx * POWER_SCALE, y: dy * POWER_SCALE });
    SoundEngine.playLaunch(Math.hypot(dx, dy) / MAX_DRAG);
    ballHeld = false;
    shotsUsed++;
    settleCounter = 0;
    dragPoint = null;
    updateHud(level);
  }

  canvas.addEventListener("pointerup", releaseDrag);
  canvas.addEventListener("pointercancel", releaseDrag);

  // ---------- Rendering ----------
  const PALETTE = {
    bg: "#0f2a4a",
    grid: "rgba(232, 238, 245, 0.08)",
    gridMajor: "rgba(232, 238, 245, 0.16)",
    ink: "#e8eef5",
    inkDim: "rgba(232, 238, 245, 0.45)",
    amber: "#ffb020",
    coral: "#ff5c5c",
    green: "#4ade80",
  };

  function render() {
    const level = LEVELS[currentLevelIndex];
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.save();
    if (shakeMag > 0.1) {
      ctx.translate((Math.random() * 2 - 1) * shakeMag, (Math.random() * 2 - 1) * shakeMag);
    }

    drawBackground();
    drawInkTrails();
    drawGround(level);
    drawObstacles(level);
    drawCurrentTrail();
    drawTargets();
    drawLauncherRig(level);
    if (isDragging && dragPoint) {
      drawTrajectoryPreview(level.launcher, dragPoint);
      drawSlingBands(level.launcher, dragPoint);
    }
    drawBall(level);
    drawParticles();

    ctx.restore();
  }

  function drawBackground() {
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= CANVAS_W; x += 20) {
      const major = x % 100 === 0;
      ctx.strokeStyle = major ? PALETTE.gridMajor : PALETTE.grid;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, CANVAS_H);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += 20) {
      const major = y % 100 === 0;
      ctx.strokeStyle = major ? PALETTE.gridMajor : PALETTE.grid;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(CANVAS_W, y + 0.5);
      ctx.stroke();
    }

    // Ticks di misura (rif. blueprint) sui bordi
    ctx.fillStyle = PALETTE.inkDim;
    ctx.font = "10px 'Space Mono', monospace";
    for (let x = 0; x <= CANVAS_W; x += 100) {
      ctx.fillText(String(x), x + 3, 12);
    }
  }

  function drawGround(level) {
    level.groundRects.forEach((g) => {
      drawTechRect(g.x - g.w / 2, g.y - g.h / 2, g.w, g.h, 0);
    });
  }

  function drawObstacles(level) {
    level.obstacles.forEach((o) => {
      drawTechRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h, o.angle || 0);
    });
  }

  function drawPolyline(points, color, lineWidth, dashed) {
    if (points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (dashed) ctx.setLineDash([1, 7]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Scie già "asciugate": diventate ostacoli reali, disegnate come tratteggio spento
  function drawInkTrails() {
    inkTrails.forEach((pts) => drawPolyline(pts, "rgba(232, 238, 245, 0.5)", TRAIL_THICKNESS - 1, true));
  }

  // Scia del tiro in corso: linea piena e brillante, si "asciuga" solo se il tiro fallisce
  function drawCurrentTrail() {
    drawPolyline(currentTrail, "rgba(255, 176, 32, 0.85)", 2.5, false);
  }

  function drawParticles() {
    particles.forEach((p) => {
      const alpha = Math.max(0, 1 - p.life / p.maxLife);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-p.len / 2, 0);
      ctx.lineTo(p.len / 2, 0);
      ctx.stroke();
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }

  // Rettangolo "disegno tecnico": contorno + leggero tratteggio diagonale
  function drawTechRect(x, y, w, h, angle) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(angle);
    ctx.translate(-w / 2, -h / 2);

    ctx.fillStyle = "rgba(232, 238, 245, 0.06)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.strokeStyle = "rgba(232, 238, 245, 0.18)";
    ctx.lineWidth = 1;
    const step = 12;
    for (let i = -h; i < w; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + h, h);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  function drawTargets() {
    targetBodies.forEach((body) => {
      const hit = hitTargetIds.has(body.targetIndex);
      const r = body.targetDef.r;
      const color = hit ? PALETTE.green : PALETTE.coral;
      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      [1, 0.66, 0.33].forEach((f) => {
        ctx.beginPath();
        ctx.arc(0, 0, r * f, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(-r - 8, 0);
      ctx.lineTo(r + 8, 0);
      ctx.moveTo(0, -r - 8);
      ctx.lineTo(0, r + 8);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawLauncherRig(level) {
    const { x, y } = level.launcher;
    ctx.save();
    ctx.strokeStyle = PALETTE.inkDim;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 14, GROUND_TOP);
    ctx.lineTo(x - 14, y);
    ctx.moveTo(x + 14, GROUND_TOP);
    ctx.lineTo(x + 14, y);
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawSlingBands(launcher, drag) {
    ctx.save();
    ctx.strokeStyle = PALETTE.amber;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(launcher.x - 14, launcher.y - 6);
    ctx.lineTo(drag.x, drag.y);
    ctx.moveTo(launcher.x + 14, launcher.y - 6);
    ctx.lineTo(drag.x, drag.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawTrajectoryPreview(launcher, drag) {
    const dx = launcher.x - drag.x;
    const dy = launcher.y - drag.y;
    const vx = dx * POWER_SCALE;
    const vy = dy * POWER_SCALE;
    const g = engine.world.gravity.y * (engine.world.gravity.scale || 0.001) * 1000;

    ctx.save();
    ctx.fillStyle = "rgba(255, 176, 32, 0.55)";
    let px = drag.x;
    let py = drag.y;
    let cvx = vx;
    let cvy = vy;
    const dt = 1 / 60;
    for (let i = 0; i < 40; i++) {
      cvy += g * dt * dt;
      px += cvx * dt * 5;
      py += cvy * dt * 5;
      if (i % 2 === 0) {
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (py > CANVAS_H) break;
    }
    ctx.restore();
  }

  function drawBall(level) {
    if (!ballBody) return;
    ctx.save();
    ctx.translate(ballBody.position.x, ballBody.position.y);
    ctx.rotate(ballBody.angle);
    ctx.fillStyle = PALETTE.amber;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.bg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(16, 0);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- HUD / Overlay ----------
  function updateHud(level) {
    hudLevelName.textContent = level.name;
    hudShots.textContent = `TIRI: ${shotsUsed}`;
    hudTargets.textContent = `BERSAGLI: ${hitTargetIds.size}/${targetBodies.length}`;
    hudInk.textContent = `SEGNI: ${inkTrails.length}`;
  }

  function starsMarkup(count) {
    let out = "";
    for (let i = 0; i < 3; i++) {
      out += i < count ? "★" : "☆";
    }
    return out;
  }

  function showCompleteOverlay(stars, shots) {
    overlayStars.textContent = starsMarkup(stars);
    overlayShotsUsed.textContent = `Completato in ${shots} tiro${shots === 1 ? "" : "i"}`;
    overlayComplete.classList.remove("hidden");
    btnNext.disabled = currentLevelIndex >= LEVELS.length - 1;
  }

  function hideCompleteOverlay() {
    overlayComplete.classList.add("hidden");
  }

  // ---------- Tutorial (solo FIG. 01, una volta sola) ----------
  function maybeShowTutorial(levelIndex) {
    if (levelIndex !== 0) {
      overlayTutorial.classList.add("hidden");
      tutorialActive = false;
      return;
    }
    let seen = false;
    try {
      seen = localStorage.getItem(TUTORIAL_KEY) === "1";
    } catch (e) {
      /* localStorage non disponibile: mostriamo comunque il tutorial una volta per sessione */
    }
    if (seen) {
      overlayTutorial.classList.add("hidden");
      tutorialActive = false;
      return;
    }
    overlayTutorial.classList.remove("hidden");
    tutorialActive = true;
  }

  function dismissTutorial() {
    tutorialActive = false;
    overlayTutorial.classList.add("hidden");
    try {
      localStorage.setItem(TUTORIAL_KEY, "1");
    } catch (e) {
      /* nessun salvataggio disponibile: il tutorial potrebbe ricomparire in una sessione futura */
    }
  }

  // ---------- Condivisione risultati ----------
  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    requestAnimationFrame(() => toast.classList.add("visible"));
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.classList.add("hidden"), 220);
    }, 1800);
  }

  function fallbackCopy(text) {
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
      showToast("Copiato negli appunti ✓");
    } catch (e) {
      showToast("Copia non riuscita: seleziona e copia a mano");
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast("Copiato negli appunti ✓"))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function starEmoji(stars) {
    if (stars >= 3) return "🟩";
    if (stars === 2) return "🟨";
    if (stars === 1) return "🟧";
    return "⬛";
  }

  // ---------- Navigazione schermate ----------
  function startLevel(index) {
    currentLevelIndex = index;
    hideCompleteOverlay();
    screenMenu.classList.add("hidden");
    screenGame.classList.remove("hidden");
    buildLevel(index);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function stopLevel() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function goToMenu() {
    stopLevel();
    screenGame.classList.add("hidden");
    screenMenu.classList.remove("hidden");
    renderMenu();
  }

  function renderMenu() {
    levelGrid.innerHTML = "";
    LEVELS.forEach((level, index) => {
      const unlocked = index === 0 || (progress[LEVELS[index - 1].id] || 0) > 0;
      const best = progress[level.id] || 0;

      const card = document.createElement("button");
      card.className = "level-card" + (unlocked ? "" : " locked");
      card.disabled = !unlocked;

      const num = String(level.id).padStart(2, "0");
      card.innerHTML = `
        <span class="level-card-fig">FIG. ${num}</span>
        <span class="level-card-name">${level.name.replace(/^FIG\. \d+ — /, "")}</span>
        <span class="level-card-stars">${unlocked ? starsMarkup(best) : "🔒"}</span>
      `;
      card.addEventListener("click", () => {
        SoundEngine.playClick();
        startLevel(index);
      });
      levelGrid.appendChild(card);
    });
  }

  // ---------- Listener pulsanti ----------
  btnReset.addEventListener("click", () => {
    SoundEngine.playClick();
    startLevel(currentLevelIndex);
  });
  btnMenu.addEventListener("click", () => {
    SoundEngine.playClick();
    goToMenu();
  });
  btnRetry.addEventListener("click", () => {
    SoundEngine.playClick();
    startLevel(currentLevelIndex);
  });
  btnNext.addEventListener("click", () => {
    SoundEngine.playClick();
    if (currentLevelIndex < LEVELS.length - 1) startLevel(currentLevelIndex + 1);
  });
  btnOverlayMenu.addEventListener("click", () => {
    SoundEngine.playClick();
    goToMenu();
  });
  btnTutorialOk.addEventListener("click", () => {
    SoundEngine.playClick();
    dismissTutorial();
  });
  btnShare.addEventListener("click", () => {
    SoundEngine.playClick();
    const level = LEVELS[currentLevelIndex];
    let text = `ARC — ${level.name}\n${starsMarkup(lastCompletionStars)} · ${shotsUsed} tiro${shotsUsed === 1 ? "" : "i"}`;
    if (SHARE_URL) text += `\n${SHARE_URL}`;
    copyToClipboard(text);
  });
  btnShareProgress.addEventListener("click", () => {
    SoundEngine.playClick();
    const completed = LEVELS.filter((l) => (progress[l.id] || 0) > 0).length;
    const totalStars = LEVELS.reduce((sum, l) => sum + (progress[l.id] || 0), 0);
    const grid = LEVELS.map((l) => starEmoji(progress[l.id] || 0)).join("");
    let text = `ARC — ${completed}/${LEVELS.length} livelli · ${totalStars}/${LEVELS.length * 3} ⭐\n${grid}`;
    if (SHARE_URL) text += `\n${SHARE_URL}`;
    copyToClipboard(text);
  });

  // ---------- Avvio ----------
  renderMenu();
})();
