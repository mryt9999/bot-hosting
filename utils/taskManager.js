//here create logic for the tasks
const Profile = require('../models/profileSchema');
const globalValues = require('../globalValues.json');

//automatically add all tasks from globalValues to a user's profile if not already present
async function ensureUserTasks(profileData) {
    if (!profileData) return;
    let updated = false;
    for (const taskDef of Object.values(globalValues.taskInfo)) {
        if (!profileData.tasks.some(t => t.taskId === taskDef.taskId)) {
            profileData.tasks.push({
                taskId: taskDef.taskId,
                completions: 0,
                firstCompletionAt: 0,
            });
            updated = true;
        }
    }
    if (updated) {
        await profileData.save();
    }
}

//if firstcompletionAt is older than 7 days, reset completions to 0 and firstCompletionAt to now
function resetWeeklyTaskIfNeeded(taskEntry) {
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    if (now - taskEntry.firstCompletionAt > oneWeekMs) {
        taskEntry.completions = 0;
        taskEntry.firstCompletionAt = now;
    }
}

//add 1 completion to a task for a user profile if under maxWeeklyCompletions, and call resetweekly if needed
async function completeTaskForUser(profileData, taskId) {
    if (!profileData) return false;
    const taskDef = Object.values(globalValues.taskInfo).find(t => t.taskId === taskId);
    if (!taskDef) return false;
    const taskEntry = profileData.tasks.find(t => t.taskId === taskId);
    if (!taskEntry) return false;
    resetWeeklyTaskIfNeeded(taskEntry);
    if (taskEntry.completions < taskDef.maxCompletionsPerWeek) {
        taskEntry.completions += 1;
        await profileData.save();
        return true;
    }
    return false;
}

//get taskId from a task name
function getTaskIdByName(taskName) {
    //add erorr handling for null taskName or if it isnt a string
    if (!taskName || typeof taskName !== 'string') return taskName;
    const taskEntry = Object.values(globalValues.taskInfo).find(t => t.taskName.toLowerCase() === taskName.toLowerCase());
    return taskEntry ? taskEntry.taskId : null;
}

//get users completions for a taskName
function getUserCompletionsForTask(profileData, taskName) {
    if (!profileData) return 0;
    const taskId = getTaskIdByName(taskName);
    if (!taskId) return 0;
    const taskEntry = profileData.tasks.find(t => t.taskId === taskId);
    if (!taskEntry) return 0;
    resetWeeklyTaskIfNeeded(taskEntry);
    return taskEntry.completions;
}




//export the functions
module.exports = {
    ensureUserTasks,
    resetWeeklyTaskIfNeeded,
    completeTaskForUser,
    getTaskIdByName,
    getUserCompletionsForTask,
};