const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = "postgresql://neondb_owner:npg_h5PoEVOK9yRw@ep-plain-truth-a1i8o7qh-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

async function run() {
  const client = new Client({ connectionString });
  try {
    console.log("Connecting to NeonDB...");
    await client.connect();
    console.log("Connected.");
    
    const sqlPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log("Executing schema.sql...");
    await client.query(sql);
    console.log("Schema executed successfully.");
  } catch (err) {
    console.error("Error executing schema:", err);
  } finally {
    await client.end();
  }
}

run();
