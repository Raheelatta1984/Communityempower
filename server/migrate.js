import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || process.env.MYCOMM_DATABASE_URL ||
  process.env.MYCOMM_POSTGRES_PRISMA_URL || process.env.MYCOMM_POSTGRES_URL ||
  process.env.MYCOMM_DATABASE_URL_UNPOOLED || process.env.MYCOMM_POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  console.log('[neon-migrate] no database URL supplied; skipping migrations for local/demo build');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 1000,
});
const migrations = ['db/schema.sql', 'db/upgrade-2026-11-budget-master.sql'];
try {
  const client = await pool.connect();
  try {
    for (const relativePath of migrations) {
      const sql = await fs.readFile(path.join(root, relativePath), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`[neon-migrate] applied ${relativePath}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    const { rows } = await client.query('SELECT current_database() AS database_name');
    console.log(`[neon-migrate] Neon schema is ready (${rows[0].database_name})`);
  } finally { client.release(); }
} catch (error) {
  console.error(`[neon-migrate] migration failed (${error.code || 'DB_ERROR'}): ${error.message}`);
  process.exitCode = 1;
} finally { await pool.end(); }
