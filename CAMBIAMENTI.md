# Confronto con il progetto caricato

## Metodo originale mantenuto

- `src/ride-parser.ts`: identico byte per byte al file nello ZIP originale.
- `src/bikemi.ts`: mantenuti i metodi di login, richiesta SMS, verifica OTP, verifica della pagina storico e lettura di `document.body.innerText`. Aggiunte solo configurazione della cartella sessioni/eseguibile Chromium e protezione dall'apertura concorrente dello stesso profilo.
- `src/auth-service.ts`: stesso flusso di autenticazione; aggiunti chiusura dei tentativi scaduti e annullamento. Rimossi log di eccezioni non controllate.
- `src/sync-service.ts`: stesso percorso `open -> hasRideHistory -> rideHistoryRows -> parseRideRows -> saveRides`. Un problema del feed pubblico non scarta piu le corse lette. Nessuna riga riconoscibile produce un errore esplicito.
- `src/db.ts`: mantenute le tabelle SQLite originali; aggiunte tabelle per conservare visite gia note, ultima sync riuscita e rete attiva. Deduplicazione delle corse ancora basata su utente + ID corsa.

## Modifiche del sito

- Nuova mappa mobile/desktop, ricerca e filtri visitate/mancanti.
- Posizione tramite consenso esplicito, senza aggiungere visite.
- Pulsante unico di aggiornamento collegato all'API originale.
- UI del numero BikeMi e codice SMS integrata nell'app.
- Profilo, progressi e lingua IT/EN.
- Cache locale della mappa per non mostrare una schermata vuota se il backend manca.
- Accesso privato all'API: la sola conoscenza di un ID utente non permette piu di leggere il suo storico.
- Nessuna importazione manuale, nessun bookmarklet, nessun file personale nel progetto pubblico.

## Cosa NON e incluso

Non e stato attivato un server, non e stato pubblicato un repository, non e stato fatto un login reale a BikeMi e non e stata inventata una modalita di esecuzione Playwright in GitHub Pages. Non e stato aggiunto un sistema di paginazione non verificato. I viaggi letti sono quelli effettivamente caricati nella pagina, come nell'originale.

SHA-256 del parser originale e della copia mantenuta: `25c491df85c04e0062046517bc6cfcac319dbdd995e3bb838468bf8bde5bfbc9`.
