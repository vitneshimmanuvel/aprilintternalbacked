require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const boardId = '2dd7c80d-e352-47c5-8208-15e27a9f3283'; // Settlo
    console.log('--- Fetching users query test ---');
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at,
        COALESCE(
          (SELECT json_agg(bu.board_id) FROM board_users bu WHERE bu.user_id = u.id),
          '[]'::json
        ) as board_ids
      FROM users u
      JOIN board_users bu ON bu.user_id = u.id
      WHERE bu.board_id = $1
      ORDER BY u.created_at DESC
    `, [boardId]);
    
    console.log('Users:');
    result.rows.forEach(u => {
      console.log(`${u.name}:`, u.board_ids, 'Type of board_ids:', typeof u.board_ids, 'Is Array:', Array.isArray(u.board_ids));
    });

  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
})();
