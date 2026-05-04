require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const boardRes = await pool.query("SELECT id FROM boards WHERE name = 'payana'");
    if (boardRes.rowCount > 0) {
      const boardId = boardRes.rows[0].id;
      await pool.query("UPDATE leads SET stage = 'followup' WHERE board_id = $1", [boardId]);
      console.log('Successfully updated leads for payana board to followup stage!');
    } else {
      console.log('Board payana not found');
    }
    await pool.end();
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
