const pool = require('../config/db');

// GET /api/leads/:leadId/reminders
const getReminders = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.name as user_name FROM reminders r
       JOIN users u ON r.user_id = u.id
       WHERE r.lead_id = $1 ORDER BY r.remind_at ASC`,
      [req.params.leadId]
    );
    res.json({ reminders: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/reminders/mine - Current user's upcoming reminders
const getMyReminders = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.*, l.title as lead_title, l.client_name, l.stage as lead_stage, u.name as user_name
       FROM reminders r
       JOIN leads l ON r.lead_id = l.id
       JOIN users u ON r.user_id = u.id
       WHERE r.user_id = $1 AND r.is_completed = false
       ORDER BY r.remind_at ASC
       LIMIT 50`,
      [req.user.id]
    );
    res.json({ reminders: result.rows });
  } catch (err) {
    next(err);
  }
};

// POST /api/leads/:leadId/reminders
const createReminder = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { leadId } = req.params;
    const { title, description, remind_at, stage, type, recurrence } = req.body;

    if (!title?.trim() || !remind_at) return res.status(400).json({ message: 'Title and remind_at are required' });

    const leadCheck = await client.query('SELECT id, stage, assigned_to FROM leads WHERE id = $1', [leadId]);
    if (!leadCheck.rows[0]) return res.status(404).json({ message: 'Lead not found' });

    if (req.user.role === 'visitor' && leadCheck.rows[0].assigned_to !== req.user.id) {
      return res.status(403).json({ message: 'Access denied: Lead not assigned to you' });
    }

    const reminderStage = stage || leadCheck.rows[0].stage;
    const reminderType = type || 'general';

    const result = await client.query(
      `INSERT INTO reminders (lead_id, user_id, stage, title, description, remind_at, type, recurrence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [leadId, req.user.id, reminderStage, title.trim(), description || null, remind_at, reminderType, recurrence || 'none']
    );

    await client.query(
      `INSERT INTO lead_history (lead_id, user_id, action, details)
       VALUES ($1, $2, $3, $4)`,
      [
        leadId, 
        req.user.id, 
        reminderType === 'visit_planned' ? 'visit_planned' : 'reminder_set', 
        JSON.stringify({ title: title.trim(), remind_at, stage: reminderStage })
      ]
    );

    await client.query('COMMIT');

    const reminder = await pool.query(
      `SELECT r.*, u.name as user_name FROM reminders r JOIN users u ON r.user_id = u.id WHERE r.id = $1`,
      [result.rows[0].id]
    );
    res.status(201).json({ reminder: reminder.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// PUT /api/reminders/:id/complete
const completeReminder = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const current = await client.query('SELECT * FROM reminders WHERE id = $1', [id]);
    if (!current.rows[0]) return res.status(404).json({ message: 'Reminder not found' });
    if (current.rows[0].user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Not allowed' });

    await client.query(
      `UPDATE reminders SET is_completed = true, completed_at = NOW() WHERE id = $1`,
      [id]
    );

    await client.query(
      `INSERT INTO lead_history (lead_id, user_id, action, details)
       VALUES ($1, $2, 'reminder_completed', $3)`,
      [current.rows[0].lead_id, req.user.id, JSON.stringify({ reminder_title: current.rows[0].title })]
    );

    // Handle recurrence
    if (current.rows[0].recurrence && current.rows[0].recurrence !== 'none') {
      let nextDate = new Date(current.rows[0].remind_at);
      if (current.rows[0].recurrence === 'daily') nextDate.setDate(nextDate.getDate() + 1);
      else if (current.rows[0].recurrence === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
      else if (current.rows[0].recurrence === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
      
      await client.query(
        `INSERT INTO reminders (lead_id, user_id, stage, title, description, remind_at, type, recurrence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          current.rows[0].lead_id, req.user.id, current.rows[0].stage, 
          current.rows[0].title, current.rows[0].description, 
          nextDate.toISOString(), current.rows[0].type, current.rows[0].recurrence
        ]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Reminder marked as completed' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// DELETE /api/reminders/:id
const deleteReminder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const current = await pool.query('SELECT * FROM reminders WHERE id = $1', [id]);
    if (!current.rows[0]) return res.status(404).json({ message: 'Reminder not found' });
    if (current.rows[0].user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Not allowed' });

    await pool.query('DELETE FROM reminders WHERE id = $1', [id]);
    res.json({ message: 'Reminder deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getReminders, getMyReminders, createReminder, completeReminder, deleteReminder };
