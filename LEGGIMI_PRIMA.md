# BikeMi Explorer - sincronizzazione originale

**Questa versione corregge la precedente: non importa file, non usa bookmarklet e non legge lo storico con un'azione manuale sul telefono. Riutilizza il server Node.js + Playwright del progetto Raspberry Pi.**

## Cosa fa

Dal telefono: apri il sito, accedi al tuo sito privato, selezioni il profilo, inserisci il numero BikeMi e il codice SMS. Il server conserva il profilo Chromium. Dopo il collegamento, **Aggiorna da BikeMi** riapre lo storico usando la sessione salvata, legge le corse e aggiorna le stazioni. Un nuovo SMS serve quando la sessione non e piu valida o quando ricolleghi l'account.

La nuova interfaccia aggiunge mappa interattiva, richiesta della posizione, punto blu aggiornato mentre usi il sito, ricerca, filtri, stazione mancante piu vicina e italiano/inglese. Il GPS non aggiunge visite.

## Il vincolo da non confondere

**GitHub puo contenere tutto il codice. GitHub Pages puo ospitare la parte grafica, ma non puo eseguire il server Node/Playwright.**

Per mantenere QUESTO metodo, un computer deve eseguire il backend quando chiedi una sincronizzazione: la Raspberry Pi originale, un PC acceso o un server compatibile con Node, Chromium e disco persistente. Non viene scelto ne attivato alcun hosting per te.

Solo GitHub Pages + nessun server + stesso meccanismo originale **non e una configurazione realizzabile con questo sito**. Non viene nascosto questo vincolo dietro un pulsante non funzionante.

## Avvio sul computer o sul server

Installa Node.js 22, poi dalla cartella del progetto:

```sh
npm ci
npm run setup
npm run browser:install
npm start
```

Su Linux, la prima installazione di Chromium potrebbe richiedere anche:

```sh
npx playwright install --with-deps chromium
```

Apri `http://localhost:3000` sullo stesso computer. Il file `.env` appena creato contiene `EXPLORER_ACCESS_KEY`: e la chiave del TUO sito, non una password BikeMi. Copiala nella prima schermata di accesso. Non viene inserita in JavaScript pubblico.

Poi: **Profilo -> scegli ID -> Collega BikeMi -> numero -> SMS -> verifica**. Dopo la verifica parte la prima sincronizzazione. Per le successive premi **Aggiorna da BikeMi**.

Per il telefono, usa un indirizzo HTTPS raggiungibile dal telefono: l'HTTP della rete locale normalmente non consente la geolocalizzazione. La configurazione HTTPS/dominio dipende da dove esegui il server e non viene creata da questo ZIP.

## Conservare i dati della vecchia Raspberry Pi

Ferma il vecchio servizio e fai una copia privata di sicurezza della cartella `data/`. Trasferisci `data/bikemi.sqlite` nella stessa posizione del nuovo progetto e usa lo stesso ID profilo locale. Lo schema originale viene mantenuto e ampliato con tabelle aggiuntive.

Puoi trasferire anche `data/bikemi_sessions/` **su un ambiente compatibile**. I profili Chromium possono dipendere da sistema e versione: non e garantito che una sessione migrata sia riutilizzabile. Se necessario richiedi un nuovo SMS. Non eseguire due istanze sullo stesso profilo Chromium/database.

**Non caricare mai `data/`, `.env`, database, numeri o sessioni su GitHub.** Questo ZIP non contiene il database personale originale ne le sessioni dell'utente.

## GitHub Pages come interfaccia

Questa opzione richiede un backend gia acceso e raggiungibile in HTTPS.

1. Carica il progetto su GitHub senza i file privati esclusi da `.gitignore`.
2. Imposta `apiBase` in `public/config.js` all'origine HTTPS del tuo backend, per esempio `https://server.example` (e un segnaposto, non un server fornito).
3. Sul backend imposta `ALLOWED_ORIGINS=https://TUO_NOME.github.io`, senza percorso del repository e senza slash finale. Riavvia il backend.
4. In GitHub: Settings -> Pages -> Source: GitHub Actions. In Actions esegui manualmente **Publish frontend only (backend required)**. Pubblica soltanto `public/`.
5. Apri il link Pages e accedi con la tua chiave privata del sito.

Il workflow rifiuta la pubblicazione finche `apiBase` non e configurato in HTTPS. GitHub Actions qui pubblica la grafica: **non viene usato come server delle corse**.

La soluzione piu semplice resta ospitare grafica e backend insieme (`apiBase: ''`), con il codice conservato su GitHub.

## Verifica indispensabile

Il parser dello storico e rimasto identico all'originale. Sono stati conservati login, invio SMS, inserimento OTP, sessione Chromium persistente e lettura del testo della pagina protetta. Tuttavia non e stato eseguito un login reale al tuo account in questo ambiente. Se BikeMi ha modificato la pagina, i selettori devono essere verificati. Non e promessa una durata fissa di pochi secondi.

Come l'originale, la lettura riguarda **le corse caricate nella pagina**. Non e stata inventata una paginazione o la lettura di mesi che il sito non carica. In caso di pagina senza corse riconoscibili, il programma mostra un avviso e conserva i progressi precedenti invece di dichiarare una falsa sincronizzazione riuscita.

Dettagli: `README.md`, `CAMBIAMENTI.md`, `TEST_REPORT.md`.
