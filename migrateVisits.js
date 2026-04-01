require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔌 Connected to NeonDB');

    // 1. Create lead_visits table
    console.log('📄 Creating lead_visits table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_visits (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        location VARCHAR(500) NOT NULL,
        distance_km DECIMAL(10,2) DEFAULT 0,
        visit_date TIMESTAMP WITH TIME ZONE NOT NULL,
        purpose VARCHAR(100) NOT NULL CHECK (purpose IN ('site_visit', 'client_meeting', 'follow_up_visit', 'final_inspection', 'other')),
        notes TEXT,
        outcome VARCHAR(100) CHECK (outcome IN ('positive', 'neutral', 'negative', 'pending')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✅ lead_visits table created');

    // 2. Create visit_participants table (multiple people can go on a single visit)
    console.log('📄 Creating visit_participants table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS visit_participants (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        visit_id UUID NOT NULL REFERENCES lead_visits(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        distance_km DECIMAL(10,2) DEFAULT 0,
        travel_mode VARCHAR(50) CHECK (travel_mode IN ('car', 'bike', 'public_transport', 'walk', 'other')),
        travel_notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(visit_id, user_id)
      );
    `);
    console.log('✅ visit_participants table created');

    // 3. Create indexes
    console.log('📄 Creating indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lead_visits_lead_id ON lead_visits(lead_id);
      CREATE INDEX IF NOT EXISTS idx_lead_visits_created_by ON lead_visits(created_by);
      CREATE INDEX IF NOT EXISTS idx_lead_visits_visit_date ON lead_visits(visit_date);
      CREATE INDEX IF NOT EXISTS idx_visit_participants_visit_id ON visit_participants(visit_id);
      CREATE INDEX IF NOT EXISTS idx_visit_participants_user_id ON visit_participants(user_id);
    `);
    console.log('✅ Indexes created');

    // 4. Add trigger for updated_at on lead_visits
    await client.query(`
      DROP TRIGGER IF EXISTS update_lead_visits_updated_at ON lead_visits;
      CREATE TRIGGER update_lead_visits_updated_at 
        BEFORE UPDATE ON lead_visits 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
    console.log('✅ Trigger created');

    console.log('\n🎉 Travel & Visits migration complete!');
    console.log('   Tables: lead_visits, visit_participants');
    console.log('   Indexes: 5 performance indexes');
    console.log('   Ready for use!\n');

  } catch (err) {
    console.error('❌ Migration error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
