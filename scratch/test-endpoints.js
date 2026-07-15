require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const { checkPhoneDuplicateHelper } = require('../src/services/validation');

(async () => {
  try {
    console.log('--- Testing Backend Phone Uniqueness Validation ---');

    const testBoardId = '35c9b269-5570-4c85-aefb-294ea07d1f17'; // payana board
    
    // 1. Test with a known duplicate number from the database: 9444722357 (Devaraj)
    const dupPhone = '9444722357';
    console.log(`\n1. Testing duplicate check for: ${dupPhone}`);
    const dupRes = await checkPhoneDuplicateHelper(pool, testBoardId, null, { field_1777876515611: dupPhone });
    if (dupRes) {
      console.log('✅ Duplicate Detected Successfully!');
      console.log('Result details:', JSON.stringify(dupRes, null, 2));
    } else {
      console.log('❌ Failed to detect duplicate for a known duplicated number');
    }

    // 2. Test with a unique phone number: 9999999999
    const uniquePhone = '9999999999';
    console.log(`\n2. Testing duplicate check for a unique number: ${uniquePhone}`);
    const uniqueRes = await checkPhoneDuplicateHelper(pool, testBoardId, null, { field_1777876515611: uniquePhone });
    if (!uniqueRes) {
      console.log('✅ Unique Number Passed Successfully (no duplicate found)!');
    } else {
      console.log('❌ Incorrectly flagged a unique number as duplicate:', uniqueRes);
    }

    // 3. Test exclusion: checking the duplicate number but excluding the lead ID itself
    const leadIdToExclude = 'b1454617-e553-45ad-be2e-af80f6a17711'; // Devaraj lead
    console.log(`\n3. Testing exclusion of current lead ID: ${leadIdToExclude} for number ${dupPhone}`);
    
    // First verify it's duplicate without exclusion
    const check1 = await checkPhoneDuplicateHelper(pool, testBoardId, null, { field_1777876515611: dupPhone });
    console.log(`- Duplicate check without exclusion:`, check1 ? 'Found' : 'Not Found');

    // Verify it finds the OTHER duplicate if there are more than 1 duplicate
    // Note that 9444722357 is repeated 2 times (b1454617-e553-45ad-be2e-af80f6a17711 and 6dcdbed3-875d-472e-a7f7-1b8a247942e0)
    // So if we exclude one, it should still find the other!
    const check2 = await checkPhoneDuplicateHelper(pool, testBoardId, null, { field_1777876515611: dupPhone }, leadIdToExclude);
    console.log(`- Duplicate check excluding ${leadIdToExclude}:`, check2 ? `Found other lead: "${check2.lead.client_name}"` : 'Not Found');

    // Let's exclude BOTH duplicates' IDs (should be unique)
    // We can verify this by checking if the query works
    console.log('\nAll tests completed!');
  } catch (e) {
    console.error('Error running validation tests:', e);
  } finally {
    pool.end();
  }
})();
