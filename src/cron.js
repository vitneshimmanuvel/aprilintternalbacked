const cron = require('node-cron');
const { Pool } = require('pg');
const { sendPushNotification } = require('./services/fcm');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Run every 5 minutes (reduced from 1 min to save Neon compute)
cron.schedule('*/5 * * * *', async () => {
  try {
    const now = new Date();
    // find reminders due in the next 15 minutes, or that are already overdue, that haven't been notified yet.
    const query = `
      SELECT r.*, u.fcm_token, u.name as user_name, l.title as lead_title, u2.fcm_token as assignee_fcm, l.assigned_to
      FROM reminders r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN leads l ON r.lead_id = l.id
      LEFT JOIN users u2 ON l.assigned_to = u2.id
      WHERE r.is_completed = false
        AND (
          (r.is_notified = false AND r.remind_at <= NOW() + INTERVAL '15 minutes')
          OR 
          (r.is_notified = true AND r.recurrence = '30_mins' AND (r.last_notified_at IS NULL OR r.last_notified_at <= NOW() - INTERVAL '30 minutes'))
          OR 
          (r.is_notified = true AND r.recurrence = '1_hour' AND (r.last_notified_at IS NULL OR r.last_notified_at <= NOW() - INTERVAL '1 hour'))
        )
    `;

    const { rows } = await pool.query(query);

    for (let reminder of rows) {
      console.log(`Sending reminder ${reminder.id} to user ${reminder.user_id} and assignee ${reminder.assigned_to}`);
      
      const title = `Upcoming Reminder: ${reminder.title}`;
      const body = reminder.lead_title 
        ? `Lead: ${reminder.lead_title}\n${reminder.description || ''}`
        : `${reminder.description || 'You have an upcoming reminder.'}`;

      // Mark as notified and record the time
      await pool.query('UPDATE reminders SET is_notified = true, last_notified_at = NOW() WHERE id = $1', [reminder.id]);

      // If user has token, send push
      if (reminder.fcm_token) {
        await sendPushNotification(reminder.fcm_token, title, body, {
          url: `/leads/${reminder.lead_id}`
        });
      }

      // Also notify the assignee if they are different from the creator
      if (reminder.assignee_fcm && reminder.assigned_to !== reminder.user_id) {
        await sendPushNotification(reminder.assignee_fcm, title, body, {
          url: `/leads/${reminder.lead_id}`
        });
      }
    }

  } catch (error) {
    console.error('Error running cron job for reminders:', error);
  }
});

console.log('Cron jobs initialized for Firebase Push Notifications.');
