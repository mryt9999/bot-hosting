// Database utility functions for safe operations with transactions and fallbacks

const mongoose = require('mongoose');
const profileModel = require('../models/profileSchema');
const balanceChangeEvent = require('../events/balanceChange');

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
 * Automatically fires balance change events for both sender and receiver
 * @param {string} senderId - Discord user ID of sender
 * @param {string} receiverId - Discord user ID of receiver
 * @param {number} amount - Amount of points to transfer (must be positive)
 * @param {Object} context - Context object containing either interaction or client (optional)
 * @param {Object} context.interaction - Discord interaction object (optional)
 * @param {Object} context.client - Discord client object (optional)
 * @returns {Promise<Object>} Result object with success status and data
 * @returns {boolean} result.success - Whether the transfer succeeded
 * @returns {string} result.reason - Reason for failure (if applicable)
 * @returns {Object} result.sender - Updated sender profile (if successful)
 * @returns {Object} result.receiver - Updated receiver profile (if successful)
 * @returns {Error} result.error - Error object (if db_error)
 */
async function transferPoints(senderId, receiverId, amount, context = {}) {
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

        // Fire balance change events for both users
        try {
            await fireBalanceChangeEvent(senderId, context);
            await fireBalanceChangeEvent(receiverId, context);
        } catch (error) {
            console.error('Failed to fire balance change events after transfer:', error);
            // Don't fail the transfer if event firing fails
        }

        return { success: true, sender, receiver };
    } catch (_err) {
        try {
            await session.abortTransaction();
        } catch (_e) {
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

            // Fire balance change events for both users
            try {
                await fireBalanceChangeEvent(senderId, context);
                await fireBalanceChangeEvent(receiverId, context);
            } catch (error) {
                console.error('Failed to fire balance change events after fallback transfer:', error);
            }

            return { success: true, sender: fallbackSender, receiver: fallbackReceiver };
        } catch (e) {
            return { success: false, reason: 'db_error', error: e };
        }
    } finally {
        session.endSession();
    }
}

/**
 * Update a user's balance and automatically fire balance change events
 * @param {string} userId - Discord user ID
 * @param {number} amount - Amount to change balance by (positive or negative)
 * @param {Object} context - Context object containing either interaction or client
 * @param {Object} context.interaction - Discord interaction object (optional)
 * @param {Object} context.client - Discord client object (optional)
 * @param {Object} options - Additional options
 * @param {string|null} options.serverId - Discord server ID (optional, for profile creation)
 * @param {boolean} options.checkBalance - Whether to check if user has sufficient balance for negative amounts (default: true)
 * @param {Object|null} options.session - Mongoose session for transactions (optional)
 * @param {boolean} options.skipBalanceEvent - Skip firing balance change event (default: false)
 * @returns {Promise<Object>} Result object with success status and data
 * @returns {boolean} result.success - Whether the update succeeded
 * @returns {string} result.reason - Reason for failure (if applicable)
 * @returns {Object} result.profile - Updated profile (if successful)
 * @returns {number} result.newBalance - New balance after update (if successful)
 * @returns {Error} result.error - Error object (if db_error)
 */
async function updateBalance(userId, amount, context = {}, options = {}) {
    const {
        serverId = null,
        checkBalance = true,
        session = null,
        skipBalanceEvent = false
    } = options;

    if (typeof amount !== 'number' || isNaN(amount)) {
        return { success: false, reason: 'invalid_amount' };
    }

    try {
        // Build the update query
        const query = { userId };
        const update = {
            $inc: { balance: amount },
            $setOnInsert: { serverId }
        };

        // If checkBalance is true and amount is negative, ensure user has enough balance
        if (checkBalance && amount < 0) {
            query.balance = { $gte: Math.abs(amount) };
        }

        const profile = await profileModel.findOneAndUpdate(
            query,
            update,
            { new: true, upsert: true, session }
        );

        if (!profile) {
            return { success: false, reason: 'insufficient_funds' };
        }

        // Fire balance change event if not skipped
        if (!skipBalanceEvent) {
            try {
                await fireBalanceChangeEvent(userId, context);
            } catch (error) {
                console.error(`Failed to fire balance change event for userId: ${userId}`, error);
                // Don't fail the whole operation if event firing fails
            }
        }

        return {
            success: true,
            profile,
            newBalance: profile.balance
        };
    } catch (error) {
        console.error('Error updating balance:', error);
        return { success: false, reason: 'db_error', error };
    }
}

/**
 * Set a user's balance to a specific value and fire balance change events
 * @param {string} userId - Discord user ID
 * @param {number} newBalance - New balance value
 * @param {Object} context - Context object containing either interaction or client
 * @param {Object} options - Additional options
 * @param {string|null} options.serverId - Discord server ID (optional, for profile creation)
 * @param {Object|null} options.session - Mongoose session for transactions (optional)
 * @param {boolean} options.skipBalanceEvent - Skip firing balance change event (default: false)
 * @returns {Promise<Object>} Result object with success status and data
 */
async function setBalance(userId, newBalance, context = {}, options = {}) {
    const {
        serverId = null,
        session = null,
        skipBalanceEvent = false
    } = options;

    if (typeof newBalance !== 'number' || isNaN(newBalance) || newBalance < 0) {
        return { success: false, reason: 'invalid_balance' };
    }

    try {
        const profile = await profileModel.findOneAndUpdate(
            { userId },
            {
                $set: { balance: newBalance },
                $setOnInsert: { serverId }
            },
            { new: true, upsert: true, session }
        );

        // Fire balance change event if not skipped
        if (!skipBalanceEvent) {
            try {
                await fireBalanceChangeEvent(userId, context);
            } catch (error) {
                console.error(`Failed to fire balance change event for userId: ${userId}`, error);
            }
        }

        return {
            success: true,
            profile,
            newBalance: profile.balance
        };
    } catch (error) {
        console.error('Error setting balance:', error);
        return { success: false, reason: 'db_error', error };
    }
}

/**
 * Fire balance change event for a user
 * @param {string} userId - Discord user ID
 * @param {Object} context - Context object containing either interaction or client
 * @param {Object} context.interaction - Discord interaction object (optional)
 * @param {Object} context.client - Discord client object (optional)
 * @returns {Promise<void>}
 */
async function fireBalanceChangeEvent(userId, context = {}) {
    const { interaction, client } = context;

    let member = null;
    let guild = null;

    // Try to get guild from interaction or client
    if (interaction?.guild) {
        guild = interaction.guild;
    } else if (client?.guilds) {
        // Get the first guild where the bot is present (fallback)
        guild = client.guilds.cache.first();
    }

    if (!guild) {
        console.warn(`Cannot fire balance change event for userId ${userId}: no guild found`);
        return;
    }

    // Fetch the member
    try {
        member = await guild.members.fetch(userId);
    } catch (error) {
        console.error(`Failed to fetch member for balance change event (userId: ${userId}):`, error);
        return;
    }

    if (member) {
        await balanceChangeEvent.execute(member);
    }
}

module.exports = {
    transferPoints,
    ensureProfile,
    updateBalance,
    setBalance,
    fireBalanceChangeEvent
};
