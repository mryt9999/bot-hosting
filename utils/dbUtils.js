// Database utility functions for safe operations with transactions and fallbacks

const mongoose = require('mongoose');
const profileModel = require('../models/profileSchema');

/**
 * Ensure a profile exists for a user, creating one if it doesn't exist
 * @param {string} userId - Discord user ID
 * @param {string|null} serverId - Discord server ID (optional)
 * @param {Object|null} session - Mongoose session for transactions (optional)
 * @returns {Promise<Object>} The user's profile document
 */
async function ensureProfile(userId, serverId = null, session = null) {
    // Try to find existing profile first
    let profile = await profileModel.findOne({ userId }).session(session || null);
    if (!profile) {
        // Create new profile if it doesn't exist
        profile = await profileModel.create([{ userId, serverId }], { session }).then(arr => arr[0]);
    }
    return profile;
}

/**
 * Transfer points from one user to another atomically
 * Uses MongoDB transactions when available, falls back to conditional updates
 * @param {string} senderId - Discord user ID of sender
 * @param {string} receiverId - Discord user ID of receiver
 * @param {number} amount - Amount of points to transfer (must be positive)
 * @returns {Promise<Object>} Result object with success status and data
 * @returns {boolean} result.success - Whether the transfer succeeded
 * @returns {string} result.reason - Reason for failure (if applicable)
 * @returns {Object} result.sender - Updated sender profile (if successful)
 * @returns {Object} result.receiver - Updated receiver profile (if successful)
 * @returns {Error} result.error - Error object (if db_error)
 */
async function transferPoints(senderId, receiverId, amount) {
    if (amount <= 0) {
        return { success: false, reason: 'invalid_amount' };
    }

    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        // Decrement sender only if they have enough balance
        const sender = await profileModel.findOneAndUpdate(
            { userId: senderId, balance: { $gte: amount } },
            { $inc: { balance: -amount } },
            { new: true, session }
        );

        if (!sender) {
            await session.abortTransaction();
            return { success: false, reason: 'insufficient_funds' };
        }

        // Ensure receiver exists and increment their balance
        const receiver = await profileModel.findOneAndUpdate(
            { userId: receiverId },
            { $inc: { balance: amount }, $setOnInsert: { serverId: null } },
            { new: true, upsert: true, session }
        );

        await session.commitTransaction();
        return { success: true, sender, receiver };
    } catch (err) {
        try {
            await session.abortTransaction();
        } catch (e) {
            // Ignore abort errors
        }

        // Fallback: If transactions aren't supported, use a safer 2-step approach
        // 1) Atomic decrement with conditional filter
        // 2) Increment receiver
        try {
            const fallbackSender = await profileModel.findOneAndUpdate(
                { userId: senderId, balance: { $gte: amount } },
                { $inc: { balance: -amount } },
                { new: true }
            );
            if (!fallbackSender) {
                return { success: false, reason: 'insufficient_funds' };
            }

            const fallbackReceiver = await profileModel.findOneAndUpdate(
                { userId: receiverId },
                { $inc: { balance: amount }, $setOnInsert: { serverId: null } },
                { new: true, upsert: true }
            );

            return { success: true, sender: fallbackSender, receiver: fallbackReceiver };
        } catch (e) {
            return { success: false, reason: 'db_error', error: e };
        }
    } finally {
        session.endSession();
    }
}

module.exports = {
    transferPoints,
    ensureProfile,
};
