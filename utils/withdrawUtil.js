const globalWithdrawModel = require('../models/globalWithdrawSchema');
const globalValues = require('../globalValues.json');

/**
 * Get or create the global withdraw tracking document
 * NOTE: This does NOT call reset - that should be done separately
 */
async function getGlobalWithdrawData() {
    // findById with fixed ID ensures we always get the same document
    let data = await globalWithdrawModel.findById('globalWithdraw');
    if (!data) {
        // Create with explicit _id to ensure only one document
        data = await globalWithdrawModel.create({
            _id: 'globalWithdraw',
            totalWithdrawnThisWeek: 0,
            weekStartAt: Date.now(),
            temporaryLimitIncrease: 0
        });
    }
    return data;
}

/**
 * Reset global withdraw tracking if a week has passed
 * Returns true if reset occurred, false otherwise
 */
function resetGlobalWithdrawIfNeeded(globalWithdrawData) {
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;

    if (now - globalWithdrawData.weekStartAt >= oneWeek) {
        console.log('[WithdrawUtil] Resetting global withdraw data - week has passed');
        globalWithdrawData.weekStartAt = now;
        globalWithdrawData.totalWithdrawnThisWeek = 0;
        globalWithdrawData.temporaryLimitIncrease = 0; // Reset temporary increase on new week
        return true; // Reset occurred
    }
    return false; // No reset
}

/**
 * Get the effective withdraw limit for a user (base + custom bonus + job bonuses)
 * @param {Object} profileData - User profile data
 * @param {Object} member - Discord guild member (optional, for job role checking)
 */
function getUserWithdrawLimit(profileData, member = null) {
    const customLimit = profileData.customWithdrawLimit || 0;
    let jobBonusLimit = 0;

    // Calculate total job bonus if member is provided
    if (member) {
        for (const job of globalValues.paidRoleInfo) {
            if (job.extraWithdrawLimit && member.roles.cache.has(job.roleId)) {
                jobBonusLimit += job.extraWithdrawLimit;
            }
        }
    }

    return globalValues.maxWithdrawPerWeek + customLimit + jobBonusLimit;
}

/**
 * Check if a withdrawal amount is allowed
 * @param {number} amount - Amount to withdraw
 * @param {Object} profileData - User profile data
 * @param {Object} member - Discord guild member (optional, for job role checking)
 */
async function canWithdraw(amount, profileData, member = null) {
    // Reset user's weekly withdraw if needed
    resetWeeklyWithdrawIfNeeded(profileData);

    // Check user-specific withdraw limit (base + custom bonus + job bonuses)
    const effectiveUserLimit = getUserWithdrawLimit(profileData, member);
    const userRemaining = effectiveUserLimit - profileData.weeklyWithdrawAmount;

    if (amount > userRemaining) {
        return {
            allowed: false,
            reason: `You have ${userRemaining.toLocaleString()} points remaining in your weekly withdraw limit.`
        };
    }

    // Check global withdraw limit
    const globalWithdrawData = await getGlobalWithdrawData();
    const wasReset = resetGlobalWithdrawIfNeeded(globalWithdrawData);

    // Only save if reset occurred
    if (wasReset) {
        await globalWithdrawData.save();
        console.log('[WithdrawUtil] Global withdraw data was reset and saved');
    }

    // Calculate effective global limit (base + temporary increase)
    const effectiveGlobalLimit = globalValues.maxGlobalWithdrawPerWeek + (globalWithdrawData.temporaryLimitIncrease || 0);
    const globalRemaining = effectiveGlobalLimit - globalWithdrawData.totalWithdrawnThisWeek;

    console.log('[WithdrawUtil] Withdraw check:', {
        userCustomLimit: profileData.customWithdrawLimit || 0,
        effectiveUserLimit,
        userRemaining,
        temporaryLimitIncrease: globalWithdrawData.temporaryLimitIncrease,
        effectiveGlobalLimit,
        globalRemaining,
        requestedAmount: amount
    });

    if (amount > globalRemaining) {
        return {
            allowed: false,
            reason: `The global weekly withdraw limit has ${globalRemaining.toLocaleString()} points remaining.`
        };
    }

    return { allowed: true };
}

/**
 * Reset user's weekly withdraw tracking if a week has passed
 */
function resetWeeklyWithdrawIfNeeded(profileData) {
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;

    if (profileData.firstWithdrawAt > 0 && now - profileData.firstWithdrawAt >= oneWeek) {
        profileData.firstWithdrawAt = 0;
        profileData.weeklyWithdrawAmount = 0;
    }
}

/**
 * Process a withdrawal and update tracking
 */
async function processWithdrawal(amount, profileData) {
    // Update user's weekly withdraw tracking
    if (profileData.firstWithdrawAt === 0) {
        profileData.firstWithdrawAt = Date.now();
    }
    profileData.weeklyWithdrawAmount += amount;

    // Update global weekly withdraw tracking
    const globalWithdrawData = await getGlobalWithdrawData();
    globalWithdrawData.totalWithdrawnThisWeek += amount;
    await globalWithdrawData.save();

    console.log('[WithdrawUtil] Processed withdrawal:', {
        amount,
        newUserTotalWithdrawn: profileData.weeklyWithdrawAmount,
        userCustomLimit: profileData.customWithdrawLimit || 0,
        newGlobalTotalWithdrawn: globalWithdrawData.totalWithdrawnThisWeek,
        temporaryLimitIncrease: globalWithdrawData.temporaryLimitIncrease
    });
}

module.exports = {
    getGlobalWithdrawData,
    resetGlobalWithdrawIfNeeded,
    resetWeeklyWithdrawIfNeeded,
    getUserWithdrawLimit,
    canWithdraw,
    processWithdrawal
};