require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    await pool.query('DELETE FROM reminders');
    await pool.query('DELETE FROM lead_notes');
    await pool.query('DELETE FROM visit_participants');
    await pool.query('DELETE FROM lead_visits');
    await pool.query('DELETE FROM lead_history');
    await pool.query('DELETE FROM leads');
    const res = await pool.query("DELETE FROM users WHERE role != 'admin'");
    console.log('Data cleared! Deleted ' + res.rowCount + ' non-admin users');
  } catch(e) {
    console.error('Error', e)
  } finally {
    pool.end();
  }
})();
