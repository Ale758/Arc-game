/*
  ARC — motore di gioco
  Fisica: Matter.js (via CDN, vedi index.html)
  Rendering: Canvas 2D disegnato a mano (stile "disegno tecnico / blueprint")

  Se i livelli ti sembrano troppo facili/difficili una volta provati nel
  browser, i valori da tarare sono qui sotto: POWER_SCALE, MAX_DRAG e la
  gravità del mondo (world.gravity.y). I valori di vento/rotazione sono
  documentati vicino alle rispettive costanti.
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
  const TRAIL_MIN_DIST = 10;
  const TRAIL_THICKNESS = 5;
  const TRAIL_EXCLUDE_LAUNCHER_R = 70;

  // Juice: scuotimento schermo e particelle
  const SHAKE_DECAY = 0.88;
  const PARTICLE_GRAVITY = 0.15;

  // Portali: tempo minimo (ms) prima che la stessa pallina possa riattivare
  // un portale, per evitare teletrasporti a catena
  const PORTAL_COOLDOWN_MS = 250;
  const PORTAL_COLOR = "#5ce1ff";

  const STORAGE_KEY = "arc-game-progress-v1";
  const TUTORIAL_KEY = "arc-game-tutorial-seen-v1";
  const DAILY_KEY = "arc-game-daily-v1";
  const SHARE_URL = ""; // opzionale: incolla qui l'URL pubblicato, verrà aggiunto ai testi condivisi

  // ---------- Riferimenti DOM ----------
  const screenMenu = document.getElementById("screen-menu");
  const screenGame = document.getElementById("screen-game");
  const screenEditor = document.getElementById("screen-editor");
  const levelGrid = document.getElementById("level-grid");
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
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

  // Sfida del giorno
  const dailyDateEl = document.getElementById("daily-date");
  const dailyStreakEl = document.getElementById("daily-streak");
  const dailyStatusEl = document.getElementById("daily-status");
  const btnDailyPlay = document.getElementById("btn-daily-play");

  // Obiettivi
  const btnOpenAchievements = document.getElementById("btn-open-achievements");
  const overlayAchievements = document.getElementById("overlay-achievements");
  const achievementsList = document.getElementById("achievements-list");
  const achievementsCount = document.getElementById("achievements-count");
  const btnAchievementsClose = document.getElementById("btn-achievements-close");

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
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }
  function saveProgress(p) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch (e) {
      /* localStorage non disponibile: il gioco funziona comunque, solo senza salvataggio */
    }
  }
  let progress = loadProgress(); // { [levelId]: bestStars }

  // ---------- Persistenza sfida del giorno ----------
  function loadDaily() {
    try {
      const raw = localStorage.getItem(DAILY_KEY);
      return raw ? JSON.parse(raw) : { lastDate: null, streak: 0, bestStreak: 0, completed: {} };
    } catch (e) {
      return { lastDate: null, streak: 0, bestStreak: 0, completed: {} };
    }
  }
  function saveDaily(d) {
    try {
      localStorage.setItem(DAILY_KEY, JSON.stringify(d));
    } catch (e) {
      /* nessun salvataggio disponibile: la serie potrebbe non essere ricordata */
    }
  }
  let dailyState = loadDaily();

  // ---------- Stato di gioco ----------
  const Engine = Matter.Engine;
  const World = Matter.World;
  const Bodies = Matter.Bodies;
  const Body = Matter.Body;
  const Events = Matter.Events;

  let engine, world;
  let mode = "normal"; // "normal" | "daily" | "custom"
  let activeLevel = null; // livello attualmente in gioco (oggetto dati)
  let activeLevelCode = null; // codice condivisibile, valido solo in modalità "custom"
  let currentLevelIndex = 0; // indice in LEVELS, valido solo in modalità "normal" (-1 altrimenti)

  let ballBody = null;
  let ballHeld = true;
  let targetBodies = [];
  let hitTargetIds = new Set();
  let obstacleBodies = []; // [{ body, def }] — include muri, rotanti e mobili
  let portalSensors = []; // corpi sensore dei portali, ognuno con .portalPartner
  let ballPortalCooldownUntil = 0;

  let shotsUsed = 0;
  let settleCounter = 0;
  let levelDone = false;
  let rafId = null;

  let isDragging = false;
  let dragPoint = null;
  let pointerId = null;

  let currentTrail = [];
  let inkTrails = [];
  let particles = [];
  let shakeMag = 0;
  let tutorialActive = false;
  let lastCompletionStars = 0;

  let toastQueue = [];
  let toastBusy = false;
  let toastTimeout = null;

  // ---------- Costruzione livello ----------
  function buildLevel(level) {
    activeLevel = level;

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
    obstacleBodies = [];
    portalSensors = [];
    ballPortalCooldownUntil = 0;

    const bodies = [];

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

    // Muro di contenimento invisibile in alto: il fondo/i lati restano
    // "aperti" cosi la pallina puo cadere fuori (voragine / tiro sbagliato)
    bodies.push(
      Bodies.rectangle(CANVAS_W / 2, -20, CANVAS_W * 2, 40, {
        isStatic: true,
        label: "ceiling",
      })
    );

    // Ostacoli: muri, rotanti e mobili condividono la stessa creazione fisica;
    // il tipo influisce solo sull'aggiornamento per-frame (vedi updateMovingObstacles)
    level.obstacles.forEach((o) => {
      const body = Bodies.rectangle(o.x, o.y, o.w, o.h, {
        isStatic: true,
        angle: o.angle || 0,
        friction: 0.6,
        restitution: 0.35,
        label: "obstacle",
      });
      bodies.push(body);
      obstacleBodies.push({ body, def: o });
    });

    World.add(world, bodies);

    // Portali: due sensori statici per coppia, ognuno "conosce" la posizione dell'altro
    const portalBodies = [];
    level.portals.forEach((p) => {
      const bodyA = Bodies.circle(p.x1, p.y1, p.r, { isStatic: true, isSensor: true, label: "portal" });
      const bodyB = Bodies.circle(p.x2, p.y2, p.r, { isStatic: true, isSensor: true, label: "portal" });
      bodyA.portalPartner = { x: p.x2, y: p.y2, r: p.r };
      bodyB.portalPartner = { x: p.x1, y: p.y1, r: p.r };
      portalBodies.push(bodyA, bodyB);
    });
    if (portalBodies.length) World.add(world, portalBodies);
    portalSensors = portalBodies;

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
    updateHud();
    setupCollisionHandler();
    maybeShowTutorial();
  }

  function spawnBall(level) {
    if (ballBody) World.remove(world, ballBody);
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

  // ---------- Collisioni ----------
  const BOUNCE_MIN_SPEED = 1.5;
  const BOUNCE_REF_SPEED = 14;
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
        if (other.label === "portal") {
          handlePortalEntry(ball, other);
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

  function handlePortalEntry(ball, portalBody) {
    const now = performance.now();
    if (now < ballPortalCooldownUntil) return;
    const partner = portalBody.portalPartner;
    const speed = Math.hypot(ball.velocity.x, ball.velocity.y) || 0.001;
    const dirX = ball.velocity.x / speed;
    const dirY = ball.velocity.y / speed;
    const offset = partner.r + 20;
    Body.setPosition(ball, { x: partner.x + dirX * offset, y: partner.y + dirY * offset });
    ballPortalCooldownUntil = now + PORTAL_COOLDOWN_MS;
    SoundEngine.playPortal();
    spawnBurst(portalBody.position.x, portalBody.position.y, PORTAL_COLOR, 8, [1, 4]);
    spawnBurst(partner.x, partner.y, PORTAL_COLOR, 8, [1, 4]);
    shakeMag = Math.min(shakeMag + 3, 8);
  }

  function registerTargetHit(targetBody) {
    if (hitTargetIds.has(targetBody.targetIndex)) return;
    hitTargetIds.add(targetBody.targetIndex);
    SoundEngine.playTargetHit(hitTargetIds.size - 1);
    spawnBurst(targetBody.position.x, targetBody.position.y, "#ff5c5c", 12, [2, 5]);
    shakeMag = Math.min(shakeMag + 6, 12);
    vibrate([15, 30, 15]);
    updateHud();
    if (hitTargetIds.size >= targetBodies.length) {
      finishLevel();
    }
  }

  function finishLevel() {
    levelDone = true;
    const level = activeLevel;
    const stars = computeStars(level, shotsUsed);
    lastCompletionStars = stars;

    SoundEngine.playLevelComplete(stars);
    targetBodies.forEach((b) => spawnBurst(b.position.x, b.position.y, "#ffb020", 14, [2, 6]));
    shakeMag = Math.min(shakeMag + 9, 14);
    vibrate([20, 40, 20, 40, 30]);

    // Obiettivi comuni a tutte le modalità
    maybeToastAchievement(Achievements.unlock("first_blueprint"));
    if (inkTrails.length === 0) maybeToastAchievement(Achievements.unlock("clean_sheet"));
    if (shotsUsed === 1) maybeToastAchievement(Achievements.unlock("one_shot"));
    if (level.portals && level.portals.length > 0) maybeToastAchievement(Achievements.unlock("portal_hopper"));

    if (mode === "normal") {
      const best = Math.max(stars, progress[level.id] || 0);
      progress[level.id] = best;
      saveProgress(progress);
      if (LEVELS.every((l) => (progress[l.id] || 0) >= 3)) {
        maybeToastAchievement(Achievements.unlock("master_engineer"));
      }
    } else if (mode === "daily") {
      updateDailyStreak(stars, shotsUsed);
    }

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
    updateMovingObstacles(timestamp);
    if (!levelDone) {
      applyWindZones();
      checkBallState();
      recordTrailPoint();
    }
    updateParticles();
    shakeMag = shakeMag > 0.1 ? shakeMag * SHAKE_DECAY : 0;
    render(timestamp);
    rafId = requestAnimationFrame(tick);
  }

  function recordTrailPoint() {
    if (!ballBody || ballHeld) return;
    if (currentTrail.length > 400) return;
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

  function updateMovingObstacles(timestamp) {
    obstacleBodies.forEach(({ body, def }) => {
      if (def.type === "rotator") {
        Body.setAngle(body, timestamp * def.speed);
      } else if (def.movement) {
        const m = def.movement;
        const offset = Math.sin(timestamp * m.speed) * m.amplitude;
        if (m.axis === "x") {
          Body.setPosition(body, { x: m.center + offset, y: def.y });
        } else {
          Body.setPosition(body, { x: def.x, y: m.center + offset });
        }
      }
    });
  }

  function applyWindZones() {
    if (!ballBody || ballHeld || !activeLevel.windZones.length) return;
    activeLevel.windZones.forEach((z) => {
      const withinX = ballBody.position.x > z.x - z.w / 2 && ballBody.position.x < z.x + z.w / 2;
      const withinY = ballBody.position.y > z.y - z.h / 2 && ballBody.position.y < z.y + z.h / 2;
      if (withinX && withinY) {
        Body.applyForce(ballBody, ballBody.position, {
          x: (z.fx || 0) * ballBody.mass,
          y: (z.fy || 0) * ballBody.mass,
        });
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
      if (settleCounter > SETTLE_FRAMES) resetShotBall();
    } else {
      settleCounter = 0;
    }
  }

  function resetShotBall() {
    commitTrail();
    spawnBall(activeLevel);
    updateHud();
  }

  // Trasforma la scia del tiro appena concluso in ostacoli fisici permanenti.
  // I punti troppo vicini al lanciatore vengono esclusi spezzando la scia in
  // tratti separati, cosi non si creano segmenti che "saltano" nel vuoto.
  function commitTrail() {
    const launcher = activeLevel.launcher;
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
        /* Vibration API non disponibile: si prosegue senza */
      }
    }
  }

  // ---------- Input (fionda) ----------
  function canvasPointFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (CANVAS_W / rect.width),
      y: (evt.clientY - rect.top) * (CANVAS_H / rect.height),
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
    if (levelDone || !ballHeld || !activeLevel) return;
    const p = canvasPointFromEvent(evt);
    const dist = Math.hypot(p.x - activeLevel.launcher.x, p.y - activeLevel.launcher.y);
    if (dist <= CATCH_RADIUS + MAX_DRAG) {
      isDragging = true;
      pointerId = evt.pointerId;
      dragPoint = clampDrag(activeLevel.launcher, p);
      Body.setPosition(ballBody, dragPoint);
      canvas.setPointerCapture(evt.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (evt) => {
    if (!isDragging || evt.pointerId !== pointerId) return;
    const p = canvasPointFromEvent(evt);
    dragPoint = clampDrag(activeLevel.launcher, p);
    Body.setPosition(ballBody, dragPoint);
  });

  function releaseDrag(evt) {
    if (!isDragging || evt.pointerId !== pointerId) return;
    isDragging = false;
    const launcher = activeLevel.launcher;
    const dx = launcher.x - dragPoint.x;
    const dy = launcher.y - dragPoint.y;
    if (Math.hypot(dx, dy) < 8) {
      Body.setPosition(ballBody, launcher);
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
    updateHud();
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

  function render(timestamp) {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.save();
    if (shakeMag > 0.1) {
      ctx.translate((Math.random() * 2 - 1) * shakeMag, (Math.random() * 2 - 1) * shakeMag);
    }

    drawBackground();
    drawInkTrails();
    drawGround(activeLevel);
    drawWindZones(timestamp || 0);
    drawPortals();
    drawObstacles();
    drawCurrentTrail();
    drawTargets();
    drawLauncherRig(activeLevel);
    if (isDragging && dragPoint) {
      drawTrajectoryPreview(activeLevel.launcher, dragPoint);
      drawSlingBands(activeLevel.launcher, dragPoint);
    }
    drawBall();
    drawParticles();

    ctx.restore();
  }

  function drawBackground() {
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    for (let x = 0; x <= CANVAS_W; x += 20) {
      ctx.strokeStyle = x % 100 === 0 ? PALETTE.gridMajor : PALETTE.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, CANVAS_H);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += 20) {
      ctx.strokeStyle = y % 100 === 0 ? PALETTE.gridMajor : PALETTE.grid;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(CANVAS_W, y + 0.5);
      ctx.stroke();
    }

    ctx.fillStyle = PALETTE.inkDim;
    ctx.font = "10px 'Space Mono', monospace";
    for (let x = 0; x <= CANVAS_W; x += 100) {
      ctx.fillText(String(x), x + 3, 12);
    }
  }

  function drawGround(level) {
    level.groundRects.forEach((g) => drawTechRect(g.x - g.w / 2, g.y - g.h / 2, g.w, g.h, 0));
  }

  function drawObstacles() {
    obstacleBodies.forEach(({ body, def }) => {
      drawTechRect(body.position.x - def.w / 2, body.position.y - def.h / 2, def.w, def.h, body.angle);
    });
  }

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
    for (let i = -h; i < w; i += 12) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + h, h);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  function drawPortals() {
    activeLevel.portals.forEach((p) => {
      ctx.save();
      ctx.strokeStyle = "rgba(92, 225, 255, 0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(p.x1, p.y1);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      drawPortalMarker(p.x1, p.y1, p.r);
      drawPortalMarker(p.x2, p.y2, p.r);
    });
  }

  function drawPortalMarker(x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = PORTAL_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawWindZones(timestamp) {
    activeLevel.windZones.forEach((z) => {
      ctx.save();
      ctx.strokeStyle = "rgba(92, 225, 255, 0.3)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.strokeRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
      ctx.setLineDash([]);

      const dir = (z.fx || 0) >= 0 ? 1 : -1;
      const chevronCount = Math.max(2, Math.floor(z.h / 60));
      const scrollOffset = ((timestamp * 0.05) % 40) * dir;
      ctx.strokeStyle = "rgba(92, 225, 255, 0.55)";
      ctx.lineWidth = 2;
      for (let i = 0; i < chevronCount; i++) {
        const step = chevronCount > 1 ? (z.h - 60) / (chevronCount - 1) : 0;
        const cy = z.y - z.h / 2 + 30 + i * step;
        const cx = z.x + scrollOffset;
        ctx.beginPath();
        ctx.moveTo(cx - 8 * dir, cy - 8);
        ctx.lineTo(cx + 8 * dir, cy);
        ctx.lineTo(cx - 8 * dir, cy + 8);
        ctx.stroke();
      }
      ctx.restore();
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

  function drawInkTrails() {
    inkTrails.forEach((pts) => drawPolyline(pts, "rgba(232, 238, 245, 0.5)", TRAIL_THICKNESS - 1, true));
  }

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
    const vx = (launcher.x - drag.x) * POWER_SCALE;
    const vy = (launcher.y - drag.y) * POWER_SCALE;
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

  function drawBall() {
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
  function updateHud() {
    if (!activeLevel) return;
    hudLevelName.textContent = activeLevel.name || "LIVELLO PERSONALIZZATO";
    hudShots.textContent = `TIRI: ${shotsUsed}`;
    hudTargets.textContent = `BERSAGLI: ${hitTargetIds.size}/${targetBodies.length}`;
    hudInk.textContent = `SEGNI: ${inkTrails.length}`;
  }

  function starsMarkup(count) {
    let out = "";
    for (let i = 0; i < 3; i++) out += i < count ? "★" : "☆";
    return out;
  }

  function showCompleteOverlay(stars, shots) {
    overlayStars.textContent = starsMarkup(stars);
    overlayShotsUsed.textContent = `Completato in ${shots} tiro${shots === 1 ? "" : "i"}`;
    overlayComplete.classList.remove("hidden");
    if (mode === "normal") {
      btnNext.classList.remove("hidden");
      btnNext.disabled = currentLevelIndex >= LEVELS.length - 1;
    } else {
      btnNext.classList.add("hidden");
    }
  }

  function hideCompleteOverlay() {
    overlayComplete.classList.add("hidden");
  }

  // ---------- Tutorial (solo FIG. 01, una volta sola) ----------
  function maybeShowTutorial() {
    if (mode !== "normal" || currentLevelIndex !== 0) {
      overlayTutorial.classList.add("hidden");
      tutorialActive = false;
      return;
    }
    let seen = false;
    try {
      seen = localStorage.getItem(TUTORIAL_KEY) === "1";
    } catch (e) {
      /* mostriamo comunque il tutorial una volta per sessione */
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
      /* il tutorial potrebbe ricomparire in una sessione futura */
    }
  }

  // ---------- Obiettivi: notifica ----------
  function maybeToastAchievement(def) {
    if (def) showToast(`🏆 Obiettivo sbloccato: ${def.name}`);
  }

  function renderAchievementsPanel() {
    achievementsList.innerHTML = "";
    Achievements.list().forEach((a) => {
      const item = document.createElement("div");
      item.className = "achievement-item" + (a.unlocked ? " unlocked" : "");
      item.innerHTML = `
        <span class="achievement-icon">${a.unlocked ? a.icon : "🔒"}</span>
        <span class="achievement-text">
          <span class="achievement-name">${a.name}</span>
          <span class="achievement-desc">${a.desc}</span>
        </span>
      `;
      achievementsList.appendChild(item);
    });
    achievementsCount.textContent = `${Achievements.unlockedCount()}/${Achievements.total()}`;
  }

  // ---------- Sfida del giorno ----------
  function pad2(n) {
    return String(n).padStart(2, "0");
  }
  function dateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function formatDateHuman(d) {
    const months = [
      "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
      "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
    ];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }
  function isYesterday(dateA, dateB) {
    const a = new Date(dateA + "T00:00:00");
    const b = new Date(dateB + "T00:00:00");
    return Math.round((b - a) / 86400000) === 1;
  }
  function todayLevelIndex() {
    const epoch = new Date(2026, 0, 1);
    const diff = Math.floor((new Date() - epoch) / 86400000);
    const len = LEVELS.length;
    return ((diff % len) + len) % len;
  }
  function getTodayLevel() {
    return LEVELS[todayLevelIndex()];
  }

  function updateDailyStreak(stars, shots) {
    const today = dateStr(new Date());
    if (dailyState.lastDate === today) {
      const prev = dailyState.completed[today];
      if (!prev || stars > prev.stars || (stars === prev.stars && shots < prev.shots)) {
        dailyState.completed[today] = { stars, shots };
      }
    } else {
      dailyState.streak = isYesterday(dailyState.lastDate || "", today) ? dailyState.streak + 1 : 1;
      dailyState.lastDate = today;
      dailyState.bestStreak = Math.max(dailyState.bestStreak, dailyState.streak);
      dailyState.completed[today] = { stars, shots };
    }
    saveDaily(dailyState);
    if (dailyState.streak >= 3) maybeToastAchievement(Achievements.unlock("streak_3"));
    if (dailyState.streak >= 7) maybeToastAchievement(Achievements.unlock("streak_7"));
    renderDailyCard();
  }

  function renderDailyCard() {
    const today = dateStr(new Date());
    const level = getTodayLevel();
    const completedToday = dailyState.completed[today];
    dailyDateEl.textContent = formatDateHuman(new Date());
    dailyStreakEl.textContent = `🔥 ${dailyState.streak}`;
    if (completedToday) {
      dailyStatusEl.textContent = `Completata — ${starsMarkup(completedToday.stars)} · ${completedToday.shots} tiri`;
      btnDailyPlay.textContent = "Rigioca";
    } else {
      dailyStatusEl.textContent = `Oggi: ${level.name}`;
      btnDailyPlay.textContent = "Gioca";
    }
  }

  // ---------- Condivisione risultati ----------
  function showToast(message) {
    toastQueue.push(message);
    processToastQueue();
  }

  function processToastQueue() {
    if (toastBusy || toastQueue.length === 0) return;
    toastBusy = true;
    const message = toastQueue.shift();
    toast.textContent = message;
    toast.classList.remove("hidden");
    requestAnimationFrame(() => toast.classList.add("visible"));
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => {
        toast.classList.add("hidden");
        toastBusy = false;
        processToastQueue();
      }, 220);
    }, 1600);
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
  function startPlaying(levelData) {
    hideCompleteOverlay();
    screenMenu.classList.add("hidden");
    if (screenEditor) screenEditor.classList.add("hidden");
    screenGame.classList.remove("hidden");
    buildLevel(levelData);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function startLevel(index) {
    mode = "normal";
    currentLevelIndex = index;
    startPlaying(LEVELS[index]);
  }

  function startDaily() {
    mode = "daily";
    currentLevelIndex = -1;
    startPlaying(getTodayLevel());
  }

  function restartCurrent() {
    if (mode === "normal") {
      startLevel(currentLevelIndex);
    } else {
      startPlaying(activeLevel);
    }
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
    renderDailyCard();
  }

  // ---------- Listener pulsanti ----------
  btnReset.addEventListener("click", () => {
    SoundEngine.playClick();
    restartCurrent();
  });
  btnMenu.addEventListener("click", () => {
    SoundEngine.playClick();
    goToMenu();
  });
  btnRetry.addEventListener("click", () => {
    SoundEngine.playClick();
    restartCurrent();
  });
  btnNext.addEventListener("click", () => {
    SoundEngine.playClick();
    if (mode === "normal" && currentLevelIndex < LEVELS.length - 1) startLevel(currentLevelIndex + 1);
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
    let text;
    if (mode === "daily") {
      text = `ARC — Sfida del ${formatDateHuman(new Date())}\n🔥 Serie: ${dailyState.streak}\n${starsMarkup(lastCompletionStars)} · ${shotsUsed} tiro${shotsUsed === 1 ? "" : "i"}`;
    } else if (mode === "custom") {
      text = `ARC — Livello personalizzato\n${starsMarkup(lastCompletionStars)} · ${shotsUsed} tiro${shotsUsed === 1 ? "" : "i"}\nCodice: ${activeLevelCode || "(non disponibile)"}`;
    } else {
      text = `ARC — ${activeLevel.name}\n${starsMarkup(lastCompletionStars)} · ${shotsUsed} tiro${shotsUsed === 1 ? "" : "i"}`;
    }
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
  btnDailyPlay.addEventListener("click", () => {
    SoundEngine.playClick();
    startDaily();
  });
  btnOpenAchievements.addEventListener("click", () => {
    SoundEngine.playClick();
    renderAchievementsPanel();
    overlayAchievements.classList.remove("hidden");
  });
  btnAchievementsClose.addEventListener("click", () => {
    SoundEngine.playClick();
    overlayAchievements.classList.add("hidden");
  });

  // ---------- Ponte verso l'editor (js/editor.js) ----------
  window.ArcGame = {
    playCustom(levelData, code) {
      mode = "custom";
      currentLevelIndex = -1;
      activeLevelCode = code || null;
      startPlaying(levelData);
    },
  };

  // ---------- Avvio ----------
  renderMenu();
})();
