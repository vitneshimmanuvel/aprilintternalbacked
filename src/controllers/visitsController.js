const pool = require('../config/db');

// GET /api/leads/:leadId/visits - Get all visits for a lead
const getVisits = async (req, res, next) => {
  try {
    const { leadId } = req.params;
    const result = await pool.query(
      `SELECT v.*, 
        u.name as created_by_name, u.role as created_by_role,
        l.title as lead_title, l.client_name,
        (SELECT json_agg(
          json_build_object(
            'id', vp.id, 'user_id', vp.user_id, 'user_name', pu.name, 'user_role', pu.role,
            'distance_km', vp.distance_km, 'travel_mode', vp.travel_mode, 'travel_notes', vp.travel_notes
          ) ORDER BY pu.name
        ) FROM visit_participants vp JOIN users pu ON vp.user_id = pu.id WHERE vp.visit_id = v.id) as participants
       FROM lead_visits v
       JOIN users u ON v.created_by = u.id
       JOIN leads l ON v.lead_id = l.id
       WHERE v.lead_id = $1
       ORDER BY v.visit_date DESC`,
      [leadId]
    );
    res.json({ visits: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/visits/all - Admin: Get all visits across all leads (with filters)
const getAllVisits = async (req, res, next) => {
  try {
    const { user_id, from_date, to_date, lead_id } = req.query;
    let query = `
      SELECT v.*, 
        u.name as created_by_name, u.role as created_by_role,
        l.title as lead_title, l.client_name, l.client_company,
        (SELECT json_agg(
          json_build_object(
            'id', vp.id, 'user_id', vp.user_id, 'user_name', pu.name, 'user_role', pu.role,
            'distance_km', vp.distance_km, 'travel_mode', vp.travel_mode, 'travel_notes', vp.travel_notes
          ) ORDER BY pu.name
        ) FROM visit_participants vp JOIN users pu ON vp.user_id = pu.id WHERE vp.visit_id = v.id) as participants
       FROM lead_visits v
       JOIN users u ON v.created_by = u.id
       JOIN leads l ON v.lead_id = l.id
       WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (user_id) {
      // Filter by participant OR creator
      query += ` AND (v.created_by = $${idx} OR v.id IN (SELECT visit_id FROM visit_participants WHERE user_id = $${idx}))`;
      params.push(user_id); idx++;
    }
    if (lead_id) {
      query += ` AND v.lead_id = $${idx++}`;
      params.push(lead_id);
    }
    if (from_date) {
      query += ` AND v.visit_date >= $${idx++}`;
      params.push(from_date);
    }
    if (to_date) {
      query += ` AND v.visit_date <= $${idx++}`;
      params.push(to_date);
    }

    query += ' ORDER BY v.visit_date DESC LIMIT 200';
    const result = await pool.query(query, params);

    // Also get per-user travel summary
    let summaryQuery = `
      SELECT 
        u.id, u.name, u.role,
        COUNT(DISTINCT v.id) as total_visits,
        COALESCE(SUM(vp.distance_km), 0) as total_distance_km
      FROM users u
      LEFT JOIN visit_participants vp ON u.id = vp.user_id
      LEFT JOIN lead_visits v ON vp.visit_id = v.id
      WHERE 1=1
    `;
    const sParams = [];
    let sIdx = 1;
    if (from_date) { summaryQuery += ` AND v.visit_date >= $${sIdx++}`; sParams.push(from_date); }
    if (to_date) { summaryQuery += ` AND v.visit_date <= $${sIdx++}`; sParams.push(to_date); }
    summaryQuery += ` GROUP BY u.id, u.name, u.role HAVING COUNT(DISTINCT v.id) > 0 ORDER BY total_visits DESC`;

    const summary = await pool.query(summaryQuery, sParams);

    res.json({ visits: result.rows, userSummary: summary.rows });
  } catch (err) {
    next(err);
  }
};

// POST /api/leads/:leadId/visits - Log a new visit
const createVisit = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { leadId } = req.params;
    const { location, distance_km, visit_date, purpose, notes, outcome, participants } = req.body;

    if (!location?.trim() || !visit_date || !purpose) {
      return res.status(400).json({ message: 'Location, visit date, and purpose are required' });
    }

    // Check lead exists
    const leadCheck = await client.query('SELECT id, stage, assigned_to, title FROM leads WHERE id = $1', [leadId]);
    if (!leadCheck.rows[0]) return res.status(404).json({ message: 'Lead not found' });

    if (leadCheck.rows[0].stage === 'cancelled') {
      return res.status(400).json({ message: 'Cannot add visits to cancelled leads' });
    }

    // Create the visit
    const result = await client.query(
      `INSERT INTO lead_visits (lead_id, created_by, location, distance_km, visit_date, purpose, notes, outcome)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [leadId, req.user.id, location.trim(), distance_km || 0, visit_date, purpose, notes || null, outcome || 'pending']
    );
    const visit = result.rows[0];

    // Add the creator as a participant automatically
    await client.query(
      `INSERT INTO visit_participants (visit_id, user_id, distance_km, travel_mode, travel_notes)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (visit_id, user_id) DO NOTHING`,
      [visit.id, req.user.id, distance_km || 0, req.body.travel_mode || 'car', null]
    );

    // Add additional participants if provided
    if (participants && Array.isArray(participants)) {
      for (const p of participants) {
        if (p.user_id && p.user_id !== req.user.id) {
          await client.query(
            `INSERT INTO visit_participants (visit_id, user_id, distance_km, travel_mode, travel_notes)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (visit_id, user_id) DO NOTHING`,
            [visit.id, p.user_id, p.distance_km || distance_km || 0, p.travel_mode || 'car', p.travel_notes || null]
          );
        }
      }
    }

    // Log to history
    await client.query(
      `INSERT INTO lead_history (lead_id, user_id, action, details)
       VALUES ($1, $2, 'visit_logged', $3)`,
      [leadId, req.user.id, JSON.stringify({
        location: location.trim(), distance_km, purpose, visit_date,
        participants_count: (participants?.length || 0) + 1
      })]
    );

    await client.query('COMMIT');

    // Fetch full visit with participants
    const full = await pool.query(
      `SELECT v.*, u.name as created_by_name, u.role as created_by_role,
        (SELECT json_agg(
          json_build_object(
            'id', vp.id, 'user_id', vp.user_id, 'user_name', pu.name, 'user_role', pu.role,
            'distance_km', vp.distance_km, 'travel_mode', vp.travel_mode, 'travel_notes', vp.travel_notes
          ) ORDER BY pu.name
        ) FROM visit_participants vp JOIN users pu ON vp.user_id = pu.id WHERE vp.visit_id = v.id) as participants
       FROM lead_visits v JOIN users u ON v.created_by = u.id WHERE v.id = $1`,
      [visit.id]
    );

    res.status(201).json({ visit: full.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// PUT /api/visits/:id - Update a visit
const updateVisit = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const current = await client.query('SELECT * FROM lead_visits WHERE id = $1', [id]);
    if (!current.rows[0]) return res.status(404).json({ message: 'Visit not found' });

    const visit = current.rows[0];
    // Only creator or admin can update
    if (visit.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not allowed to edit this visit' });
    }

    const { location, distance_km, visit_date, purpose, notes, outcome } = req.body;
    await client.query(
      `UPDATE lead_visits SET 
        location = COALESCE($1, location), distance_km = COALESCE($2, distance_km),
        visit_date = COALESCE($3, visit_date), purpose = COALESCE($4, purpose),
        notes = COALESCE($5, notes), outcome = COALESCE($6, outcome)
       WHERE id = $7`,
      [location, distance_km, visit_date, purpose, notes, outcome, id]
    );

    // Log to history
    await client.query(
      `INSERT INTO lead_history (lead_id, user_id, action, details)
       VALUES ($1, $2, 'visit_updated', $3)`,
      [visit.lead_id, req.user.id, JSON.stringify({ visit_id: id, location: location || visit.location })]
    );

    await client.query('COMMIT');
    res.json({ message: 'Visit updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

module.exports = { getVisits, getAllVisits, createVisit, updateVisit };
