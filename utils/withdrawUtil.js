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
                temporaryLimitIncrease: 0,
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
function resetGlobalWithdrawIfNeeded(globalWithdrawData) {
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;

    if (now - globalWithdrawData.weekStartAt >= oneWeek) {
        globalWithdrawData.weekStartAt = now;
        globalWithdrawData.totalWithdrawnThisWeek = 0;
        globalWithdrawData.temporaryLimitIncrease = 0; // Reset temporary increase on new week
    }
}

/**
 * Check if a withdrawal amount is allowed
 * @param {number} amount - Amount to withdraw
 * @param {Object} userProfile - User's profile document
 * @returns {Object} - { allowed: boolean, reason: string }
 */
async function canWithdraw(amount, profileData) {
    // Reset user's weekly withdraw if needed
    resetGlobalWithdrawIfNeeded(profileData);

    // Check user-specific withdraw limit
    const userRemaining = globalValues.maxWithdrawPerWeek - profileData.weeklyWithdrawAmount;
    if (amount > userRemaining) {
        return {
            allowed: false,
            reason: `You have ${userRemaining.toLocaleString()} points remaining in your weekly withdraw limit.`
        };
    }

    // Check global withdraw limit
    const globalWithdrawData = await getGlobalWithdrawData();
    resetGlobalWithdrawIfNeeded(globalWithdrawData);

    // Calculate effective global limit (base + temporary increase)
    const effectiveGlobalLimit = globalValues.maxGlobalWithdrawPerWeek + globalWithdrawData.temporaryLimitIncrease;
    const globalRemaining = effectiveGlobalLimit - globalWithdrawData.totalWithdrawnThisWeek;

    if (amount > globalRemaining) {
        return {
            allowed: false,
            reason: `The global weekly withdraw limit has ${globalRemaining.toLocaleString()} points remaining.`
        };
    }

    return { allowed: true };
}


// ...existing code...

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
    // if total withdrawn exceeds max, reduce temporary limit increase
    if (globalData.totalWithdrawnThisWeek > globalValues.maxGlobalWithdrawPerWeek) {
        globalData.temporaryLimitIncrease -= (globalData.totalWithdrawnThisWeek - globalValues.maxGlobalWithdrawPerWeek);
        if (globalData.temporaryLimitIncrease < 0) {
            globalData.temporaryLimitIncrease = 0;
        }
    }

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