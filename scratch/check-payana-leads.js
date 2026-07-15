require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const boardRes = await pool.query("SELECT id, name FROM boards WHERE name = 'payana'");
    if (boardRes.rows.length === 0) {
      console.log('payana board not found');
      return;
    }
    const boardId = boardRes.rows[0].id;
    console.log('Board payana ID:', boardId);

    // Get board settings
    const settingsRes = await pool.query("SELECT * FROM settings WHERE board_id = $1", [boardId]);
    console.log('Settings:');
    settingsRes.rows.forEach(r => {
      console.log(`Key: ${r.key}`);
      console.log('Value:', JSON.stringify(r.value, null, 2));
    });

    // Count payana leads
    const countRes = await pool.query('SELECT COUNT(*) FROM leads WHERE board_id = $1', [boardId]);
    console.log('Total Payana Leads:', countRes.rows[0].count);

    // Check custom_data keys of a few leads
    const sampleLeads = await pool.query('SELECT id, title, client_name, client_phone, custom_data FROM leads WHERE board_id = $1 LIMIT 5', [boardId]);
    console.log('Sample Leads:');
    sampleLeads.rows.forEach(l => {
      console.log(`Lead: ${l.client_name} (Phone: ${l.client_phone})`);
      console.log('Custom Data:', JSON.stringify(l.custom_data, null, 2));
    });

  } catch (e) {
    console.error(e.message);
  } finally {
    pool.end();
  }
})();
