require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const boards = await pool.query('SELECT id, name FROM boards');
    console.log('=== ALL BOARDS ===');
    console.table(boards.rows);

    for (const b of boards.rows) {
      const leads = await pool.query('SELECT id, title, client_name, stage, priority, value FROM leads WHERE board_id = $1', [b.id]);
      console.log(`\n=== LEADS in board: "${b.name}" (${leads.rowCount} total) ===`);
      if (leads.rowCount > 0) console.table(leads.rows);
      else console.log('  (No leads found)');

      const settings = await pool.query('SELECT key FROM settings WHERE board_id = $1', [b.id]);
      console.log(`  Settings keys: ${settings.rows.map(r => r.key).join(', ') || '(none)'}`);
    }

    await pool.end();
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
