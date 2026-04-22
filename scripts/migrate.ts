import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FileMigrationProvider, Migrator } from 'kysely';
import { loadConfig } from '../src/core/config';
import { createDb } from '../src/core/db';

// Load .env from project root into process.env (no runtime dep required).
// tsx/node does not auto-load .env for arbitrary scripts.
await (async () => {
  const envPath = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const [, key, rawVal] = m;
      if (process.env[key] !== undefined) continue;
      const val = rawVal.replace(/^['"]|['"]$/g, '');
      process.env[key] = val;
    }
  } catch {
    // .env is optional; if missing, loadConfig() will surface a clear error.
  }
})();

async function main() {
  const direction = process.argv[2];
  if (direction !== 'up' && direction !== 'down') {
    console.error('Usage: migrate.ts <up|down>');
    process.exit(1);
  }

  const cfg = loadConfig();
  const { db } = createDb(cfg.databaseUrl);

  const migrationFolder = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  // On Windows, kysely's FileMigrationProvider calls dynamic import() on
  // path.join(folder, file), which yields a drive-letter path (e.g. D:\...).
  // ESM's dynamic import rejects that. FileMigrationProvider only calls
  // path.join once (folder + filename) and feeds the result directly into
  // import(), so wrap `join` to return a file:// URL; safe on POSIX too.
  const pathShim = {
    ...nodePath,
    join: (...parts: string[]): string => pathToFileURL(nodePath.join(...parts)).href,
  };
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({ fs, path: pathShim, migrationFolder }),
  });

  const { error, results } = direction === 'up'
    ? await migrator.migrateToLatest()
    : await migrator.migrateDown();

  for (const r of results ?? []) {
    if (r.status === 'Success') {
      console.log(`[${direction}] ${r.migrationName}: ${r.status}`);
    } else {
      console.error(`[${direction}] ${r.migrationName}: ${r.status}`);
    }
  }

  if (error) {
    console.error('Migration failed:', error);
    await db.destroy();
    process.exit(1);
  }

  await db.destroy();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
