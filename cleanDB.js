const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function clean() {
  try {
   
    try { await pool.query('DELETE FROM travel_logs'); console.log('Cleared travel_logs'); } catch(e) { console.log('travel_logs skipped (not exists)'); }
    try { await pool.query('DELETE FROM lead_visits'); console.log('Cleared lead_visits'); } catch(e) { console.log('lead_visits skipped'); }
    
    await pool.query('DELETE FROM reminders');
    console.log('Cleared reminders');
    await pool.query('DELETE FROM lead_history');
    console.log('Cleared lead_history');
    await pool.query('DELETE FROM lead_notes');
    console.log('Cleared lead_notes');
    await pool.query('DELETE FROM leads');
    console.log('Cleared leads');
    const deleted = await pool.query("DELETE FROM users WHERE role != 'admin' RETURNING name, email");
    console.log('Deleted non-admin users:', deleted.rows);
    const remaining = await pool.query('SELECT id, name, email, role FROM users');
    console.log('Remaining users in DB:', remaining.rows);
  } catch (err) {
    console.error('Error:', err.message);
  }
  process.exit(0);
}

clean();
