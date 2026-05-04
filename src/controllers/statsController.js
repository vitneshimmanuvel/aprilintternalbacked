const pool = require('../config/db');

// GET /api/stats/today - Admin: Get activity stats (defaults to today, accepts date range)
const getTodayStats = async (req, res, next) => {
  try {
    const { from_date, to_date } = req.query;
    const boardId = req.boardId;
    let dateFilterSql = "DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE";
    let params = [boardId]; // $1 will always be boardId
    let paramIdx = 2;

    if (from_date && to_date) {
      dateFilterSql = `DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') BETWEEN $${paramIdx} AND $${paramIdx+1}`;
      params.push(from_date, to_date);
    } else if (from_date) {
      dateFilterSql = `DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') = $${paramIdx}`;
      params.push(from_date);
    }

    // 1. Leads created in date range
    const newLeads = await pool.query(`
      SELECT l.id, l.title, l.client_name, l.created_at, u.name as creator_name, u.role as creator_role, l.stage
      FROM leads l
      JOIN users u ON l.created_by = u.id
      WHERE l.board_id = $1 AND ${dateFilterSql.replace(/created_at/g, 'l.created_at')}
      ORDER BY l.created_at DESC
    `, params);

    // 2. ALL history actions in date range (not just stage changes)
    const allActions = await pool.query(`
      SELECT h.id, h.created_at, h.action, h.old_value, h.new_value, h.field_changed, h.details,
             u.name as user_name, u.role as user_role, l.title as lead_title, l.id as lead_id, l.client_name
      FROM lead_history h
      JOIN users u ON h.user_id = u.id
      JOIN leads l ON h.lead_id = l.id
      WHERE l.board_id = $1 AND ${dateFilterSql.replace(/created_at/g, 'h.created_at')}
      ORDER BY h.created_at DESC
    `, params);

    // 3. Stage movements only (subset)
    const stageMoves = allActions.rows.filter(a => a.action === 'stage_changed');

    // 4. User activity summary
    const activeUsers = await pool.query(`
      SELECT u.id, u.name, u.role, COUNT(h.id) as actions_today
      FROM users u
      JOIN board_users bu ON bu.user_id = u.id
      LEFT JOIN lead_history h ON u.id = h.user_id AND ${dateFilterSql.replace(/created_at/g, 'h.created_at')} 
        AND EXISTS (SELECT 1 FROM leads l WHERE l.id = h.lead_id AND l.board_id = $1)
      WHERE bu.board_id = $1
      GROUP BY u.id, u.name, u.role
      HAVING COUNT(h.id) > 0
      ORDER BY actions_today DESC
    `, params);

    // 5. Visits logged in date range
    const visitsToday = await pool.query(`
      SELECT v.id, v.location, v.purpose, v.distance_km, v.outcome, v.created_at,
             l.title as lead_title, u.name as user_name, u.role as user_role
      FROM lead_visits v
      JOIN leads l ON v.lead_id = l.id
      JOIN users u ON v.created_by = u.id
      WHERE l.board_id = $1 AND ${dateFilterSql.replace(/created_at/g, 'v.created_at')}
      ORDER BY v.created_at DESC
    `, params);

    // 6. Money collected notes in date range
    const moneyCollected = await pool.query(`
      SELECT ln.id, ln.content, ln.created_at, ln.money_collected,
             u.name as user_name, l.title as lead_title, l.id as lead_id, l.client_name, l.value
      FROM lead_notes ln
      JOIN users u ON ln.user_id = u.id
      JOIN leads l ON ln.lead_id = l.id
      WHERE ln.money_collected = true 
        AND l.board_id = $1
        AND ${dateFilterSql.replace(/created_at/g, 'ln.created_at')}
      ORDER BY ln.created_at DESC
    `, params);

    res.json({
      newLeads: newLeads.rows,
      stageMoves,
      allActions: allActions.rows,
      activeUsers: activeUsers.rows,
      visitsToday: visitsToday.rows,
      moneyCollected: moneyCollected.rows
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getTodayStats };
