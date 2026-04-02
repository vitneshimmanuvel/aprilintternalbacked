const pool = require('../config/db');

const VALID_STAGES = ['meeting', 'followup', 'negotiation', 'estimation_review', 'finalization', 'cancelled'];

// Log an action to lead_history
const logHistory = async (client, leadId, userId, action, details = {}, fieldChanged = null, oldValue = null, newValue = null) => {
  await client.query(
    `INSERT INTO lead_history (lead_id, user_id, action, field_changed, old_value, new_value, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [leadId, userId, action, fieldChanged, oldValue, newValue, JSON.stringify(details)]
  );
};

// GET /api/leads - All users
const getLeads = async (req, res, next) => {
  try {
    const { stage, assigned_to, search } = req.query;
    let query = `
      SELECT l.*,
        u1.name as assigned_to_name, u1.email as assigned_to_email,
        u2.name as created_by_name,
        (SELECT COUNT(*) FROM lead_notes ln WHERE ln.lead_id = l.id) as notes_count,
        (SELECT COUNT(*) FROM reminders r WHERE r.lead_id = l.id AND r.is_completed = false AND r.remind_at > NOW()) as pending_reminders
      FROM leads l
      LEFT JOIN users u1 ON l.assigned_to = u1.id
      LEFT JOIN users u2 ON l.created_by = u2.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (stage) { query += ` AND l.stage = $${idx++}`; params.push(stage); }
    
    // Role-based visibility
    if (req.user.role === 'visitor') {
      query += ` AND l.assigned_to = $${idx++}`;
      params.push(req.user.id);
    } else if (assigned_to) {
      query += ` AND l.assigned_to = $${idx++}`;
      params.push(assigned_to);
    }

    if (search) {
      query += ` AND (l.title ILIKE $${idx} OR l.client_name ILIKE $${idx} OR l.client_company ILIKE $${idx})`;
      params.push(`%${search}%`); idx++;
    }

    query += ' ORDER BY l.updated_at DESC';
    const result = await pool.query(query, params);
    res.json({ leads: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/leads/:id - Single lead with full history
const getLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const lead = await pool.query(
      `SELECT l.*,
        u1.name as assigned_to_name, u1.email as assigned_to_email,
        u2.name as created_by_name
       FROM leads l
       LEFT JOIN users u1 ON l.assigned_to = u1.id
       LEFT JOIN users u2 ON l.created_by = u2.id
       WHERE l.id = $1`,
      [id]
    );
    if (!lead.rows[0]) return res.status(404).json({ message: 'Lead not found' });

    // Role-based access control
    if (req.user.role === 'visitor' && lead.rows[0].assigned_to !== req.user.id) {
      return res.status(403).json({ message: 'Access denied: Lead not assigned to you' });
    }

    const history = await pool.query(
      `SELECT lh.*, u.name as user_name, u.role as user_role
       FROM lead_history lh
       JOIN users u ON lh.user_id = u.id
       WHERE lh.lead_id = $1
       ORDER BY lh.created_at DESC`,
      [id]
    );

    const notes = await pool.query(
      `SELECT ln.*,
        u.name as user_name, u.role as user_role,
        json_agg(
          json_build_object('id', ne.id, 'previous_content', ne.previous_content, 'new_content', ne.new_content, 'edited_at', ne.edited_at, 'editor_name', ue.name)
          ORDER BY ne.edited_at DESC
        ) FILTER (WHERE ne.id IS NOT NULL) as edit_history
       FROM lead_notes ln
       JOIN users u ON ln.user_id = u.id
       LEFT JOIN note_edits ne ON ne.note_id = ln.id
       LEFT JOIN users ue ON ne.user_id = ue.id
       WHERE ln.lead_id = $1
       GROUP BY ln.id, u.name, u.role
       ORDER BY ln.created_at DESC`,
      [id]
    );

    const reminders = await pool.query(
      `SELECT r.*, u.name as user_name
       FROM reminders r
       JOIN users u ON r.user_id = u.id
       WHERE r.lead_id = $1
       ORDER BY r.remind_at ASC`,
      [id]
    );

    res.json({
      lead: lead.rows[0],
      history: history.rows,
      notes: notes.rows,
      reminders: reminders.rows,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/leads - Create lead
const createLead = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { title, client_name, client_email, client_phone, client_company, description, priority, value, assigned_to } = req.body;

    if (!title || !client_name) return res.status(400).json({ message: 'Title and client name are required' });

    const result = await client.query(
      `INSERT INTO leads (title, client_name, client_email, client_phone, client_company, description, priority, value, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [title.trim(), client_name.trim(), client_email, client_phone, client_company, description, priority || 'medium', value || null, assigned_to || req.user.id, req.user.id]
    );

    const lead = result.rows[0];
    await logHistory(client, lead.id, req.user.id, 'lead_created', { title: lead.title, client_name: lead.client_name });

    await client.query('COMMIT');

    const full = await pool.query(
      `SELECT l.*, u1.name as assigned_to_name, u2.name as created_by_name
       FROM leads l LEFT JOIN users u1 ON l.assigned_to = u1.id LEFT JOIN users u2 ON l.created_by = u2.id
       WHERE l.id = $1`, [lead.id]
    );
    res.status(201).json({ lead: full.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// PUT /api/leads/:id - Update lead fields
const updateLead = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const current = await client.query('SELECT * FROM leads WHERE id = $1', [id]);
    if (!current.rows[0]) return res.status(404).json({ message: 'Lead not found' });
    const lead = current.rows[0];

    // Role-based access control
    if (req.user.role === 'visitor' && lead.assigned_to !== req.user.id) {
      return res.status(403).json({ message: 'Access denied: Lead not assigned to you' });
    }

    const fields = ['title', 'client_name', 'client_email', 'client_phone', 'client_company', 'description', 'priority', 'value', 'assigned_to'];
    const updates = [];
    const params = [];
    let idx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined && req.body[field] !== lead[field]) {
        updates.push(`${field} = $${idx++}`);
        params.push(req.body[field]);
        await logHistory(client, id, req.user.id, 'field_updated', {}, field, String(lead[field] ?? ''), String(req.body[field] ?? ''));
      }
    }

    if (updates.length === 0) return res.status(400).json({ message: 'No changes detected' });

    params.push(id);
    const result = await client.query(
      `UPDATE leads SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    await client.query('COMMIT');
    res.json({ lead: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// PUT /api/leads/:id/stage - Move stage (Kanban drag)
const moveStage = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { stage } = req.body;

    if (!VALID_STAGES.includes(stage))
      return res.status(400).json({ message: 'Invalid stage' });

    const current = await client.query('SELECT * FROM leads WHERE id = $1', [id]);
    if (!current.rows[0]) return res.status(404).json({ message: 'Lead not found' });

    // Role-based access control
    if (req.user.role === 'visitor' && current.rows[0].assigned_to !== req.user.id) {
      return res.status(403).json({ message: 'Access denied: Lead not assigned to you' });
    }

    const oldStage = current.rows[0].stage;
    if (oldStage === stage) return res.status(400).json({ message: 'Lead already in this stage' });

    const result = await client.query(
      'UPDATE leads SET stage = $1 WHERE id = $2 RETURNING *',
      [stage, id]
    );

    await logHistory(client, id, req.user.id, 'stage_changed', { from: oldStage, to: stage }, 'stage', oldStage, stage);
    await client.query('COMMIT');

    // Send Email to the assigned user asynchronously
    try {
      const assigneeResult = await pool.query('SELECT email, name FROM users WHERE id = $1', [result.rows[0].assigned_to]);
      const assignee = assigneeResult.rows[0];
      if (assignee && assignee.email) {
        const { sendEmail } = require('../services/email');
        const emailContent = `
          <h2>Lead Stage Updated</h2>
          <p>Hello ${assignee.name},</p>
          <p>The lead <strong>"${result.rows[0].title}"</strong> has been moved to a new stage.</p>
          <ul>
            <li><strong>From:</strong> ${oldStage}</li>
            <li><strong>To:</strong> ${stage}</li>
            <li><strong>Updated By:</strong> ${req.user.name || 'A team member'}</li>
          </ul>
          <p><a href="${process.env.FRONTEND_URL || 'https://aprilintternalbacked.vercel.app'}/leads/${id}">Click here to view Lead</a></p>
        `;
        sendEmail(assignee.email, `Lead Update: ${result.rows[0].title} moved to ${stage}`, '', emailContent);
      }
    } catch (err) {
      console.error('Failed to send stage change email:', err);
    }

    res.json({ lead: result.rows[0], from: oldStage, to: stage });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

module.exports = { getLeads, getLead, createLead, updateLead, moveStage };
