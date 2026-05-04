require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const boardId = '35c9b269-5570-4c85-aefb-294ea07d1f17'; // payana

    // Fix 1: Move the stuck lead from 'meeting' to 'enquire' (first stage in payana)
    const stuck = await pool.query("SELECT id, title, stage FROM leads WHERE board_id = $1 AND stage = 'meeting'", [boardId]);
    if (stuck.rows.length > 0) {
      for (const lead of stuck.rows) {
        await pool.query("UPDATE leads SET stage = 'enquire' WHERE id = $1", [lead.id]);
        console.log(`Moved lead "${lead.title}" from 'meeting' to 'enquire'`);
      }
    } else {
      console.log('No stuck leads found');
    }

    console.log('Done!');
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
})();
