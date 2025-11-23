const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const profileModel = require('../../../models/profileSchema');
const dbUtils = require('../../../utils/dbUtils');

// Global game trackers
const activeRPSGames = new Map();
const pendingRPSChallenges = new Map();

/**
 * Setup challenge expiration timer
 */
function setupChallengeExpiration(interaction, challengeKey, pendingMap, gameType) {
    setTimeout(async () => {
        if (pendingMap.has(challengeKey)) {
            pendingMap.delete(challengeKey);

            const expireEmbed = new EmbedBuilder()
                .setTitle(`⏱️ ${gameType} Challenge Expired`)
                .setDescription('The challenge was not accepted within 1 minute.')
                .setColor(0x95A5A6)
                .setTimestamp();

            try {
                await interaction.editReply({
                    embeds: [expireEmbed],
                    components: []
                });
            } catch (error) {
                console.error('Failed to update expired challenge:', error);
            }
        }
    }, 60000); // 1 minute
}

/**
 * Handles RPS challenge accept/decline buttons
 */
async function handleRPSChallenge(interaction) {
    const parts = interaction.customId.split('_');
    const action = parts[1]; // This gets 'accept' or 'decline'
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

    // Check if this challenge was already responded to or expired
    if (!pendingRPSChallenges.has(challengeKey)) {
        return await interaction.reply({
            content: '❌ This challenge is no longer valid or has already been responded to.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Remove from pending challenges BEFORE any other action
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

    // ACCEPT LOGIC - action === 'accept'
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

    // DEDUCT BETS IMMEDIATELY
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

    const gameId = `${challengerId}_${opponentId}_${Date.now()}`;
    activeRPSGames.set(gameId, {
        challengerId,
        opponentId,
        betAmount,
        choices: {},
        messageId: interaction.message.id
    });

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

    const gameEmbed = new EmbedBuilder()
        .setTitle('🪨📄✂️ Make Your Choice!')
        .setDescription('Both players, choose your weapon!')
        .addFields(
            { name: 'Challenger', value: `<@${challengerId}> - ⏳ Waiting...`, inline: true },
            { name: 'Opponent', value: `<@${opponentId}> - ⏳ Waiting...`, inline: true },
            { name: 'Bet', value: `${betAmount.toLocaleString()} points each`, inline: false }
        )
        .setColor(0xF39C12)
        .setFooter({ text: 'You have 30 seconds to choose!' })
        .setTimestamp();

    await interaction.update({
        content: `<@${challengerId}> vs <@${opponentId}>`,
        embeds: [gameEmbed],
        components: [choiceButtons]
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

    // Verify this interaction is for the correct message
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

    const updatedEmbed = new EmbedBuilder()
        .setTitle('🪨📄✂️ Make Your Choice!')
        .setDescription('Both players, choose your weapon!')
        .addFields(
            { name: 'Challenger', value: `<@${challengerId}> - ${challengerReady ? '✅ Ready' : '⏳ Waiting...'}`, inline: true },
            { name: 'Opponent', value: `<@${opponentId}> - ${opponentReady ? '✅ Ready' : '⏳ Waiting...'}`, inline: true },
            { name: 'Bet', value: `${betAmount.toLocaleString()} points each`, inline: false }
        )
        .setColor(0xF39C12)
        .setFooter({ text: 'You have 30 seconds to choose!' })
        .setTimestamp();

    await interaction.message.edit({ embeds: [updatedEmbed] });

    if (challengerReady && opponentReady) {
        const challengerChoice = game.choices[challengerId];
        const opponentChoice = game.choices[opponentId];

        let winnerId = null;
        let resultText = '';

        if (challengerChoice === opponentChoice) {
            // TIE - REFUND BOTH
            resultText = '# 🤝 It\'s a tie! Bets refunded.';

            const challengerProfile = await profileModel.findOne({
                userId: challengerId,
                serverID: interaction.guild.id
            });
            const opponentProfile = await profileModel.findOne({
                userId: opponentId,
                serverID: interaction.guild.id
            });

            if (challengerProfile && opponentProfile) {
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
        } else if (
            (challengerChoice === 'rock' && opponentChoice === 'scissors') ||
            (challengerChoice === 'paper' && opponentChoice === 'rock') ||
            (challengerChoice === 'scissors' && opponentChoice === 'paper')
        ) {
            winnerId = challengerId;
            resultText = `# 🎉 <@${challengerId}> wins!`;
        } else {
            winnerId = opponentId;
            resultText = `# 🎉 <@${opponentId}> wins!`;
        }

        if (winnerId) {
            const winnerProfile = await profileModel.findOne({
                userId: winnerId,
                serverID: interaction.guild.id
            });

            if (winnerProfile) {
                // Winner gets 2x bet (their money back + opponent's bet)
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
        }

        const choiceEmojis = {
            rock: '🪨',
            paper: '📄',
            scissors: '✂️'
        };

        // Fetch user objects to get usernames
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

        await interaction.message.edit({
            embeds: [resultEmbed],
            components: []
        });

        // Log the result to rock paper scissors log channel
        const rpsLogsChannel = interaction.guild.channels.cache.get(process.env.GAMES_LOGS_CHANNEL_ID);
        if (rpsLogsChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('🪨📄✂️ Rock Paper Scissors Game Result')
                .addFields(
                    { name: 'Challenger', value: `<@${challengerId}> (${challengerUser.username})`, inline: true },
                    { name: 'Opponent', value: `<@${opponentId}> (${opponentUser.username})`, inline: true },
                    { name: 'Challenger Choice', value: `${choiceEmojis[challengerChoice]} ${challengerChoice}`, inline: true },
                    { name: 'Opponent Choice', value: `${choiceEmojis[opponentChoice]} ${opponentChoice}`, inline: true },
                    { name: 'Result', value: resultText, inline: false },
                    { name: 'Bet Amount', value: `${betAmount.toLocaleString()} points`, inline: true },
                    { name: 'Total Prize', value: winnerId ? `${(betAmount * 2).toLocaleString()} points` : 'N/A', inline: true }
                )
                .setColor(winnerId ? 0x2ECC71 : 0x95A5A6)
                .setTimestamp();

            await rpsLogsChannel.send({ embeds: [logEmbed] });
        }

        activeRPSGames.delete(gameId);
    }
}

module.exports = {
    activeRPSGames,
    pendingRPSChallenges,
    setupChallengeExpiration,
    handleRPSChallenge,
    handleRPSChoice
};
