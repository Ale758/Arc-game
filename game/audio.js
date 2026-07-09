/*
  ARC — motore audio
  Tutti i suoni sono sintetizzati al volo con la Web Audio API (oscillatori +
  rumore filtrato). Nessun file audio esterno: zero asset da scaricare, zero
  problemi di licenza, funziona identico su GitHub Pages / Vercel / itch.io.

  I browser bloccano l'avvio di un AudioContext prima di un gesto utente:
  SoundEngine.unlock() va chiamato al primo click/tocco/tasto (vedi game.js).
*/

const SoundEngine = (function () {
  const MUTE_KEY = "arc-game-muted-v1";

  let ctx = null;
  let masterGain = null;
  let muted = false;
  try {
    muted = localStorage.getItem(MUTE_KEY) === "1";
  } catch (e) {
    /* localStorage non disponibile: si parte semplicemente non mutati */
  }

  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 0.5;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone({ freq, type = "sine", duration = 0.15, gain = 0.25, delay = 0, glideTo = null }) {
    const c = ensureContext();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function noiseBurst({ duration = 0.08, gain = 0.2, filterFreq = 1200, delay = 0 }) {
    const c = ensureContext();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const size = Math.max(1, Math.floor(c.sampleRate * duration));
    const buffer = c.createBuffer(1, size, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / size);
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  return {
    unlock() {
      ensureContext();
    },

    isMuted() {
      return muted;
    },

    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
      } catch (e) {
        /* nessun salvataggio disponibile: il flag resta comunque valido per la sessione corrente */
      }
      if (masterGain) masterGain.gain.value = muted ? 0 : 0.5;
      return muted;
    },

    // Rilascio della fionda: "twang" — due toni brevi, il pitch sale con la potenza
    playLaunch(power) {
      const p = Math.max(0, Math.min(1, power));
      tone({ freq: 180 + p * 260, type: "triangle", duration: 0.16, gain: 0.28 });
      tone({ freq: 420 + p * 300, type: "sine", duration: 0.1, gain: 0.14, delay: 0.02 });
    },

    // Impatto contro terreno/ostacolo: piccolo "thud" filtrato, intensità = velocità
    playBounce(intensity) {
      const i = Math.max(0, Math.min(1, intensity));
      noiseBurst({ duration: 0.04 + i * 0.05, gain: 0.08 + i * 0.16, filterFreq: 300 + i * 1400 });
    },

    // Bersaglio colpito: nota di un arpeggio maggiore, sale ad ogni bersaglio nello stesso livello
    playTargetHit(comboIndex) {
      const semis = [0, 4, 7, 12, 16][Math.min(comboIndex, 4)];
      const freq = 523.25 * Math.pow(2, semis / 12);
      tone({ freq, type: "square", duration: 0.2, gain: 0.2 });
      tone({ freq: freq * 2, type: "sine", duration: 0.16, gain: 0.09, delay: 0.015 });
    },

    // Livello completato: accordo maggiore arpeggiato, con scintilla extra a 3 stelle
    playLevelComplete(stars) {
      [523.25, 659.25, 783.99].forEach((f, i) => {
        tone({ freq: f, type: "triangle", duration: 0.5, gain: 0.2, delay: i * 0.07 });
      });
      if (stars >= 3) {
        tone({ freq: 1046.5, type: "sine", duration: 0.45, gain: 0.16, delay: 0.26 });
      }
    },

    // Pallina caduta fuori campo / nel vuoto: blip discendente
    playMiss() {
      tone({ freq: 260, type: "sawtooth", duration: 0.22, gain: 0.13, glideTo: 90 });
    },

    // Feedback di interfaccia (bottoni, selezione livello)
    playClick() {
      tone({ freq: 780, type: "square", duration: 0.045, gain: 0.1 });
    },
  };
})();
