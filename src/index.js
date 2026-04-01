require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./routes');
require('./cron');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API routes
app.use('/api', routes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.code === '23505') return res.status(409).json({ message: 'Duplicate entry' });
  if (err.code === '23503') return res.status(400).json({ message: 'Referenced record not found' });
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 LeadFlow server running on port ${PORT}`));

module.exports = app;
