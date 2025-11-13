const mongoose = require('mongoose');

/**
 * Schema for tracking user task completions
 * Tracks weekly task completions for each user
 */
const taskSchema = new mongoose.Schema({
    /** Discord user ID */
    userId: {
        type: String,
        required: true
    },
    /** Discord server ID */
    serverID: {
        type: String,
        required: true
    },
    /** Task ID from globalValues.json */
    taskId: {
        type: Number,
        required: true
    },
    /** Number of times completed this week */
    completionsThisWeek: {
        type: Number,
        default: 0
    },
    /** Timestamp of last completion */
    lastCompletionDate: {
        type: Date,
        default: null
    },
    /** Timestamp of week start (used to reset weekly counts) */
    weekStartDate: {
        type: Date,
        default: () => getWeekStart()
    }
});

// Create compound index for efficient querying
taskSchema.index({ userId: 1, serverID: 1, taskId: 1 }, { unique: true });

/**
 * Get the start of the current week (Monday at 00:00:00 UTC)
 */
function getWeekStart() {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - diff);
    monday.setUTCHours(0, 0, 0, 0);
    return monday;
}

module.exports = mongoose.model('Task', taskSchema);
