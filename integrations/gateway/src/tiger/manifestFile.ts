// integrations/gateway/src/tiger/manifestFile.ts
// The manifest store on disk (RFC §5, TIG-D5): `<stateDir>/manifests/<artifactHash>.manifest.json`, outside results/.
// Each manifest is written once, atomically (temporary file, then rename), and never rewritten.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { manifestFileName, type ImportManifestV1, type ManifestStore } from './importer.ts';

export function fileManifestStore(stateDir: string): ManifestStore {
  const pathOf = (artifactHash: string) => join(stateDir, manifestFileName(artifactHash));
  return {
    read(artifactHash) {
      const path = pathOf(artifactHash);
      if (!existsSync(path)) return null;
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as ImportManifestV1;
      if (manifest.manifestVersion !== 1 || manifest.artifactHash !== artifactHash) throw new Error('manifest file does not match its name');
      return manifest;
    },
    write(manifest) {
      const path = pathOf(manifest.artifactHash);
      if (existsSync(path)) throw new Error('a manifest is never overwritten');
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      const fd = openSync(temporary, 'w');
      try {
        writeFileSync(fd, `${JSON.stringify(manifest, null, 2)}\n`);
        fsyncSync(fd);   // durable before it becomes visible under its final name
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, path);
    },
  };
}
