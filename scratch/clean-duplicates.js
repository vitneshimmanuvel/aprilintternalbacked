require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const DRY_RUN = false;

(async () => {
  try {
    console.log(`--- SCANNING FOR DUPLICATES (${DRY_RUN ? 'DRY-RUN MODE' : 'EXECUTION MODE'}) ---`);

    // 1. Get all boards and their custom fields of type 'phonedcd'
    const boardsRes = await pool.query("SELECT id, name FROM boards");
    const boardPhoneFields = {}; 

    for (const board of boardsRes.rows) {
      const settingsRes = await pool.query("SELECT value FROM settings WHERE board_id = $1 AND key = 'custom_fields'", [board.id]);
      if (settingsRes.rows[0]) {
        try {
          const fields = typeof settingsRes.rows[0].value === 'string' ? JSON.parse(settingsRes.rows[0].value) : settingsRes.rows[0].value;
          if (Array.isArray(fields)) {
            const phoneFields = fields.filter(f => f.type === 'phone').map(f => f.id);
            if (phoneFields.length > 0) {
              boardPhoneFields[board.id] = phoneFields;
            }
          }
        } catch (e) {
          console.error(`Error parsing custom fields for board ${board.name}:`, e.message);
        }
      }
    }

    // 2. Fetch all leads
    const leadsRes = await pool.query(`
      SELECT l.id, l.title, l.client_name, l.client_phone, l.custom_data, l.board_id, l.created_at,
             b.name as board_name, u.name as creator_name
      FROM leads l
      LEFT JOIN boards b ON l.board_id = b.id
      LEFT JOIN users u ON l.created_by = u.id
    `);

    // Helper to normalize phone number
    const normalizePhone = (phone) => {
      if (!phone) return null;
      const digits = String(phone).replace(/\D/g, '');
      if (digits.length >= 10) {
        return digits.slice(-10); // Last 10 digits
      }
      return digits || null;
    };

    const phoneToLeads = {};

    for (const lead of leadsRes.rows) {
      const phonesFound = new Set();
      
      const normSystemPhone = normalizePhone(lead.client_phone);
      if (normSystemPhone) phonesFound.add(normSystemPhone);

      const customPhoneKeys = boardPhoneFields[lead.board_id] || [];
      const customData = lead.custom_data || {};
      for (const key of customPhoneKeys) {
        const val = customData[key];
        const normCustomPhone = normalizePhone(val);
        if (normCustomPhone) phonesFound.add(normCustomPhone);
      }

      for (const p of phonesFound) {
        if (!phoneToLeads[p]) phoneToLeads[p] = [];
        phoneToLeads[p].push(lead);
      }
    }

    const duplicatePhones = Object.keys(phoneToLeads).filter(p => phoneToLeads[p].length > 1);
    
    if (duplicatePhones.length === 0) {
      console.log('No duplicate phone numbers found in the system!');
      return;
    }

    console.log(`Found ${duplicatePhones.length} duplicate phone number groups.`);

    const toDeleteIds = [];

    for (const phone of duplicatePhones) {
      const leads = phoneToLeads[phone];
      
      // Sort by created_at in ascending order (oldest first)
      leads.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      const keepLead = leads[0];
      const dupLeads = leads.slice(1);

      console.log(`\nPhone: ${phone}`);
      console.log(`  KEEP: "${keepLead.client_name}" (${keepLead.board_name}) created on ${keepLead.created_at} [ID: ${keepLead.id}]`);
      
      dupLeads.forEach(l => {
        console.log(`  DELETE: "${l.client_name}" (${l.board_name}) created on ${l.created_at} [ID: ${l.id}]`);
        toDeleteIds.push(l.id);
      });
    }

    console.log(`\nTotal duplicate leads to delete: ${toDeleteIds.length}`);

    if (DRY_RUN) {
      console.log('\n[DRY RUN] No records were modified. Set DRY_RUN = false to perform deletions.');
    } else {
      console.log('\nStarting deletion of duplicates...');
      
      for (const leadId of toDeleteIds) {
        console.log(`Deleting references and lead ID: ${leadId}`);
        // Delete child references
        await pool.query("DELETE FROM note_edits WHERE note_id IN (SELECT id FROM lead_notes WHERE lead_id = $1)", [leadId]);
        await pool.query("DELETE FROM lead_notes WHERE lead_id = $1", [leadId]);
        await pool.query("DELETE FROM reminders WHERE lead_id = $1", [leadId]);
        await pool.query("DELETE FROM lead_history WHERE lead_id = $1", [leadId]);
        try { await pool.query("DELETE FROM visit_participants WHERE visit_id IN (SELECT id FROM visits WHERE lead_id = $1)", [leadId]); } catch(e) {}
        try { await pool.query("DELETE FROM visits WHERE lead_id = $1", [leadId]); } catch(e) {}
        
        // Delete lead
        await pool.query("DELETE FROM leads WHERE id = $1", [leadId]);
      }
      
      console.log('\nCleanup completed successfully!');
    }

  } catch (e) {
    console.error('Error during cleanup:', e);
  } finally {
    pool.end();
  }
})();
