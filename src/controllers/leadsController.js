const pool = require('../config/db');

// Helper to build filtering queries
const buildFilterQuery = (query, baseQuery, params, userRole, userId, boardId) => {
  let paramIdx = params.length + 1;

  // Always filter by board
  baseQuery += ` AND l.board_id = $${paramIdx}`;
  params.push(boardId);
  paramIdx++;

  if (query.assigned_to) {
    baseQuery += ` AND l.assigned_to = $${paramIdx}`;
    params.push(query.assigned_to);
    paramIdx++;
  }

  if (query.stage) {
    baseQuery += ` AND l.stage = $${paramIdx}`;
    params.push(query.stage);
    paramIdx++;
  }

  if (query.search) {
    baseQuery += ` AND (l.title ILIKE $${paramIdx} OR l.client_name ILIKE $${paramIdx} OR l.client_email ILIKE $${paramIdx} OR l.client_company ILIKE $${paramIdx})`;
    params.push(`%${query.search}%`);
    paramIdx++;
  }

  return { sql: baseQuery, params };
};

// GET /api/leads
const getLeads = async (req, res, next) => {
  try {
    let sql = `
      SELECT l.*, 
        u1.name as assigned_name, 
        u2.name as creator_name,
        (SELECT COUNT(*) FROM lead_notes ln WHERE ln.lead_id = l.id AND ln.money_collected = true) as money_collected_notes
      FROM leads l
      LEFT JOIN users u1 ON l.assigned_to = u1.id
      JOIN users u2 ON l.created_by = u2.id
      WHERE 1=1
    `;
    let params = [];

    const filtered = buildFilterQuery(req.query, sql, params, req.user.role, req.user.id, req.boardId);
    filtered.sql += ` ORDER BY l.created_at DESC`;

    const result = await pool.query(filtered.sql, filtered.params);
    res.json({ leads: result.rows });
  } catch (err) {
    next(err);
  }
};

// POST /api/leads
const createLead = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { title, client_name, client_email, client_phone, client_company, description, priority, value, assigned_to, custom_data } = req.body;

    let finalTitle = title ? title.trim() : 'Unnamed Lead';
    let finalClientName = client_name ? client_name.trim() : 'Unknown Client';

    let finalAssignedTo = assigned_to || null;

    let firstStage = 'meeting';
    const settingsResult = await client.query("SELECT value FROM settings WHERE board_id = $1 AND key = 'stages'", [req.boardId]);
    if (settingsResult.rows[0]) {
      try {
        const stages = typeof settingsResult.rows[0].value === 'string' ? JSON.parse(settingsResult.rows[0].value) : settingsResult.rows[0].value;
        if (stages && stages.length > 0) firstStage = stages[0].id;
      } catch (e) { console.error('Error parsing stages', e); }
    }

    const result = await client.query(
      `INSERT INTO leads (title, client_name, client_email, client_phone, client_company, description, priority, value, assigned_to, created_by, board_id, custom_data, stage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        finalTitle, finalClientName, client_email?.trim() || null, 
        client_phone?.trim() || null, client_company?.trim() || null, 
        description?.trim() || null, priority || 'medium', value || null, 
        finalAssignedTo, req.user.id, req.boardId, custom_data || {}, firstStage
      ]
    );

    const leadId = result.rows[0].id;

    await client.query(
      `INSERT INTO lead_history (lead_id, user_id, action, details)
       VALUES ($1, $2, 'created', $3)`,
      [leadId, req.user.id, JSON.stringify({ title: finalTitle, initial_stage: firstStage })]
    );

    // Initial default note
    await client.query(
      `INSERT INTO lead_notes (lead_id, user_id, stage, content, original_content)
       VALUES ($1, $2, $3, $4, $4)`,
      [leadId, req.user.id, firstStage, `Lead created: ${title}`]
    );

    await client.query('COMMIT');

    // Email notification if assigned
    if (finalAssignedTo && finalAssignedTo !== req.user.id) {
      const { sendActionEmail } = require('../services/email');
      sendActionEmail(finalAssignedTo, leadId, `New Lead Assigned: ${title}`, `You have been assigned a new lead.`, `Client: ${client_name}`);
    }

    const fullLead = await pool.query(
      `SELECT l.*, u1.name as assigned_name, u2.name as creator_name
       FROM leads l LEFT JOIN users u1 ON l.assigned_to = u1.id JOIN users u2 ON l.created_by = u2.id WHERE l.id = $1`,
      [leadId]
    );
    res.status(201).json({ lead: fullLead.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/leads/:id
const getLead = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT l.*, u1.name as assigned_name, u2.name as creator_name
       FROM leads l
       LEFT JOIN users u1 ON l.assigned_to = u1.id
       JOIN users u2 ON l.created_by = u2.id
       WHERE l.id = $1 AND l.board_id = $2`,
      [req.params.id, req.boardId]
    );

    if (!result.rows[0]) return res.status(404).json({ message: 'Lead not found or access denied' });
    const lead = result.rows[0];

    // Removed visitor access block so they can see the lead details

    const historyRes = await pool.query(
      `SELECT h.*, u.name as user_name 
       FROM lead_history h JOIN users u ON h.user_id = u.id 
       WHERE h.lead_id = $1 ORDER BY h.created_at DESC`,
      [lead.id]
    );

    const notesRes = await pool.query(
      `SELECT ln.*, u.name as user_name, u.role as user_role,
        json_agg(json_build_object('id', ne.id, 'previous_content', ne.previous_content, 'new_content', ne.new_content, 'edited_at', ne.edited_at, 'editor_name', ue.name) ORDER BY ne.edited_at DESC) FILTER (WHERE ne.id IS NOT NULL) as edit_history
       FROM lead_notes ln
       JOIN users u ON ln.user_id = u.id
       LEFT JOIN note_edits ne ON ne.note_id = ln.id
       LEFT JOIN users ue ON ne.user_id = ue.id
       WHERE ln.lead_id = $1 GROUP BY ln.id, u.name, u.role ORDER BY ln.created_at DESC`,
      [lead.id]
    );

    const remindersRes = await pool.query(
      `SELECT r.*, u.name as user_name
       FROM reminders r
       JOIN users u ON r.user_id = u.id
       WHERE r.lead_id = $1 ORDER BY r.remind_at ASC`,
      [lead.id]
    );

    res.json({ 
      lead, 
      history: historyRes.rows, 
      notes: notesRes.rows, 
      reminders: remindersRes.rows 
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/leads/:id
const updateLead = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { title, client_name, client_email, client_phone, client_company, description, priority, value, assigned_to, custom_data } = req.body;

    const current = await client.query('SELECT * FROM leads WHERE id = $1 AND board_id = $2', [id, req.boardId]);
    if (!current.rows[0]) return res.status(404).json({ message: 'Lead not found or access denied' });

    // Removed visitor update restriction so they can edit leads and re-assign
    let finalAssignedTo = assigned_to;

    const updates = [];
    const changedFields = [];
    const params = [];
    let paramIdx = 1;
    
    // Compare and build history
    if (title && title !== current.rows[0].title) { updates.push(`title = $${paramIdx++}`); params.push(title); changedFields.push('title'); }
    if (client_name && client_name !== current.rows[0].client_name) { updates.push(`client_name = $${paramIdx++}`); params.push(client_name); changedFields.push('client_name'); }
    if (client_email !== undefined && client_email !== current.rows[0].client_email) { updates.push(`client_email = $${paramIdx++}`); params.push(client_email || null); changedFields.push('client_email'); }
    if (client_phone !== undefined && client_phone !== current.rows[0].client_phone) { updates.push(`client_phone = $${paramIdx++}`); params.push(client_phone || null); changedFields.push('client_phone'); }
    if (client_company !== undefined && client_company !== current.rows[0].client_company) { updates.push(`client_company = $${paramIdx++}`); params.push(client_company || null); changedFields.push('client_company'); }
    if (description !== undefined && description !== current.rows[0].description) { updates.push(`description = $${paramIdx++}`); params.push(description || null); changedFields.push('description'); }
    if (priority && priority !== current.rows[0].priority) { updates.push(`priority = $${paramIdx++}`); params.push(priority); changedFields.push('priority'); }
    if (value !== undefined && value != current.rows[0].value) { updates.push(`value = $${paramIdx++}`); params.push(value || null); changedFields.push('value'); }
    if (finalAssignedTo !== undefined && finalAssignedTo !== current.rows[0].assigned_to) { updates.push(`assigned_to = $${paramIdx++}`); params.push(finalAssignedTo || null); changedFields.push('assigned_to'); }
    if (custom_data !== undefined) { 
      // Compare custom_data JSON
      if (JSON.stringify(custom_data) !== JSON.stringify(current.rows[0].custom_data)) {
        updates.push(`custom_data = $${paramIdx++}`); 
        params.push(custom_data); 
        changedFields.push('custom_data'); 
      }
    }

    if (updates.length > 0) {
      params.push(id);
      await client.query(`UPDATE leads SET ${updates.join(', ')} WHERE id = $${paramIdx}`, params);
      
      await client.query(
        `INSERT INTO lead_history (lead_id, user_id, action, details) VALUES ($1, $2, 'updated', $3)`,
        [id, req.user.id, JSON.stringify({ fields: changedFields })]
      );
    }

    await client.query('COMMIT');
    
    // Notify if assignee changed
    if (finalAssignedTo && finalAssignedTo !== current.rows[0].assigned_to) {
      const { sendActionEmail } = require('../services/email');
      sendActionEmail(finalAssignedTo, id, `Lead Re-assigned to You: ${current.rows[0].title}`, `A lead has been assigned to you.`, `Client: ${current.rows[0].client_name}`);
    }

    const fullLead = await pool.query(
      `SELECT l.*, u1.name as assigned_name, u2.name as creator_name
       FROM leads l LEFT JOIN users u1 ON l.assigned_to = u1.id JOIN users u2 ON l.created_by = u2.id WHERE l.id = $1`,
      [id]
    );
    res.json({ lead: fullLead.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// PUT /api/leads/:id/stage
const moveStage = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { new_stage, note } = req.body;

    if (!new_stage) return res.status(400).json({ message: 'new_stage is required' });

    const current = await client.query('SELECT * FROM leads WHERE id = $1 AND board_id = $2', [id, req.boardId]);
    if (!current.rows[0]) return res.status(404).json({ message: 'Lead not found or access denied' });

    // Removed visitor restriction so they can move stages

    const oldStage = current.rows[0].stage;
    if (oldStage === new_stage) {
      return res.status(400).json({ message: 'Lead is already in this stage' });
    }

    // Update lead stage
    await client.query('UPDATE leads SET stage = $1 WHERE id = $2', [new_stage, id]);

    // History log
    await client.query(
      `INSERT INTO lead_history (lead_id, user_id, action, field_changed, old_value, new_value, details)
       VALUES ($1, $2, 'stage_changed', 'stage', $3, $4, $5)`,
      [id, req.user.id, oldStage, new_stage, JSON.stringify({ note })]
    );

    // If there's an optional note, add it
    if (note && note.trim()) {
      await client.query(
        `INSERT INTO lead_notes (lead_id, user_id, stage, content, original_content)
         VALUES ($1, $2, $3, $4, $4)`,
        [id, req.user.id, new_stage, note.trim()]
      );
    }

    await client.query('COMMIT');
    
    // Notify Manager/Admin of stage changes (could refine to only specific stages later)
    if (['negotiation', 'estimation_review', 'finalization'].includes(new_stage)) {
       const { sendActionEmail } = require('../services/email');
       const managers = await client.query(`
         SELECT u.id, u.email FROM users u 
         JOIN board_users bu ON bu.user_id = u.id
         WHERE bu.board_id = $1 AND (u.role = 'admin' OR bu.role = 'admin' OR u.role = 'manager')
       `, [req.boardId]);
       for(const m of managers.rows) {
         sendActionEmail(m.id, id, `Lead Stage Updated: ${current.rows[0].title}`, `Lead moved to <strong>${new_stage}</strong> by ${req.user.name}.`, `Client: ${current.rows[0].client_name}`);
       }
    }

    const fullLead = await pool.query(
      `SELECT l.*, u1.name as assigned_name, u2.name as creator_name
       FROM leads l LEFT JOIN users u1 ON l.assigned_to = u1.id JOIN users u2 ON l.created_by = u2.id WHERE l.id = $1`,
      [id]
    );
    res.json({ lead: fullLead.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

module.exports = { getLeads, createLead, getLead, updateLead, moveStage };
