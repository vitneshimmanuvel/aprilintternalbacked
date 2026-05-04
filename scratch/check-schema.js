require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'lead_notes'");
    console.log('lead_notes columns:', r.rows.map(x => x.column_name).join(', '));
  } catch(e) { 
    console.error(e.message); 
  } finally { 
    pool.end(); 
  }
})();
