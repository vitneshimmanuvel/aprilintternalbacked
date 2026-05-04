const pool = require('../config/db');

// GET /api/visits/all - Admin/Manager: view all visits across all leads
const getAllVisits = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT v.*, u.name as user_name, l.title as lead_title, l.client_name 
      FROM lead_visits v
      JOIN users u ON v.created_by = u.id
      JOIN leads l ON v.lead_id = l.id
      WHERE l.board_id = $1
      ORDER BY v.created_at DESC
    `, [req.boardId]);
    res.json({ visits: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/leads/:leadId/visits
const getVisits = async (req, res, next) => {
  try {
    const { leadId } = req.params;
    const result = await pool.query(`
      SELECT v.*, u.name as user_name 
      FROM lead_visits v
      JOIN users u ON v.created_by = u.id
      JOIN leads l ON v.lead_id = l.id
      WHERE v.lead_id = $1 AND l.board_id = $2
      ORDER BY v.created_at DESC
    `, [leadId, req.boardId]);
    res.json({ visits: result.rows });
  } catch (err) {
    next(err);
  }
};

// POST /api/leads/:leadId/visits
const createVisit = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { leadId } = req.params;
    const { location, purpose, distance_km, is_custom_location, outcome } = req.body;

    const leadCheck = await client.query('SELECT id, board_id FROM leads WHERE id = $1', [leadId]);
    if (!leadCheck.rows[0] || leadCheck.rows[0].board_id !== req.boardId) {
       return res.status(404).json({ message: 'Lead not found or access denied' });
    }

    const result = await client.query(
      `INSERT INTO lead_visits (lead_id, location, purpose, distance_km, is_custom_location, outcome, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [leadId, location, purpose, distance_km || 0, is_custom_location || false, outcome || null, req.user.id]
    );

    // Add to lead history
    await client.query(
      `INSERT INTO lead_history (lead_id, user_id, action, details)
       VALUES ($1, $2, 'visit_logged', $3)`,
      [leadId, req.user.id, JSON.stringify({ location: location?.address, purpose, outcome })]
    );

    await client.query('COMMIT');
    
    const visit = await pool.query(
      `SELECT v.*, u.name as user_name FROM lead_visits v JOIN users u ON v.created_by = u.id WHERE v.id = $1`,
      [result.rows[0].id]
    );
    res.status(201).json({ visit: visit.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// PUT /api/visits/:id
const updateVisit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { location, purpose, distance_km, outcome, notes, visit_date, travel_mode } = req.body;

    // Verify the visit belongs to a lead in the user's board
    const check = await pool.query(
      `SELECT v.id, v.created_by, l.board_id FROM lead_visits v JOIN leads l ON v.lead_id = l.id WHERE v.id = $1`,
      [id]
    );
    if (!check.rows[0] || check.rows[0].board_id !== req.boardId) {
      return res.status(404).json({ message: 'Visit not found or access denied' });
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (location !== undefined) { fields.push(`location = $${idx++}`); values.push(location); }
    if (purpose !== undefined) { fields.push(`purpose = $${idx++}`); values.push(purpose); }
    if (distance_km !== undefined) { fields.push(`distance_km = $${idx++}`); values.push(distance_km); }
    if (outcome !== undefined) { fields.push(`outcome = $${idx++}`); values.push(outcome); }
    if (notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(notes); }
    if (visit_date !== undefined) { fields.push(`visit_date = $${idx++}`); values.push(visit_date); }
    if (travel_mode !== undefined) { fields.push(`travel_mode = $${idx++}`); values.push(travel_mode); }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(id);
    await pool.query(`UPDATE lead_visits SET ${fields.join(', ')} WHERE id = $${idx}`, values);

    // Log to history
    const visit = check.rows[0];
    await pool.query(
      `INSERT INTO lead_history (lead_id, user_id, action, details)
       SELECT v.lead_id, $1, 'visit_updated', $2
       FROM lead_visits v WHERE v.id = $3`,
      [req.user.id, JSON.stringify({ location, purpose, outcome }), id]
    );

    const updated = await pool.query(
      `SELECT v.*, u.name as user_name FROM lead_visits v JOIN users u ON v.created_by = u.id WHERE v.id = $1`,
      [id]
    );
    res.json({ visit: updated.rows[0] });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllVisits, getVisits, createVisit, updateVisit };
