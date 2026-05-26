const bcrypt = require('bcryptjs');
const pool = require('../config/db');

// GET /api/users - Admin: list users in current board
const getUsers = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at,
        COALESCE(
          (SELECT json_agg(bu.board_id) FROM board_users bu WHERE bu.user_id = u.id),
          '[]'::json
        ) as board_ids
      FROM users u
      JOIN board_users bu ON bu.user_id = u.id
      WHERE bu.board_id = $1
      ORDER BY u.created_at DESC
    `, [req.boardId]);
    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/users/all - Admin: list ALL users globally (for board assignment)
const getAllUsers = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at,
        COALESCE(
          (SELECT json_agg(bu.board_id) FROM board_users bu WHERE bu.user_id = u.id),
          '[]'::json
        ) as board_ids
      FROM users u
      ORDER BY u.created_at DESC
    `);
    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/users/active - All: list active users for assignment in current board
const getActiveUsers = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.role, u.is_active 
      FROM users u
      JOIN board_users bu ON bu.user_id = u.id
      WHERE u.is_active = true AND bu.board_id = $1
      ORDER BY u.name ASC
    `, [req.boardId]);
    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
};

// POST /api/users - Admin: create user and add to current board
const createUser = async (req, res, next) => {
  const { name, email, password, role, boardIds } = req.body;
  if (!name || !email || !password || !role)
    return res.status(400).json({ message: 'All fields are required' });
  if (!['manager', 'visitor'].includes(role))
    return res.status(400).json({ message: 'Role must be manager or visitor' });
  if (password.length < 6)
    return res.status(400).json({ message: 'Password must be at least 6 characters' });

  // Validation: Non-admin users must belong to at least one workspace
  if (role !== 'admin' && boardIds !== undefined && (!Array.isArray(boardIds) || boardIds.length === 0)) {
    return res.status(400).json({ message: 'At least one workspace must be selected' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({ message: 'Email already in use' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await client.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, is_active, created_at',
      [name.trim(), email.toLowerCase().trim(), hash, role]
    );

    // Add to selected boards or fallback to the current board
    const targetBoards = (boardIds && Array.isArray(boardIds) && boardIds.length > 0) ? boardIds : [req.boardId];
    for (const bId of targetBoards) {
      await client.query(
        'INSERT INTO board_users (board_id, user_id, role) VALUES ($1, $2, $3)',
        [bId, result.rows[0].id, 'member']
      );
    }

    await client.query('COMMIT');

    // Fetch newly created user with board_ids to return
    const userRes = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at,
        COALESCE(
          (SELECT json_agg(bu.board_id) FROM board_users bu WHERE bu.user_id = u.id),
          '[]'::json
        ) as board_ids
      FROM users u WHERE u.id = $1
    `, [result.rows[0].id]);

    res.status(201).json({ user: userRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// PUT /api/users/:id - Admin: update user
const updateUser = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { name, email, role, is_active, password, boardIds } = req.body;

    // Prevent admin from deactivating themselves
    if (req.user.id === id && is_active === false) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ message: 'Cannot deactivate your own account' });
    }

    const current = await client.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent changing admin role
    if (current.rows[0].role === 'admin' && role && role !== 'admin') {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ message: 'Cannot change admin role' });
    }

    // Validation: Non-admin users must belong to at least one workspace
    const targetRole = role || current.rows[0].role;
    if (targetRole !== 'admin' && boardIds !== undefined && (!Array.isArray(boardIds) || boardIds.length === 0)) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ message: 'At least one workspace must be selected' });
    }

    let updateQuery = `UPDATE users SET
      name = COALESCE($1, name),
      email = COALESCE($2, email),
      role = COALESCE($3, role),
      is_active = COALESCE($4, is_active)`;
    let params = [
      name?.trim() || null,
      email?.toLowerCase().trim() || null,
      role || null,
      is_active !== undefined ? is_active : null,
      id
    ];

    if (password) {
      if (password.length < 6) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ message: 'Password too short' });
      }
      const hash = await bcrypt.hash(password, 10);
      updateQuery += `, password_hash = $6`;
      params = [name?.trim() || null, email?.toLowerCase().trim() || null, role || null, is_active !== undefined ? is_active : null, id, hash];
      updateQuery += ` WHERE id = $5 RETURNING id, name, email, role, is_active, created_at`;
    } else {
      updateQuery += ` WHERE id = $5 RETURNING id, name, email, role, is_active, created_at`;
    }

    const result = await client.query(updateQuery, params);

    // Update board assignments
    if (boardIds && Array.isArray(boardIds)) {
      await client.query('DELETE FROM board_users WHERE user_id = $1', [id]);
      for (const bId of boardIds) {
        await client.query(
          'INSERT INTO board_users (board_id, user_id, role) VALUES ($1, $2, $3)',
          [bId, id, 'member']
        );
      }
    }

    await client.query('COMMIT');

    // Fetch newly updated user with board_ids to return
    const userRes = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at,
        COALESCE(
          (SELECT json_agg(bu.board_id) FROM board_users bu WHERE bu.user_id = u.id),
          '[]'::json
        ) as board_ids
      FROM users u WHERE u.id = $1
    `, [id]);

    res.json({ user: userRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// DELETE /api/users/:id - Admin: soft delete (deactivate)
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.user.id === id)
      return res.status(400).json({ message: 'Cannot delete your own account' });

    const result = await pool.query(
      'UPDATE users SET is_active = false WHERE id = $1 RETURNING id',
      [id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'User not found' });

    res.json({ message: 'User deactivated' });
  } catch (err) {
    next(err);
  }
};

const updateFcmToken = async (req, res, next) => {
  try {
    const { token } = req.body;
    await pool.query('UPDATE users SET fcm_token = $1 WHERE id = $2', [token, req.user.id]);
    res.json({ message: 'Device registered for notifications' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getUsers, getAllUsers, createUser, updateUser, deleteUser, getActiveUsers, updateFcmToken };
