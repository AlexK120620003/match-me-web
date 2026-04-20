/**
 * Drop all application tables. Destructive — do not run in prod.
 */
import { pool } from './pool';

const TABLES = [
  'messages',
  'chats',
  'dismissals',
  'connections',
  'bios',
  'profiles',
  'users',
];

async function main() {
  console.log('[drop] dropping application tables...');
  const client = await pool.connect();
  try {
    for (const t of TABLES) {
      await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
      console.log(`  - dropped ${t}`);
    }
    console.log('[drop] done ✓');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[drop] failed:', err);
  process.exit(1);
});
