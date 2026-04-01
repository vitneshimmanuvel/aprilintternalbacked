const pool = require('../config/db');

// Default initial stages if nothing in DB
const DEFAULT_STAGES = [
  { id: 'meeting', label: 'Meeting', color: 'var(--cyan)' },
  { id: 'followup', label: 'Follow-up', color: 'var(--accent)' },
  { id: 'negotiation', label: 'Negotiation', color: 'var(--yellow)' },
  { id: 'estimation_review', label: 'Est. Review', color: 'var(--orange)' },
  { id: 'finalization', label: 'Finalization', color: 'var(--green)' },
  { id: 'cancelled', label: 'Cancelled', color: 'var(--red)' },
];

const getSettings = async (req, res, next) => {
  try {
    const result = await pool.query("SELECT key, value FROM settings");
    const settings = {};
    result.rows.forEach(r => { settings[r.key] = r.value; });

    // Ensure we always return a valid stages array
    if (!settings.stages) {
      settings.stages = DEFAULT_STAGES;
      // Ideally we save it back, but returning it is enough for now
    }

    res.json(settings);
  } catch (err) {
    next(err);
  }
};

const updateSettings = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    
    const { key, value } = req.body;
    if (!key || !value) return res.status(400).json({ message: 'Key and value required' });
    
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)]
    );
    
    res.json({ message: 'Saved successfully' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getSettings, updateSettings };
