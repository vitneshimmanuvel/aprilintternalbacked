require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔌 Connected to NeonDB');

    // 1. Update the visitor user's email and name to employee branding
    const existing = await client.query("SELECT id, name, email FROM users WHERE email = 'visitor@leadflow.com'");
    
    if (existing.rows[0]) {
      const hash = await bcrypt.hash('Employee@123', 10);
      await client.query(
        "UPDATE users SET name = 'Priya Employee', email = 'employee@leadflow.com', password_hash = $1 WHERE email = 'visitor@leadflow.com'",
        [hash]
      );
      console.log('✅ Updated visitor@leadflow.com → employee@leadflow.com');
      console.log('   Name: Priya Visitor → Priya Employee');
      console.log('   Password: Employee@123');
    } else {
      // Check if employee@leadflow.com already exists
      const empCheck = await client.query("SELECT id FROM users WHERE email = 'employee@leadflow.com'");
      if (empCheck.rows[0]) {
        console.log('ℹ️  employee@leadflow.com already exists, skipping.');
      } else {
        // Create the employee user
        const hash = await bcrypt.hash('Employee@123', 10);
        await client.query(
          "INSERT INTO users (name, email, password_hash, role) VALUES ('Priya Employee', 'employee@leadflow.com', $1, 'visitor')",
          [hash]
        );
        console.log('✅ Created employee@leadflow.com with password Employee@123');
      }
    }

    console.log('\n🎉 Migration complete! Employee login:');
    console.log('   Email:    employee@leadflow.com');
    console.log('   Password: Employee@123\n');

  } catch (err) {
    console.error('❌ Migration error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
