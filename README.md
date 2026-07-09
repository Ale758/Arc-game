# ARC

Un piccolo puzzle fisico stile "disegno tecnico": trascini la pallina dal
punto di ancoraggio, miri, rilasci e cerchi di colpire tutti i bersagli
usando meno tiri possibile. 8 livelli, difficoltà crescente.

**Meccanica firma:** ogni tiro che non centra il bersaglio lascia sul campo
un segno d'inchiostro permanente, che diventa un ostacolo fisico reale per
i tiri successivi nello stesso livello. Più sbagli, più il progetto si
complica — quindi conviene ragionare prima di tirare.

Tecnologia: solo HTML + CSS + JavaScript vanilla, fisica con
[Matter.js](https://brm.io/matter-js/) caricato da CDN. Nessuna build,
nessuna dipendenza da installare.

```
arc-game/
├── index.html
├── style.css
└── js/
    ├── audio.js    ← motore audio (suoni sintetizzati, nessun file esterno)
    ├── levels.js   ← definizione degli 8 livelli (modifica qui per tarare la difficoltà)
    └── game.js     ← motore di gioco (fisica, inchiostro, particelle, input, rendering)
```

## Audio

Tutti i suoni (lancio, rimbalzo, bersaglio colpito, livello completato, click
UI) sono generati al volo con la **Web Audio API** — non ci sono file `.mp3`
o `.wav` da scaricare, quindi zero problemi di licenza e caricamento
istantaneo anche su itch.io. C'è un tasto 🔊/🔇 fisso in alto a destra per
disattivare l'audio; la preferenza viene ricordata nel browser.

Per policy dei browser, l'audio si sblocca solo dopo il primo click/tocco
della pagina: è già gestito automaticamente in `game.js`, non serve fare
nulla. Se vuoi cambiare i suoni, tutte le funzioni sono in `js/audio.js` e
usano solo oscillatori e rumore filtrato — puoi modificare frequenze,
durate e forme d'onda (`sine`, `square`, `triangle`, `sawtooth`) senza
bisogno di alcun asset.

## Inchiostro permanente, juice, tutorial e condivisione

**Inchiostro permanente** — durante il volo, la pallina disegna la propria
traiettoria in tempo reale (linea ambra piena). Se il tiro non centra il
bersaglio, quella linea "si asciuga" (diventa tratteggiata e spenta) e si
trasforma in un vero ostacolo fisico per i tiri successivi dello stesso
livello. È gestita in `commitTrail()` / `recordTrailPoint()` in `game.js`;
i parametri da tarare sono `TRAIL_MIN_DIST`, `TRAIL_THICKNESS` e
`TRAIL_EXCLUDE_LAUNCHER_R` in cima al file.

**Juice** — piccole particelle "a tratteggio tecnico" sugli impatti e sui
bersagli colpiti, uno scuotimento leggero della schermata (`shakeMag`) e
vibrazione su mobile (`navigator.vibrate`, ignorata silenziosamente sui
browser che non la supportano, es. iOS Safari).

**Tutorial** — al primo avvio del livello 1 compare una nota "del
progettista" con le istruzioni essenziali; non ricompare più una volta
chiusa (salvato in `localStorage`). Per fartelo ricomparire durante i test,
cancella la chiave `arc-game-tutorial-seen-v1` da localStorage (DevTools →
Application → Local Storage) o apri il gioco in navigazione anonima.

**Condivisione risultati** — stile Wordle: un pulsante "Copia risultato"
nell'overlay di fine livello e un pulsante "Copia i miei risultati" nel
menu copiano negli appunti un testo con stelline ed emoji (🟩🟨🟧⬛) pronto
da incollare ovunque. Se pubblichi il gioco, incolla l'URL nella costante
`SHARE_URL` in cima a `game.js`: verrà aggiunto automaticamente ai testi
copiati.

## 1. Provarlo in locale

Puoi aprire direttamente `index.html` nel browser con doppio click.
Se preferisci un server locale (consigliato, specialmente su mobile / per
evitare limitazioni del browser su alcuni sistemi):

```bash
# con Python
python3 -m http.server 8000

# oppure con Node
npx serve .
```

poi apri `http://localhost:8000`.

**Importante:** non ho potuto testare il gioco in un vero browser durante
la creazione (l'ambiente in cui l'ho scritto non ha accesso di rete/display).
La logica è corretta e il codice è stato controllato sintatticamente, ma le
sensazioni di gioco (potenza del lancio, difficoltà dei livelli) vanno
verificate e probabilmente tarate da te. I parametri da modificare sono in
cima a `js/game.js`:

- `POWER_SCALE` — quanto è potente il lancio rispetto alla trazione
- `MAX_DRAG` — quanto puoi tirare indietro la fionda
- `engine.world.gravity.y` (in `buildLevel`) — forza di gravità

e in `js/levels.js`: posizione di ostacoli/bersagli/`par` per ogni livello.

## 2. Pubblicare su GitHub

```bash
cd arc-game
git init
git add .
git commit -m "ARC — primo commit"
gh repo create arc-game --public --source=. --push
# oppure, senza gh cli:
# git remote add origin https://github.com/<tuo-utente>/arc-game.git
# git branch -M main
# git push -u origin main
```

## 3. Deploy su Vercel (gratuito)

Non serve alcuna configurazione: è un sito statico.

1. Vai su [vercel.com](https://vercel.com) → **Add New Project**
2. Importa il repository GitHub appena creato
3. Framework Preset: **Other** (Vercel lo rileva da solo, non c'è build da eseguire)
4. Deploy

In alternativa da terminale:

```bash
npm i -g vercel
vercel
```

## 4. Pubblicare su itch.io (gratuito)

1. Comprimi in `.zip` il **contenuto** della cartella `arc-game`
   (attenzione: `index.html` deve stare nella radice dello zip, non dentro
   una sottocartella)
2. Su itch.io → **Upload new project**
3. Kind of project: **HTML**
4. Carica lo zip, spunta **"This file will be played in the browser"**
5. Imposta le dimensioni del viewport a **960 × 600** (o "automatic")
6. Pubblica

## Idee per continuare

- Più livelli in `LEVELS` in `js/levels.js`, magari con nuove combinazioni
  che sfruttano l'inchiostro accumulato (es. bersagli raggiungibili solo
  costruendo una rampa con i propri tiri falliti)
- Una modalità "difficile" a tiri limitati per livello, per chi cerca la
  vera sfida da classifica
- Musica ambientale procedurale di sottofondo (in `js/audio.js` c'è già
  tutto l'occorrente per generare un drone/pad con gli oscillatori)
- Salvataggio progressi già incluso via `localStorage` (funziona anche su
  itch.io e Vercel, è per-browser/per-dispositivo)
