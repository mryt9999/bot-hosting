// New helper utilities for safe DB operations (transactions + fallbacks)

const mongoose = require('mongoose');
const profileModel = require('../models/profileSchema');

/**
 * Ensure profile exists for a user (create if missing).
 */
async function ensureProfile(userId, serverID = null, session = null) {
    // upsert pattern: try findOne, then create if missing
    let profile = await profileModel.findOne({ userId }).session(session || null);
    if (!profile) {
        profile = await profileModel.create([{ userId, serverID }], { session }).then(arr => arr[0]);
    }
    return profile;
}

/**
 * Transfer points from sender to receiver atomically if possible.
 * Returns { success: boolean, reason?: string, sender?, receiver?, error? }
 */
async function transferPoints(senderId, receiverId, amount) {
    if (amount <= 0) return { success: false, reason: 'invalid_amount' };
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        // decrement sender only if they have enough balance
        const sender = await profileModel.findOneAndUpdate(
            { userId: senderId, balance: { $gte: amount } },
            { $inc: { balance: -amount } },
            { new: true, session }
        );

        if (!sender) {
            await session.abortTransaction();
            return { success: false, reason: 'insufficient_funds' };
        }

        // ensure receiver exists and increment
        const receiver = await profileModel.findOneAndUpdate(
            { userId: receiverId },
            { $inc: { balance: amount }, $setOnInsert: { serverID: null } },
            { new: true, upsert: true, session }
        );

        await session.commitTransaction();
        return { success: true, sender, receiver };
    } catch (err) {
        try {
            await session.abortTransaction();
        } catch (e) {
            // ignore
        }
        // Fallback: if transactions aren't supported, we try a safer 2-step approach:
        // 1) atomic decrement with conditional filter
        // 2) increment receiver
        try {
            const fallbackSender = await profileModel.findOneAndUpdate(
                { userId: senderId, balance: { $gte: amount } },
                { $inc: { balance: -amount } },
                { new: true }
            );
            if (!fallbackSender) return { success: false, reason: 'insufficient_funds' };

            const fallbackReceiver = await profileModel.findOneAndUpdate(
                { userId: receiverId },
                { $inc: { balance: amount }, $setOnInsert: { serverID: null } },
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
