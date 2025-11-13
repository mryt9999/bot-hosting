const taskModel = require('../models/taskSchema');
const globalValues = require('../globalValues.json');
const profileModel = require('../models/profileSchema');

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

/**
 * Record a task completion for a user
 * @param {string} userId - Discord user ID
 * @param {string} serverId - Discord server ID
 * @param {number} taskId - Task ID from globalValues.json
 * @returns {Promise<{success: boolean, message: string, rewardEarned: number}>}
 */
async function completeTask(userId, serverId, taskId) {
    try {
        // Find the task definition
        const taskDefinition = globalValues.taskInfo?.find(t => t.taskId === taskId);

        if (!taskDefinition) {
            return {
                success: false,
                message: `Task ${taskId} not found`,
                rewardEarned: 0
            };
        }

        // Get or create user task record
        let userTask = await taskModel.findOne({
            userId: userId,
            serverID: serverId,
            taskId: taskId
        });

        const weekStart = getWeekStart();

        if (!userTask) {
            // Create new task record
            userTask = await taskModel.create({
                userId: userId,
                serverID: serverId,
                taskId: taskId,
                completionsThisWeek: 0,
                weekStartDate: weekStart,
                lastCompletionDate: null
            });
        } else {
            // Check if week has passed and reset if needed
            if (userTask.weekStartDate < weekStart) {
                userTask.completionsThisWeek = 0;
                userTask.weekStartDate = weekStart;
            }
        }

        // Check if user has reached the weekly limit
        if (userTask.completionsThisWeek >= taskDefinition.maxCompletionsPerWeek) {
            return {
                success: false,
                message: `You have already completed this task ${taskDefinition.maxCompletionsPerWeek} times this week. Try again next Monday!`,
                rewardEarned: 0
            };
        }

        // Increment completion count
        userTask.completionsThisWeek += 1;
        userTask.lastCompletionDate = new Date();
        await userTask.save();

        // Award points to user
        const reward = taskDefinition.pointRewardPerCompletion;
        await profileModel.findOneAndUpdate(
            { userId: userId, serverID: serverId },
            { $inc: { balance: reward } },
            { upsert: true }
        );

        return {
            success: true,
            message: `Task completed! You earned ${reward.toLocaleString()} points. (${userTask.completionsThisWeek}/${taskDefinition.maxCompletionsPerWeek} this week)`,
            rewardEarned: reward,
            completions: userTask.completionsThisWeek,
            maxCompletions: taskDefinition.maxCompletionsPerWeek
        };
    } catch (error) {
        console.error('Failed to complete task:', error);
        return {
            success: false,
            message: 'Failed to record task completion. Please try again later.',
            rewardEarned: 0
        };
    }
}

/**
 * Get user's progress for a specific task
 * @param {string} userId - Discord user ID
 * @param {string} serverId - Discord server ID
 * @param {number} taskId - Task ID from globalValues.json
 * @returns {Promise<{completions: number, maxCompletions: number, canComplete: boolean}>}
 */
async function getTaskProgress(userId, serverId, taskId) {
    try {
        const taskDefinition = globalValues.taskInfo?.find(t => t.taskId === taskId);

        if (!taskDefinition) {
            return {
                completions: 0,
                maxCompletions: 0,
                canComplete: false
            };
        }

        const userTask = await taskModel.findOne({
            userId: userId,
            serverID: serverId,
            taskId: taskId
        });

        if (!userTask) {
            return {
                completions: 0,
                maxCompletions: taskDefinition.maxCompletionsPerWeek,
                canComplete: true
            };
        }

        // Check if week has passed
        const weekStart = getWeekStart();
        if (userTask.weekStartDate < weekStart) {
            return {
                completions: 0,
                maxCompletions: taskDefinition.maxCompletionsPerWeek,
                canComplete: true
            };
        }

        return {
            completions: userTask.completionsThisWeek,
            maxCompletions: taskDefinition.maxCompletionsPerWeek,
            canComplete: userTask.completionsThisWeek < taskDefinition.maxCompletionsPerWeek
        };
    } catch (error) {
        console.error('Failed to get task progress:', error);
        return {
            completions: 0,
            maxCompletions: 0,
            canComplete: false
        };
    }
}

module.exports = {
    completeTask,
    getTaskProgress,
    getWeekStart
};
