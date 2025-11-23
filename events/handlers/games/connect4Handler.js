const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const dbUtils = require('../../../utils/dbUtils');
const { createConnect4Image } = require('../../../utils/connect4Canvas');
const { clearChallengeTimeout } = require('./challengeTimeoutHandler');
const { saveActiveGame, removeActiveGame } = require('../../../utils/gameRecovery');

// Initialize global game tracker
if (!global.activeC4Games) {
    global.activeC4Games = new Map();
}

/**
 * Helper function to create Connect 4 board buttons
 */
function createConnect4Board(gameId, board, disabled = false) {
    const rows = [];

    // Column drop buttons - split into 2 rows (4 + 3 columns)
    const columnRow1 = new ActionRowBuilder();
    for (let col = 0; col < 4; col++) {
        columnRow1.addComponents(
            new ButtonBuilder()
                .setCustomId(`c4_move_${col}_${gameId}`)
                .setLabel(`${col + 1}`)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled || board[0][col] !== '')
        );
    }
    rows.push(columnRow1);

    const columnRow2 = new ActionRowBuilder();
    for (let col = 4; col < 7; col++) {
        columnRow2.addComponents(
            new ButtonBuilder()
                .setCustomId(`c4_move_${col}_${gameId}`)
                .setLabel(`${col + 1}`)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled || board[0][col] !== '')
        );
    }

    // Add forfeit button (only if game is active)
    if (!disabled) {
        columnRow2.addComponents(
            new ButtonBuilder()
                .setCustomId(`c4_forfeit_${gameId}`)
                .setLabel('Forfeit')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🏳️')
        );
    }

    rows.push(columnRow2);

    return rows;
}

/**
 * Helper function for board display (legacy, returns empty string now)
 */
function createConnect4BoardDisplay() {
    return '';
}

/**
 * Helper function to check for Connect 4 winner
 */
function checkConnect4Winner(board, lastRow, lastCol) {
    const directions = [
        { dr: 0, dc: 1 },
        { dr: 1, dc: 0 },
        { dr: 1, dc: 1 },
        { dr: 1, dc: -1 }
    ];

    const symbol = board[lastRow][lastCol];
    if (!symbol) {
        return null;
    }

    for (const { dr, dc } of directions) {
        let count = 1;
        let r = lastRow + dr;
        let c = lastCol + dc;

        while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === symbol) {
            count++;
            r += dr;
            c += dc;
        }

        r = lastRow - dr;
        c = lastCol - dc;

        while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === symbol) {
            count++;
            r -= dr;
            c -= dc;
        }

        if (count >= 4) {
            return symbol;
        }
    }

    return null;
}

/**
 * Handles Connect 4 challenge accept/decline
 */
async function handleConnect4Challenge(interaction) {
    const parts = interaction.customId.split('_');
    const action = parts[1];
    const challengerId = parts[2];
    const opponentId = parts[3];
    const betAmount = action === 'accept' ? parseInt(parts[4]) : 0;

    if (interaction.user.id !== opponentId) {
        return await interaction.reply({
            content: '❌ Only the challenged player can respond to this challenge.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Clear the timeout
    clearChallengeTimeout('c4', challengerId, opponentId, interaction.message.id);

    if (action === 'decline') {
        const declineEmbed = new EmbedBuilder()
            .setTitle('🔴 Challenge Declined')
            .setDescription(`<@${opponentId}> declined the Connect 4 challenge.`)
            .setColor(0x95A5A6)
            .setTimestamp();

        await interaction.update({
            embeds: [declineEmbed],
            components: []
        });
        return;
    }

    // Use dbUtils to ensure profiles exist
    const challengerProfile = await dbUtils.ensureProfile(challengerId, interaction.guild.id);
    const opponentProfile = await dbUtils.ensureProfile(opponentId, interaction.guild.id);

    if (challengerProfile.balance < betAmount) {
        await interaction.update({
            content: `❌ Challenge cancelled. <@${challengerId}> no longer has enough points.`,
            embeds: [],
            components: []
        });
        return;
    }

    if (opponentProfile.balance < betAmount) {
        await interaction.update({
            content: `❌ Challenge cancelled. <@${opponentId}> doesn't have enough points.`,
            embeds: [],
            components: []
        });
        return;
    }

    // Deduct bets immediately
    challengerProfile.balance -= betAmount;
    opponentProfile.balance -= betAmount;

    await challengerProfile.save();
    await opponentProfile.save();

    // Trigger balance change events
    try {
        const balanceChangeEvent = require('../../balanceChange');
        const challengerMember = await interaction.guild.members.fetch(challengerId);
        const opponentMember = await interaction.guild.members.fetch(opponentId);
        balanceChangeEvent.execute(challengerMember);
        balanceChangeEvent.execute(opponentMember);
    } catch (err) {
        console.error('Failed to trigger balance change event:', err);
    }

    // Initialize game
    const gameId = `${challengerId}_${opponentId}_${Date.now()}`;

    if (!global.activeC4Games) {
        global.activeC4Games = new Map();
    }

    const gameState = {
        board: Array(6).fill(null).map(() => Array(7).fill('')),
        currentTurn: challengerId,
        redPlayer: challengerId,
        yellowPlayer: opponentId
    };

    global.activeC4Games.set(gameId, {
        challengerId,
        opponentId,
        betAmount,
        board: gameState.board,
        currentTurn: gameState.currentTurn,
        redPlayer: gameState.redPlayer,
        yellowPlayer: gameState.yellowPlayer,
        messageId: interaction.message.id,
        betsDeducted: true
    });

    // Save to database for crash recovery
    await saveActiveGame(
        gameId,
        'c4',
        interaction.guild.id,
        challengerId,
        opponentId,
        betAmount,
        interaction.message.id,
        interaction.channel.id,
        gameState
    );

    // Create board buttons with forfeit option
    const boardButtons = createConnect4Board(gameId, gameState.board, false);

    // Create board image
    const boardImage = createConnect4Image(gameState.board);

    const gameEmbed = new EmbedBuilder()
        .setTitle('🔴 Connect 4')
        .setDescription(`**Current Turn:** <@${challengerId}> (🔴)\n\n*Bets of ${betAmount.toLocaleString()} points have been deducted from both players.*`)
        .addFields(
            { name: '🔴 Red Player', value: `<@${challengerId}>`, inline: true },
            { name: '🟡 Yellow Player', value: `<@${opponentId}>`, inline: true },
            { name: '💰 Prize Pool', value: `${(betAmount * 2).toLocaleString()} points`, inline: true }
        )
        .setColor(0xE74C3C)
        .setImage('attachment://connect4.png')
        .setTimestamp();

    await interaction.update({
        content: `<@${challengerId}> vs <@${opponentId}>`,
        embeds: [gameEmbed],
        files: [{
            attachment: boardImage,
            name: 'connect4.png'
        }],
        components: boardButtons
    });
}

/**
 * Handles Connect 4 move (column drop)
 */
async function handleConnect4Move(interaction) {
    const parts = interaction.customId.split('_');
    const column = parseInt(parts[2]);
    const gameId = parts.slice(3).join('_');

    if (!global.activeC4Games) {
        global.activeC4Games = new Map();
    }

    const game = global.activeC4Games.get(gameId);
    if (!game) {
        return await interaction.reply({
            content: '❌ This game has expired or already finished.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    const { challengerId, opponentId, betAmount, board, currentTurn, redPlayer, yellowPlayer, messageId } = game;

    if (interaction.message.id !== messageId) {
        return await interaction.reply({
            content: '❌ This game belongs to a different message.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (interaction.user.id !== currentTurn) {
        return await interaction.reply({
            content: '❌ It\'s not your turn!',
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Find lowest available row in the column
    let row = -1;
    for (let r = 5; r >= 0; r--) {
        if (board[r][column] === '') {
            row = r;
            break;
        }
    }

    if (row === -1) {
        return await interaction.reply({
            content: '❌ That column is full!',
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Make move
    const symbol = currentTurn === redPlayer ? 'R' : 'Y';
    board[row][column] = symbol;

    // Check for winner
    const winner = checkConnect4Winner(board, row, column);
    const isTie = !winner && board[0].every(cell => cell !== '');

    if (winner || isTie) {
        let winnerId = null;
        if (winner === 'R') {
            winnerId = redPlayer;
        } else if (winner === 'Y') {
            winnerId = yellowPlayer;
        }

        if (winnerId) {
            const winnerProfile = await dbUtils.ensureProfile(winnerId, interaction.guild.id);
            winnerProfile.balance += betAmount * 2;
            await winnerProfile.save();

            try {
                const balanceChangeEvent = require('../../balanceChange');
                const winnerMember = await interaction.guild.members.fetch(winnerId);
                balanceChangeEvent.execute(winnerMember);
            } catch (err) {
                console.error('Failed to trigger balance change event:', err);
            }
        } else {
            // Tie - refund both
            const challengerProfile = await dbUtils.ensureProfile(challengerId, interaction.guild.id);
            const opponentProfile = await dbUtils.ensureProfile(opponentId, interaction.guild.id);

            challengerProfile.balance += betAmount;
            opponentProfile.balance += betAmount;

            await challengerProfile.save();
            await opponentProfile.save();

            try {
                const balanceChangeEvent = require('../../balanceChange');
                const challengerMember = await interaction.guild.members.fetch(challengerId);
                const opponentMember = await interaction.guild.members.fetch(opponentId);
                balanceChangeEvent.execute(challengerMember);
                balanceChangeEvent.execute(opponentMember);
            } catch (err) {
                console.error('Failed to trigger balance change event:', err);
            }
        }

        const resultEmbed = new EmbedBuilder()
            .setTitle('🔴 Connect 4 - Game Over')
            .setDescription(
                winnerId
                    ? `🎉 **<@${winnerId}> wins ${(betAmount * 2).toLocaleString()} points!**`
                    : '🤝 **It\'s a tie!** Bets refunded.'
            )
            .setColor(winnerId ? 0x2ECC71 : 0x95A5A6)
            .setImage('attachment://connect4.png')
            .setTimestamp();

        const finalBoardImage = createConnect4Image(board);
        const disabledButtons = createConnect4Board(gameId, board, true);

        await interaction.update({
            embeds: [resultEmbed],
            files: [{
                attachment: finalBoardImage,
                name: 'connect4.png'
            }],
            components: disabledButtons
        });

        // Log to games channel
        const gamesLogsChannel = interaction.guild.channels.cache.get(process.env.GAMES_LOGS_CHANNEL_ID);
        if (gamesLogsChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('🔴 Connect 4 Game Result')
                .addFields(
                    { name: '🔴 Red Player', value: `<@${redPlayer}>`, inline: true },
                    { name: '🟡 Yellow Player', value: `<@${yellowPlayer}>`, inline: true },
                    { name: 'Result', value: winnerId ? `🎉 <@${winnerId}> wins!` : '🤝 Tie - Bets refunded', inline: false },
                    { name: 'Prize', value: winnerId ? `${(betAmount * 2).toLocaleString()} points` : 'Refunded', inline: true }
                )
                .setColor(winnerId ? 0x2ECC71 : 0x95A5A6)
                .setTimestamp();

            await gamesLogsChannel.send({ embeds: [logEmbed] });
        }

        global.activeC4Games.delete(gameId);
        await removeActiveGame(gameId);
    } else {
        game.currentTurn = currentTurn === challengerId ? opponentId : challengerId;
        const nextSymbol = game.currentTurn === redPlayer ? '🔴' : '🟡';

        const updatedEmbed = new EmbedBuilder()
            .setTitle('🔴 Connect 4')
            .setDescription(`**Current Turn:** <@${game.currentTurn}> (${nextSymbol})`)
            .addFields(
                { name: '🔴 Red Player', value: `<@${redPlayer}>`, inline: true },
                { name: '🟡 Yellow Player', value: `<@${yellowPlayer}>`, inline: true },
                { name: '💰 Prize Pool', value: `${(betAmount * 2).toLocaleString()} points`, inline: true }
            )
            .setColor(0xE74C3C)
            .setImage('attachment://connect4.png')
            .setTimestamp();

        const updatedBoardImage = createConnect4Image(board);
        const updatedButtons = createConnect4Board(gameId, board);

        await interaction.update({
            embeds: [updatedEmbed],
            files: [{
                attachment: updatedBoardImage,
                name: 'connect4.png'
            }],
            components: updatedButtons
        });
    }
}

/**
 * Handles Connect 4 forfeit
 */
async function handleConnect4Forfeit(interaction) {
    const gameId = interaction.customId.replace('c4_forfeit_', '');

    if (!global.activeC4Games) {
        global.activeC4Games = new Map();
    }

    const game = global.activeC4Games.get(gameId);
    if (!game) {
        return await interaction.reply({
            content: '❌ This game has expired or already finished.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    const { challengerId, opponentId, betAmount, redPlayer, yellowPlayer, board } = game;

    if (interaction.user.id !== challengerId && interaction.user.id !== opponentId) {
        return await interaction.reply({
            content: '❌ You are not in this game.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    const loserId = interaction.user.id;
    const winnerId = loserId === challengerId ? opponentId : challengerId;

    // Award winnings to winner
    const winnerProfile = await dbUtils.ensureProfile(winnerId, interaction.guild.id);
    winnerProfile.balance += betAmount * 2;
    await winnerProfile.save();

    // Trigger balance change event
    try {
        const balanceChangeEvent = require('../../balanceChange');
        const winnerMember = await interaction.guild.members.fetch(winnerId);
        balanceChangeEvent.execute(winnerMember);
    } catch (err) {
        console.error('Failed to trigger balance change event:', err);
    }

    const resultEmbed = new EmbedBuilder()
        .setTitle('🏳️ Connect 4 - Forfeit')
        .setDescription(
            `<@${loserId}> has forfeited the game!\n\n` +
            `🎉 <@${winnerId}> wins by forfeit!\n\n` +
            `**Prize:** ${(betAmount * 2).toLocaleString()} points`
        )
        .setColor(0x95A5A6)
        .setImage('attachment://connect4.png')
        .setTimestamp();

    const finalBoardImage = createConnect4Image(board);

    await interaction.update({
        embeds: [resultEmbed],
        files: [{
            attachment: finalBoardImage,
            name: 'connect4.png'
        }],
        components: []
    });

    // Log to games channel
    const gamesLogsChannel = interaction.guild.channels.cache.get(process.env.GAMES_LOGS_CHANNEL_ID);
    if (gamesLogsChannel) {
        const logEmbed = new EmbedBuilder()
            .setTitle('🏳️ Connect 4 - Forfeit')
            .addFields(
                { name: 'Forfeited By', value: `<@${loserId}>`, inline: true },
                { name: 'Winner', value: `<@${winnerId}>`, inline: true },
                { name: 'Prize', value: `${(betAmount * 2).toLocaleString()} points`, inline: true }
            )
            .setColor(0x95A5A6)
            .setTimestamp();

        await gamesLogsChannel.send({ embeds: [logEmbed] });
    }

    global.activeC4Games.delete(gameId);
    await removeActiveGame(gameId);
}

module.exports = {
    handleConnect4Challenge,
    handleConnect4Move,
    handleConnect4Forfeit
};