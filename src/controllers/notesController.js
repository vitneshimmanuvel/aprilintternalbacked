const pool = require('../config/db');

// GET /api/leads/:leadId/notes
const getNotes = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ln.*, u.name as user_name, u.role as user_role,
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
       ORDER BY ln.created_at ASC`,
      [req.params.leadId]
    );
    res.json({ notes: result.rows });
  } catch (err) {
    next(err);
  }
};

// POST /api/leads/:leadId/notes
const addNote = async (req, res, next) => {
  const { leadId } = req.params;
  const { content, stage, money_collected, attachments } = req.body;

  // 1. Simple validation (no DB query needed)
  if (!content?.trim() && (!attachments || attachments.length === 0)) {
    return res.status(400).json({ message: 'Note content or file attachment is required' });
  }

  try {
    // 2. Permission and lead validation
    const leadCheck = await pool.query('SELECT id, stage, assigned_to, board_id FROM leads WHERE id = $1', [leadId]);
    if (!leadCheck.rows[0] || leadCheck.rows[0].board_id !== req.boardId) {
      return res.status(404).json({ message: 'Lead not found or access denied' });
    }

    if (req.user.role === 'visitor' && leadCheck.rows[0].assigned_to !== req.user.id) {
      return res.status(403).json({ message: 'Access denied: Lead not assigned to you' });
    }

    const noteStage = stage || leadCheck.rows[0].stage;

    // 3. Perform database writes inside a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO lead_notes (lead_id, user_id, stage, content, original_content, money_collected, attachments)
         VALUES ($1, $2, $3, $4, $4, $5, $6) RETURNING *`,
        [leadId, req.user.id, noteStage, content?.trim() || '', money_collected || false, JSON.stringify(attachments || [])]
      );

      const historyPreview = content ? content.slice(0, 80) : `[File Attached: ${(attachments || []).map(a => a.name).join(', ')}]`;

      await client.query(
        `INSERT INTO lead_history (lead_id, user_id, action, details)
         VALUES ($1, $2, 'note_added', $3)`,
        [leadId, req.user.id, JSON.stringify({ stage: noteStage, preview: historyPreview, money_collected: money_collected || false })]
      );

      await client.query('COMMIT');

      // Notify Assignee
      const { sendActionEmail } = require('../services/email');
      const emailBody = content 
        ? `Note from ${req.user.name || 'someone'}:<br><em>"${content.trim()}"</em>`
        : `Attachment added by ${req.user.name || 'someone'}`;
      sendActionEmail(leadCheck.rows[0].assigned_to, leadId, `New Note/Attachment Added on Lead`, `A new note or attachment was added to the lead.`, emailBody);

      const note = await pool.query(
        `SELECT ln.*, u.name as user_name, u.role as user_role
         FROM lead_notes ln JOIN users u ON ln.user_id = u.id WHERE ln.id = $1`,
        [result.rows[0].id]
      );
      res.status(201).json({ note: { ...note.rows[0], edit_history: [] } });

    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

// PUT /api/leads/:leadId/notes/:noteId
const editNote = async (req, res, next) => {
  const { leadId, noteId } = req.params;
  const { content } = req.body;

  // 1. Simple validation
  if (!content?.trim()) {
    return res.status(400).json({ message: 'Content required' });
  }

  try {
    // 2. Fetch existing note and check permissions
    const current = await pool.query('SELECT * FROM lead_notes WHERE id = $1 AND lead_id = $2', [noteId, leadId]);
    if (!current.rows[0]) {
      return res.status(404).json({ message: 'Note not found' });
    }

    const note = current.rows[0];

    // Only note owner or admin can edit
    if (note.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not allowed to edit this note' });
    }

    // 3. Database writes inside transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Archive old content in edit history
      await client.query(
        `INSERT INTO note_edits (note_id, user_id, previous_content, new_content)
         VALUES ($1, $2, $3, $4)`,
        [noteId, req.user.id, note.content, content.trim()]
      );

      // Update note with new content
      await client.query(
        `UPDATE lead_notes SET content = $1, is_edited = true WHERE id = $2`,
        [content.trim(), noteId]
      );

      await client.query(
        `INSERT INTO lead_history (lead_id, user_id, action, details)
         VALUES ($1, $2, 'note_edited', $3)`,
        [leadId, req.user.id, JSON.stringify({ note_id: noteId, preview: content.slice(0, 80) })]
      );

      await client.query('COMMIT');

      const fullNote = await pool.query(
        `SELECT ln.*, u.name as user_name, u.role as user_role,
          json_agg(json_build_object('id', ne.id, 'previous_content', ne.previous_content, 'new_content', ne.new_content, 'edited_at', ne.edited_at, 'editor_name', ue.name) ORDER BY ne.edited_at DESC) FILTER (WHERE ne.id IS NOT NULL) as edit_history
         FROM lead_notes ln
         JOIN users u ON ln.user_id = u.id
         LEFT JOIN note_edits ne ON ne.note_id = ln.id
         LEFT JOIN users ue ON ne.user_id = ue.id
         WHERE ln.id = $1 GROUP BY ln.id, u.name, u.role`,
        [noteId]
      );

      res.json({ note: fullNote.rows[0] });

    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

module.exports = { getNotes, addNote, editNote };

