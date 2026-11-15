// integrations/gateway/src/tiger/ledgerFile.ts
// The ledger on disk (RFC §5, TIG-D5): append-only NDJSON at `<stateDir>/imports.ndjson`, outside results/. Each line
// is appended with O_APPEND and fsync; if the file's last byte is not LF (a torn final write), a LF goes first, so a
// torn tail can never swallow the new line. Single writer: the import CLI runs attempts sequentially (no lock file in
// this offline build; the gateway importer adds one with TIG-05).
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { ledgerAppendText, parseLedger, type LedgerLine, type LedgerSink } from './importer.ts';

export interface FileLedger extends LedgerSink {
  path: string;
  read(): ReturnType<typeof parseLedger>;
}

function endsWithLf(path: string): boolean {
  if (!existsSync(path)) return true;
  const size = statSync(path).size;
  if (size === 0) return true;
  const fd = openSync(path, 'r');
  try {
    const last = new Uint8Array(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] === 0x0a;
  } finally {
    closeSync(fd);
  }
}

export function fileLedger(path: string): FileLedger {
  return {
    path,
    append(line: LedgerLine) {
      mkdirSync(dirname(path), { recursive: true });
      const text = ledgerAppendText(endsWithLf(path), line);   // throws on an invalid line: nothing malformed is written
      const fd = openSync(path, 'a');
      try {
        appendFileSync(fd, text);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
    read() {
      return existsSync(path) ? parseLedger(readFileSync(path, 'utf8')) : { lines: [], skipped: [] };
    },
  };
}
