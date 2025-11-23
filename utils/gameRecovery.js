const activeGameModel = require('../models/activeGameSchema');
const dbUtils = require('./dbUtils');

/**
 * Refunds bets from crashed/expired games on bot startup
 */
async function recoverCrashedGames(client) {
    try {
        console.log('Checking for crashed games to recover...');

        const crashedGames = await activeGameModel.find({});

        if (crashedGames.length === 0) {
            console.log('No crashed games found.');
            return;
        }

        console.log(`Found ${crashedGames.length} crashed games. Refunding bets...`);

        for (const game of crashedGames) {
            try {
                // Refund both players
                const challengerProfile = await dbUtils.ensureProfile(game.challengerId, game.serverID);
                const opponentProfile = await dbUtils.ensureProfile(game.opponentId, game.serverID);

                challengerProfile.balance += game.betAmount;
                opponentProfile.balance += game.betAmount;

                await challengerProfile.save();
                await opponentProfile.save();

                // Try to update the message if possible
                try {
                    const guild = client.guilds.cache.get(game.serverID);
                    if (guild) {
                        const channel = guild.channels.cache.get(game.channelId);
                        if (channel) {
                            const message = await channel.messages.fetch(game.messageId);
                            await message.edit({
                                content: '⚠️ **Game Cancelled** - Bot restarted. Bets have been refunded to both players.',
                                components: []
                            });
                        }
                    }
                } catch (msgErr) {
                    console.log(`Could not update message for game ${game.gameId}:`, msgErr.message);
                }

                // Delete the game record
                await activeGameModel.deleteOne({ gameId: game.gameId });

                console.log(`Refunded ${game.betAmount} points to both players in ${game.gameType} game ${game.gameId}`);
            } catch (gameErr) {
                console.error(`Error recovering game ${game.gameId}:`, gameErr);
            }
        }

        console.log('Game recovery completed.');
    } catch (error) {
        console.error('Error in game recovery:', error);
    }
}

/**
 * Saves active game to database
 */
async function saveActiveGame(gameId, gameType, serverID, challengerId, opponentId, betAmount, messageId, channelId, gameState) {
    try {
        await activeGameModel.create({
            gameId,
            gameType,
            serverID,
            challengerId,
            opponentId,
            betAmount,
            messageId,
            channelId,
            gameState
        });
    } catch (error) {
        console.error('Error saving active game:', error);
    }
}

/**
 * Removes active game from database
 */
async function removeActiveGame(gameId) {
    try {
        await activeGameModel.deleteOne({ gameId });
    } catch (error) {
        console.error('Error removing active game:', error);
    }
}

module.exports = {
    recoverCrashedGames,
    saveActiveGame,
    removeActiveGame
};