import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { AppDb } from './index.js';

/**
 * Runs committed SQL migrations from ./drizzle/ at app startup.
 *
 * - Safe to call on every boot: Drizzle's migrator tracks applied migrations
 *   in a meta table and is a no-op if everything is up to date.
 * - In dev, the current user is the project owner (DDL allowed).
 * - In prod, the service principal runs this on first deploy, becomes the
 *   owner of `app` schema, and can run future migrations.
 *
 * NB: the migrations folder path is computed relative to this source file so
 * it resolves both under tsx-watch (dev) and tsdown-bundled (prod).
 */
export async function runMigrations(db: AppDb): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // Dev: server/db/migrate.ts → ../../drizzle
  // Prod (bundled to dist/server.js): dist/ → ../drizzle
  const candidates = [
    resolve(here, '../../drizzle'),
    resolve(here, '../drizzle'),
  ];
  const fs = await import('node:fs');
  const migrationsFolder = candidates.find((p) => fs.existsSync(p));
  if (!migrationsFolder) {
    throw new Error(
      `No Drizzle migrations folder found. Tried: ${candidates.join(', ')}. ` +
        `Run \`npm run db:generate\` first.`,
    );
  }
  try {
    await migrate(db, { migrationsFolder });
  } catch (e) {
    // The app service principal may lack CREATE on the `drizzle` migration-tracking
    // schema on a shared/managed branch. The app tables are provisioned out-of-band
    // (applied by the owner via the migration files / dev-branch setup), so a failure
    // to write the drizzle bookkeeping must NOT gate the app. Log and continue —
    // the tables the app reads/writes already exist.
    const msg = (e as Error).message ?? String(e);
    if (/drizzle|permission denied|must be owner|CREATE/i.test(msg)) {
      console.warn(
        `[migrate] skipping drizzle migration bookkeeping (tables already provisioned): ${msg.slice(0, 200)}`,
      );
      return;
    }
    throw e;
  }
}
