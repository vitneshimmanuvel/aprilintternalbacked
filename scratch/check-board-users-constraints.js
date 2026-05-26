require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    console.log('--- Table details for board_users ---');
    const tableInfo = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'board_users'
    `);
    console.log(tableInfo.rows);

    console.log('\n--- Constraints for board_users ---');
    const constraints = await pool.query(`
      SELECT tc.constraint_name, tc.constraint_type, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'board_users'
    `);
    console.log(constraints.rows);

    console.log('\n--- Current board_users rows ---');
    const rows = await pool.query(`
      SELECT bu.id, bu.board_id, b.name AS board_name, bu.user_id, u.name AS user_name, bu.role
      FROM board_users bu
      JOIN boards b ON bu.board_id = b.id
      JOIN users u ON bu.user_id = u.id
    `);
    console.log(rows.rows);

    console.log('\n--- All Boards ---');
    const boards = await pool.query(`SELECT id, name, slug FROM boards`);
    console.log(boards.rows);

    console.log('\n--- All Users ---');
    const users = await pool.query(`SELECT id, name, email, role, is_active FROM users`);
    console.log(users.rows);

  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
})();
