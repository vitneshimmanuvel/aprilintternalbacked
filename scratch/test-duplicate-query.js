require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const testPhone = '9444722357';
    console.log('Testing query for phone:', testPhone);

    // 1. Get phone field keys
    const settingsRes = await pool.query("SELECT value FROM settings WHERE key = 'custom_fields'");
    const phoneKeys = new Set();
    for (const row of settingsRes.rows) {
      try {
        const fields = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        if (Array.isArray(fields)) {
          fields.filter(f => f.type === 'phone').forEach(f => phoneKeys.add(f.id));
        }
      } catch (e) {}
    }
    const keysArray = Array.from(phoneKeys);
    console.log('Phone Keys:', keysArray);

    // 2. Query duplicates
    const query = `
      SELECT l.id, l.client_name, l.client_phone, l.custom_data, b.name as board_name
      FROM leads l
      LEFT JOIN boards b ON l.board_id = b.id
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
    const searchPattern = `%${testPhone}`;
    const result = await pool.query(query, [searchPattern, keysArray]);
    console.log('Results:');
    console.table(result.rows);

  } catch (e) {
    console.error('Error:', e);
  } finally {
    pool.end();
  }
})();
