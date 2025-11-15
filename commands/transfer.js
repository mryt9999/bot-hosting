const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const globalValues = require('../globalValues.json');
const dbUtils = require('../utils/dbUtils');
const withdrawUtil = require('../utils/withdrawUtil');
const transferModel = require('../models/transferSchema');
const WITHDRAWALS_LOGS_CHANNEL_ID = process.env.WITHDRAWAL_LOGS_CHANNEL_ID;

const genChoices = globalValues.gensAfterGodly.map(gen => ({
    name: gen,
    value: gen
}));

// Store transfer sessions in memory
const transferSessions = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('transfer')
        .setDescription('Transfer points or view point value in gens')
        .addSubcommand(subcommand =>
            subcommand
                .setName('calculator')
                .setDescription('Show how many gens your points are worth')
                .addStringOption(option =>
                    option.setName('gen')
                        .setDescription('The gen to view the point value in')
                        .setRequired(false)
                        .addChoices(...genChoices))
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('Calculate gen value for another user')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('withdrawlimit')
                .setDescription('Check weekly withdraw limit status')
                .addStringOption(option =>
                    option.setName('global')
                        .setDescription('What to view')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Global Server Limit', value: 'global' },
                        ))
                .addUserOption(option =>
                    option.setName('player')
                        .setDescription('Check another player\'s withdraw limit status (only for personal view)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('make')
                .setDescription('Transfer points into gens'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('pending')
                .setDescription('View your pending transfers')),

    async execute(interaction, profileData = null, opts = {}) {
        await interaction.deferReply();

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'calculator') {
            const genOption = interaction.options.getString('gen');
            const targetUser = interaction.options.getUser('user') || interaction.user;

            if (!profileData || targetUser.id !== interaction.user.id) {
                profileData = await dbUtils.ensureProfile(targetUser.id, interaction.guild?.id ?? null);
            }

            const points = profileData.balance;
            let genValue;

            if (genOption) {
                const genIndex = globalValues.gensAfterGodly.indexOf(genOption);
                if (genIndex === -1) {
                    return await interaction.editReply({ content: 'Invalid gen specified.' });
                }
                const pointsPerGen = globalValues.pointsPerGodlyGen * Math.pow(10, genIndex);
                genValue = points / pointsPerGen;

                const wholeNumber = Math.floor(genValue);
                const formattedValue = wholeNumber >= 10 ? wholeNumber.toLocaleString() : genValue.toFixed(2);

                const embed = new EmbedBuilder()
                    .setColor(0x00D9FF)
                    .setTitle('✨ Gen Value Calculator')
                    .setDescription(`**${points.toLocaleString()}** points = **${formattedValue}** ${genOption}'s`)
                    .setFooter({ text: targetUser.username, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            }

            let closestGen = 'godly';
            let closestGenIndex = -1;

            for (let i = globalValues.gensAfterGodly.length - 1; i >= 0; i--) {
                const pointsPerGen = globalValues.pointsPerGodlyGen * Math.pow(10, i);
                const genCount = points / pointsPerGen;

                if (genCount >= 1) {
                    closestGen = globalValues.gensAfterGodly[i];
                    closestGenIndex = i;
                    break;
                }
            }

            const pointsPerClosestGen = closestGenIndex >= 0
                ? globalValues.pointsPerGodlyGen * Math.pow(10, closestGenIndex)
                : globalValues.pointsPerGodlyGen;
            genValue = points / pointsPerClosestGen;

            const wholeNumber = Math.floor(genValue);
            const formattedValue = wholeNumber >= 10 ? wholeNumber.toLocaleString() : genValue.toFixed(2);

            const embed = new EmbedBuilder()
                .setColor(0x00D9FF)
                .setTitle('✨ Gen Value Calculator')
                .setDescription(`**${points.toLocaleString()}** points = **${formattedValue}** ${closestGen}'s`)
                .setFooter({ text: targetUser.username, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            return await interaction.editReply({ embeds: [embed] });
        }

        if (subcommand === 'withdrawlimit') {
            const viewOption = interaction.options.getString('global') || 'personal';
            const targetUser = interaction.options.getUser('player') || interaction.user;

            if (viewOption === 'global') {
                const globalWithdrawData = await withdrawUtil.getGlobalWithdrawData();
                withdrawUtil.resetGlobalWithdrawIfNeeded(globalWithdrawData);
                await globalWithdrawData.save();

                const temporaryLimitIncrease = globalWithdrawData.temporaryLimitIncrease || 0;
                const effectiveGlobalLimit = globalValues.maxGlobalWithdrawPerWeek + temporaryLimitIncrease;
                const remaining = effectiveGlobalLimit - globalWithdrawData.totalWithdrawnThisWeek;
                const resetTimestamp = Math.floor(globalWithdrawData.weekStartAt / 1000) + 7 * 24 * 60 * 60;

                const embed = new EmbedBuilder()
                    .setTitle('🌐 Global Weekly Withdraw Limit Status 🌐')
                    .setColor(0x3498DB)
                    .setTimestamp()
                    .setThumbnail(interaction.guild?.iconURL({ dynamic: true, size: 256 }))
                    .addFields(
                        {
                            name: 'Total Withdrawn This Week',
                            value: `${globalWithdrawData.totalWithdrawnThisWeek.toLocaleString()} / ${effectiveGlobalLimit.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Remaining Global Withdraw',
                            value: `${remaining.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Week Resets',
                            value: `<t:${resetTimestamp}:R>`,
                            inline: false
                        }
                    );

                if (temporaryLimitIncrease > 0) {
                    embed.addFields({
                        name: '⚡ Temporary Limit Bonus',
                        value: `+${temporaryLimitIncrease.toLocaleString()} points (resets with week)`,
                        inline: false
                    });
                }

                return await interaction.editReply({ embeds: [embed] });
            }

            if (!profileData || targetUser.id !== interaction.user.id) {
                profileData = await dbUtils.ensureProfile(targetUser.id, interaction.guild?.id ?? null);
            }

            await withdrawUtil.canWithdraw(0, profileData);

            // Use the helper function to get effective limit
            const effectiveUserLimit = withdrawUtil.getUserWithdrawLimit(profileData);
            const customBonus = profileData.customWithdrawLimit || 0;
            const remaining = effectiveUserLimit - profileData.weeklyWithdrawAmount;
            const resetTimestamp = profileData.firstWithdrawAt === 0
                ? Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
                : Math.floor(profileData.firstWithdrawAt / 1000) + 7 * 24 * 60 * 60;

            const embed = new EmbedBuilder()
                .setTitle(`💸 ${targetUser.username}'s Weekly Withdraw Limit Status 💸`)
                .setColor(0x3498DB)
                .setTimestamp()
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }));

            // Add base limit and custom bonus fields if there's a custom limit
            if (customBonus !== 0) {
                embed.addFields(
                    {
                        name: 'Base Weekly Limit',
                        value: `${globalValues.maxWithdrawPerWeek.toLocaleString()} points`,
                        inline: true
                    },
                    {
                        name: 'Custom Bonus',
                        value: `${customBonus > 0 ? '+' : ''}${customBonus.toLocaleString()} points`,
                        inline: true
                    },
                    {
                        name: 'Total Limit',
                        value: `${effectiveUserLimit.toLocaleString()} points`,
                        inline: true
                    }
                );
            }

            embed.addFields(
                {
                    name: 'Total Withdrawn This Week',
                    value: `${profileData.weeklyWithdrawAmount.toLocaleString()} / ${effectiveUserLimit.toLocaleString()} points`,
                    inline: true
                },
                {
                    name: 'Remaining Withdraw',
                    value: `${remaining.toLocaleString()} points`,
                    inline: true
                },
                {
                    name: 'Week Resets',
                    value: `<t:${resetTimestamp}:R>`,
                    inline: false
                }
            );

            return await interaction.editReply({ embeds: [embed] });
        }
        if (subcommand === 'make') {
            if (!profileData) {
                profileData = await dbUtils.ensureProfile(interaction.user.id, interaction.guild?.id ?? null);
            }

            const canWithdrawResult = await withdrawUtil.canWithdraw(globalValues.minPointsPerWithdraw, profileData);
            if (!canWithdrawResult.allowed) {
                return await interaction.editReply({
                    content: `❌ Cannot create transfer: ${canWithdrawResult.reason}`,
                });
            }

            if (profileData.balance < globalValues.minPointsPerWithdraw) {
                return await interaction.editReply({
                    content: `❌ You need at least **${globalValues.minPointsPerWithdraw.toLocaleString()}** points to make a transfer. You have **${profileData.balance.toLocaleString()}** points.`,
                });
            }

            // Initialize transfer session FIRST
            const sessionId = `${interaction.user.id}_${Date.now()}`;
            transferSessions.set(sessionId, {
                userId: interaction.user.id,
                items: [],
                totalPoints: 0,
                messageId: null, // Will be set after message is sent
                channelId: interaction.channel.id
            });

            // THEN show initial shopping list
            await updateTransferList(interaction, sessionId, profileData, true);

            // Update the session with the message ID
            const message = await interaction.fetchReply();
            const session = transferSessions.get(sessionId);
            if (session) {
                session.messageId = message.id;
            }
        }

        if (subcommand === 'pending') {
            try {
                // Find all pending transfers for the user
                const pendingTransfers = await transferModel.find({
                    userId: interaction.user.id,
                    serverID: interaction.guild.id,
                    status: 'pending'
                }).sort({ createdAt: -1 });

                if (pendingTransfers.length === 0) {
                    const noTransfersEmbed = new EmbedBuilder()
                        .setTitle('📋 Pending Transfers')
                        .setColor(0x3498DB)
                        .setDescription('You have no pending transfers.')
                        .setFooter({ text: interaction.user.username, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                        .setTimestamp();

                    return await interaction.editReply({ embeds: [noTransfersEmbed] });
                }

                // Build embed with pending transfers
                const embed = new EmbedBuilder()
                    .setTitle('📋 Your Pending Transfers')
                    .setColor(0x3498DB)
                    .setDescription(`You have **${pendingTransfers.length}** pending transfer${pendingTransfers.length !== 1 ? 's' : ''}.`)
                    .setFooter({ text: interaction.user.username, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();

                // Add fields for each transfer (max 25 fields due to Discord limits)
                const transfersToShow = pendingTransfers.slice(0, 25);

                transfersToShow.forEach((transfer, index) => {
                    const createdDate = new Date(transfer.createdAt);
                    const timestamp = Math.floor(createdDate.getTime() / 1000);


                    embed.addFields({
                        name: `\`transfer #${index + 1}\``,
                        value: `**Items:** ${transfer.transferDescription}\n**Points:** ${transfer.pointsPaid.toLocaleString()}\n**Created:** <t:${timestamp}:R>\n**ID:** \`${transfer._id}\``,
                        inline: false
                    });
                });

                if (pendingTransfers.length > 25) {
                    embed.addFields({
                        name: '⚠️ Note',
                        value: `Showing 25 of ${pendingTransfers.length} pending transfers. The oldest transfers are shown first.`,
                        inline: false
                    });
                }

                // Add summary field
                const totalPoints = pendingTransfers.reduce((sum, transfer) => sum + transfer.pointsPaid, 0);
                embed.addFields({
                    name: '📊 Summary',
                    value: `**Total Transfers:** ${pendingTransfers.length}\n**Total Points Pending:** ${totalPoints.toLocaleString()}`,
                    inline: false
                });

                await interaction.editReply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });

            } catch (error) {
                console.error('Error fetching pending transfers:', error);
                const replyMethod = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
                await interaction[replyMethod]({
                    content: '❌ An error occurred while fetching your pending transfers. Please try again.',
                    flags: [MessageFlags.Ephemeral]
                });
            }
        }
    },

    // Export session map and handlers for interactionCreate.js
    transferSessions,
    handleTransferButton,
    handleTransferSelect,
    handleTransferModal
};

async function updateTransferList(interaction, sessionId, profileData, isInitial = false) {
    const session = transferSessions.get(sessionId);

    if (!session) {
        console.log('[Transfer] Session not found in updateTransferList for sessionId:', sessionId);
        return;
    }

    const meetsMinimum = session.totalPoints >= globalValues.minPointsPerWithdraw;
    const canAfford = profileData.balance >= session.totalPoints;
    const totalGens = session.items.reduce((sum, item) => sum + item.amount, 0);

    // Build shopping list
    let shoppingList = `**🛒 Shopping List:** (${totalGens}/${globalValues.maxGensPerWithdraw} gens)\n`;
    if (session.items.length === 0) {
        shoppingList += '```\nNo items yet - Click "Add Gen" to start!\n```';
    } else {
        shoppingList += '```\n';
        session.items.forEach((item, index) => {
            const genName = item.gen.charAt(0).toUpperCase() + item.gen.slice(1);
            shoppingList += `${index + 1}. ${item.amount}x ${genName.padEnd(10)} ${item.points.toLocaleString().padStart(12)} pts\n`;
        });
        shoppingList += '```';
    }

    const embed = new EmbedBuilder()
        .setTitle('💎 Transfer Builder')
        .setColor(meetsMinimum && canAfford ? 0x2ECC71 : 0x9B59B6)
        .setDescription(shoppingList)
        .addFields(
            {
                name: '📊 Total Transfer Value',
                value: `${session.totalPoints.toLocaleString()} points`,
                inline: true
            },
            {
                name: '💳 Your Balance',
                value: `${profileData.balance.toLocaleString()} points`,
                inline: true
            },
            {
                name: '💸 After Transfer',
                value: canAfford ? `${(profileData.balance - session.totalPoints).toLocaleString()} points` : '❌ Insufficient funds',
                inline: true
            }
        );

    // Add status messages
    if (!meetsMinimum && session.totalPoints > 0) {
        const remaining = globalValues.minPointsPerWithdraw - session.totalPoints;
        embed.addFields({
            name: '⚠️ Minimum Not Met',
            value: `Need ${remaining.toLocaleString()} more points to reach ${globalValues.minPointsPerWithdraw.toLocaleString()} minimum`,
            inline: false
        });
    } else if (!canAfford && session.totalPoints > 0) {
        embed.addFields({
            name: '❌ Insufficient Balance',
            value: `You need ${session.totalPoints.toLocaleString()} points but only have ${profileData.balance.toLocaleString()} points.`,
            inline: false
        });
    } else if (meetsMinimum && canAfford && session.items.length > 0) {
        embed.addFields({
            name: '✅ Ready to Transfer',
            value: 'Your transfer meets all requirements. Click "Confirm Transfer" when ready!',
            inline: false
        });
    }

    embed.setFooter({ text: `Items: ${session.items.length} | Gens: ${totalGens}/${globalValues.maxGensPerWithdraw}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    // Build action buttons
    const buttons = [];

    // Disable "Add Gen" button if max gens reached
    const maxGensReached = totalGens >= globalValues.maxGensPerWithdraw;
    const addGenButton = new ButtonBuilder()
        .setCustomId(`transfer_add_${sessionId}`)
        .setLabel('Add Gen')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('➕')
        .setDisabled(maxGensReached);
    buttons.push(addGenButton);

    if (session.items.length > 0) {
        const removeButton = new ButtonBuilder()
            .setCustomId(`transfer_remove_${sessionId}`)
            .setLabel('Remove Last')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🗑️');
        buttons.push(removeButton);

        if (meetsMinimum && canAfford) {
            const confirmButton = new ButtonBuilder()
                .setCustomId(`transfer_confirm_${sessionId}`)
                .setLabel('Confirm Transfer')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅');
            buttons.push(confirmButton);
        }
    }

    const cancelButton = new ButtonBuilder()
        .setCustomId(`transfer_cancel_${session.userId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');
    buttons.push(cancelButton);

    const row = new ActionRowBuilder().addComponents(buttons);

    // Update or send message
    if (isInitial) {
        await interaction.editReply({ embeds: [embed], components: [row] });
    } else if (interaction.isButton()) {
        await interaction.update({ embeds: [embed], components: [row] });
    }
}

async function updateTransferListFromMessage(message, sessionId, profileData) {
    const session = transferSessions.get(sessionId);

    if (!session) {
        console.log('[Transfer] Session not found in updateTransferListFromMessage for sessionId:', sessionId);
        return;
    }

    const meetsMinimum = session.totalPoints >= globalValues.minPointsPerWithdraw;
    const canAfford = profileData.balance >= session.totalPoints;
    const totalGens = session.items.reduce((sum, item) => sum + item.amount, 0);

    // Build shopping list
    let shoppingList = `**🛒 Shopping List:** (${totalGens}/${globalValues.maxGensPerWithdraw} gens)\n`;
    if (session.items.length === 0) {
        shoppingList += '```\nNo items yet - Click "Add Gen" to start!\n```';
    } else {
        shoppingList += '```\n';
        session.items.forEach((item, index) => {
            const genName = item.gen.charAt(0).toUpperCase() + item.gen.slice(1);
            shoppingList += `${index + 1}. ${item.amount}x ${genName.padEnd(10)} ${item.points.toLocaleString().padStart(12)} pts\n`;
        });
        shoppingList += '```';
    }

    const embed = new EmbedBuilder()
        .setTitle('💎 Transfer Builder')
        .setColor(meetsMinimum && canAfford ? 0x2ECC71 : 0x9B59B6)
        .setDescription(shoppingList)
        .addFields(
            {
                name: '📊 Total Transfer Value',
                value: `${session.totalPoints.toLocaleString()} points`,
                inline: true
            },
            {
                name: '💳 Your Balance',
                value: `${profileData.balance.toLocaleString()} points`,
                inline: true
            },
            {
                name: '💸 After Transfer',
                value: canAfford ? `${(profileData.balance - session.totalPoints).toLocaleString()} points` : '❌ Insufficient funds',
                inline: true
            }
        );

    if (!meetsMinimum && session.totalPoints > 0) {
        const remaining = globalValues.minPointsPerWithdraw - session.totalPoints;
        embed.addFields({
            name: '⚠️ Minimum Not Met',
            value: `Need ${remaining.toLocaleString()} more points to reach ${globalValues.minPointsPerWithdraw.toLocaleString()} minimum`,
            inline: false
        });
    } else if (!canAfford && session.totalPoints > 0) {
        embed.addFields({
            name: '❌ Insufficient Balance',
            value: `You need ${session.totalPoints.toLocaleString()} points but only have ${profileData.balance.toLocaleString()} points.`,
            inline: false
        });
    } else if (meetsMinimum && canAfford && session.items.length > 0) {
        embed.addFields({
            name: '✅ Ready to Transfer',
            value: 'Your transfer meets all requirements. Click "Confirm Transfer" when ready!',
            inline: false
        });
    }

    embed.setFooter({ text: `Items: ${session.items.length} | Gens: ${totalGens}/${globalValues.maxGensPerWithdraw}`, iconURL: message.client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    // Build buttons
    const buttons = [];

    // Disable "Add Gen" button if max gens reached
    const maxGensReached = totalGens >= globalValues.maxGensPerWithdraw;
    const addGenButton = new ButtonBuilder()
        .setCustomId(`transfer_add_${sessionId}`)
        .setLabel('Add Gen')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('➕')
        .setDisabled(maxGensReached);
    buttons.push(addGenButton);

    if (session.items.length > 0) {
        const removeButton = new ButtonBuilder()
            .setCustomId(`transfer_remove_${sessionId}`)
            .setLabel('Remove Last')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🗑️');
        buttons.push(removeButton);

        if (meetsMinimum && canAfford) {
            const confirmButton = new ButtonBuilder()
                .setCustomId(`transfer_confirm_${sessionId}`)
                .setLabel('Confirm Transfer')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅');
            buttons.push(confirmButton);
        }
    }

    const cancelButton = new ButtonBuilder()
        .setCustomId(`transfer_cancel_${session.userId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');
    buttons.push(cancelButton);

    const row = new ActionRowBuilder().addComponents(buttons);

    await message.edit({ embeds: [embed], components: [row] });
}

async function handleAddGen(interaction, sessionId) {
    console.log('[Transfer] handleAddGen called with sessionId:', sessionId);
    console.log('[Transfer] Active sessions:', Array.from(transferSessions.keys()));

    const session = transferSessions.get(sessionId);

    if (!session) {
        console.log('[Transfer] Session not found for sessionId:', sessionId);
        return await interaction.reply({
            content: '❌ This transfer session has expired or is invalid. Please run `/transfer make` again.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (interaction.user.id !== session.userId) {
        console.log('[Transfer] User mismatch. Expected:', session.userId, 'Got:', interaction.user.id);
        return await interaction.reply({
            content: '❌ This transfer session is not for you.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Check if max gens limit reached
    const totalGens = session.items.reduce((sum, item) => sum + item.amount, 0);
    if (totalGens >= globalValues.maxGensPerWithdraw) {
        return await interaction.reply({
            content: `❌ You have reached the maximum limit of **${globalValues.maxGensPerWithdraw}** gens per transfer. Please remove items or confirm your current transfer.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Create gen selection menu
    const genSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`transfer_select_${sessionId}`)
        .setPlaceholder('Select a gen type')
        .addOptions(
            globalValues.gensAfterGodly.map(gen => ({
                label: gen.charAt(0).toUpperCase() + gen.slice(1),
                value: gen,
                description: `Add ${gen} gens to your transfer`
            }))
        );

    const selectRow = new ActionRowBuilder()
        .addComponents(genSelectMenu);

    await interaction.reply({
        content: `**Select which gen to add:** (${totalGens}/${globalValues.maxGensPerWithdraw} gens)`,
        components: [selectRow],
        flags: MessageFlags.Ephemeral
    });
}

// Centralized handler for all transfer-related buttons
async function handleTransferButton(interaction) {
    const customId = interaction.customId;

    if (customId.startsWith('transfer_add_')) {
        const sessionId = customId.replace('transfer_add_', '');
        await handleAddGen(interaction, sessionId);
    } else if (customId.startsWith('transfer_remove_')) {
        const sessionId = customId.replace('transfer_remove_', '');
        await handleRemoveItem(interaction, sessionId);
    } else if (customId.startsWith('transfer_confirm_')) {
        const sessionId = customId.replace('transfer_confirm_', '');
        await handleConfirm(interaction, sessionId);
    } else if (customId.startsWith('transfer_cancel_')) {
        const userId = customId.replace('transfer_cancel_', '');
        await handleCancel(interaction, userId);
    }
}

// Centralized handler for all transfer-related select menus
async function handleTransferSelect(interaction) {
    const customId = interaction.customId;

    if (customId.startsWith('transfer_select_')) {
        const sessionId = customId.replace('transfer_select_', '');
        await handleGenSelect(interaction, sessionId);
    }
}

// Centralized handler for all transfer-related modals
async function handleTransferModal(interaction) {
    const customId = interaction.customId;

    if (customId.startsWith('transfer_modal_')) {
        // Remove the prefix first
        const withoutPrefix = customId.replace('transfer_modal_', '');

        // Split and get the last part as the gen (e.g., 'godly')
        const parts = withoutPrefix.split('_');
        const selectedGen = parts[parts.length - 1]; // Last part is the gen

        // Everything except the last part is the sessionId
        const sessionId = parts.slice(0, -1).join('_');

        console.log('[Transfer] handleTransferModal - customId:', customId);
        console.log('[Transfer] handleTransferModal - parsed sessionId:', sessionId);
        console.log('[Transfer] handleTransferModal - parsed gen:', selectedGen);

        await handleAmountModal(interaction, sessionId, selectedGen);
    }
}

async function handleAddGen(interaction, sessionId) {
    console.log('[Transfer] handleAddGen called with sessionId:', sessionId);
    console.log('[Transfer] Active sessions:', Array.from(transferSessions.keys()));

    const session = transferSessions.get(sessionId);

    if (!session) {
        console.log('[Transfer] Session not found for sessionId:', sessionId);
        return await interaction.reply({
            content: `❌ This transfer session has expired or is invalid. Please run \`/transfer make\` again.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (interaction.user.id !== session.userId) {
        console.log('[Transfer] User mismatch. Expected:', session.userId, 'Got:', interaction.user.id);
        return await interaction.reply({
            content: '❌ This transfer session is not for you.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Create gen selection menu
    const genSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`transfer_select_${sessionId}`)
        .setPlaceholder('Select a gen type')
        .addOptions(
            globalValues.gensAfterGodly.map(gen => ({
                label: gen.charAt(0).toUpperCase() + gen.slice(1),
                value: gen,
                description: `Add ${gen} gens to your transfer`
            }))
        );

    const selectRow = new ActionRowBuilder()
        .addComponents(genSelectMenu);

    await interaction.reply({
        content: '**Select which gen to add:**',
        components: [selectRow],
        flags: MessageFlags.Ephemeral
    });
}

async function handleGenSelect(interaction, sessionId) {
    console.log('[Transfer] handleGenSelect called with sessionId:', sessionId);

    const session = transferSessions.get(sessionId);

    if (!session) {
        console.log('[Transfer] Session not found in handleGenSelect');
        return await interaction.reply({
            content: '❌ This transfer session has expired or is invalid. Please run `/transfer make` again.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (interaction.user.id !== session.userId) {
        console.log('[Transfer] User mismatch in handleGenSelect');
        return await interaction.reply({
            content: '❌ This transfer session is not for you.',
            flags: MessageFlags.Ephemeral
        });
    }

    const selectedGen = interaction.values[0];

    // Show modal to enter amount
    const modal = new ModalBuilder()
        .setCustomId(`transfer_modal_${sessionId}_${selectedGen}`)
        .setTitle(`Add ${selectedGen.charAt(0).toUpperCase() + selectedGen.slice(1)}`);

    const amountInput = new TextInputBuilder()
        .setCustomId('genAmount')
        .setLabel('How many gens do you want to add?')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter whole number (e.g., 5)')
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(amountInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
}

async function handleAmountModal(interaction, sessionId, selectedGen) {
    console.log('[Transfer] handleAmountModal called with sessionId:', sessionId, 'gen:', selectedGen);
    console.log('[Transfer] Active sessions:', Array.from(transferSessions.keys()));

    const session = transferSessions.get(sessionId);

    if (!session) {
        console.log('[Transfer] Session not found in handleAmountModal');
        console.log('[Transfer] Looking for sessionId:', sessionId);
        console.log('[Transfer] Available sessions:', Array.from(transferSessions.keys()));
        return await interaction.reply({
            content: '❌ This transfer session has expired or is invalid. Please run `/transfer make` again.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (interaction.user.id !== session.userId) {
        console.log('[Transfer] User mismatch in handleAmountModal');
        return await interaction.reply({
            content: '❌ This transfer session is not for you.',
            flags: MessageFlags.Ephemeral
        });
    }

    const amountRaw = interaction.fields.getTextInputValue('genAmount').trim();
    const genAmount = parseInt(amountRaw.replace(/[,]/g, ''), 10);

    if (isNaN(genAmount) || genAmount <= 0 || !Number.isInteger(genAmount)) {
        return await interaction.reply({
            content: '❌ Please enter a valid whole number for the gen amount (decimals are not allowed).',
            flags: MessageFlags.Ephemeral
        });
    }

    // Calculate current total gens in cart
    const currentTotalGens = session.items.reduce((sum, item) => sum + item.amount, 0);
    const newTotalGens = currentTotalGens + genAmount;

    // Check if adding this amount would exceed max gens limit
    if (newTotalGens > globalValues.maxGensPerWithdraw) {
        const remaining = globalValues.maxGensPerWithdraw - currentTotalGens;
        return await interaction.reply({
            content: `❌ You cannot add ${genAmount} gens. Maximum total gens per transfer is **${globalValues.maxGensPerWithdraw}**.\n\nYou currently have **${currentTotalGens}** gens in your cart. You can add up to **${remaining}** more gens.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Calculate points needed
    const genIndex = globalValues.gensAfterGodly.indexOf(selectedGen);
    const pointsPerGen = globalValues.pointsPerGodlyGen * Math.pow(10, genIndex);
    const itemPoints = genAmount * pointsPerGen;

    // Add item to session
    session.items.push({
        gen: selectedGen,
        amount: genAmount,
        points: itemPoints
    });
    session.totalPoints += itemPoints;

    console.log('[Transfer] Added item to session. Total items:', session.items.length, 'Total gens:', newTotalGens, 'Total points:', session.totalPoints);

    // Get user profile
    const profileData = await dbUtils.ensureProfile(session.userId, interaction.guild?.id ?? null);

    // Acknowledge modal
    await interaction.deferUpdate();

    // Update the original transfer message using stored message ID
    try {
        const channel = await interaction.client.channels.fetch(session.channelId);
        const transferMessage = await channel.messages.fetch(session.messageId);

        if (transferMessage) {
            await updateTransferListFromMessage(transferMessage, sessionId, profileData);
            console.log('[Transfer] Successfully updated transfer message');
        } else {
            console.log('[Transfer] Could not find original transfer message');
        }
    } catch (error) {
        console.error('[Transfer] Error updating original message:', error);
    }

    // Send confirmation
    await interaction.followUp({
        content: `✅ Added **${genAmount}x ${selectedGen.charAt(0).toUpperCase() + selectedGen.slice(1)}** (${itemPoints.toLocaleString()} points) to your transfer!\n\nTotal gens: **${newTotalGens}** / **${globalValues.maxGensPerWithdraw}**`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleRemoveItem(interaction, sessionId) {
    console.log('[Transfer] handleRemoveItem called with sessionId:', sessionId);

    const session = transferSessions.get(sessionId);

    if (!session) {
        console.log('[Transfer] Session not found in handleRemoveItem');
        return await interaction.reply({
            content: '❌ This transfer session has expired or is invalid. Please run `/transfer make` again.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (interaction.user.id !== session.userId) {
        console.log('[Transfer] User mismatch in handleRemoveItem');
        return await interaction.reply({
            content: '❌ This transfer session is not for you.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (session.items.length === 0) {
        return await interaction.reply({
            content: '❌ No items to remove.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Remove last item
    const removedItem = session.items.pop();
    session.totalPoints -= removedItem.points;

    console.log('[Transfer] Removed item. Remaining items:', session.items.length, 'Total points:', session.totalPoints);

    // Get user profile
    const profileData = await dbUtils.ensureProfile(session.userId, interaction.guild?.id ?? null);

    // Update the transfer list
    await updateTransferList(interaction, sessionId, profileData);
}

async function handleConfirm(interaction, sessionId) {
    console.log('[Transfer] handleConfirm called with sessionId:', sessionId);

    const session = transferSessions.get(sessionId);

    if (!session) {
        console.log('[Transfer] Session not found in handleConfirm');
        return await interaction.reply({
            content: '❌ This transfer session has expired or is invalid. Please run `/transfer make` again.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (interaction.user.id !== session.userId) {
        console.log('[Transfer] User mismatch in handleConfirm');
        return await interaction.reply({
            content: '❌ This transfer session is not for you.',
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferUpdate();

    try {
        // Get user profile
        let profileData = await dbUtils.ensureProfile(session.userId, interaction.guild?.id ?? null);

        // Final validation
        if (session.totalPoints < globalValues.minPointsPerWithdraw) {
            transferSessions.delete(sessionId);
            return await interaction.followUp({
                content: `❌ Transfer total is below minimum of ${globalValues.minPointsPerWithdraw.toLocaleString()} points. Transaction cancelled.`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (profileData.balance < session.totalPoints) {
            transferSessions.delete(sessionId);
            return await interaction.followUp({
                content: `❌ Insufficient balance. You need ${session.totalPoints.toLocaleString()} points but only have ${profileData.balance.toLocaleString()} points.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Check withdraw limits
        const canWithdrawResult = await withdrawUtil.canWithdraw(session.totalPoints, profileData);
        if (!canWithdrawResult.allowed) {
            transferSessions.delete(sessionId);
            return await interaction.followUp({
                content: `❌ Cannot complete transfer: ${canWithdrawResult.reason}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Process withdrawal
        await withdrawUtil.processWithdrawal(session.totalPoints, profileData);

        // Subtract points from balance
        profileData.balance -= session.totalPoints;
        await profileData.save();

        console.log('[Transfer] Transfer completed successfully. Points spent:', session.totalPoints);

        // Trigger balance change event
        try {
            const member = await interaction.guild.members.fetch(session.userId);
            const balanceChangeEvent = require('../events/balanceChange');
            balanceChangeEvent.execute(member);
        } catch (err) {
            console.error('Failed to trigger balance change event:', err);
        }

        // Build success message
        let itemsList = '';
        session.items.forEach((item, index) => {
            const genName = item.gen.charAt(0).toUpperCase() + item.gen.slice(1);
            itemsList += `${index + 1}. **${item.amount}x ${genName}** - ${item.points.toLocaleString()} points\n`;
        });

        const successEmbed = new EmbedBuilder()
            .setTitle('✅ Transfer Successful!')
            .setColor(0x2ECC71)
            .setDescription('You have successfully transferred points to gens!\n\n**Items Received:**\n' + itemsList)
            .addFields(
                {
                    name: '📊 Total Points Spent',
                    value: `${session.totalPoints.toLocaleString()} points`,
                    inline: true
                },
                {
                    name: '💳 New Balance',
                    value: `${profileData.balance.toLocaleString()} points`,
                    inline: true
                },
                {
                    name: '📅 Weekly Withdrawn',
                    value: `${profileData.weeklyWithdrawAmount.toLocaleString()} / ${(globalValues.maxWithdrawPerWeek + (profileData.customWithdrawLimit || 0)).toLocaleString()} points`,
                    inline: false
                }
            )
            .setFooter({ text: 'Thank you for your transfer!', iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        //make a new transferModel instance to log the transfer
        const newTransfer = new transferModel({
            userId: session.userId,
            serverID: interaction.guild.id,
            transferDescription: session.items.map(item => `${item.amount}x ${item.gen.charAt(0).toUpperCase() + item.gen.slice(1)}`).join(', '),
            pointsPaid: session.totalPoints,
            createdAt: new Date(),
            status: 'pending',
        });
        await newTransfer.save();

        // Log to withdrawals-logs channel
        const logsChannel = interaction.guild.channels.cache.get(WITHDRAWALS_LOGS_CHANNEL_ID);
        if (logsChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('💸 New Transfer Logged')
                .setColor(0x3498DB)
                .addFields(
                    { name: 'user', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Total Points', value: session.totalPoints.toLocaleString(), inline: true },
                    { name: 'Items', value: session.items.map(item => `${item.amount}x ${item.gen.charAt(0).toUpperCase() + item.gen.slice(1)}`).join('\n'), inline: false }
                )
                .setTimestamp();

            logsChannel.send({ embeds: [logEmbed] }).catch(console.error);
        }

        // Clean up session
        transferSessions.delete(sessionId);

        await interaction.editReply({ embeds: [successEmbed], components: [] });

    } catch (error) {
        console.error('Error processing transfer:', error);
        transferSessions.delete(sessionId);
        await interaction.followUp({
            content: '❌ An error occurred while processing your transfer. Please try again.',
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleCancel(interaction, userId) {
    if (interaction.user.id !== userId) {
        return await interaction.reply({
            content: '❌ This button is not for you.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Clean up any sessions for this user
    for (const [sessionId, session] of transferSessions.entries()) {
        if (session.userId === userId) {
            transferSessions.delete(sessionId);
        }
    }

    const cancelEmbed = new EmbedBuilder()
        .setTitle('❌ Transfer Cancelled')
        .setColor(0x95A5A6)
        .setDescription('Your transfer has been cancelled. No points were deducted.')
        .setTimestamp();

    await interaction.update({ embeds: [cancelEmbed], components: [] });
}