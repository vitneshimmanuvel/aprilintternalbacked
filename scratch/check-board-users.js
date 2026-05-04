require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const boardId = '35c9b269-5570-4c85-aefb-294ea07d1f17'; // payana

    const result = await pool.query(`
      SELECT u.id, u.name, u.role, u.is_active 
      FROM users u
      JOIN board_users bu ON bu.user_id = u.id
      WHERE u.is_active = true AND bu.board_id = $1
      ORDER BY u.name ASC
    `, [boardId]);
    console.log('Active users for payana:');
    console.log(result.rows);
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
})();
