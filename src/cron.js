const cron = require('node-cron');
const { Pool } = require('pg');
const { sendPushNotification } = require('./services/fcm');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Run every minute
cron.schedule('* * * * *', async () => {
  try {
    console.log('Running reminder cron check...');
    const now = new Date();
    // find reminders due in the next 15 minutes, or that are already overdue, that haven't been notified yet.
    const query = `
      SELECT r.*, u.fcm_token, u.name as user_name, l.title as lead_title
      FROM reminders r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN leads l ON r.lead_id = l.id
      WHERE r.is_completed = false
        AND r.is_notified = false
        AND r.remind_at <= NOW() + INTERVAL '15 minutes'
    `;

    const { rows } = await pool.query(query);

    for (let reminder of rows) {
      console.log(`Sending reminder ${reminder.id} to user ${reminder.user_id}`);
      
      const title = `Upcoming Reminder: ${reminder.title}`;
      const body = reminder.lead_title 
        ? `Lead: ${reminder.lead_title}\n${reminder.description || ''}`
        : `${reminder.description || 'You have an upcoming reminder.'}`;

      // Mark as notified so we don't send again
      await pool.query('UPDATE reminders SET is_notified = true WHERE id = $1', [reminder.id]);

      // If user has token, send push
      if (reminder.fcm_token) {
        await sendPushNotification(reminder.fcm_token, title, body, {
          url: `/leads/${reminder.lead_id}`
        });
      }
    }

  } catch (error) {
    console.error('Error running cron job for reminders:', error);
  }
});

console.log('Cron jobs initialized for Firebase Push Notifications.');
