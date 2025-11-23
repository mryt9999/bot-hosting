const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const profileModel = require('../../../models/profileSchema');

// Initialize global game tracker
if (!global.activeTTTGames) {
    global.activeTTTGames = new Map();
}

/**
 * Helper function to create Tic Tac Toe board buttons
 */
function createTicTacToeBoard(gameId, board, disabled = false) {
    const rows = [];

    // Create 3x3 grid
    for (let row = 0; row < 3; row++) {
        const actionRow = new ActionRowBuilder();
        for (let col = 0; col < 3; col++) {
            const index = row * 3 + col;
            const cell = board[index];

            let emoji = '⬜';
            let style = ButtonStyle.Secondary;

            if (cell === 'X') {
                emoji = '❌';
                style = ButtonStyle.Primary;
            } else if (cell === 'O') {
                emoji = '⭕';
                style = ButtonStyle.Danger;
            }

            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`ttt_move_${index}_${gameId}`)
                    .setEmoji(emoji)
                    .setStyle(style)
                    .setDisabled(disabled || cell !== '')
            );
        }
        rows.push(actionRow);
    }

    // Add forfeit button row (only if game is active)
    if (!disabled) {
        const forfeitRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ttt_forfeit_${gameId}`)
                .setLabel('Forfeit Game')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🏳️')
        );
        rows.push(forfeitRow);
    }

    return rows;
}

/**
 * Helper function to check for winner
 */
function checkTicTacToeWinner(board) {
    const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
        [0, 4, 8], [2, 4, 6]             // Diagonals
    ];

    for (const pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a]; // Returns 'X' or 'O'
        }
    }

    return null; // No winner yet
}

/**
 * Handles Tic Tac Toe challenge accept/decline
 */
async function handleTicTacToeChallenge(interaction) {
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

    if (action === 'decline') {
        const declineEmbed = new EmbedBuilder()
            .setTitle('⭕ Challenge Declined')
            .setDescription(`<@${opponentId}> declined the Tic Tac Toe challenge.`)
            .setColor(0x95A5A6)
            .setTimestamp();

        await interaction.update({
            embeds: [declineEmbed],
            components: []
        });
        return;
    }

    // Verify balances and ensure profiles exist
    let challengerProfile = await profileModel.findOne({
        userId: challengerId,
        serverID: interaction.guild.id
    });
    let opponentProfile = await profileModel.findOne({
        userId: opponentId,
        serverID: interaction.guild.id
    });

    // Create profiles if they don't exist
    if (!challengerProfile) {
        challengerProfile = await profileModel.create({
            userId: challengerId,
            serverID: interaction.guild.id,
            balance: 100
        });
    }

    if (!opponentProfile) {
        opponentProfile = await profileModel.create({
            userId: opponentId,
            serverID: interaction.guild.id,
            balance: 100
        });
    }

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

    // OPTION 1: Deduct bets immediately
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

    if (!global.activeTTTGames) {
        global.activeTTTGames = new Map();
    }

    global.activeTTTGames.set(gameId, {
        challengerId,
        opponentId,
        betAmount,
        board: ['', '', '', '', '', '', '', '', ''],
        currentTurn: challengerId,
        xPlayer: challengerId,
        oPlayer: opponentId,
        messageId: interaction.message.id,
        betsDeducted: true
    });

    // Create game board with forfeit option
    const boardButtons = createTicTacToeBoard(gameId, global.activeTTTGames.get(gameId).board, false);

    const gameEmbed = new EmbedBuilder()
        .setTitle('⭕ Tic Tac Toe')
        .setDescription(`**Current Turn:** <@${challengerId}> (X)\n\n*Bets of ${betAmount.toLocaleString()} points have been deducted from both players.*`)
        .addFields(
            { name: 'X Player', value: `<@${challengerId}>`, inline: true },
            { name: 'O Player', value: `<@${opponentId}>`, inline: true },
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
async function handleTicTacToeMove(interaction) {
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

    // Verify correct message
    if (interaction.message.id !== messageId) {
        return await interaction.reply({
            content: '❌ This game belongs to a different message.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Verify it's the player's turn
    if (interaction.user.id !== currentTurn) {
        return await interaction.reply({
            content: '❌ It\'s not your turn!',
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Verify position is empty
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
    const winner = checkTicTacToeWinner(board);
    const isTie = !winner && board.every(cell => cell !== '');

    if (winner || isTie) {
        // Game over - ADD winnings instead of deducting
        if (winner) {
            // winner is 'X' or 'O', need to get the actual user ID
            const winnerId = winner === 'X' ? xPlayer : oPlayer;

            const winnerProfile = await profileModel.findOne({
                userId: winnerId,
                serverID: interaction.guild.id
            });

            if (!winnerProfile) {
                console.error(`Winner profile not found for user ${winnerId}`);
                return await interaction.reply({
                    content: '❌ An error occurred while processing the game result.',
                    flags: [MessageFlags.Ephemeral]
                });
            }

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
            // ADD THIS TIE REFUND LOGIC:
            const challengerProfile = await profileModel.findOne({
                userId: challengerId,
                serverID: interaction.guild.id
            });
            const opponentProfile = await profileModel.findOne({
                userId: opponentId,
                serverID: interaction.guild.id
            });

            if (!challengerProfile || !opponentProfile) {
                console.error('Player profile not found during tie refund');
                return await interaction.reply({
                    content: '❌ An error occurred while processing the refund.',
                    flags: [MessageFlags.Ephemeral]
                });
            }

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

        // Create result embed - use winnerId instead of winner
        const winnerId = winner ? (winner === 'X' ? xPlayer : oPlayer) : null;

        const resultEmbed = new EmbedBuilder()
            .setTitle('⭕ Tic Tac Toe Results')
            .setDescription(winnerId ? `# 🎉 <@${winnerId}> wins!\n\n**Prize:** ${(betAmount * 2).toLocaleString()} points` : '🤝 It\'s a tie!\n\nBets have been refunded.')
            .setColor(winnerId ? 0x2ECC71 : 0x95A5A6)
            .setTimestamp();

        const finalBoardButtons = createTicTacToeBoard(gameId, board, true);

        await interaction.update({
            embeds: [resultEmbed],
            components: finalBoardButtons
        });

        // Log to games channel
        const gamesLogsChannel = interaction.guild.channels.cache.get(process.env.GAMES_LOGS_CHANNEL_ID);
        if (gamesLogsChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('⭕ Tic Tac Toe Game Result')
                .addFields(
                    { name: 'X Player', value: `<@${xPlayer}>`, inline: true },
                    { name: 'O Player', value: `<@${oPlayer}>`, inline: true },
                    { name: 'Result', value: winnerId ? `🎉 <@${winnerId}> wins!` : '🤝 Tie - Bets refunded', inline: false },
                    { name: 'Bet Amount', value: `${betAmount.toLocaleString()} points each`, inline: true },
                    { name: 'Total Prize', value: winnerId ? `${(betAmount * 2).toLocaleString()} points` : 'Refunded', inline: true }
                )
                .setColor(winnerId ? 0x2ECC71 : 0x95A5A6)
                .setTimestamp();

            await gamesLogsChannel.send({ embeds: [logEmbed] });
        }

        global.activeTTTGames.delete(gameId);
    } else {
        // Continue game - switch turns
        game.currentTurn = currentTurn === challengerId ? opponentId : challengerId;
        const nextSymbol = game.currentTurn === xPlayer ? 'X (⭕)' : 'O (❌)';

        const updatedEmbed = new EmbedBuilder()
            .setTitle('⭕ Tic Tac Toe')
            .setDescription(`**Current Turn:** <@${game.currentTurn}> (${nextSymbol})`)
            .addFields(
                { name: '⭕ X Player', value: `<@${xPlayer}>`, inline: true },
                { name: '❌ O Player', value: `<@${oPlayer}>`, inline: true },
                { name: '💰 Bet', value: `${betAmount.toLocaleString()} points each`, inline: true }
            )
            .setColor(0x3498DB)
            .setTimestamp();

        const updatedBoardButtons = createTicTacToeBoard(gameId, board);

        await interaction.update({
            embeds: [updatedEmbed],
            components: updatedBoardButtons
        });
    }
}

/**
 * Handles Tic Tac Toe forfeit
 */
async function handleTicTacToeForfeit(interaction) {
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

    const { challengerId, opponentId, betAmount, xPlayer, oPlayer, board } = game;

    // Verify it's a player in the game
    if (interaction.user.id !== challengerId && interaction.user.id !== opponentId) {
        return await interaction.reply({
            content: '❌ You are not in this game.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Determine winner (the other player)
    const loserId = interaction.user.id;
    const winnerId = loserId === challengerId ? opponentId : challengerId;

    // Award winnings to winner
    const winnerProfile = await profileModel.findOne({
        userId: winnerId,
        serverID: interaction.guild.id
    });

    // Add null check
    if (!winnerProfile) {
        console.error(`Winner profile not found for user ${winnerId}`);
        return await interaction.reply({
            content: '❌ An error occurred while processing the forfeit.',
            flags: [MessageFlags.Ephemeral]
        });
    }

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

    // Create forfeit result embed
    const resultEmbed = new EmbedBuilder()
        .setTitle('🏳️ Tic Tac Toe - Forfeit')
        .setDescription(
            `<@${loserId}> has forfeited the game!\n\n` +
            `🎉 <@${winnerId}> wins by forfeit!\n\n` +
            `**Prize:** ${(betAmount * 2).toLocaleString()} points`
        )
        .setColor(0x95A5A6)
        .setTimestamp();

    const finalBoardButtons = createTicTacToeBoard(gameId, board, true);

    await interaction.update({
        embeds: [resultEmbed],
        components: finalBoardButtons
    });

    // Log to games channel
    const gamesLogsChannel = interaction.guild.channels.cache.get(process.env.GAMES_LOGS_CHANNEL_ID);
    if (gamesLogsChannel) {
        const logEmbed = new EmbedBuilder()
            .setTitle('🏳️ Tic Tac Toe - Forfeit')
            .addFields(
                { name: 'X Player', value: `<@${xPlayer}>`, inline: true },
                { name: 'O Player', value: `<@${oPlayer}>`, inline: true },
                { name: 'Result', value: `<@${loserId}> forfeited - <@${winnerId}> wins!`, inline: false },
                { name: 'Prize', value: `${(betAmount * 2).toLocaleString()} points`, inline: true }
            )
            .setColor(0x95A5A6)
            .setTimestamp();

        await gamesLogsChannel.send({ embeds: [logEmbed] });
    }

    global.activeTTTGames.delete(gameId);
}

module.exports = {
    handleTicTacToeChallenge,
    handleTicTacToeMove,
    handleTicTacToeForfeit
};
