const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const authCtrl = require('../controllers/authController');
const usersCtrl = require('../controllers/usersController');
const leadsCtrl = require('../controllers/leadsController');
const notesCtrl = require('../controllers/notesController');
const remindersCtrl = require('../controllers/remindersController');
const statsCtrl = require('../controllers/statsController');
const visitsCtrl = require('../controllers/visitsController');
const settingsCtrl = require('../controllers/settingsController');

// Stats (admin only)
router.get('/stats/today', authenticate, requireAdmin, statsCtrl.getTodayStats);

// Auth
router.post('/auth/login', authCtrl.login);
router.get('/auth/me', authenticate, authCtrl.getMe);
router.put('/auth/change-password', authenticate, authCtrl.changePassword);

// Users
router.put('/users/me/fcm-token', authenticate, usersCtrl.updateFcmToken);
router.get('/users/active', authenticate, usersCtrl.getActiveUsers);
router.get('/users', authenticate, requireAdmin, usersCtrl.getUsers);
router.post('/users', authenticate, requireAdmin, usersCtrl.createUser);
router.put('/users/:id', authenticate, requireAdmin, usersCtrl.updateUser);
router.delete('/users/:id', authenticate, requireAdmin, usersCtrl.deleteUser);

// Leads (all authenticated)
router.get('/leads', authenticate, leadsCtrl.getLeads);
router.post('/leads', authenticate, leadsCtrl.createLead);
router.get('/leads/:id', authenticate, leadsCtrl.getLead);
router.put('/leads/:id', authenticate, leadsCtrl.updateLead);
router.put('/leads/:id/stage', authenticate, leadsCtrl.moveStage);

// Notes
router.get('/leads/:leadId/notes', authenticate, notesCtrl.getNotes);
router.post('/leads/:leadId/notes', authenticate, notesCtrl.addNote);
router.put('/leads/:leadId/notes/:noteId', authenticate, notesCtrl.editNote);

// Reminders
router.get('/reminders/mine', authenticate, remindersCtrl.getMyReminders);
router.get('/leads/:leadId/reminders', authenticate, remindersCtrl.getReminders);
router.post('/leads/:leadId/reminders', authenticate, remindersCtrl.createReminder);
router.put('/reminders/:id/complete', authenticate, remindersCtrl.completeReminder);
router.delete('/reminders/:id', authenticate, remindersCtrl.deleteReminder);

// Visits / Travel
router.get('/visits/all', authenticate, requireAdmin, visitsCtrl.getAllVisits);
router.get('/leads/:leadId/visits', authenticate, visitsCtrl.getVisits);
router.post('/leads/:leadId/visits', authenticate, visitsCtrl.createVisit);
router.put('/visits/:id', authenticate, visitsCtrl.updateVisit);

// Settings
router.get('/settings', authenticate, settingsCtrl.getSettings);
router.put('/settings', authenticate, requireAdmin, settingsCtrl.updateSettings);

module.exports = router;
