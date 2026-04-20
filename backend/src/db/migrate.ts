/**
 * Run DB migrations: install extensions + apply schema.sql
 * Idempotent — safe to re-run.
 */
import fs from 'fs';
import path from 'path';
import { pool } from './pool';

async function main() {
  console.log('[migrate] connecting...');
  const client = await pool.connect();
  try {
    console.log('[migrate] installing extensions (pgcrypto, citext)...');
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query('CREATE EXTENSION IF NOT EXISTS citext');

    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf-8');
    console.log('[migrate] applying schema.sql...');
    await client.query(sql);

    console.log('[migrate] done ✓');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
