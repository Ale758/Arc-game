# ARC

Un piccolo puzzle fisico stile "disegno tecnico": trascini la pallina dal
punto di ancoraggio, miri, rilasci e cerchi di colpire tutti i bersagli
usando meno tiri possibile. 19 livelli, difficoltà crescente, più una sfida
giornaliera, obiettivi ed un editor per creare e condividere i tuoi livelli.

**Meccanica firma:** ogni tiro lascia sul campo una traccia d'inchiostro
permanente — la cronologia visiva dei tuoi tentativi su quel livello. È un
segno puramente estetico: non blocca né devia i tiri successivi.

Dal livello 9 compaiono nuove meccaniche: **portali** (cerchi ciano
collegati, teletrasportano la pallina mantenendo la velocità), **correnti
d'aria** (zone che spingono la pallina in una direzione, utili per
attraversare voragini troppo larghe) e **ingranaggi** (muri rotanti da
aggirare o sfruttare come deflettori). Dal livello 15: **trampolini** (pad
rosa acceso, rimbalzo molto più elastico del normale) e **zone a gravità
leggera** (annullano parzialmente la gravità mentre la pallina è dentro,
allungando l'arco del tiro).

Tecnologia: solo HTML + CSS + JavaScript vanilla, fisica con
[Matter.js](https://brm.io/matter-js/) caricato da CDN. Nessuna build,
nessuna dipendenza da installare.

```
arc-game/
├── index.html
├── style.css
├── manifest.json      ← manifest PWA (nome, icone, colori) — rende il gioco installabile
├── sw.js              ← service worker: cache offline dei file del gioco
├── icons/             ← icone dell'app (generate in stile pixel art)
└── js/
    ├── audio.js          ← motore audio (suoni + musica sintetizzati, nessun file esterno)
    ├── achievements.js   ← definizione e salvataggio degli 8 obiettivi
    ├── levels.js         ← definizione dei 19 livelli (modifica qui per tarare la difficoltà)
    ├── game.js           ← motore di gioco (fisica, inchiostro, portali/vento, skin, tastiera, rendering)
    └── editor.js         ← editor di livelli (piazzamento, playtest, export/import codice)
```

## Musica, skin, tastiera e installazione

**Musica di sottofondo** — un giro di basso chiptune generato con oscillatori
(stesso principio degli effetti sonori, zero file audio). Parte da sola al
primo click/tocco sulla pagina, insieme allo sblocco audio, e segue lo
stesso tasto muto 🔊/🔇 degli effetti. Per cambiarla, il pattern di note è
in `MUSIC_BASS` in cima a `js/audio.js`.

**Skin della pallina** — dal menu, "🎨 Personalizza": 4 colori, 3 dei quali
si sbloccano ottenendo un obiettivo specifico (mostrato nel pannello). La
scelta resta salvata in `localStorage`. Per aggiungerne una, basta una riga
nell'array `SKINS` in `game.js`.

**Controlli da tastiera** — alternativa al trascinamento: frecce
sinistra/destra per ruotare la mira, su/giù per la potenza, Spazio o Invio
per lanciare. Utile su desktop.

**Installabile come app (PWA)** — su Chrome/Edge (desktop e Android) compare
l'opzione "Installa app" o "Aggiungi a schermata Home"; su iOS Safari si fa
da Condividi → "Aggiungi a Home". Il service worker (`sw.js`) mette in cache
i file del gioco, quindi funziona anche offline una volta aperto la prima
volta. **Importante:** ad ogni modifica ai file, `sw.js` va aggiornato
cambiando `CACHE_NAME` (es. `arc-game-v6` → `arc-game-v7`), altrimenti chi
ha già installato l'app potrebbe continuare a vedere la versione vecchia
dalla cache. Su Vercel/GitHub Pages non serve altro: manifest e service
worker funzionano automaticamente via HTTPS.
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

**Scia d'inchiostro** — durante il volo, la pallina disegna la propria
traiettoria in tempo reale (linea ambra piena). Quando il tiro finisce,
quella linea "si asciuga" (diventa tratteggiata e spenta) e resta visibile
per il resto del livello come cronologia dei tentativi — ma è solo un
segno visivo: non ha alcun effetto sulla fisica dei tiri successivi. È
gestita in `commitTrail()` / `recordTrailPoint()` in `game.js`; i parametri
da tarare sono `TRAIL_MIN_DIST` e `TRAIL_THICKNESS` in cima al file.

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

## Sfida del giorno

Ogni giorno il gioco seleziona in modo deterministico un livello dalla
lista `LEVELS` (in base alla data, uguale per tutti i giocatori nello
stesso fuso orario) e lo propone nella scheda "SFIDA DEL GIORNO" in cima al
menu. Completarla aggiorna una serie di giorni consecutivi (streak, salvata
in `localStorage`); saltare un giorno la azzera. La data usata è quella
**locale del dispositivo**, non sincronizzata via rete: due giocatori in
fusi orari molto diversi potrebbero ricevere il livello del giorno con
qualche ora di scarto — una semplificazione accettabile per un progetto di
questa scala. Logica in `game.js`, cerca `updateDailyStreak`.

## Obiettivi

8 obiettivi sbloccabili (primo livello, livello senza segni d'inchiostro,
completamento in un solo tiro, tutti i livelli a 3 stelle, un livello con
portale, serie di 3 e 7 giorni, primo livello esportato dall'editor).
Definiti in `js/achievements.js`; per aggiungerne uno nuovo basta aggiungere
una voce a `DEFS` e chiamare `Achievements.unlock('tuo-id')` nel punto
giusto di `game.js`.

## Editor di livelli

Dal menu, "✏️ Editor di livelli" apre uno strumento per disegnare i tuoi
schemi: trascina per creare muri o trampolini, clicca per piazzare
bersagli o spostare il lanciatore, clicca due volte per collegare una
coppia di portali, trascina per disegnare zone vento o antigravità (il
tasto "💨 Vento" cicla tra le 4 direzioni ad ogni click quando è già lo
strumento selezionato).
"▶ Playtest" carica subito il livello nel motore di gioco vero (fisica
inclusa) così puoi provarlo prima di condividerlo — è anche il modo in cui
**io** consiglio di verificare che un livello sia risolvibile, dato che non
ho potuto testarlo in un browser durante lo sviluppo. "📤 Esporta codice"
genera una stringa di testo (JSON compresso in base64) che chiunque può
incollare in "📥 Carica e gioca" per provare il tuo livello — nessun
server, nessun account, solo copia-incolla.

Il terreno resta sempre a larghezza piena (niente voragini disegnabili a
mano), per ridurre il rischio di livelli impossibili da completare — se
vuoi una voragine, l'unica via resta modificare `LEVELS` in `js/levels.js`
a mano seguendo lo schema dei livelli esistenti.

## Risoluzione problemi

**Dopo un aggiornamento, il gioco mostra ancora la versione vecchia.**
Da quando c'è il service worker (`sw.js`), oltre alla cache del browser
normale c'è anche la sua cache offline. Se un hard refresh (Ctrl/Cmd+Shift+R)
non basta: apri DevTools → Application → Service Workers → "Unregister", poi
ricarica. Ricordati anche di alzare `CACHE_NAME` in `sw.js` ad ogni modifica
(vedi sezione sopra) — è il modo per evitare il problema alla radice.

**Il menu si vede ma la lista livelli è vuota e non succede nulla ai click.**
Quasi sempre è il motore fisico (Matter.js) che non riesce a caricarsi da
nessuna delle fonti online — capita su reti scolastiche/aziendali che
filtrano i CDN esterni. Dalla versione attuale il gioco prova tre fonti in
sequenza (cdnjs → jsdelivr → unpkg) e, se falliscono tutte, mostra un
messaggio chiaro invece di restare bloccato senza spiegazioni. Se lo vedi:
prova a ricaricare, cambiare rete (es. dati mobili) o browser. Per la
massima affidabilità puoi anche scaricare `matter.min.js` e metterlo dentro
`js/` nel tuo repository, poi cambiare il primo `<script src="...">` in
`index.html` con `<script src="js/matter.min.js"></script>` — così il gioco
non dipende più da nessun servizio esterno.

**Il sito pubblicato mostra una versione più vecchia del gioco.**
Controlla che Vercel abbia effettivamente ricevuto l'ultimo push (tab
"Deployments" del progetto su vercel.com) e prova un refresh forzato del
browser (Ctrl/Cmd+Shift+R) per escludere la cache.

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
- `PORTAL_COOLDOWN_MS` — tempo minimo tra due teletrasporti consecutivi
- `restitution: 0.8` e `density: 0.0028` (in `spawnBall`) — elasticità e
  peso della pallina: più alta la prima, rimbalza di più ovunque; più bassa
  la seconda, più è "leggera" e reattiva a vento/zone antigravità

e in `js/levels.js`, livello per livello: posizione di ostacoli/bersagli/
`par`, `fx`/`fy` delle zone di vento (`windZones` — ora possono spingere in
qualunque delle 4 direzioni, non solo a destra), `speed` degli ostacoli
rotanti/mobili (`type: "rotator"` o campo `movement`), `restitution` dei
trampolini (`type: "bouncer"`, default 10.5 — un valore estremo, se la
pallina schizza fuori schermo quasi ad ogni tiro è la prima cosa da
abbassare) e `strength` delle zone a gravità leggera (`gravityZones`,
default 2.1 — con valori sopra 1 la gravità non si annulla soltanto, si
inverte: la pallina sale) — questi ultimi sono i valori con cui sono stato più prudente, non avendo potuto vederli
in azione.

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

- Una modalità "difficile" a tiri limitati per livello, per chi cerca la
  vera sfida da classifica
- Musica ambientale procedurale di sottofondo (in `js/audio.js` c'è già
  tutto l'occorrente per generare un drone/pad con gli oscillatori)
- Editor v2: rotazione dei muri, voragini, e magari anche portali/vento
  per chi vuole progettare livelli davvero avanzati
- Una classifica condivisa richiederebbe un piccolo backend (oggi tutto è
  locale al browser, per restare a costo zero e senza account)
