const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      'SELECT id, name, email, role, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!result.rows[0]) {
      return res.status(401).json({ message: 'User not found' });
    }

    if (!result.rows[0].is_active) {
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    next(err);
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Insufficient permissions' });
  }
  next();
};

const requireAdmin = requireRole('admin');
const requireManagerOrAdmin = requireRole('admin', 'manager');

module.exports = { authenticate, requireRole, requireAdmin, requireManagerOrAdmin };
