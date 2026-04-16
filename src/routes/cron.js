const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { sendPushNotification } = require('../services/fcm');

router.get('/', async (req, res) => {
  // Optional: Add simple security to prevent unauthorized triggering
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET) {
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
  }

  try {
    console.log('Running Vercel cron check for reminders...');
    const now = new Date();
    // find reminders due in the next 15 minutes, or that are already overdue, that haven't been notified yet.
    const query = `
      SELECT r.*, u.fcm_token, u.name as user_name, u.email, l.title as lead_title
      FROM reminders r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN leads l ON r.lead_id = l.id
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
    let sentCount = 0;

    for (let reminder of rows) {
      console.log(`Sending reminder ${reminder.id} to user ${reminder.user_id}`);
      
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
        sentCount++;
      }

      // Send ONE-TIME email only on the first initial reminder notification
      if (reminder.is_notified === false && reminder.email) {
        const { sendEmail } = require('../services/email');
        const emailContent = `
          <h2>LeadFlow Reminder 🔔</h2>
          <p>Hello ${reminder.user_name},</p>
          <p>You have an upcoming reminder scheduled.</p>
          <p><strong>Reminder:</strong> ${reminder.title}</p>
          <p><strong>Details:</strong><br/>${body.replace(/\n/g, '<br/>')}</p>
        `;
        sendEmail(reminder.email, `LeadFlow Reminder: ${reminder.title}`, '', emailContent);
      }
    }

    res.json({ message: 'Cron job executed successfully', remindersChecked: rows.length, pushesSent: sentCount, timestamp: new Date() });
  } catch (error) {
    console.error('Error running vercel cron job:', error);
    res.status(500).json({ message: 'Error running cron job', error: error.message });
  }
});

module.exports = router;
