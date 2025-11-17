const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, MessageFlags, Collection } = require('discord.js');
const { Routes } = require('discord-api-types/v10');
const profileModel = require("../models/profileSchema");
const lotteryModel = require('../models/lotterySchema');
const { endNumberLottery, NUMBER_LOTTERY_COST, RAFFLE_LOTTERY_COST } = require('../utils/lotteryManager');
const dbUtils = require('../utils/dbUtils');


const activeRPSGames = new Map();
const pendingRPSChallenges = new Map(); // Track pending challenges

module.exports = {
    name: Events.InteractionCreate,
    pendingRPSChallenges, // Export so rps.js can access it
    async execute(interaction) {
        ///////////////////////////////
        if (interaction.isAutocomplete()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command || !command.autocomplete) return;

            try {
                await command.autocomplete(interaction);
            } catch (error) {
                console.error('Error handling autocomplete:', error);
            }
            return;
        }

        //  make this remove ephemeral messages after 30 seconds
        const replyEphemeral = async (options) => {
            const message = await interaction.reply({ ...options, flags: MessageFlags.Ephemeral, fetchReply: true });
            setTimeout(async () => {
                try {
                    await interaction.deleteReply();
                } catch (err) {
                    // ignore
                }
            }, 30000);
            return message;
        };
        /////////////////////////////////
        //////////////////////////////////////

        // Get user db information first
        let profileData;
        try {
            profileData = await profileModel.findOne({ userId: interaction.user.id });
            if (!profileData) {
                profileData = await profileModel.create({
                    userId: interaction.user.id,
                    serverID: interaction.guild?.id ?? null,
                });
            }
        } catch (err) {
            console.log(err);
        }

        /////////
        // Handle user select for donate recipient
        if (interaction.isUserSelectMenu() && interaction.customId.startsWith('donateSelect:')) {
            // ensure only the original invoker can use this select
            const [, invokerId] = interaction.customId.split(':');
            if (interaction.user.id !== invokerId) {
                return await replyEphemeral({ content: 'You cannot choose a recipient for someone else\'s donate action.' });
            }

            const targetId = interaction.values[0];
            // show modal to enter amount, embed target id into customId so modal handler knows it
            const modal = new ModalBuilder()
                .setCustomId(`donateModal:${invokerId}:${targetId}`)
                .setTitle('Donate Points');

            const amountInput = new TextInputBuilder()
                .setCustomId('donateAmount')
                .setLabel('Amount to donate')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter amount (numbers only)')
                .setRequired(true);

            const row = new ActionRowBuilder().addComponents(amountInput);
            await interaction.showModal(modal.addComponents(row));
            return;
        }

        if (interaction.isStringSelectMenu()) {
            // ...existing select menu handlers...



            if (interaction.customId === 'help_command_select') {
                const commandName = interaction.values[0];
                const command = interaction.client.commands.get(commandName);

                if (!command) {
                    return await interaction.update({
                        content: '❌ Command not found.',
                        embeds: [],
                        components: []
                    });
                }

                const { createCommandDetailEmbed, createCommandSelectMenu, createBackButton } = require('../commands/help');
                const detailEmbed = createCommandDetailEmbed(command, interaction);
                const selectMenu = createCommandSelectMenu(interaction);
                const backButton = createBackButton();

                await interaction.update({
                    embeds: [detailEmbed],
                    components: [selectMenu, backButton]
                });
            }



            // Handle transfer select menus
            if (interaction.customId.startsWith('transfer_')) {
                const transferCommand = interaction.client.commands.get('transfer');
                if (transferCommand && transferCommand.handleTransferSelect) {
                    try {
                        await transferCommand.handleTransferSelect(interaction);
                    } catch (error) {
                        console.error('Error handling transfer select menu:', error);
                        const replyMethod = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
                        await interaction[replyMethod]({
                            content: 'An error occurred while processing your selection.',
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
                return;
            }
        }

        // Handle modal submit for gamble and donate
        if (interaction.isModalSubmit()) {

            // Handle transfer modals
            if (interaction.customId.startsWith('transfer_')) {
                const transferCommand = interaction.client.commands.get('transfer');
                if (transferCommand && transferCommand.handleTransferModal) {
                    try {
                        await transferCommand.handleTransferModal(interaction);
                    } catch (error) {
                        console.error('Error handling transfer modal:', error);
                        const replyMethod = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
                        await interaction[replyMethod]({
                            content: 'An error occurred while processing your input.',
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
                return;
            }

            // Gamble modal
            if (interaction.customId.startsWith('gambleModal:')) {
                const amountRaw = interaction.fields.getTextInputValue('gambleAmount');
                const amount = parseInt(amountRaw.replace(/[, ]/g, ''), 10);

                if (isNaN(amount) || amount <= 0) {
                    return await replyEphemeral({ content: 'Please enter a valid positive number for the amount.' });
                }

                const cmd = interaction.client.commands.get('gamble');
                if (!cmd) {
                    return await replyEphemeral({ content: 'Gamble command not found.' });
                }

                try {
                    // Pass flags to make it ephemeral, and mark as invoked by modal
                    await cmd.execute(interaction, profileData, {
                        amount,
                        invokedByModal: true,
                        flags: MessageFlags.Ephemeral
                    });
                } catch (err) {
                    console.error('Error executing gamble from modal:', err);
                    if (!interaction.replied && !interaction.deferred) {
                        return await replyEphemeral({ content: 'Error executing gamble.' });
                    }
                }
                return;
            }

            // Donate modal (customId format: donateModal:<invokerId>:<targetId>)
            if (interaction.customId.startsWith('donateModal:')) {
                const parts = interaction.customId.split(':');
                const invokerId = parts[1];
                const targetId = parts[2];

                if (interaction.user.id !== invokerId) {
                    return await replyEphemeral({ content: 'You cannot perform this donate action.' });
                }

                const amountRaw = interaction.fields.getTextInputValue('donateAmount').trim();
                const amount = parseInt(amountRaw.replace(/[, ]/g, ''), 10);

                if (isNaN(amount) || amount <= 0) {
                    return await replyEphemeral({ content: 'Please enter a valid positive number for the amount.' });
                }

                let targetMember;
                try {
                    targetMember = await interaction.guild.members.fetch(targetId);
                } catch (err) {
                    console.error('Failed to fetch donate target:', err);
                    return await replyEphemeral({ content: 'Could not find that user in this server. Please try again.' });
                }

                const cmd = interaction.client.commands.get('donate');
                if (!cmd) {
                    return await replyEphemeral({ content: 'Donate command not found.' });
                }

                try {
                    await cmd.execute(interaction, profileData, {
                        amount,
                        targetId: targetMember.id,
                        invokedByModal: true,
                        flags: MessageFlags.Ephemeral
                    });
                } catch (err) {
                    console.error('Error executing donate from modal:', err);
                    if (!interaction.replied && !interaction.deferred) {
                        return await replyEphemeral({ content: 'Error executing donate.' });
                    }
                }
                return;
            }
        }
        /////////

        // Handle regular commands
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction, profileData);
            } catch (error) {
                console.error(error);
                if (!interaction.replied && !interaction.deferred) {
                    await replyEphemeral({
                        content: 'There was an error executing this command!',
                    });
                }
            }
            return;
        }

        // Handle button interactions
        if (interaction.isButton()) {

            ////////////////////////

            // RPS Challenge Accept/Decline
            if (interaction.customId.startsWith('rps_accept_') || interaction.customId.startsWith('rps_decline_')) {
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

                // Check if this challenge was already responded to
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

            if (interaction.customId.startsWith('rps_choice_')) {
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
                        resultText = '# 🤝 It\'s a tie! Bets refunded.';
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
                        const loserId = winnerId === challengerId ? opponentId : challengerId;
                        const loserProfile = await profileModel.findOne({
                            userId: loserId,
                            serverID: interaction.guild.id
                        });

                        winnerProfile.balance += betAmount;
                        loserProfile.balance -= betAmount;

                        await winnerProfile.save();
                        await loserProfile.save();

                        try {
                            const balanceChangeEvent = require('./balanceChange');
                            const winnerMember = await interaction.guild.members.fetch(winnerId);
                            const loserMember = await interaction.guild.members.fetch(loserId);
                            balanceChangeEvent.execute(winnerMember);
                            balanceChangeEvent.execute(loserMember);
                        } catch (err) {
                            console.error('Failed to trigger balance change event:', err);
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
                    // log the result to rock paper sccicors log channel
                    const rpsLogsChannel = interaction.guild.channels.cache.get(process.env.RPS_LOGS_CHANNEL_ID);
                    if (rpsLogsChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('🪨📄✂️ Rock Paper Scissors Game Result')
                            .addFields(
                                { name: 'Challenger', value: `<@${challengerId}> (${challengerUser.username})`, inline: true },
                                { name: 'Opponent', value: `<@${opponentId}> (${opponentUser.username})`, inline: true },
                                { name: 'Challenger Choice', value: `${choiceEmojis[challengerChoice]} ${challengerChoice}`, inline: true },
                                { name: 'Opponent Choice', value: `${choiceEmojis[opponentChoice]} ${opponentChoice}`, inline: true },
                                { name: 'Result', value: resultText, inline: false }
                                // add bet and prize if applicable
                                , { name: 'Bet Amount', value: `${betAmount.toLocaleString()} points`, inline: true },
                                { name: 'Total Prize', value: winnerId ? `${(betAmount * 2).toLocaleString()} points` : 'N/A', inline: true }
                            )
                            .setColor(winnerId ? 0x2ECC71 : 0x95A5A6)
                            .setTimestamp();

                        await rpsLogsChannel.send({ embeds: [logEmbed] });
                    }

                    activeRPSGames.delete(gameId);
                }
            }


            ///////////////////////


            // Lottery buttons
            if (interaction.customId.startsWith('lottery_')) {
                const parts = interaction.customId.split('_');
                const lotteryType = parts[1]; // 'number' or 'raffle'
                const lotteryId = parts[2];

                // Get lottery
                let lottery;
                try {
                    lottery = await lotteryModel.findById(lotteryId);
                } catch (error) {
                    console.error('Invalid lottery ID:', error);
                    return await interaction.reply({
                        content: '❌ Invalid lottery ID.',
                        flags: [MessageFlags.Ephemeral]
                    });
                }

                if (!lottery) {
                    return await interaction.reply({
                        content: '❌ Lottery not found.',
                        flags: [MessageFlags.Ephemeral]
                    });
                }

                if (lottery.status === 'ended') {
                    return await interaction.reply({
                        content: '❌ This lottery has already ended.',
                        flags: [MessageFlags.Ephemeral]
                    });
                }

                // Get lottery thread for logging
                let lotteryThread = null;
                if (lottery.logThreadId) {
                    try {
                        lotteryThread = await interaction.client.channels.fetch(lottery.logThreadId);
                    } catch (error) {
                        console.error('Failed to fetch lottery thread:', error);
                    }
                }

                // Get user profile
                let profileData = await dbUtils.ensureProfile(interaction.user.id, interaction.guild.id);

                if (lotteryType === 'number') {
                    // Number lottery - buy a draw
                    if (profileData.balance < NUMBER_LOTTERY_COST) {
                        const errorMsg = `❌ You need ${NUMBER_LOTTERY_COST.toLocaleString()} points to buy a draw. You have ${profileData.balance.toLocaleString()} points.`;

                        // Send to thread if available
                        if (lotteryThread) {
                            await lotteryThread.send({
                                content: `<@${interaction.user.id}> ${errorMsg}`
                            });
                        }

                        return await interaction.reply({
                            content: errorMsg,
                            flags: [MessageFlags.Ephemeral]
                        });
                    }

                    // Check if all numbers are used
                    if (lottery.usedNumbers.length >= 1000) {
                        const errorMsg = '❌ All numbers have been used. This lottery is over.';

                        if (lotteryThread) {
                            await lotteryThread.send({
                                content: `<@${interaction.user.id}> ${errorMsg}`
                            });
                        }

                        return await interaction.reply({
                            content: errorMsg,
                            flags: [MessageFlags.Ephemeral]
                        });
                    }

                    await interaction.deferUpdate();

                    // Deduct cost
                    profileData.balance -= NUMBER_LOTTERY_COST;
                    await profileData.save();

                    // Add to prize pool
                    lottery.prizePool += NUMBER_LOTTERY_COST;

                    // Get available numbers
                    const availableNumbers = [];
                    for (let i = 1; i <= 1000; i++) {
                        if (!lottery.usedNumbers.includes(i)) {
                            availableNumbers.push(i);
                        }
                    }

                    // Pick random available number
                    const randomNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
                    lottery.usedNumbers.push(randomNumber);

                    // Add participant
                    lottery.participants.push({
                        userId: interaction.user.id,
                        number: randomNumber,
                        joinedAt: Date.now()
                    });

                    // Check if won
                    const isWinner = randomNumber === lottery.winningNumber;

                    await lottery.save();

                    // Trigger balance change event
                    try {
                        const balanceChangeEvent = require('./balanceChange');
                        balanceChangeEvent.execute(interaction.member);
                    } catch (err) {
                        console.error('Failed to trigger balance change event:', err);
                    }

                    if (isWinner) {
                        // Winner!
                        await endNumberLottery(lottery, interaction.client, interaction.guild, interaction.user.id, randomNumber);
                    } else {
                        // Update lottery message
                        const channel = interaction.guild.channels.cache.get(lottery.channelId);
                        if (channel && lottery.messageId) {
                            try {
                                const message = await channel.messages.fetch(lottery.messageId);
                                const { createLotteryEmbed } = require('../utils/lotteryManager');
                                const embed = createLotteryEmbed(lottery);
                                await message.edit({ embeds: [embed] });
                            } catch (error) {
                                console.error('Failed to update lottery message:', error);
                            }
                        }

                        // Log to lottery thread
                        if (lotteryThread) {
                            const logEmbed = new EmbedBuilder()
                                .setTitle('🎲 Number Draw Purchase')
                                .setColor(0xE74C3C)
                                .addFields(
                                    { name: 'Player', value: `<@${interaction.user.id}>`, inline: true },
                                    { name: 'Number Drawn', value: `${randomNumber}`, inline: true },
                                    { name: 'Result', value: '❌ Not a winner', inline: true },
                                    { name: 'Prize Pool', value: `${lottery.prizePool.toLocaleString()} points`, inline: true },
                                    { name: 'Numbers Used', value: `${lottery.usedNumbers.length}/1000`, inline: true }
                                )
                                .setTimestamp();

                            await lotteryThread.send({
                                content: `<@${interaction.user.id}>`,
                                embeds: [logEmbed]
                            });
                        }
                    }

                } else if (lotteryType === 'raffle') {
                    // Raffle lottery - enter once
                    if (profileData.balance < RAFFLE_LOTTERY_COST) {
                        const errorMsg = `❌ You need ${RAFFLE_LOTTERY_COST.toLocaleString()} points to enter the raffle. You have ${profileData.balance.toLocaleString()} points.`;

                        if (lotteryThread) {
                            await lotteryThread.send({
                                content: `<@${interaction.user.id}> ${errorMsg}`
                            });
                        }

                        return await interaction.reply({
                            content: errorMsg,
                            flags: [MessageFlags.Ephemeral]
                        });
                    }

                    // Check if already participated
                    const alreadyParticipated = lottery.participants.some(p => p.userId === interaction.user.id);
                    if (alreadyParticipated) {
                        const errorMsg = '❌ You have already entered this raffle. Only one entry per person.';

                        if (lotteryThread) {
                            await lotteryThread.send({
                                content: `<@${interaction.user.id}> ${errorMsg}`
                            });
                        }

                        return await interaction.reply({
                            content: errorMsg,
                            flags: [MessageFlags.Ephemeral]
                        });
                    }

                    await interaction.deferUpdate();

                    // Deduct cost
                    profileData.balance -= RAFFLE_LOTTERY_COST;
                    await profileData.save();

                    // Add to prize pool
                    lottery.prizePool += RAFFLE_LOTTERY_COST;

                    // Add participant
                    lottery.participants.push({
                        userId: interaction.user.id,
                        joinedAt: Date.now()
                    });

                    await lottery.save();

                    // Trigger balance change event
                    try {
                        const balanceChangeEvent = require('./balanceChange');
                        balanceChangeEvent.execute(interaction.member);
                    } catch (err) {
                        console.error('Failed to trigger balance change event:', err);
                    }

                    // Update lottery message
                    const channel = interaction.guild.channels.cache.get(lottery.channelId);
                    if (channel && lottery.messageId) {
                        try {
                            const message = await channel.messages.fetch(lottery.messageId);
                            const { createLotteryEmbed } = require('../utils/lotteryManager');
                            const embed = createLotteryEmbed(lottery);
                            await message.edit({ embeds: [embed] });
                        } catch (error) {
                            console.error('Failed to update lottery message:', error);
                        }
                    }

                    // Log to lottery thread
                    if (lotteryThread) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('🎟️ Raffle Entry')
                            .setColor(0x3498DB)
                            .addFields(
                                { name: 'Player', value: `<@${interaction.user.id}>`, inline: true },
                                { name: 'Entry Cost', value: `${RAFFLE_LOTTERY_COST.toLocaleString()} points`, inline: true },
                                { name: 'Prize Pool', value: `${lottery.prizePool.toLocaleString()} points`, inline: true },
                                { name: 'Total Participants', value: `${lottery.participants.length}`, inline: true },
                                { name: 'Time Remaining', value: `<t:${Math.floor(lottery.endsAt / 1000)}:R>`, inline: true }
                            )
                            .setTimestamp();

                        await lotteryThread.send({
                            content: `<@${interaction.user.id}> ✅ Entered the raffle!`,
                            embeds: [logEmbed]
                        });
                    }
                }

                return;
            }


            ///////////////////////////

            // Help back button
            if (interaction.customId === 'help_back_to_list') {
                const { createMainHelpEmbed, createCommandSelectMenu } = require('../commands/help');
                const mainEmbed = createMainHelpEmbed(interaction);
                const selectMenu = createCommandSelectMenu(interaction);

                await interaction.update({
                    embeds: [mainEmbed],
                    components: [selectMenu]
                });
            }

            // Handle transfer buttons
            if (interaction.customId.startsWith('transfer_')) {
                const transferCommand = interaction.client.commands.get('transfer');
                if (transferCommand && transferCommand.handleTransferButton) {
                    try {
                        await transferCommand.handleTransferButton(interaction);
                    } catch (error) {
                        console.error('Error handling transfer button:', error);
                        const replyMethod = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
                        await interaction[replyMethod]({
                            content: 'An error occurred while processing your request.',
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
                return;
            }

            if (interaction.customId.startsWith('transfer_cancel_')) {
                const userId = interaction.customId.replace('transfer_cancel_', '');
                const { handleTransferCancel } = require('../commands/transfer');
                return await handleTransferCancel(interaction, userId);
            }


            // Handle loan accept button
            // Loan accept button
            if (interaction.customId.startsWith('loan_accept_')) {
                const loanId = interaction.customId.replace('loan_accept_', '');
                const { processLoanAcceptance } = require('../commands/loan');
                return await processLoanAcceptance(interaction, loanId);
            }

            // Loan confirm button (high interest confirmation)
            if (interaction.customId.startsWith('loan_confirm_')) {
                const loanId = interaction.customId.replace('loan_confirm_', '');
                const { processLoanAcceptance } = require('../commands/loan');
                return await processLoanAcceptance(interaction, loanId);
            }

            // Loan cancel button (high interest warning cancellation)
            if (interaction.customId.startsWith('loan_cancel_')) {
                const cancelEmbed = new EmbedBuilder()
                    .setTitle('❌ Loan Cancelled')
                    .setColor(0x95A5A6)
                    .setDescription('You have cancelled this loan.')
                    .setTimestamp();

                return await interaction.update({
                    embeds: [cancelEmbed],
                    components: []
                });
            }

            // Handle command buttons (cmd:*)
            if (interaction.customId.startsWith('cmd:')) {
                const cmdName = interaction.customId.split(':')[1];
                const command = interaction.client.commands.get(cmdName);

                if (!command) return;

                // Open a modal for gamble so player can enter an amount
                if (cmdName === 'gamble') {
                    const modal = new ModalBuilder()
                        .setCustomId(`gambleModal:${interaction.user.id}`)
                        .setTitle('Gamble Amount');

                    const amountInput = new TextInputBuilder()
                        .setCustomId('gambleAmount')
                        .setLabel('Amount of points to gamble')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Enter amount (numbers only)')
                        .setRequired(true);

                    const row = new ActionRowBuilder().addComponents(amountInput);

                    await interaction.showModal(modal.addComponents(row));
                    return;
                }

                // For donate: present a user select so the player can pick recipient easily
                if (cmdName === 'donate') {
                    const userSelect = new UserSelectMenuBuilder()
                        .setCustomId(`donateSelect:${interaction.user.id}`)
                        .setPlaceholder('Select a recipient to donate to')
                        .setMinValues(1)
                        .setMaxValues(1);

                    const row = new ActionRowBuilder().addComponents(userSelect);

                    return await replyEphemeral({
                        content: 'Choose a recipient for your donation:',
                        components: [row]
                    });
                }


                // If command has no required options, execute it directly
                if (!command.data.options?.some(opt => opt.required)) {
                    try {
                        const sensitive = ['leaderboard', 'balance', 'daily'];
                        const opts = { invokedByButton: true, ephemeral: sensitive.includes(command.data.name) };
                        await command.execute(interaction, profileData, opts);
                    } catch (error) {
                        console.error(error);
                        if (!interaction.replied && !interaction.deferred) {
                            await replyEphemeral({
                                content: 'Error executing the command!',
                            });
                        }
                    }

                    return;
                }

                // If command has required options, show info embed
                const cmdEmbed = new EmbedBuilder()
                    .setTitle(`/${command.data.name}`)
                    .setDescription(command.data.description)
                    .setColor('#4CAF50');

                if (command.data.options?.length > 0) {
                    const optionsText = command.data.options
                        .map(opt => `• **${opt.name}**: ${opt.description}`)
                        .join('\n');
                    cmdEmbed.addFields({ name: 'Options', value: optionsText });
                }

                const buttonRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('back')
                            .setLabel('Back to Menu')
                            .setStyle(ButtonStyle.Secondary)
                    );

                return await replyEphemeral({
                    embeds: [cmdEmbed],
                    components: [buttonRow]
                });
            }

            // Handle close/back buttons
            if (interaction.customId === 'close' || interaction.customId === 'back') {
                try {
                    await interaction.deferUpdate();
                    await interaction.deleteReply();
                } catch (err) {
                    console.error('Error handling close/back button:', err);
                }
                return;
            }
        }

    },
};
