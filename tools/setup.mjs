import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) {
  console.log('Il file .env esiste: non e stato modificato. / Existing .env preserved.');
} else {
  const contents = readFileSync('.env.example', 'utf8').replace(/^EXPLORER_ACCESS_KEY=$/m, 'EXPLORER_ACCESS_KEY=' + randomBytes(32).toString('hex'));
  writeFileSync('.env', contents, { mode: 0o600, flag: 'wx' });
  console.log('Creato .env con una chiave casuale. Apri il file e usa EXPLORER_ACCESS_KEY per accedere al sito. Non pubblicare questo file.');
}
