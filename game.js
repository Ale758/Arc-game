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
  const PORTAL_COLOR = "#2de2e6";

  const STORAGE_KEY = "arc-game-progress-v1";
  const SKIN_KEY = "arc-game-skin-v1";
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

  // Skin della pallina
  const btnOpenSkins = document.getElementById("btn-open-skins");
  const overlaySkins = document.getElementById("overlay-skins");
  const skinsList = document.getElementById("skins-list");
  const btnSkinsClose = document.getElementById("btn-skins-close");

  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  // ---------- Audio: sblocco al primo gesto + tasto muto ----------
  const btnMute = document.getElementById("btn-mute");

  function unlockAudioOnce() {
    SoundEngine.unlock();
    SoundEngine.startMusic();
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
  // Se Matter.js non si è caricato da nessuna delle fonti (vedi index.html),
  // il gioco non deve bloccarsi del tutto: menu, obiettivi ed editor restano
  // utilizzabili, e mostriamo un messaggio chiaro al momento di giocare.
  const matterAvailable = typeof Matter !== "undefined";
  const Engine = matterAvailable ? Matter.Engine : null;
  const World = matterAvailable ? Matter.World : null;
  const Bodies = matterAvailable ? Matter.Bodies : null;
  const Body = matterAvailable ? Matter.Body : null;
  const Events = matterAvailable ? Matter.Events : null;

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
  let keyboardAiming = false;
  let keyAimAngle = -Math.PI / 4;
  let keyAimPower = MAX_DRAG * 0.7;
  const KEY_ANGLE_STEP = 0.06;
  const KEY_POWER_STEP = 4;

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

    // Ostacoli: muri, rotanti, mobili e trampolini condividono la stessa
    // creazione fisica; il tipo influisce solo su restituzione/attrito e
    // sull'aggiornamento per-frame (vedi updateMovingObstacles)
    level.obstacles.forEach((o) => {
      const isBouncer = o.type === "bouncer";
      const body = Bodies.rectangle(o.x, o.y, o.w, o.h, {
        isStatic: true,
        angle: o.angle || 0,
        friction: isBouncer ? 0 : 0.6,
        restitution: isBouncer ? o.restitution || 10.5 : 0.35,
        label: "obstacle",
      });
      if (isBouncer) body.isTrampoline = true;
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
      restitution: 0.8,
      friction: 0.4,
      frictionAir: 0.0008,
      density: 0.0028,
      label: "ball",
    });
    World.add(world, ballBody);
    ballHeld = true;
    settleCounter = 0;
    currentTrail = [];
    keyboardAiming = false;
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
        if (other.label === "ground" || other.label === "obstacle") {
          const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
          const now = performance.now();
          if (speed > BOUNCE_MIN_SPEED && now - lastBounceTime > 40) {
            lastBounceTime = now;
            if (other.isTrampoline) {
              SoundEngine.playTrampoline();
              spawnBurst(ball.position.x, ball.position.y, "#ff5fd1", 12, [2, 6]);
              shakeMag = Math.min(shakeMag + 7, 12);
              vibrate(30);
            } else {
              const intensity = Math.min(speed / BOUNCE_REF_SPEED, 1);
              SoundEngine.playBounce(intensity);
              spawnBurst(ball.position.x, ball.position.y, "rgba(255, 248, 231, 0.7)", 3 + Math.round(intensity * 3), [1, 2 + intensity * 3]);
              shakeMag = Math.min(shakeMag + intensity * 5, 10);
              if (intensity > 0.35) vibrate(Math.round(10 + intensity * 20));
            }
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
    spawnBurst(targetBody.position.x, targetBody.position.y, "#ff3860", 12, [2, 5]);
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
    targetBodies.forEach((b) => spawnBurst(b.position.x, b.position.y, "#ffd23f", 14, [2, 6]));
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
      applyGravityZones();
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

  // Zone a gravità leggera: applicano una spinta verso l'alto proporzionale
  // alla gravità del mondo, annullandola parzialmente (strength 0..1) finché
  // la pallina si trova al loro interno — l'arco del tiro si allunga e
  // rallenta, "galleggiando".
  function applyGravityZones() {
    if (!ballBody || ballHeld || !activeLevel.gravityZones.length) return;
    activeLevel.gravityZones.forEach((z) => {
      const withinX = ballBody.position.x > z.x - z.w / 2 && ballBody.position.x < z.x + z.w / 2;
      const withinY = ballBody.position.y > z.y - z.h / 2 && ballBody.position.y < z.y + z.h / 2;
      if (withinX && withinY) {
        const strength = z.strength != null ? z.strength : 2.1;
        const counterAccel = engine.world.gravity.y * (engine.world.gravity.scale || 0.001) * strength;
        Body.applyForce(ballBody, ballBody.position, { x: 0, y: -counterAccel * ballBody.mass });
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

  // La scia del tiro appena concluso diventa un segno "asciugato" solo
  // visivo (vedi drawInkTrails) — niente più corpi fisici: non deve
  // interferire con i tiri successivi, è solo la cronologia dei tentativi.
  // I punti troppo vicini al lanciatore vengono comunque esclusi spezzando
  // la scia in tratti separati, per coerenza visiva con l'origine del tiro.
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

    runs.forEach((pts) => inkTrails.push(pts));
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

  function launchBall(dx, dy) {
    Body.setStatic(ballBody, false);
    Body.setVelocity(ballBody, { x: dx * POWER_SCALE, y: dy * POWER_SCALE });
    SoundEngine.playLaunch(Math.hypot(dx, dy) / MAX_DRAG);
    ballHeld = false;
    shotsUsed++;
    settleCounter = 0;
    updateHud();
  }

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
    launchBall(dx, dy);
    dragPoint = null;
  }

  canvas.addEventListener("pointerup", releaseDrag);
  canvas.addEventListener("pointercancel", releaseDrag);

  // ---------- Controlli da tastiera (alternativa al trascinamento) ----------
  // Frecce sinistra/destra: ruotano la mira. Frecce su/giù: regolano la
  // potenza. Spazio o Invio: lanciano. Utile su desktop, e per chi preferisce
  // non trascinare col mouse.
  function computeKeyboardDragPoint() {
    const launcher = activeLevel.launcher;
    return {
      x: launcher.x - Math.cos(keyAimAngle) * keyAimPower,
      y: launcher.y - Math.sin(keyAimAngle) * keyAimPower,
    };
  }

  document.addEventListener("keydown", (evt) => {
    if (!activeLevel || levelDone || !ballHeld || isDragging) return;
    if (!screenGame || screenGame.classList.contains("hidden")) return;
    if (tutorialActive) return;

    if (evt.key === " " || evt.key === "Enter") {
      if (!keyboardAiming || !dragPoint) return;
      evt.preventDefault();
      const launcher = activeLevel.launcher;
      const dx = launcher.x - dragPoint.x;
      const dy = launcher.y - dragPoint.y;
      if (Math.hypot(dx, dy) < 8) return;
      launchBall(dx, dy);
      keyboardAiming = false;
      dragPoint = null;
      return;
    }

    let changed = true;
    if (evt.key === "ArrowLeft") keyAimAngle -= KEY_ANGLE_STEP;
    else if (evt.key === "ArrowRight") keyAimAngle += KEY_ANGLE_STEP;
    else if (evt.key === "ArrowUp") keyAimPower = Math.min(MAX_DRAG, keyAimPower + KEY_POWER_STEP);
    else if (evt.key === "ArrowDown") keyAimPower = Math.max(15, keyAimPower - KEY_POWER_STEP);
    else changed = false;

    if (changed) {
      evt.preventDefault();
      keyboardAiming = true;
      dragPoint = computeKeyboardDragPoint();
      Body.setPosition(ballBody, dragPoint);
    }
  });

  // ---------- Rendering ----------
  const PALETTE = {
    bg: "#1b1035",
    outline: "#0a0614",
    ink: "#fff8e7",
    inkDim: "rgba(255, 248, 231, 0.45)",
    amber: "#ffd23f",
    coral: "#ff3860",
    cyan: "#2de2e6",
    green: "#39ff88",
    ground: "#6b4229",
    groundLight: "#8a5a3c",
    groundDark: "#472b1a",
  };

  // Stelline di sfondo: posizioni fisse calcolate una sola volta, cosi non
  // "tremano" ad ogni frame come farebbero con Math.random() nel render loop
  const STARS = Array.from({ length: 50 }, () => ({
    x: Math.random() * CANVAS_W,
    y: Math.random() * CANVAS_H,
    size: Math.random() < 0.75 ? 2 : 3,
  }));

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
    drawGravityZones(timestamp || 0);
    drawPortals();
    drawObstacles();
    drawCurrentTrail();
    drawTargets();
    drawLauncherRig(activeLevel);
    if ((isDragging || keyboardAiming) && dragPoint) {
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
    ctx.fillStyle = "rgba(255, 248, 231, 0.5)";
    STARS.forEach((s) => ctx.fillRect(s.x, s.y, s.size, s.size));
  }

  function drawGround(level) {
    level.groundRects.forEach((g) => drawPixelBlock(g.x - g.w / 2, g.y - g.h / 2, g.w, g.h, 0));
  }

  function drawObstacles() {
    obstacleBodies.forEach(({ body, def }) => {
      const x = body.position.x - def.w / 2;
      const y = body.position.y - def.h / 2;
      if (def.type === "bouncer") {
        drawTrampoline(x, y, def.w, def.h);
      } else {
        drawPixelBlock(x, y, def.w, def.h, body.angle);
      }
    });
  }

  // Trampolino: cuscinetto rosa acceso con "molle" disegnate sopra, cosi si
  // riconosce a colpo d'occhio anche prima di provarlo.
  function drawTrampoline(x, y, w, h) {
    ctx.save();
    ctx.fillStyle = "#ff5fd1";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#a83b8a";
    ctx.fillRect(x, y + h - 4, w, 4);
    ctx.fillStyle = "#ffffff";
    for (let i = 6; i < w - 4; i += 10) {
      ctx.fillRect(x + i, y + 5, 4, 3);
    }
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.restore();
  }

  // Zone a gravità leggera: cornice tratteggiata viola + bollicine che
  // salgono (posizioni derivate in modo deterministico da indice e tempo,
  // cosi l'animazione è fluida senza "tremare" ad ogni frame).
  function drawGravityZones(timestamp) {
    activeLevel.gravityZones.forEach((z) => {
      ctx.save();
      ctx.strokeStyle = "rgba(190, 120, 255, 0.3)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
      ctx.setLineDash([]);

      ctx.fillStyle = "#be78ff";
      const left = z.x - z.w / 2;
      const top = z.y - z.h / 2;
      const bubbleCount = Math.max(3, Math.floor(z.w / 45));
      for (let i = 0; i < bubbleCount; i++) {
        const seed = i * 137.5;
        const bx = left + ((seed + timestamp * 0.02) % z.w);
        const by = (top + z.h) - ((timestamp * 0.06 + seed) % z.h);
        ctx.fillRect(bx - 2, by - 2, 4, 4);
      }
      ctx.restore();
    });
  }

  // Blocco "mattone" in stile pixel art: riempimento pieno + bordo chiaro in
  // alto/sinistra e scuro in basso/destra (il classico bevel degli sprite a
  // blocchi), contorno spesso quasi nero.
  function drawPixelBlock(x, y, w, h, angle) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(angle);
    ctx.translate(-w / 2, -h / 2);

    const shade = Math.max(3, Math.min(6, Math.round(Math.min(w, h) * 0.12)));

    ctx.fillStyle = PALETTE.ground;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = PALETTE.groundDark;
    ctx.fillRect(0, h - shade, w, shade);
    ctx.fillRect(w - shade, 0, shade, h);
    ctx.fillStyle = PALETTE.groundLight;
    ctx.fillRect(0, 0, w, shade);
    ctx.fillRect(0, 0, shade, h);

    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    ctx.restore();
  }

  // Cerchio "a pixel": disegnato come una griglia di quadratini invece di un
  // arco liscio, per uniformare pallina/bersagli/portali allo stile a blocchi.
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

  function drawPixelDots(x1, y1, x2, y2, color) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const count = Math.max(1, Math.floor(dist / 10));
    ctx.save();
    ctx.fillStyle = color;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      ctx.fillRect(x1 + (x2 - x1) * t - 1, y1 + (y2 - y1) * t - 1, 2, 2);
    }
    ctx.restore();
  }

  function drawPortals() {
    activeLevel.portals.forEach((p) => {
      drawPixelDots(p.x1, p.y1, p.x2, p.y2, "rgba(45, 226, 230, 0.35)");
      drawPortalMarker(p.x1, p.y1, p.r);
      drawPortalMarker(p.x2, p.y2, p.r);
    });
  }

  function drawPortalMarker(x, y, r) {
    drawPixelCircle(x, y, r, PALETTE.cyan);
    drawPixelCircle(x, y, r * 0.6, PALETTE.bg);
    drawPixelCircle(x, y, r * 0.3, PALETTE.cyan);
  }

  function drawWindZones(timestamp) {
    activeLevel.windZones.forEach((z) => {
      ctx.save();
      ctx.strokeStyle = "rgba(45, 226, 230, 0.25)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
      ctx.setLineDash([]);

      ctx.fillStyle = PALETTE.cyan;
      const s = 4;
      const horizontal = Math.abs(z.fx || 0) >= Math.abs(z.fy || 0);

      if (horizontal) {
        const dir = (z.fx || 0) >= 0 ? 1 : -1;
        const chevronCount = Math.max(2, Math.floor(z.h / 60));
        const scrollOffset = ((timestamp * 0.05) % 40) * dir;
        for (let i = 0; i < chevronCount; i++) {
          const step = chevronCount > 1 ? (z.h - 60) / (chevronCount - 1) : 0;
          const cy = z.y - z.h / 2 + 30 + i * step;
          const cx = z.x + scrollOffset;
          ctx.fillRect(cx - 8 * dir, cy - 8, s, s);
          ctx.fillRect(cx - 4 * dir, cy - 4, s, s);
          ctx.fillRect(cx, cy, s, s);
          ctx.fillRect(cx - 4 * dir, cy + 4, s, s);
          ctx.fillRect(cx - 8 * dir, cy + 8, s, s);
        }
      } else {
        const dir = (z.fy || 0) >= 0 ? 1 : -1;
        const chevronCount = Math.max(2, Math.floor(z.w / 60));
        const scrollOffset = ((timestamp * 0.05) % 40) * dir;
        for (let i = 0; i < chevronCount; i++) {
          const step = chevronCount > 1 ? (z.w - 60) / (chevronCount - 1) : 0;
          const cx = z.x - z.w / 2 + 30 + i * step;
          const cy = z.y + scrollOffset;
          ctx.fillRect(cx - 8, cy - 8 * dir, s, s);
          ctx.fillRect(cx - 4, cy - 4 * dir, s, s);
          ctx.fillRect(cx, cy, s, s);
          ctx.fillRect(cx + 4, cy - 4 * dir, s, s);
          ctx.fillRect(cx + 8, cy - 8 * dir, s, s);
        }
      }
      ctx.restore();
    });
  }

  // Scia disegnata come sequenza di puntini quadrati invece di una linea
  // continua: piu coerente con lo stile a pixel.
  function drawPixelTrail(points, color, pixelSize) {
    if (points.length < 2) return;
    ctx.save();
    ctx.fillStyle = color;
    points.forEach((p) => ctx.fillRect(p.x - pixelSize / 2, p.y - pixelSize / 2, pixelSize, pixelSize));
    ctx.restore();
  }

  function drawInkTrails() {
    inkTrails.forEach((pts) => drawPixelTrail(pts, "rgba(255, 248, 231, 0.35)", 3));
  }

  function drawCurrentTrail() {
    drawPixelTrail(currentTrail, PALETTE.amber, 4);
  }

  function drawParticles() {
    particles.forEach((p) => {
      const alpha = Math.max(0, 1 - p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }

  function drawTargets() {
    targetBodies.forEach((body) => {
      const hit = hitTargetIds.has(body.targetIndex);
      const r = body.targetDef.r;
      const color = hit ? PALETTE.green : PALETTE.coral;
      const cx = body.position.x;
      const cy = body.position.y;
      drawPixelCircle(cx, cy, r, color);
      drawPixelCircle(cx, cy, r * 0.62, PALETTE.bg);
      drawPixelCircle(cx, cy, r * 0.3, color);
    });
  }

  function drawLauncherRig(level) {
    const { x, y } = level.launcher;
    ctx.save();
    ctx.fillStyle = PALETTE.inkDim;
    ctx.fillRect(x - 15, y, 4, Math.max(0, GROUND_TOP - y));
    ctx.fillRect(x + 11, y, 4, Math.max(0, GROUND_TOP - y));
    ctx.fillStyle = PALETTE.amber;
    ctx.fillRect(x - 3, y - 3, 6, 6);
    ctx.restore();
  }

  function drawSlingBands(launcher, drag) {
    ctx.save();
    ctx.strokeStyle = PALETTE.amber;
    ctx.lineWidth = 4;
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
    ctx.fillStyle = PALETTE.amber;
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
        ctx.fillRect(px - 2, py - 2, 4, 4);
      }
      if (py > CANVAS_H) break;
    }
    ctx.restore();
  }

  function drawBall() {
    if (!ballBody) return;
    const cx = ballBody.position.x;
    const cy = ballBody.position.y;
    drawPixelCircle(cx, cy, 16, getBallColor());
    const ix = cx + Math.cos(ballBody.angle) * 8;
    const iy = cy + Math.sin(ballBody.angle) * 8;
    ctx.fillStyle = PALETTE.outline;
    ctx.fillRect(ix - 2, iy - 2, 4, 4);
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

  // ---------- Skin della pallina ----------
  // Ogni skin (tranne quella di base) si sblocca ottenendo un obiettivo
  // specifico — un motivo in più per andare a caccia di obiettivi.
  const SKINS = [
    { id: "amber", name: "Oro", color: "#ffd23f", requires: null },
    { id: "coral", name: "Corallo", color: "#ff3860", requires: "clean_sheet" },
    { id: "cyan", name: "Ciano", color: "#2de2e6", requires: "portal_hopper" },
    { id: "green", name: "Smeraldo", color: "#39ff88", requires: "master_engineer" },
  ];

  let selectedSkin = "amber";
  try {
    const savedSkin = localStorage.getItem(SKIN_KEY);
    if (savedSkin && SKINS.some((s) => s.id === savedSkin)) selectedSkin = savedSkin;
  } catch (e) {
    /* nessun salvataggio disponibile: si parte dalla skin di base */
  }

  function isSkinUnlocked(skin) {
    return !skin.requires || Achievements.isUnlocked(skin.requires);
  }

  function getBallColor() {
    const skin = SKINS.find((s) => s.id === selectedSkin) || SKINS[0];
    return isSkinUnlocked(skin) ? skin.color : SKINS[0].color;
  }

  function renderSkinsPanel() {
    skinsList.innerHTML = "";
    SKINS.forEach((skin) => {
      const unlocked = isSkinUnlocked(skin);
      const btn = document.createElement("button");
      btn.className = "skin-swatch" + (skin.id === selectedSkin ? " selected" : "") + (unlocked ? "" : " locked");
      btn.style.setProperty("--swatch-color", skin.color);
      btn.disabled = !unlocked;
      const reqDef = skin.requires ? Achievements.list().find((a) => a.id === skin.requires) : null;
      btn.innerHTML = `
        <span class="skin-swatch-dot"></span>
        <span class="skin-swatch-name">${unlocked ? skin.name : "🔒"}</span>
        ${!unlocked && reqDef ? `<span class="skin-swatch-req">${reqDef.name}</span>` : ""}
      `;
      btn.addEventListener("click", () => {
        if (!unlocked) return;
        SoundEngine.playClick();
        selectedSkin = skin.id;
        try {
          localStorage.setItem(SKIN_KEY, selectedSkin);
        } catch (e) {
          /* la scelta resta valida solo per questa sessione */
        }
        renderSkinsPanel();
      });
      skinsList.appendChild(btn);
    });
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
  function showFatalError() {
    let box = document.getElementById("fatal-error-box");
    if (!box) {
      box = document.createElement("div");
      box.id = "fatal-error-box";
      box.className = "fatal-error";
      box.innerHTML =
        "<p><strong>⚠️ Motore fisico non disponibile.</strong></p>" +
        "<p>Il gioco non riesce a caricare la libreria di fisica da nessuna delle fonti online provate. Succede spesso su reti scolastiche o aziendali che bloccano i CDN esterni.</p>" +
        "<p>Prova a ricaricare la pagina, cambiare rete (es. dati mobili) o browser.</p>";
      levelGrid.parentNode.insertBefore(box, levelGrid);
    }
  }

  function startPlaying(levelData) {
    if (!matterAvailable) {
      showFatalError();
      return;
    }
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
  btnOpenSkins.addEventListener("click", () => {
    SoundEngine.playClick();
    renderSkinsPanel();
    overlaySkins.classList.remove("hidden");
  });
  btnSkinsClose.addEventListener("click", () => {
    SoundEngine.playClick();
    overlaySkins.classList.add("hidden");
  });

  // ---------- Ponte verso l'editor (js/editor.js) ----------
  window.ArcGame = {
    playCustom(levelData, code) {
      if (!matterAvailable) {
        showFatalError();
        return;
      }
      mode = "custom";
      currentLevelIndex = -1;
      activeLevelCode = code || null;
      startPlaying(levelData);
    },
  };

  // ---------- Avvio ----------
  renderMenu();
  if (!matterAvailable) showFatalError();
})();
