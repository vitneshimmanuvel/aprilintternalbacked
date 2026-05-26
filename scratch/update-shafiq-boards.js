require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    console.log('--- Checking user shafiq and board payana ---');
    const userRes = await pool.query("SELECT id, name FROM users WHERE email = 'settloshafiqmohamed@gmail.com'");
    if (userRes.rows.length === 0) {
      console.error('User shafiq not found!');
      return;
    }
    const userId = userRes.rows[0].id;
    console.log('User shafiq ID:', userId);

    const boardRes = await pool.query("SELECT id, name FROM boards WHERE name = 'payana'");
    if (boardRes.rows.length === 0) {
      console.error('Board payana not found!');
      return;
    }
    const boardId = boardRes.rows[0].id;
    console.log('Board payana ID:', boardId);

    // Check if association already exists
    const assocRes = await pool.query(
      "SELECT id FROM board_users WHERE board_id = $1 AND user_id = $2",
      [boardId, userId]
    );

    if (assocRes.rows.length > 0) {
      console.log('User shafiq is already assigned to the payana board.');
    } else {
      console.log('Assigning user shafiq to the payana board...');
      await pool.query(
        "INSERT INTO board_users (board_id, user_id, role) VALUES ($1, $2, 'member')",
        [boardId, userId]
      );
      console.log('Successfully assigned user shafiq to payana board!');
    }

  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
})();
