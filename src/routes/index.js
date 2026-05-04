const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin, requireManagerOrAdmin, requireBoardAccess } = require('../middleware/auth');
const authCtrl = require('../controllers/authController');
const usersCtrl = require('../controllers/usersController');
const leadsCtrl = require('../controllers/leadsController');
const notesCtrl = require('../controllers/notesController');
const remindersCtrl = require('../controllers/remindersController');
const statsCtrl = require('../controllers/statsController');
const visitsCtrl = require('../controllers/visitsController');
const settingsCtrl = require('../controllers/settingsController');
const boardsCtrl = require('../controllers/boardsController');
const cronRoute = require('./cron');

// Mount Cron route (cron-job.org invokes this)
router.use('/trigger-reminders', cronRoute);

// Stats (require board access)
router.get('/stats/today', authenticate, requireBoardAccess, requireManagerOrAdmin, statsCtrl.getTodayStats);

// Auth
router.post('/auth/login', authCtrl.login);
router.get('/auth/me', authenticate, authCtrl.getMe);
router.put('/auth/change-password', authenticate, authCtrl.changePassword);

// Boards
router.get('/boards', authenticate, boardsCtrl.getBoards);
router.get('/boards/:id', authenticate, boardsCtrl.getBoard);
router.post('/boards', authenticate, requireAdmin, boardsCtrl.createBoard);
router.put('/boards/:id', authenticate, requireAdmin, boardsCtrl.updateBoard);
router.post('/boards/:id/members', authenticate, requireAdmin, boardsCtrl.addBoardMember);
router.delete('/boards/:id/members/:userId', authenticate, requireAdmin, boardsCtrl.removeBoardMember);

// Users
router.put('/users/me/fcm-token', authenticate, usersCtrl.updateFcmToken);
router.get('/users/active', authenticate, requireBoardAccess, usersCtrl.getActiveUsers); // Filter active users by board
router.get('/users/all', authenticate, requireAdmin, usersCtrl.getAllUsers); // Global users list for board assignment
router.get('/users', authenticate, requireAdmin, requireBoardAccess, usersCtrl.getUsers); // Board-scoped users list
router.post('/users', authenticate, requireAdmin, requireBoardAccess, usersCtrl.createUser);
router.put('/users/:id', authenticate, requireAdmin, usersCtrl.updateUser);
router.delete('/users/:id', authenticate, requireAdmin, usersCtrl.deleteUser);

// Leads (all authenticated, but require board access)
router.get('/leads', authenticate, requireBoardAccess, leadsCtrl.getLeads);
router.post('/leads', authenticate, requireBoardAccess, leadsCtrl.createLead);
router.get('/leads/:id', authenticate, requireBoardAccess, leadsCtrl.getLead);
router.put('/leads/:id', authenticate, requireBoardAccess, leadsCtrl.updateLead);
router.put('/leads/:id/stage', authenticate, requireBoardAccess, leadsCtrl.moveStage);

// Notes
router.get('/leads/:leadId/notes', authenticate, requireBoardAccess, notesCtrl.getNotes);
router.post('/leads/:leadId/notes', authenticate, requireBoardAccess, notesCtrl.addNote);
router.put('/leads/:leadId/notes/:noteId', authenticate, requireBoardAccess, notesCtrl.editNote);

// Reminders
router.get('/reminders/mine', authenticate, requireBoardAccess, remindersCtrl.getMyReminders);
router.get('/leads/:leadId/reminders', authenticate, requireBoardAccess, remindersCtrl.getReminders);
router.post('/leads/:leadId/reminders', authenticate, requireBoardAccess, remindersCtrl.createReminder);
router.put('/reminders/:id/complete', authenticate, requireBoardAccess, remindersCtrl.completeReminder);
router.delete('/reminders/:id', authenticate, requireBoardAccess, remindersCtrl.deleteReminder);

// Visits / Travel
router.get('/visits/all', authenticate, requireBoardAccess, requireManagerOrAdmin, visitsCtrl.getAllVisits);
router.get('/leads/:leadId/visits', authenticate, requireBoardAccess, visitsCtrl.getVisits);
router.post('/leads/:leadId/visits', authenticate, requireBoardAccess, visitsCtrl.createVisit);
router.put('/visits/:id', authenticate, requireBoardAccess, visitsCtrl.updateVisit);

// Settings
router.get('/settings', authenticate, requireBoardAccess, settingsCtrl.getSettings);
router.put('/settings', authenticate, requireBoardAccess, requireManagerOrAdmin, settingsCtrl.updateSettings);

module.exports = router;
