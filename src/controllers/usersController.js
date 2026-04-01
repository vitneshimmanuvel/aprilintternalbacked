const bcrypt = require('bcryptjs');
const pool = require('../config/db');

// GET /api/users - Admin: list all users
const getUsers = async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/users/active - All: list active users for assignment
const getActiveUsers = async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name FROM users WHERE is_active = true ORDER BY name ASC'
    );
    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
};

// POST /api/users - Admin: create user
const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role)
      return res.status(400).json({ message: 'All fields are required' });
    if (!['manager', 'visitor'].includes(role))
      return res.status(400).json({ message: 'Role must be manager or visitor' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows[0])
      return res.status(409).json({ message: 'Email already in use' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, is_active, created_at',
      [name.trim(), email.toLowerCase().trim(), hash, role]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// PUT /api/users/:id - Admin: update user
const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, role, is_active, password } = req.body;

    // Prevent admin from deactivating themselves
    if (req.user.id === id && is_active === false)
      return res.status(400).json({ message: 'Cannot deactivate your own account' });

    const current = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!current.rows[0]) return res.status(404).json({ message: 'User not found' });

    // Prevent changing admin role
    if (current.rows[0].role === 'admin' && role && role !== 'admin')
      return res.status(400).json({ message: 'Cannot change admin role' });

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
      if (password.length < 6) return res.status(400).json({ message: 'Password too short' });
      const hash = await bcrypt.hash(password, 10);
      updateQuery += `, password_hash = $6`;
      params = [name?.trim() || null, email?.toLowerCase().trim() || null, role || null, is_active !== undefined ? is_active : null, id, hash];
      updateQuery += ` WHERE id = $5 RETURNING id, name, email, role, is_active, created_at`;
    } else {
      updateQuery += ` WHERE id = $5 RETURNING id, name, email, role, is_active, created_at`;
    }

    const result = await pool.query(updateQuery, params);
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
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

module.exports = { getUsers, createUser, updateUser, deleteUser, getActiveUsers, updateFcmToken };
