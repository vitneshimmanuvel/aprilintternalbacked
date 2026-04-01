require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🔌 Connected to NeonDB');

    // 1. Drop existing tables (clean slate)
    console.log('🗑️  Dropping existing tables...');
    await client.query(`
      DROP TABLE IF EXISTS note_edits CASCADE;
      DROP TABLE IF EXISTS reminders CASCADE;
      DROP TABLE IF EXISTS lead_notes CASCADE;
      DROP TABLE IF EXISTS lead_history CASCADE;
      DROP TABLE IF EXISTS leads CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
    `);

    // 2. Run schema (without the INSERT at the end)
    console.log('📄 Running schema...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    // Remove the old INSERT statement from schema so we handle it ourselves
    const cleanSchema = schema.replace(/-- Seed admin[\s\S]*$/, '');
    await client.query(cleanSchema);
    console.log('✅ Schema created');

    // 3. Create users with proper bcryptjs hashes
    const users = [
      { name: 'System Admin',    email: 'admin@leadflow.com',   password: 'Admin@123',   role: 'admin'   },
      { name: 'Rahul Manager',   email: 'manager@leadflow.com', password: 'Manager@123', role: 'manager' },
      { name: 'Priya Employee',  email: 'employee@leadflow.com', password: 'Employee@123', role: 'visitor' },
    ];

    console.log('\n👤 Creating users...');
    for (const u of users) {
      const hash = await bcrypt.hash(u.password, 10);
      await client.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING',
        [u.name, u.email, hash, u.role]
      );
      console.log(`   ✅ ${u.role.padEnd(8)} → ${u.email}  /  ${u.password}`);
    }

    console.log('\n🎉 Seed completed! You can now log in with:\n');
    console.log('  ┌──────────┬─────────────────────────┬──────────────┐');
    console.log('  │ Role     │ Email                   │ Password     │');
    console.log('  ├──────────┼─────────────────────────┼──────────────┤');
    console.log('  │ Admin    │ admin@leadflow.com      │ Admin@123    │');
    console.log('  │ Manager  │ manager@leadflow.com    │ Manager@123  │');
    console.log('  │ Employee │ employee@leadflow.com   │ Employee@123 │');
    console.log('  └──────────┴─────────────────────────┴──────────────┘\n');

  } catch (err) {
    console.error('❌ Seed error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
