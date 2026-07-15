const pool = require('../config/db');

/**
 * Checks if a given client phone or any phone-type custom fields in customData already exist in the database.
 * Normalizes numbers to check matching last 10 digits.
 * Returns the matching lead info if a duplicate is found, otherwise null.
 */
const checkPhoneDuplicateHelper = async (client, boardId, clientPhone, customData, excludeLeadId = null) => {
  const phonesToCheck = new Set();
  
  // 1. Check system client_phone
  if (clientPhone) {
    const digits = String(clientPhone).replace(/\D/g, '');
    if (digits.length >= 10) phonesToCheck.add(digits.slice(-10));
  }

  // 2. Check custom phone fields for this board
  const settingsRes = await client.query("SELECT value FROM settings WHERE board_id = $1 AND key = 'custom_fields'", [boardId]);
  if (settingsRes.rows[0]) {
    try {
      const fields = typeof settingsRes.rows[0].value === 'string' 
        ? JSON.parse(settingsRes.rows[0].value) 
        : settingsRes.rows[0].value;
      if (Array.isArray(fields)) {
        const phoneKeys = fields.filter(f => f.type === 'phone').map(f => f.id);
        if (customData) {
          for (const key of phoneKeys) {
            const val = customData[key];
            if (val) {
              const digits = String(val).replace(/\D/g, '');
              if (digits.length >= 10) phonesToCheck.add(digits.slice(-10));
            }
          }
        }
      }
    } catch (e) {
      console.error('Error parsing custom fields for duplicate check:', e);
    }
  }

  if (phonesToCheck.size === 0) return null;

  // Get all custom field keys of type phone across the entire system (to look up in custom_data of other leads)
  const allSettingsRes = await client.query("SELECT value FROM settings WHERE key = 'custom_fields'");
  const allPhoneKeys = new Set();
  for (const row of allSettingsRes.rows) {
    try {
      const fields = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      if (Array.isArray(fields)) {
        fields.filter(f => f.type === 'phone').forEach(f => allPhoneKeys.add(f.id));
      }
    } catch (e) {}
  }
  const keysArray = Array.from(allPhoneKeys);

  for (const last10 of phonesToCheck) {
    let sql = `
      SELECT l.id, l.client_name, l.title, b.name as board_name, u.name as creator_name
      FROM leads l
      LEFT JOIN boards b ON l.board_id = b.id
      LEFT JOIN users u ON l.created_by = u.id
      WHERE (
        (l.client_phone IS NOT NULL AND REGEXP_REPLACE(l.client_phone, '\\D', '', 'g') LIKE $1)
        OR
        EXISTS (
          SELECT 1 
          FROM jsonb_each_text(l.custom_data) 
          WHERE key = ANY($2) AND REGEXP_REPLACE(value, '\\D', '', 'g') LIKE $1
        )
      )
    `;
    const params = [`%${last10}`, keysArray];
    if (excludeLeadId) {
      sql += ` AND l.id != $3`;
      params.push(excludeLeadId);
    }

    const dupRes = await client.query(sql, params);
    if (dupRes.rows.length > 0) {
      return {
        phone: last10,
        lead: dupRes.rows[0]
      };
    }
  }

  return null;
};

module.exports = {
  checkPhoneDuplicateHelper
};
