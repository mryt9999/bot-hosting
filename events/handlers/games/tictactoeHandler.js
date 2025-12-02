const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const dbUtils = require('../../../utils/dbUtils');
const { clearChallengeTimeout } = require('./challengeTimeoutHandler');
const { saveActiveGame, removeActiveGame } = require('../../../utils/gameRecovery');

/**
 * Helper function to create Tic Tac Toe board buttons
 */
function createTTTBoard(gameId, board, disabled = false) {
    const rows = [];
    for (let row = 0; row < 3; row++) {
        const actionRow = new ActionRowBuilder();
        for (let col = 0; col < 3; col++) {
            const position = row * 3 + col;
            const cell = board[position];

            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`ttt_move_${position}_${gameId}`)
                    .setLabel(cell || '⠀')
                    .setStyle(cell === 'X' ? ButtonStyle.Primary : cell === 'O' ? ButtonStyle.Danger : ButtonStyle.Secondary)
                    .setDisabled(disabled || cell !== '')
            );
        }
        rows.push(actionRow);
    }

    // Add forfeit button if game is active
    if (!disabled) {
        const forfeitRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ttt_forfeit_${gameId}`)
                .setLabel('Forfeit')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🏳️')
        );
        rows.push(forfeitRow);
    }

    return rows;
}

/**
 * Helper function to check for Tic Tac Toe winner
 */
function checkTTTWinner(board) {
    const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
        [0, 4, 8], [2, 4, 6] // Diagonals
    ];

    for (const pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }

    if (board.every(cell => cell !== '')) {
        return 'tie';
    }

    return null;
}

/**
 * Handles Tic Tac Toe challenge accept/decline
 */
async function handleTTTChallenge(interaction) {
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
    clearChallengeTimeout('ttt', challengerId, opponentId, interaction.message.id);

    if (action === 'decline') {
        const declineEmbed = new EmbedBuilder()
            .setTitle('❌ Challenge Declined')
            .setDescription(`<@${opponentId}> declined the Tic Tac Toe challenge.`)
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

    if (betAmount > 0) {
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

        // Deduct bets
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
    }

    // Initialize game
    const gameId = `${challengerId}_${opponentId}_${Date.now()}`;

    if (!global.activeTTTGames) {
        global.activeTTTGames = new Map();
    }

    const gameState = {
        board: Array(9).fill(''),
        currentTurn: challengerId,
        xPlayer: challengerId,
        oPlayer: opponentId
    };

    global.activeTTTGames.set(gameId, {
        challengerId,
        opponentId,
        betAmount,
        board: gameState.board,
        currentTurn: gameState.currentTurn,
        xPlayer: gameState.xPlayer,
        oPlayer: gameState.oPlayer,
        messageId: interaction.message.id,
        betsDeducted: true
    });

    // Save to database for crash recovery
    await saveActiveGame(
        gameId,
        'ttt',
        interaction.guild.id,
        challengerId,
        opponentId,
        betAmount,
        interaction.message.id,
        interaction.channel.id,
        gameState
    );

    const boardButtons = createTTTBoard(gameId, gameState.board);

    const gameEmbed = new EmbedBuilder()
        .setTitle('❌ Tic Tac Toe')
        .setDescription(`**Current Turn:** <@${challengerId}> (❌)\n\n*Bets of ${betAmount.toLocaleString()} points have been deducted from both players.*`)
        .addFields(
            { name: '❌ X Player', value: `<@${challengerId}>`, inline: true },
            { name: '⭕ O Player', value: `<@${opponentId}>`, inline: true },
            { name: '💰 Prize Pool', value: `${(betAmount * 2).toLocaleString()} points`, inline: true }
        )
        .setColor(0x3498DB)
        .setTimestamp();

    await interaction.update({
        content: `<@${challengerId}> vs <@${opponentId}>`,
        embeds: [gameEmbed],
        components: boardButtons
    });
}

/**
 * Handles Tic Tac Toe move
 */
async function handleTTTMove(interaction) {
    const parts = interaction.customId.split('_');
    const position = parseInt(parts[2]);
    const gameId = parts.slice(3).join('_');

    if (!global.activeTTTGames) {
        global.activeTTTGames = new Map();
    }

    const game = global.activeTTTGames.get(gameId);
    if (!game) {
        return await interaction.reply({
            content: '❌ This game has expired or already finished.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    const { challengerId, opponentId, betAmount, board, currentTurn, xPlayer, oPlayer, messageId } = game;

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

    if (board[position] !== '') {
        return await interaction.reply({
            content: '❌ That position is already taken!',
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Make move
    const symbol = currentTurn === xPlayer ? 'X' : 'O';
    board[position] = symbol;

    // Check for winner
    const result = checkTTTWinner(board);

    if (result) {
        let winnerId = null;
        if (result === 'X') {
            winnerId = xPlayer;
        } else if (result === 'O') {
            winnerId = oPlayer;
        }

        // Update balances
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
            // Tie - refund bets
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

        // Create result embed
        const resultEmbed = new EmbedBuilder()
            .setTitle('❌ Tic Tac Toe - Results')
            .setDescription(
                winnerId
                    ? `# 🎉 **<@${winnerId}> wins ${(betAmount * 2).toLocaleString()} points!**`
                    : '# 🤝 **It\'s a tie!** Bets refunded.'
            )
            .setColor(winnerId ? 0x2ECC71 : 0x95A5A6)
            .setTimestamp();

        const finalBoard = createTTTBoard(gameId, board, true);

        await interaction.update({
            embeds: [resultEmbed],
            components: finalBoard
        });

        // Log to games channel
        const gamesLogsChannel = interaction.guild.channels.cache.get(process.env.GAMES_LOGS_CHANNEL_ID);
        if (gamesLogsChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('❌ Tic Tac Toe Game Result')
                .addFields(
                    { name: '❌ X Player', value: `<@${xPlayer}>`, inline: true },
                    { name: '⭕ O Player', value: `<@${oPlayer}>`, inline: true },
                    { name: 'Result', value: winnerId ? `🎉 <@${winnerId}> wins!` : '🤝 Tie - Bets refunded', inline: false },
                    { name: 'Prize', value: winnerId ? `${(betAmount * 2).toLocaleString()} points` : 'Refunded', inline: true }
                )
                .setColor(winnerId ? 0x2ECC71 : 0x95A5A6)
                .setTimestamp();

            await gamesLogsChannel.send({ embeds: [logEmbed] });
        }

        global.activeTTTGames.delete(gameId);
        await removeActiveGame(gameId);
    } else {
        // Continue game
        game.currentTurn = currentTurn === challengerId ? opponentId : challengerId;
        const nextSymbol = game.currentTurn === xPlayer ? '❌' : '⭕';

        const updatedEmbed = new EmbedBuilder()
            .setTitle('❌ Tic Tac Toe')
            .setDescription(`**Current Turn:** <@${game.currentTurn}> (${nextSymbol})`)
            .addFields(
                { name: '❌ X Player', value: `<@${xPlayer}>`, inline: true },
                { name: '⭕ O Player', value: `<@${oPlayer}>`, inline: true },
                { name: '💰 Prize Pool', value: `${(betAmount * 2).toLocaleString()} points`, inline: true }
            )
            .setColor(0x3498DB)
            .setTimestamp();

        const updatedBoard = createTTTBoard(gameId, board);

        await interaction.update({
            embeds: [updatedEmbed],
            components: updatedBoard
        });
    }
}

/**
 * Handles Tic Tac Toe forfeit
 */
async function handleTTTForfeit(interaction) {
    const gameId = interaction.customId.replace('ttt_forfeit_', '');

    if (!global.activeTTTGames) {
        global.activeTTTGames = new Map();
    }

    const game = global.activeTTTGames.get(gameId);
    if (!game) {
        return await interaction.reply({
            content: '❌ This game has expired or already finished.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    const { challengerId, opponentId, betAmount, board } = game;

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
        .setTitle('🏳️ Tic Tac Toe - Forfeit')
        .setDescription(
            `<@${loserId}> has forfeited the game!\n\n` +
            `# 🎉 <@${winnerId}> wins by forfeit!\n\n` +
            `**Prize:** ${(betAmount * 2).toLocaleString()} points`
        )
        .setColor(0x95A5A6)
        .setTimestamp();

    const finalBoard = createTTTBoard(gameId, board, true);

    await interaction.update({
        embeds: [resultEmbed],
        components: finalBoard
    });

    // Log to games channel
    const gamesLogsChannel = interaction.guild.channels.cache.get(process.env.GAMES_LOGS_CHANNEL_ID);
    if (gamesLogsChannel) {
        const logEmbed = new EmbedBuilder()
            .setTitle('🏳️ Tic Tac Toe - Forfeit')
            .addFields(
                { name: 'Forfeited By', value: `<@${loserId}>`, inline: true },
                { name: 'Winner', value: `<@${winnerId}>`, inline: true },
                { name: 'Prize', value: `${(betAmount * 2).toLocaleString()} points`, inline: true }
            )
            .setColor(0x95A5A6)
            .setTimestamp();

        await gamesLogsChannel.send({ embeds: [logEmbed] });
    }

    global.activeTTTGames.delete(gameId);
    await removeActiveGame(gameId);
}

module.exports = {
    handleTTTChallenge,
    handleTTTMove,
    handleTTTForfeit
};