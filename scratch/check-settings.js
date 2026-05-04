require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    // Get all boards
    const boards = await pool.query("SELECT id, name FROM boards");
    console.log('=== BOARDS ===');
    boards.rows.forEach(b => console.log(`  ${b.name}: ${b.id}`));

    // Get settings for each board
    for (const board of boards.rows) {
      console.log(`\n=== SETTINGS for ${board.name} ===`);
      const settings = await pool.query("SELECT key, value FROM settings WHERE board_id = $1", [board.id]);
      settings.rows.forEach(s => {
        const val = typeof s.value === 'string' ? JSON.parse(s.value) : s.value;
        if (s.key === 'stages') {
          console.log(`  stages: ${JSON.stringify(val.map(st => st.id + '(' + st.label + ')'))}`);
        } else if (s.key === 'custom_fields') {
          console.log(`  custom_fields (${val.length} fields):`);
          val.forEach(f => console.log(`    - ${f.id}: ${f.label} [${f.type}] system=${f.isSystem} showOnCard=${f.showOnCard}`));
        } else {
          console.log(`  ${s.key}: ${JSON.stringify(val).slice(0, 100)}`);
        }
      });

      // Check leads for this board
      const leads = await pool.query("SELECT id, title, client_name, stage, custom_data FROM leads WHERE board_id = $1 LIMIT 3", [board.id]);
      console.log(`  leads (${leads.rows.length}):`);
      leads.rows.forEach(l => console.log(`    - ${l.title} (${l.client_name}) stage=${l.stage} custom_data=${JSON.stringify(l.custom_data)}`));
    }
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
})();
