const profileModel = require('../models/profileSchema');
const { tasks: configuredTasks } = require('../globalValues.json'); // expects "tasks" object in globalValues.json

// 7 days in milliseconds
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Return the configured task by id (or null).
 */
function getTask(taskId) {
    if (!configuredTasks) return null;
    return configuredTasks[taskId] || null;
}

/**
 * Ensure profile exists for the given userId (create if missing).
 */
async function ensureProfile(userId, serverId = null) {
    let profile = await profileModel.findOne({ userId });
    if (!profile) {
        profile = await profileModel.create({
            userId,
            serverID: serverId ?? null,
        });
    }
    return profile;
}

/**
 * Find the task entry inside a profile document (or null).
 */
function findTaskEntry(profile, taskId) {
    if (!profile || !Array.isArray(profile.tasks)) return null;
    return profile.tasks.find((t) => t.taskId === taskId) || null;
}

/**
 * Give a task to a user:
 * - starts or re-starts a 7-day window based on firstCompletionAt
 * - enforces max completions per week
 * - increments completions and adds points to profile.balance
 *
 * Returns object describing result.
 */
async function giveTask(userId, taskId, serverId = null) {
    const task = getTask(taskId);
    if (!task) return { ok: false, reason: 'invalid_task' };

    const profile = await ensureProfile(userId, serverId);
    let entry = findTaskEntry(profile, taskId);

    const now = Date.now();

    if (!entry) {
        entry = {
            taskId,
            completions: 0,
            firstCompletionAt: 0,
        };
        profile.tasks.push(entry);
    } else if (entry.firstCompletionAt && (now - entry.firstCompletionAt) >= WEEK_MS) {
        // weekly window expired -> reset
        entry.completions = 0;
        entry.firstCompletionAt = 0;
    }

    // start new weekly window if needed
    if (!entry.firstCompletionAt) {
        entry.firstCompletionAt = now;
        entry.completions = 0;
    }

    const max = Number(task.maxCompletionsPerWeek ?? 1);
    if (entry.completions >= max) {
        return { ok: false, reason: 'max_reached', current: entry.completions, max };
    }

    // award
    entry.completions += 1;
    const addPoints = Number(task.points ?? 0);
    profile.balance = (profile.balance || 0) + addPoints;

    await profile.save();

    return {
        ok: true,
        addedPoints: addPoints,
        newCount: entry.completions,
        max,
        userBalance: profile.balance,
    };
}

/**
 * Get the number of completions the user has for taskId.
 * If profile is provided it will be used; otherwise we fetch it.
 * Returns 0 if no entry or window expired.
 */
async function getUserTaskCount(userId, taskId, profile = null) {
    let prof = profile;
    if (!prof) prof = await profileModel.findOne({ userId });
    if (!prof) return 0;

    const entry = findTaskEntry(prof, taskId);
    if (!entry || !entry.firstCompletionAt) return 0;
    if ((Date.now() - entry.firstCompletionAt) >= WEEK_MS) return 0;
    return entry.completions || 0;
}

/**
 * Return an array of all configured tasks with user's completion count included.
 * Accepts optional profile param (to skip DB lookup when interactionCreate already provided it).
 * Result element:
 * { taskId, description, points, max, userCount }
 */
async function listTasksForUser(userId, profile = null) {
    const prof = profile || await profileModel.findOne({ userId });
    const list = [];

    for (const [taskId, info] of Object.entries(configuredTasks || {})) {
        let userCount = 0;
        if (prof) {
            const entry = findTaskEntry(prof, taskId);
            if (entry && entry.firstCompletionAt && (Date.now() - entry.firstCompletionAt) < WEEK_MS) {
                userCount = entry.completions || 0;
            }
        }
        list.push({
            taskId,
            description: info.description || '',
            points: Number(info.points ?? 0),
            max: Number(info.maxCompletionsPerWeek ?? 1),
            userCount,
        });
    }

    return list;
}

module.exports = {
    getTask,
    giveTask,
    getUserTaskCount,
    listTasksForUser,
};