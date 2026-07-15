require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    console.log('--- Scanning Database for All Phone Numbers (System & Custom Fields) ---');
    
    // Get all boards and their custom fields of type 'phone'
    const boardsRes = await pool.query("SELECT id, name FROM boards");
    const boardPhoneFields = {}; // boardId -> array of phone field IDs

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
    console.log('Phone fields per board:', boardPhoneFields);

    // Fetch all leads
    const leadsRes = await pool.query(`
      SELECT l.id, l.title, l.client_name, l.client_phone, l.custom_data, l.board_id, l.created_at,
             b.name as board_name, u.name as creator_name
      FROM leads l
      LEFT JOIN boards b ON l.board_id = b.id
      LEFT JOIN users u ON l.created_by = u.id
    `);

    console.log(`Scanning ${leadsRes.rows.length} total leads...`);

    // Helper to normalize phone number (keep only digits, and take last 10 digits for comparison)
    const normalizePhone = (phone) => {
      if (!phone) return null;
      const digits = String(phone).replace(/\D/g, '');
      if (digits.length >= 10) {
        return digits.slice(-10); // Last 10 digits
      }
      return digits || null;
    };

    const phoneToLeads = {}; // normalizedPhone -> array of lead objects

    for (const lead of leadsRes.rows) {
      const phonesFound = new Set();
      
      // 1. Check system client_phone
      const normSystemPhone = normalizePhone(lead.client_phone);
      if (normSystemPhone) phonesFound.add(normSystemPhone);

      // 2. Check custom phone fields
      const customPhoneKeys = boardPhoneFields[lead.board_id] || [];
      const customData = lead.custom_data || {};
      for (const key of customPhoneKeys) {
        const val = customData[key];
        const normCustomPhone = normalizePhone(val);
        if (normCustomPhone) phonesFound.add(normCustomPhone);
      }

      // Record lead under each phone number found
      for (const p of phonesFound) {
        if (!phoneToLeads[p]) {
          phoneToLeads[p] = [];
        }
        phoneToLeads[p].push(lead);
      }
    }

    // Filter duplicates (where phone number is associated with > 1 lead)
    const duplicatePhones = Object.keys(phoneToLeads).filter(p => phoneToLeads[p].length > 1);
    
    console.log(`\n=== Found ${duplicatePhones.length} duplicate phone numbers in the entire system ===`);

    const summaryList = [];
    let markdown = `# Duplicate Phone Numbers Report\n\n`;
    markdown += `This report lists all duplicate phone numbers detected in the system, scanning both the system \`client_phone\` field and any custom phone fields.\n\n`;
    markdown += `## Summary Table\n\n`;
    markdown += `| Phone Number | Duplicate Count | Client Names | Boards |\n`;
    markdown += `| --- | --- | --- | --- |\n`;

    for (const phone of duplicatePhones) {
      const leads = phoneToLeads[phone];
      const names = leads.map(l => l.client_name).join(', ');
      const boards = [...new Set(leads.map(l => l.board_name))].join(', ');
      summaryList.push({
        phone: phone,
        count: leads.length,
        names: names,
        boards: boards
      });
      markdown += `| \`${phone}\` | ${leads.length} | ${names} | ${boards} |\n`;
    }

    console.table(summaryList);

    markdown += `\n## Detailed Analysis\n\n`;
    markdown += `Here are the details for each duplicate number. You can see whether the data in these leads are identical or different.\n\n`;

    // Detail printing
    for (const phone of duplicatePhones) {
      const leads = phoneToLeads[phone];
      markdown += `### Phone: \`${phone}\` (${leads.length} occurrences)\n\n`;
      markdown += `| Lead Name | Board | Creator | Created At | Service Needed | Custom Phone Field |\n`;
      markdown += `| --- | --- | --- | --- | --- | --- |\n`;
      
      console.log(`\n------------------------------------------------------------`);
      console.log(`Phone: ${phone} (Repeated ${leads.length} times)`);
      console.log(`------------------------------------------------------------`);
      console.table(leads.map(l => ({
        id: l.id,
        client_name: l.client_name,
        title: l.title,
        board: l.board_name,
        creator: l.creator_name,
        created_at: l.created_at,
        custom_data_phone: boardPhoneFields[l.board_id]?.map(k => l.custom_data[k]).join(', ') || 'N/A'
      })));

      for (const l of leads) {
        const customPhoneVal = boardPhoneFields[l.board_id]?.map(k => l.custom_data[k]).join(', ') || 'N/A';
        const formattedDate = new Date(l.created_at).toLocaleString();
        markdown += `| ${l.client_name} | ${l.board_name} | ${l.creator_name || 'System'} | ${formattedDate} | ${l.title} | ${customPhoneVal} |\n`;
      }
      markdown += `\n`;
    }

    const fs = require('fs');
    const path = require('path');
    const artifactPath = 'C:\\Users\\vitne\\.gemini\\antigravity-ide\\brain\\627350a0-b0d7-461a-b63b-ba21eba743a8\\duplicates_report.md';
    fs.writeFileSync(artifactPath, markdown);
    console.log(`Markdown report written to: ${artifactPath}`);

  } catch (e) {
    console.error('Error during scanning:', e);
  } finally {
    pool.end();
  }
})();
