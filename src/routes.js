'use strict';
/** Gắn router của từng module vào /api/v1 */
const { Router } = require('express');

const router = Router();

router.use('/system', require('./modules/system/system.routes'));
router.use('/auth', require('./modules/auth/auth.routes'));
router.use('/users', require('./modules/users/users.routes'));
router.use('/dashboard', require('./modules/dashboard/dashboard.routes'));
router.use('/schedules', require('./modules/schedule/schedule.routes')); // UniSchedule
router.use('/drive', require('./modules/drive/drive.routes')); // UniDrive
router.use('/notes', require('./modules/notes/notes.routes')); // UniNote
router.use('/sheets', require('./modules/sheets/sheets.routes')); // UniSheet
router.use('/tasks', require('./modules/tasks/tasks.routes')); // UniTask
router.use('/ai', require('./modules/ai/ai.routes')); // UniAI
router.use('/quiz', require('./modules/quiz/quiz.routes')); // UniQuiz
router.use('/groups', require('./modules/groups/groups.routes')); // UniGroup
router.use('/community', require('./modules/community/community.routes')); // UniShare
router.use('/notifications', require('./modules/notifications/notifications.routes'));
router.use('/search', require('./modules/search/search.routes')); // UniSearch
router.use('/library', require('./modules/library/library.routes')); // Favorites, Recent, Trash, Activity

module.exports = router;
