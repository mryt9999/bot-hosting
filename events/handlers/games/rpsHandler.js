const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const profileModel = require('../../../models/profileSchema');
const dbUtils = require('../../../utils/dbUtils');
const { clearChallengeTimeout } = require('./challengeTimeoutHandler');
const { saveActiveGame, removeActiveGame } = require('../../../utils/gameRecovery');

// Global game trackers
const activeRPSGames = new Map();
const pendingRPSChallenges = new Map();

/**
 * Handles RPS challenge accept/decline buttons
 */
async function handleRPSChallenge(interaction) {
    const parts = interaction.customId.split('_');
    const action = parts[1];
    const challengerId = parts[2];
    const opponentId = parts[3];
    const betAmount = action === 'accept' ? parseInt(parts[4]) : 0;
    const challengeKey = `${challengerId}_${opponentId}`;

    if (interaction.user.id !== opponentId) {
        return await interaction.reply({
            content: '❌ Only the challenged player can respond to this challenge.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Clear the timeout
    clearChallengeTimeout('rps', challengerId, opponentId, interaction.message.id);

    // Check if this challenge was already responded to or expired
    if (!pendingRPSChallenges.has(challengeKey)) {
        return await interaction.reply({
            content: '❌ This challenge is no longer valid or has already been responded to.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Remove from pending challenges
    pendingRPSChallenges.delete(challengeKey);

    if (action === 'decline') {
        const declineEmbed = new EmbedBuilder()
            .setTitle('🪨📄✂️ Challenge Declined')
            .setDescription(`<@${opponentId}> declined the challenge.`)
            .setColor(0x95A5A6)
            .setTimestamp();

        await interaction.update({
            embeds: [declineEmbed],
            components: []
        });
        return;
    }

    // Check if either player is already in an active game
    const existingGame = Array.from(activeRPSGames.values()).find(
        game => game.challengerId === challengerId ||
            game.challengerId === opponentId ||
            game.opponentId === challengerId ||
            game.opponentId === opponentId
    );

    if (existingGame) {
        await interaction.update({
            content: '❌ Challenge cancelled. One or both players are already in an active RPS game.',
            embeds: [],
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
    }

    const gameId = `${challengerId}_${opponentId}_${Date.now()}`;
    activeRPSGames.set(gameId, {
        challengerId,
        opponentId,
        betAmount,
        choices: {},
        messageId: interaction.message.id,
        betsDeducted: true
    });

    // Save to database for crash recovery
    await saveActiveGame(
        gameId,
        'rps',
        interaction.guild.id,
        challengerId,
        opponentId,
        betAmount,
        interaction.message.id,
        interaction.channel.id,
        { choices: {} }
    );

    const choiceButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`rps_choice_rock_${gameId}`)
            .setLabel('Rock')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🪨'),
        new ButtonBuilder()
            .setCustomId(`rps_choice_paper_${gameId}`)
            .setLabel('Paper')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📄'),
        new ButtonBuilder()
            .setCustomId(`rps_choice_scissors_${gameId}`)
            .setLabel('Scissors')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('✂️')
    );

    const forfeitButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`rps_forfeit_${gameId}`)
            .setLabel('Forfeit')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🏳️')
    );

    const gameEmbed = new EmbedBuilder()
        .setTitle('🪨📄✂️ Make Your Choice!')
        .setDescription(`Both players, choose your weapon!\n\n*Bets of ${betAmount.toLocaleString()} points have been deducted from both players.*`)
        .addFields(
            { name: 'Challenger', value: `<@${challengerId}> - ⏳ Waiting...`, inline: true },
            { name: 'Opponent', value: `<@${opponentId}> - ⏳ Waiting...`, inline: true },
            { name: '💰 Prize Pool', value: `${(betAmount * 2).toLocaleString()} points`, inline: true }
        )
        .setColor(0xF39C12)
        .setFooter({ text: 'You have 30 seconds to choose!' })
        .setTimestamp();

    await interaction.update({
        content: `<@${challengerId}> vs <@${opponentId}>`,
        embeds: [gameEmbed],
        components: [choiceButtons, forfeitButton]
    });

    setTimeout(() => {
        if (activeRPSGames.has(gameId)) {
            const game = activeRPSGames.get(gameId);
            if (Object.keys(game.choices).length < 2) {
                activeRPSGames.delete(gameId);
                interaction.message.edit({
                    content: '⏱️ Game expired - both players did not choose in time.',
                    embeds: [],
                    components: []
                }).catch(() => { });
            }
        }
    }, 30000);
}

/**
 * Handles RPS choice buttons
 */
async function handleRPSChoice(interaction) {
    const parts = interaction.customId.split('_');
    const choice = parts[2];
    const gameId = parts.slice(3).join('_');

    const game = activeRPSGames.get(gameId);
    if (!game) {
        return await interaction.reply({
            content: '❌ This game has expired or already finished.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    const { challengerId, opponentId, betAmount, messageId } = game;

    if (interaction.message.id !== messageId) {
        return await interaction.reply({
            content: '❌ This game belongs to a different message.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (interaction.user.id !== challengerId && interaction.user.id !== opponentId) {
        return await interaction.reply({
            content: '❌ You are not part of this game.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (game.choices[interaction.user.id]) {
        return await interaction.reply({
            content: '❌ You already made your choice!',
            flags: [MessageFlags.Ephemeral]
        });
    }

    game.choices[interaction.user.id] = choice;

    await interaction.reply({
        content: `You chose **${choice}**! 🎲`,
        flags: [MessageFlags.Ephemeral]
    });

    const challengerReady = !!game.choices[challengerId];
    const opponentReady = !!game.choices[opponentId];

    // If both players haven't chosen yet, just update the waiting status
    if (!challengerReady || !opponentReady) {
        const updatedEmbed = new EmbedBuilder()
            .setTitle('🪨📄✂️ Make Your Choice!')
            .setDescription('Both players, choose your weapon!')
            .addFields(
                { name: 'Challenger', value: `<@${challengerId}> - ${challengerReady ? '✅ Ready' : '⏳ Waiting...'}`, inline: true },
                { name: 'Opponent', value: `<@${opponentId}> - ${opponentReady ? '✅ Ready' : '⏳ Waiting...'}`, inline: true },
                { name: '💰 Prize Pool', value: `${(betAmount * 2).toLocaleString()} points`, inline: true }
            )
            .setColor(0xF39C12)
            .setFooter({ text: 'You have 30 seconds to choose!' })
            .setTimestamp();

        await interaction.message.edit({ embeds: [updatedEmbed] });
        return;
    }

    // Both players have chosen - determine winner and update the SAME message
    const challengerChoice = game.choices[challengerId];
    const opponentChoice = game.choices[opponentId];

    let winnerId = null;
    let resultText = '';

    if (challengerChoice === opponentChoice) {
        // TIE - REFUND BOTH
        resultText = '🤝 It\'s a tie! Bets refunded.';

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
    } else if (
        (challengerChoice === 'rock' && opponentChoice === 'scissors') ||
        (challengerChoice === 'paper' && opponentChoice === 'rock') ||
        (challengerChoice === 'scissors' && opponentChoice === 'paper')
    ) {
        winnerId = challengerId;
        resultText = `# 🎉 <@${challengerId}> wins ${(betAmount * 2).toLocaleString()} points!`;
    } else {
        winnerId = opponentId;
        resultText = `# 🎉 <@${opponentId}> wins ${(betAmount * 2).toLocaleString()} points!`;
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
    }

    const choiceEmojis = {
        rock: '🪨',
        paper: '📄',
        scissors: '✂️'
    };

    const challengerUser = await interaction.client.users.fetch(challengerId);
    const opponentUser = await interaction.client.users.fetch(opponentId);

    const resultEmbed = new EmbedBuilder()
        .setTitle('🪨📄✂️ Rock Paper Scissors Results')
        .setDescription(resultText)
        .addFields(
            { name: challengerUser.username, value: `${choiceEmojis[challengerChoice]} ${challengerChoice}`, inline: true },
            { name: 'VS', value: '⚔️', inline: true },
            { name: opponentUser.username, value: `${choiceEmojis[opponentChoice]} ${opponentChoice}`, inline: true }
        )
        .setColor(winnerId ? 0x2ECC71 : 0x95A5A6)
        .setTimestamp();

    if (winnerId) {
        resultEmbed.addFields({
            name: '💰 Prize',
            value: `${(betAmount * 2).toLocaleString()} points`,
            inline: false
        });
    }

    // Edit the SAME message instead of creating a new one
    await interaction.message.edit({
        content: `<@${challengerId}> vs <@${opponentId}>`,
        embeds: [resultEmbed],
        components: []
    });

    // Log to games channel
    const rpsLogsChannel = interaction.guild.channels.cache.get(process.env.GAMES_LOGS_CHANNEL_ID);
    if (rpsLogsChannel) {
        const logEmbed = new EmbedBuilder()
            .setTitle('🪨📄✂️ RPS Game Result')
            .addFields(
                { name: 'Challenger', value: `<@${challengerId}> (${challengerUser.username})`, inline: true },
                { name: 'Opponent', value: `<@${opponentId}> (${opponentUser.username})`, inline: true },
                { name: 'Challenger Choice', value: `${choiceEmojis[challengerChoice]} ${challengerChoice}`, inline: true },
                { name: 'Opponent Choice', value: `${choiceEmojis[opponentChoice]} ${opponentChoice}`, inline: true },
                { name: 'Result', value: resultText, inline: false },
                { name: 'Prize', value: winnerId ? `${(betAmount * 2).toLocaleString()} points` : 'Refunded', inline: true }
            )
            .setColor(winnerId ? 0x2ECC71 : 0x95A5A6)
            .setTimestamp();

        await rpsLogsChannel.send({ embeds: [logEmbed] });
    }

    activeRPSGames.delete(gameId);
    await removeActiveGame(gameId); // Remove from DB
}

/**
 * Handles RPS forfeit
 */
async function handleRPSForfeit(interaction) {
    const gameId = interaction.customId.replace('rps_forfeit_', '');

    const game = activeRPSGames.get(gameId);
    if (!game) {
        return await interaction.reply({
            content: '❌ This game has expired or already finished.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    const { challengerId, opponentId, betAmount } = game;

    if (interaction.user.id !== challengerId && interaction.user.id !== opponentId) {
        return await interaction.reply({
            content: '❌ You are not part of this game.',
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
        .setTitle('🏳️ Rock Paper Scissors - Forfeit')
        .setDescription(
            `<@${loserId}> has forfeited the game!\n\n` +
            `# 🎉 <@${winnerId}> wins by forfeit!\n\n` +
            `**Prize:** ${(betAmount * 2).toLocaleString()} points`
        )
        .setColor(0x95A5A6)
        .setTimestamp();

    await interaction.update({
        embeds: [resultEmbed],
        components: []
    });

    // Log to games channel
    const gamesLogsChannel = interaction.guild.channels.cache.get(process.env.GAMES_LOGS_CHANNEL_ID);
    if (gamesLogsChannel) {
        const logEmbed = new EmbedBuilder()
            .setTitle('🏳️ RPS Game - Forfeit')
            .addFields(
                { name: 'Forfeited By', value: `<@${loserId}>`, inline: true },
                { name: 'Winner', value: `<@${winnerId}>`, inline: true },
                { name: 'Prize', value: `${(betAmount * 2).toLocaleString()} points`, inline: true }
            )
            .setColor(0x95A5A6)
            .setTimestamp();

        await gamesLogsChannel.send({ embeds: [logEmbed] });
    }

    activeRPSGames.delete(gameId);
    await removeActiveGame(gameId); // Remove from DB
}

module.exports = {
    activeRPSGames,
    pendingRPSChallenges,
    handleRPSChallenge,
    handleRPSChoice,
    handleRPSForfeit
};