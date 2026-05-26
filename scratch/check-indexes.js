require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    console.log('--- Indexes for board_users ---');
    const indexes = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'board_users'
    `);
    console.log(indexes.rows);

  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
})();
