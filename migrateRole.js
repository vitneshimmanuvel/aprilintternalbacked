const pool = require('./src/config/db');

(async () => {
  try {
    const client = await pool.connect();
    console.log('Connected to DB');

    // 1. Drop existing constraint if exists
    try {
      await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
    } catch (err) {
      console.log('Notice: Could not drop constraint, might not exist: ' + err.message);
    }

    // 2. Add new constraint allowing all roles temporarily
    await client.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'manager', 'visitor', 'employee'))");

    // 3. Update existing data
    await client.query("UPDATE users SET role = 'employee' WHERE role = 'visitor'");
    await client.query("UPDATE users SET email = 'employee@leadflow.com' WHERE email = 'visitor@leadflow.com'");
    
    // We optionally swap password hashing for Employee@123 but keeping the previous one (Visitor@123) is fine 
    // since user can change it anyway. Or we can just let them login with Visitor@123. 
    // To make it fully Employee, I'll update the password hash to Employee@123:
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('Employee@123', 10);
    await client.query("UPDATE users SET password_hash = $1 WHERE email = 'employee@leadflow.com'", [hash]);

    console.log('Migration completed successfully.');
    
    // 4. Tighten constraint again (optional, depending on postgres support for replacing constraints)
    await client.query('ALTER TABLE users DROP CONSTRAINT users_role_check');
    await client.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'manager', 'employee'))");

    client.release();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
})();
