require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const result = await pool.query('SELECT id, name, email, role, is_active, created_at FROM users ORDER BY role ASC, created_at DESC');
    console.log('=== ALL USERS IN SYSTEM ===');
    console.table(result.rows);
  } catch (e) {
    console.error('Error fetching users:', e.message);
  } finally {
    pool.end();
  }
})();
