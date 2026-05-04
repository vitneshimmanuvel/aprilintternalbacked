const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const src = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const tgt = new Pool({ connectionString: 'postgresql://neondb_owner:npg_3hH1MkTfboCA@ep-small-feather-a1ng6nmh-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require', ssl: { rejectUnauthorized: false } });

async function fixSettings() {
  const { rows } = await src.query('SELECT key, value FROM settings');
  console.log('Settings from live DB:', rows);
  
  for (const row of rows) {
    const val = typeof row.value === 'object' ? JSON.stringify(row.value) : row.value;
    await tgt.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [row.key, val]);
    console.log(`✅ Inserted settings key: ${row.key}`);
  }

  const { rows: verify } = await tgt.query('SELECT COUNT(*) as c FROM settings');
  console.log(`\nBackup DB settings count: ${verify[0].c}`);
  
  await src.end();
  await tgt.end();
}
fixSettings();
