const globalWithdrawModel = require('../models/globalWithdrawSchema');
const globalValues = require('../globalValues.json');

/**
 * Get or create the global withdraw tracking document
 * Uses a singleton pattern with a fixed _id
 */
async function getGlobalWithdrawData() {
    try {
        // Use a simple string as the fixed ID (not ObjectId)
        const GLOBAL_ID = 'globalWithdraw';

        let globalData = await globalWithdrawModel.findOne({ _id: GLOBAL_ID });

        if (!globalData) {
            globalData = await globalWithdrawModel.create({
                _id: GLOBAL_ID,
                totalWithdrawnThisWeek: 0,
                weekStartAt: Date.now()
            });
        }

        return globalData;
    } catch (error) {
        console.error('Error getting global withdraw data:', error);
        throw error;
    }
}

/**
 * Reset global withdraw amount if a week has passed
 * @param {Object} globalData - The global withdraw document
 */
function resetGlobalWithdrawIfNeeded(globalData) {
    const now = Date.now();
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    if (!globalData.weekStartAt || now - globalData.weekStartAt >= oneWeekMs) {
        globalData.totalWithdrawnThisWeek = 0;
        globalData.weekStartAt = now;
    }
}

/**
 * Check if a withdrawal amount is allowed
 * @param {number} amount - Amount to withdraw
 * @param {Object} userProfile - User's profile document
 * @returns {Object} - { allowed: boolean, reason: string }
 */
async function canWithdraw(amount, userProfile) {
    // Reset user's weekly withdraw if needed
    const now = Date.now();
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    if (userProfile.firstWithdrawAt === 0 || now - userProfile.firstWithdrawAt >= oneWeekMs) {
        userProfile.weeklyWithdrawAmount = 0;
        userProfile.firstWithdrawAt = now;
    }

    // Check user's weekly limit
    if (userProfile.weeklyWithdrawAmount + amount > globalValues.maxWithdrawPerWeek) {
        const remaining = globalValues.maxWithdrawPerWeek - userProfile.weeklyWithdrawAmount;
        return {
            allowed: false,
            reason: `You can only withdraw ${remaining.toLocaleString()} more points this week. Your weekly limit is ${globalValues.maxWithdrawPerWeek.toLocaleString()} points.`
        };
    }

    // Get and check global limit
    const globalData = await getGlobalWithdrawData();
    resetGlobalWithdrawIfNeeded(globalData);

    if (globalData.totalWithdrawnThisWeek + amount > globalValues.maxGlobalWithdrawPerWeek) {
        const remaining = globalValues.maxGlobalWithdrawPerWeek - globalData.totalWithdrawnThisWeek;
        return {
            allowed: false,
            reason: `The global weekly withdraw limit has been reached. Only ${remaining.toLocaleString()} points can be withdrawn globally this week.`
        };
    }

    return { allowed: true, reason: null };
}

/**
 * Process a withdrawal (updates both user and global counters)
 * @param {number} amount - Amount to withdraw
 * @param {Object} userProfile - User's profile document
 */
async function processWithdrawal(amount, userProfile) {
    // Update user's withdraw tracking
    if (userProfile.firstWithdrawAt === 0) {
        userProfile.firstWithdrawAt = Date.now();
    }
    userProfile.weeklyWithdrawAmount += amount;

    // Update global withdraw tracking
    const globalData = await getGlobalWithdrawData();
    resetGlobalWithdrawIfNeeded(globalData);
    globalData.totalWithdrawnThisWeek += amount;

    // Save both documents
    await userProfile.save();
    await globalData.save();
}

module.exports = {
    getGlobalWithdrawData,
    resetGlobalWithdrawIfNeeded,
    canWithdraw,
    processWithdrawal
};