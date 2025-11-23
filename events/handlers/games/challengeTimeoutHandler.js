const { EmbedBuilder } = require('discord.js');

// Initialize global pending challenges tracker
if (!global.pendingGameChallenges) {
    global.pendingGameChallenges = new Map();
}

/**
 * Creates a challenge with a 1-minute timeout
 * @param {Message} message - The challenge message
 * @param {string} gameType - Type of game (c4, rps, ttt)
 * @param {string} challengerId - The challenger's user ID
 * @param {string} opponentId - The opponent's user ID
 */
function startChallengeTimeout(message, gameType, challengerId, opponentId) {
    const challengeKey = `${gameType}_${challengerId}_${opponentId}_${message.id}`;

    // Clear any existing timeout for this challenge
    if (global.pendingGameChallenges.has(challengeKey)) {
        clearTimeout(global.pendingGameChallenges.get(challengeKey));
    }

    // Set 1-minute timeout
    const timeout = setTimeout(async () => {
        try {
            const gameNames = {
                c4: 'Connect 4',
                rps: 'Rock Paper Scissors',
                ttt: 'Tic Tac Toe'
            };

            const expiredEmbed = new EmbedBuilder()
                .setTitle('⏱️ Challenge Expired')
                .setDescription(`The ${gameNames[gameType] || 'game'} challenge from <@${challengerId}> to <@${opponentId}> has expired (60 seconds).`)
                .setColor(0x95A5A6)
                .setTimestamp();

            await message.edit({
                embeds: [expiredEmbed],
                components: []
            });

            global.pendingGameChallenges.delete(challengeKey);
        } catch (error) {
            console.error('Error handling challenge timeout:', error);
            global.pendingGameChallenges.delete(challengeKey);
        }
    }, 60000); // 1 minute = 60000ms

    global.pendingGameChallenges.set(challengeKey, timeout);
}

/**
 * Clears a challenge timeout when accepted/declined
 * @param {string} gameType - Type of game (c4, rps, ttt)
 * @param {string} challengerId - The challenger's user ID
 * @param {string} opponentId - The opponent's user ID
 * @param {string} messageId - The message ID
 */
function clearChallengeTimeout(gameType, challengerId, opponentId, messageId) {
    const challengeKey = `${gameType}_${challengerId}_${opponentId}_${messageId}`;

    if (global.pendingGameChallenges.has(challengeKey)) {
        clearTimeout(global.pendingGameChallenges.get(challengeKey));
        global.pendingGameChallenges.delete(challengeKey);
    }
}

/**
 * Clears all timeouts for a specific game type (useful for cleanup)
 * @param {string} gameType - Type of game (c4, rps, ttt)
 */
function clearAllGameTimeouts(gameType) {
    const keysToDelete = [];

    for (const [key, timeout] of global.pendingGameChallenges.entries()) {
        if (key.startsWith(`${gameType}_`)) {
            clearTimeout(timeout);
            keysToDelete.push(key);
        }
    }

    keysToDelete.forEach(key => global.pendingGameChallenges.delete(key));
}

module.exports = {
    startChallengeTimeout,
    clearChallengeTimeout,
    clearAllGameTimeouts
};