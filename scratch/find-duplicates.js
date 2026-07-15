require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    console.log('--- Database Diagnostics ---');
    
    // Count total leads
    const totalLeadsRes = await pool.query('SELECT COUNT(*) FROM leads');
    console.log('Total Leads:', totalLeadsRes.rows[0].count);

    // Count leads with phone numbers
    const phoneLeadsRes = await pool.query("SELECT COUNT(*) FROM leads WHERE client_phone IS NOT NULL AND TRIM(client_phone) != ''");
    console.log('Leads with Phone Numbers:', phoneLeadsRes.rows[0].count);

    // Show a sample of leads with phone numbers
    const sampleRes = await pool.query("SELECT id, title, client_name, client_phone, stage FROM leads WHERE client_phone IS NOT NULL AND TRIM(client_phone) != '' LIMIT 15");
    console.log('Sample leads with phone numbers:');
    console.table(sampleRes.rows);

    // Find client_phone values that occur more than once (excluding null/empty)
    const dupesResult = await pool.query(`
      SELECT client_phone, COUNT(*) as count 
      FROM leads 
      WHERE client_phone IS NOT NULL AND TRIM(client_phone) != '' 
      GROUP BY client_phone 
      HAVING COUNT(*) > 1 
      ORDER BY count DESC
    `);
    
    console.log(`Found ${dupesResult.rows.length} duplicate phone numbers:`);
    console.table(dupesResult.rows);

    for (const row of dupesResult.rows) {
      const phone = row.client_phone;
      console.log(`\nLeads for Phone: ${phone}`);
      
      const leadsRes = await pool.query(`
        SELECT l.id, l.title, l.client_name, l.stage, l.created_at, b.name as board_name, u.name as created_by_name
        FROM leads l
        LEFT JOIN boards b ON l.board_id = b.id
        LEFT JOIN users u ON l.created_by = u.id
        WHERE l.client_phone = $1
        ORDER BY l.created_at DESC
      `, [phone]);
      
      console.table(leadsRes.rows);
    }
  } catch (e) {
    console.error('Error in diagnostics:', e.message);
  } finally {
    pool.end();
  }
})();
