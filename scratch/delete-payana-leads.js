require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    // Find payana board
    const boards = await pool.query("SELECT id, name FROM boards WHERE name ILIKE '%payana%'");
    if (!boards.rows.length) { console.log('No payana board found'); pool.end(); return; }
    const boardId = boards.rows[0].id;
    console.log('Payana board:', boardId, boards.rows[0].name);

    // Find leads on this board
    const leads = await pool.query("SELECT id, title, client_name, stage FROM leads WHERE board_id = $1", [boardId]);
    console.log('Leads found:', leads.rows.length);
    leads.rows.forEach(l => console.log(`  - ${l.title} (${l.client_name}) [${l.stage}] id=${l.id}`));

    if (leads.rows.length === 0) { pool.end(); return; }

    const leadIds = leads.rows.map(l => l.id);

    // Delete in order (foreign keys have ON DELETE CASCADE, but let's be thorough)
    for (const leadId of leadIds) {
      await pool.query("DELETE FROM note_edits WHERE note_id IN (SELECT id FROM lead_notes WHERE lead_id = $1)", [leadId]);
      await pool.query("DELETE FROM lead_notes WHERE lead_id = $1", [leadId]);
      await pool.query("DELETE FROM reminders WHERE lead_id = $1", [leadId]);
      await pool.query("DELETE FROM lead_history WHERE lead_id = $1", [leadId]);
      // Delete visits if table exists
      try { await pool.query("DELETE FROM visits WHERE lead_id = $1", [leadId]); } catch(e) {}
      try { await pool.query("DELETE FROM visit_participants WHERE visit_id IN (SELECT id FROM visits WHERE lead_id = $1)", [leadId]); } catch(e) {}
      await pool.query("DELETE FROM leads WHERE id = $1", [leadId]);
      console.log(`Deleted lead: ${leadId}`);
    }

    console.log('Done! All payana leads deleted.');
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
})();
