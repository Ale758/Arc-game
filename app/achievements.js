/*
  ARC — obiettivi
  Modulo indipendente: tiene definizioni, stato (localStorage) e rendering
  del pannello. game.js chiama Achievements.unlock(id) nei punti giusti.
*/

const Achievements = (function () {
  const KEY = "arc-game-achievements-v1";

  const DEFS = [
    { id: "first_blueprint", icon: "📐", name: "Primo tratto", desc: "Completa il tuo primo livello." },
    { id: "clean_sheet", icon: "✨", name: "Foglio pulito", desc: "Completa un livello senza lasciare alcun segno d'inchiostro." },
    { id: "one_shot", icon: "🎯", name: "Un solo tiro", desc: "Completa un livello con un solo tiro, anche con più bersagli." },
    { id: "master_engineer", icon: "🏆", name: "Ingegnere capo", desc: "Ottieni 3 stelle su tutti i livelli." },
    { id: "portal_hopper", icon: "🌀", name: "Nuove rotte", desc: "Completa un livello che contiene un portale." },
    { id: "streak_3", icon: "🔥", name: "Serie di 3", desc: "Gioca la sfida del giorno per 3 giorni di fila." },
    { id: "streak_7", icon: "🔥🔥", name: "Serie di 7", desc: "Gioca la sfida del giorno per 7 giorni di fila." },
    { id: "architect", icon: "✏️", name: "Architetto", desc: "Esporta il tuo primo livello dall'editor." },
  ];

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* nessun salvataggio disponibile: gli obiettivi restano validi solo per la sessione corrente */
    }
  }

  let state = load();

  return {
    // Ritorna la definizione dell'obiettivo se è stato sbloccato ORA per la
    // prima volta, altrimenti null (già sbloccato prima, o id inesistente).
    unlock(id) {
      if (state[id]) return null;
      const def = DEFS.find((d) => d.id === id);
      if (!def) return null;
      state[id] = true;
      save(state);
      return def;
    },
    isUnlocked(id) {
      return !!state[id];
    },
    list() {
      return DEFS.map((d) => ({ ...d, unlocked: !!state[d.id] }));
    },
    unlockedCount() {
      return DEFS.filter((d) => state[d.id]).length;
    },
    total() {
      return DEFS.length;
    },
  };
})();

// Esposizione esplicita: `const` non attacca automaticamente a `window`,
// ed editor.js vi accede tramite window.Achievements.
window.Achievements = Achievements;
