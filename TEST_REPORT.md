# Rapporto di verifica - versione con acquisizione originale

## Esito

- Compilazione TypeScript senza emissione: superata.
- Build TypeScript del server: superata.
- Test Node: **41 passati, 0 falliti** (conteggio del runner, inclusi i sottotest HTTP).
- Verifiche DOM in Chromium: **17 passate**, nessuna eccezione JavaScript non gestita.
- `src/ride-parser.ts`: confrontato byte per byte con lo ZIP originale; invariato.

## Cosa e stato davvero eseguito

I test Node hanno usato Express e SQLite reali su questo computer. Le richieste HTTP di prova hanno verificato autenticazione del sito, CORS, protezione degli endpoint, risposte senza telefono, invio del numero normalizzato al browser simulato, OTP, sync incrementale, idempotenza, stazioni di partenza e arrivo, feed indisponibile, pagina senza corse riconoscibili, reset e conservazione dell'ultima sincronizzazione riuscita.

Il parser originale e stato eseguito su righe di esempio. La lettura del testo della pagina e l'inserimento OTP sono stati verificati con oggetti Page simulati. Il browser BikeMi autenticato NON e stato avviato su un account reale.

Il test dell'interfaccia ha eseguito HTML, CSS e JavaScript in Chromium, in memoria: pagina mobile e desktop, login al sito, numero BikeMi, codice SMS, sync, contatori, ricerca della mancante piu vicina, posizione simulata, cambio lingua e assenza di import manuali. Rete, GPS, API e tasselli della mappa sono simulati. Le immagini di controllo usano tasselli neutri di test: non provano il caricamento delle cartine stradali reali.

L'ambiente blocca la navigazione diretta di Chromium tramite policy: il test DOM usa `set_content` e fixture locali, senza modificare policy o collegarsi a BikeMi.

## Limiti importanti

Non verificati in questa sessione:

- Login reale BikeMi, ricezione SMS, challenge, scadenza reale del provider.
- Attuale compatibilita dei selettori con il DOM privato BikeMi.
- Recupero di corse non caricate nella pagina; nessuna paginazione aggiunta.
- GPS reale di iPhone/Android e relativo comportamento in background.
- Mappa OSM e feed live dal futuro dominio pubblicato.
- Pubblicazione nel tuo repository, backend remoto, HTTPS, CORS tra domini effettivamente distribuiti.
- Build e avvio del Dockerfile/Compose o workflow GitHub nel tuo account.

L'installazione pulita `npm ci` non e stata completata nel container. Per eseguire i test sono state usate le dipendenze presenti nell'archivio originale, ricompilando il componente SQLite per Linux con gli header Node disponibili. Sono stati eseguiti direttamente il compilatore TypeScript e il runner Node; la distribuzione NON contiene `node_modules`, binari nativi o dipendenze locali di test. Sul computer di destinazione usa `npm ci`, non copiare i moduli Windows contenuti nello ZIP originale.

## Comandi usati per il codice

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --project tsconfig.build.json
node --test tests/*.test.mjs
```

Test DOM riproducibile, con Python/Pillow/Playwright e Chromium installati:

```sh
python tests/component_checks.py
```

Le dipendenze e il browser installati correttamente sul sistema di destinazione permettono di usare i normali script `npm run check`, `npm test` e `npm start`.

**Conclusione:** implementazione corretta per mantenere il meccanismo originale e verificata localmente con provider simulato. Non e una certificazione di sincronizzazione live con l'attuale sito BikeMi, ne una versione eseguibile usando solo GitHub Pages.
