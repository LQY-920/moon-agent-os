import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import { Kysely, MysqlDialect, Migrator, FileMigrationProvider } from 'kysely';
import { createPool } from 'mysql2';
import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Database } from '../../src/core/db';

export type TestDbCtx = {
  container: StartedMySqlContainer;
  db: Kysely<Database>;
  destroy: () => Promise<void>;
};

export async function startTestDb(): Promise<TestDbCtx> {
  const container = await new MySqlContainer('mysql:8').withDatabase('moon_test').withRootPassword('root').start();
  const url = `mysql://root:root@${container.getHost()}:${container.getPort()}/moon_test`;
  const pool = createPool({ uri: url, connectionLimit: 5 });
  const db = new Kysely<Database>({ dialect: new MysqlDialect({ pool: async () => pool }) });

  const migrationFolder = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

  // Windows ESM fix (same as scripts/migrate.ts): FileMigrationProvider feeds path.join
  // result straight into dynamic import(); Windows paths like "D:\..." need file:// URL form.
  const pathShim = {
    ...nodePath,
    join: (...parts: string[]) => pathToFileURL(nodePath.join(...parts)).href,
  };

  const migrator = new Migrator({ db, provider: new FileMigrationProvider({ fs, path: pathShim, migrationFolder }) });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;

  return {
    container,
    db,
    // Kysely's MysqlDialect.destroy() closes the pool; no separate pool.end().
    destroy: async () => { await db.destroy(); await container.stop(); },
  };
}
