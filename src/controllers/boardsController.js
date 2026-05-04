const pool = require('../config/db');

// GET /api/boards — List boards for the current user
const getBoards = async (req, res, next) => {
  try {
    let result;
    if (req.user.role === 'admin') {
      // Admins see all boards
      result = await pool.query(`
        SELECT b.*, 
          (SELECT COUNT(*) FROM board_users bu WHERE bu.board_id = b.id) as member_count,
          (SELECT COUNT(*) FROM leads l WHERE l.board_id = b.id) as lead_count
        FROM boards b
        WHERE b.is_active = true
        ORDER BY b.created_at ASC
      `);
    } else {
      // Non-admins see only their assigned boards
      result = await pool.query(`
        SELECT b.*,
          (SELECT COUNT(*) FROM board_users bu WHERE bu.board_id = b.id) as member_count,
          (SELECT COUNT(*) FROM leads l WHERE l.board_id = b.id) as lead_count
        FROM boards b
        JOIN board_users bu ON bu.board_id = b.id
        WHERE bu.user_id = $1 AND b.is_active = true
        ORDER BY b.created_at ASC
      `, [req.user.id]);
    }
    res.json({ boards: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/boards/:id — Get single board details
const getBoard = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT b.*,
        (SELECT COUNT(*) FROM board_users bu WHERE bu.board_id = b.id) as member_count,
        (SELECT COUNT(*) FROM leads l WHERE l.board_id = b.id) as lead_count
      FROM boards b WHERE b.id = $1
    `, [id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Board not found' });

    // Get board members
    const members = await pool.query(`
      SELECT bu.*, u.name, u.email, u.role as user_role, u.is_active
      FROM board_users bu
      JOIN users u ON bu.user_id = u.id
      WHERE bu.board_id = $1
      ORDER BY u.name ASC
    `, [id]);

    res.json({ board: result.rows[0], members: members.rows });
  } catch (err) {
    next(err);
  }
};

// POST /api/boards — Admin: create new board
const createBoard = async (req, res, next) => {
  try {
    const { name, description, color, icon } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Board name is required' });

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    const existing = await pool.query('SELECT id FROM boards WHERE slug = $1', [slug]);
    if (existing.rows[0]) return res.status(409).json({ message: 'A board with a similar name already exists' });

    const result = await pool.query(
      `INSERT INTO boards (name, slug, description, color, icon, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name.trim(), slug, description || null, color || '#4f7cff', icon || 'briefcase', req.user.id]
    );

    // Auto-add the creator as admin of this board
    await pool.query(
      `INSERT INTO board_users (board_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [result.rows[0].id, req.user.id]
    );

    res.status(201).json({ board: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// PUT /api/boards/:id — Admin: update board
const updateBoard = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, color, icon } = req.body;

    const result = await pool.query(
      `UPDATE boards SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        color = COALESCE($3, color),
        icon = COALESCE($4, icon)
       WHERE id = $5 RETURNING *`,
      [name?.trim() || null, description, color, icon, id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Board not found' });

    res.json({ board: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// POST /api/boards/:id/members — Admin: add user to board
const addBoardMember = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { user_id, role } = req.body;
    if (!user_id) return res.status(400).json({ message: 'user_id is required' });

    const exists = await pool.query(
      'SELECT id FROM board_users WHERE board_id = $1 AND user_id = $2',
      [id, user_id]
    );
    if (exists.rows[0]) return res.status(409).json({ message: 'User is already a member of this board' });

    await pool.query(
      `INSERT INTO board_users (board_id, user_id, role) VALUES ($1, $2, $3)`,
      [id, user_id, role || 'member']
    );
    res.status(201).json({ message: 'User added to board' });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/boards/:id/members/:userId — Admin: remove user from board
const removeBoardMember = async (req, res, next) => {
  try {
    const { id, userId } = req.params;
    await pool.query('DELETE FROM board_users WHERE board_id = $1 AND user_id = $2', [id, userId]);
    res.json({ message: 'User removed from board' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getBoards, getBoard, createBoard, updateBoard, addBoardMember, removeBoardMember };
