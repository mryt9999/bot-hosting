const mongoose = require('mongoose');

/**
 * User profile schema for the economy system
 * @typedef {Object} ProfileSchema
 * @property {string} userId - Discord user ID (unique identifier)
 * @property {string} serverID - Discord server/guild ID
 * @property {number} balance - User's current point balance (default: 100)
 * @property {number} lastDaily - Timestamp of last daily claim in milliseconds (default: 0)
 * @property {number} lastDailyRolePay - Timestamp of last daily role pay in milliseconds (default: 0)
 *
 * New:
 * @property {Array} tasks - Array of minimal task usage objects:
 *   [{ taskId: String, completions: Number, firstCompletionAt: Number }]
 *   - taskId: id/key for the task as found in globalValues.json (string)
 *   - completions: number of times user has completed this task in the current week window
 *   - firstCompletionAt: timestamp in ms of the first recorded completion in the current weekly window
 */
const profileSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    serverID: { type: String, required: true },
    balance: { type: Number, default: 100 },
    lastDaily: { type: Number, default: 0 },
    lastDailyRolePay: { type: Number, default: 0 },
    claimedArcaneRoles: { type: [String], default: [] },
    // Minimal task tracking
    tasks: {
        type: [
            {
                taskId: { type: String, required: true },
                completions: { type: Number, default: 0 },
                firstCompletionAt: { type: Number, default: 0 },
            },
        ],
        default: [],
    },

    //weekly withdrawal tracking
    weeklyWithdrawAmount: { type: Number, default: 0 },
    firstWithdrawAt: { type: Number, default: 0 },
});

// keep the existing model name to avoid breaking references
const model = mongoose.model('economydb', profileSchema);

module.exports = model;