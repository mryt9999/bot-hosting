const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const globalValues = require('../globalValues.json');
const dbUtils = require('../utils/dbUtils');
const withdrawUtil = require('../utils/withdrawUtil');

const genChoices = globalValues.gensAfterGodly.map(gen => ({
    name: gen,
    value: gen
}));

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
                .setDescription('Transfer points into gens')),

    async execute(interaction, profileData = null, opts = {}) {
        await interaction.deferReply();

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'calculator') {
            const genOption = interaction.options.getString('gen');
            const targetUser = interaction.options.getUser('user') || interaction.user;

            // Ensure profileData exists for target user
            if (!profileData || targetUser.id !== interaction.user.id) {
                profileData = await dbUtils.ensureProfile(targetUser.id, interaction.guild?.id ?? null);
            }

            const points = profileData.balance;
            let genValue;

            if (genOption) {
                // Calculate value in specified gen
                const genIndex = globalValues.gensAfterGodly.indexOf(genOption);
                if (genIndex === -1) {
                    return await interaction.editReply({ content: 'Invalid gen specified.' });
                }
                const pointsPerGen = globalValues.pointsPerGodlyGen * Math.pow(10, genIndex);
                genValue = points / pointsPerGen;

                // Format: no decimals if whole number part has 2+ digits
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

            // Determine closest gen - find highest gen where value >= 1
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

            // Format: no decimals if whole number part has 2+ digits
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
                // Use withdrawUtil to get and reset global data
                const globalWithdrawData = await withdrawUtil.getGlobalWithdrawData();
                withdrawUtil.resetGlobalWithdrawIfNeeded(globalWithdrawData);
                await globalWithdrawData.save();

                const temporaryLimitIncrease = globalWithdrawData.temporaryLimitIncrease || 0;
                // Calculate remaining including temporary increase
                const remaining = globalValues.maxGlobalWithdrawPerWeek + temporaryLimitIncrease - globalWithdrawData.totalWithdrawnThisWeek;
                const resetTimestamp = Math.floor(globalWithdrawData.weekStartAt / 1000) + 7 * 24 * 60 * 60;

                const embed = new EmbedBuilder()
                    .setTitle('🌐 Global Weekly Withdraw Limit Status 🌐')
                    .setColor(0x3498DB)
                    .setTimestamp()
                    .setThumbnail(interaction.guild?.iconURL({ dynamic: true, size: 256 }))
                    .addFields(
                        {
                            name: 'Total Withdrawn This Week',
                            //indlue temporary limit increase in total withdrawn display
                            value: `${globalWithdrawData.totalWithdrawnThisWeek.toLocaleString()} / ${(globalValues.maxGlobalWithdrawPerWeek).toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Remaining Global Withdraw',
                            value: `${(remaining + (globalWithdrawData.temporaryLimitIncrease || 0)).toLocaleString()} points`,
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

            // Personal view - Ensure profileData exists with dbUtils
            if (!profileData || targetUser.id !== interaction.user.id) {
                profileData = await dbUtils.ensureProfile(targetUser.id, interaction.guild?.id ?? null);
            }

            // Check user-specific withdraw limit using withdrawUtil
            await withdrawUtil.canWithdraw(0, profileData);

            const remaining = globalValues.maxWithdrawPerWeek - profileData.weeklyWithdrawAmount;
            const resetTimestamp = profileData.firstWithdrawAt === 0
                ? Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
                : Math.floor(profileData.firstWithdrawAt / 1000) + 7 * 24 * 60 * 60;

            const embed = new EmbedBuilder()
                .setTitle(`💸 ${targetUser.username}'s Weekly Withdraw Limit Status 💸`)
                .setColor(0x3498DB)
                .setTimestamp()
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    {
                        name: 'Total Withdrawn This Week',
                        value: `${profileData.weeklyWithdrawAmount.toLocaleString()} / ${globalValues.maxWithdrawPerWeek.toLocaleString()} points`,
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
            // Ensure profileData exists
            if (!profileData) {
                profileData = await dbUtils.ensureProfile(interaction.user.id, interaction.guild?.id ?? null);
            }

            // Check withdraw limits
            const canWithdrawResult = await withdrawUtil.canWithdraw(globalValues.minPointsPerWithdraw, profileData);
            if (!canWithdrawResult.allowed) {
                return await interaction.editReply({
                    content: `❌ Cannot create transfer: ${canWithdrawResult.reason}`,
                });
            }

            // Check if user has minimum points
            if (profileData.balance < globalValues.minPointsPerWithdraw) {
                return await interaction.editReply({
                    content: `❌ You need at least **${globalValues.minPointsPerWithdraw.toLocaleString()}** points to make a transfer. You have **${profileData.balance.toLocaleString()}** points.`,
                });
            }

            // Create initial confirmation embed
            const confirmEmbed = new EmbedBuilder()
                .setTitle('💎 Transfer Points to Gens')
                .setColor(0x9B59B6)
                .setDescription('Are you ready to transfer your points into gens?')
                .addFields(
                    {
                        name: '📊 Your Balance',
                        value: `${profileData.balance.toLocaleString()} points`,
                        inline: true
                    },
                    {
                        name: '💰 Min Transfer',
                        value: `${globalValues.minPointsPerWithdraw.toLocaleString()} points`,
                        inline: true
                    },
                    {
                        name: '🎯 Max Gens Per Transfer',
                        value: `${globalValues.maxGensPerWithdraw} gens`,
                        inline: true
                    }
                )
                .setFooter({ text: 'Click the button below to begin', iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            const confirmButton = new ButtonBuilder()
                .setCustomId(`transfer_start_${interaction.user.id}`)
                .setLabel('Begin Transfer')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✅');

            const cancelButton = new ButtonBuilder()
                .setCustomId(`transfer_cancel_${interaction.user.id}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('❌');

            const row = new ActionRowBuilder()
                .addComponents(confirmButton, cancelButton);

            return await interaction.editReply({ embeds: [confirmEmbed], components: [row] });
        }
    }
};

// Export for button handlers
module.exports.handleTransferStart = handleTransferStart;
module.exports.handleGenSelect = handleGenSelect;
module.exports.handleTransferConfirm = handleTransferConfirm;

async function handleTransferStart(interaction, userId) {
    // Verify user
    if (interaction.user.id !== userId) {
        return await interaction.reply({
            content: 'This button is not for you.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Get user profile
    const profileData = await dbUtils.ensureProfile(userId, interaction.guild?.id ?? null);

    // Create gen selection menu
    const genSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`transfer_gen_select_${userId}`)
        .setPlaceholder('Select a gen type')
        .addOptions(
            globalValues.gensAfterGodly.map(gen => ({
                label: gen.charAt(0).toUpperCase() + gen.slice(1),
                value: gen,
                description: `Transfer points to ${gen} gens`
            }))
        );

    const selectRow = new ActionRowBuilder()
        .addComponents(genSelectMenu);

    const embed = new EmbedBuilder()
        .setTitle('💎 Select Gen Type')
        .setColor(0x9B59B6)
        .setDescription('Choose which gen you want to transfer points for.')
        .addFields(
            {
                name: '📊 Your Balance',
                value: `${profileData.balance.toLocaleString()} points`,
                inline: true
            },
            {
                name: '🎯 Gens Remaining',
                value: `${globalValues.maxGensPerWithdraw} / ${globalValues.maxGensPerWithdraw}`,
                inline: true
            }
        )
        .setFooter({ text: 'Step 1: Select gen type', iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    await interaction.update({ embeds: [embed], components: [selectRow] });
}

async function handleGenSelect(interaction, userId) {
    // Verify user
    if (interaction.user.id !== userId) {
        return await interaction.reply({
            content: 'This selection is not for you.',
            flags: MessageFlags.Ephemeral
        });
    }

    const selectedGen = interaction.values[0];

    // Show modal to enter amount
    const modal = new ModalBuilder()
        .setCustomId(`transfer_amount_modal_${userId}_${selectedGen}`)
        .setTitle(`Transfer to ${selectedGen.charAt(0).toUpperCase() + selectedGen.slice(1)}`);

    const amountInput = new TextInputBuilder()
        .setCustomId('genAmount')
        .setLabel('How many gens do you want?')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`Max: ${globalValues.maxGensPerWithdraw}`)
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(amountInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
}

async function handleTransferAmountModal(interaction, userId, selectedGen) {
    // Verify user
    if (interaction.user.id !== userId) {
        return await interaction.reply({
            content: 'This modal is not for you.',
            flags: MessageFlags.Ephemeral
        });
    }

    const amountRaw = interaction.fields.getTextInputValue('genAmount').trim();
    const genAmount = parseFloat(amountRaw.replace(/[,]/g, ''));

    if (isNaN(genAmount) || genAmount <= 0) {
        return await interaction.reply({
            content: '❌ Please enter a valid positive number for the gen amount.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (genAmount > globalValues.maxGensPerWithdraw) {
        return await interaction.reply({
            content: `❌ You can only transfer a maximum of **${globalValues.maxGensPerWithdraw}** gens per transfer.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Calculate points needed
    const genIndex = globalValues.gensAfterGodly.indexOf(selectedGen);
    const pointsPerGen = globalValues.pointsPerGodlyGen * Math.pow(10, genIndex);
    const totalPoints = Math.ceil(genAmount * pointsPerGen);

    // Get user profile
    const profileData = await dbUtils.ensureProfile(userId, interaction.guild?.id ?? null);

    // Validate transfer
    if (totalPoints < globalValues.minPointsPerWithdraw) {
        return await interaction.reply({
            content: `❌ Transfer total must be at least **${globalValues.minPointsPerWithdraw.toLocaleString()}** points. Your transfer is worth **${totalPoints.toLocaleString()}** points.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (profileData.balance < totalPoints) {
        return await interaction.reply({
            content: `❌ Insufficient balance. You need **${totalPoints.toLocaleString()}** points but only have **${profileData.balance.toLocaleString()}** points.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Check withdraw limits
    const canWithdrawResult = await withdrawUtil.canWithdraw(totalPoints, profileData);
    if (!canWithdrawResult.allowed) {
        return await interaction.reply({
            content: `❌ Cannot complete transfer: ${canWithdrawResult.reason}`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Create confirmation embed
    const confirmEmbed = new EmbedBuilder()
        .setTitle('💎 Confirm Transfer')
        .setColor(0xE67E22)
        .setDescription('Please review your transfer details:')
        .addFields(
            {
                name: '🎯 Gen Type',
                value: selectedGen.charAt(0).toUpperCase() + selectedGen.slice(1),
                inline: true
            },
            {
                name: '💰 Gen Amount',
                value: `${genAmount} gens`,
                inline: true
            },
            {
                name: '📊 Points Required',
                value: `${totalPoints.toLocaleString()} points`,
                inline: true
            },
            {
                name: '💳 Your Balance',
                value: `${profileData.balance.toLocaleString()} points`,
                inline: true
            },
            {
                name: '💸 After Transfer',
                value: `${(profileData.balance - totalPoints).toLocaleString()} points`,
                inline: true
            }
        )
        .setFooter({ text: 'This action cannot be undone', iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    const confirmButton = new ButtonBuilder()
        .setCustomId(`transfer_confirm_${userId}_${selectedGen}_${genAmount}`)
        .setLabel('Confirm Transfer')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

    const cancelButton = new ButtonBuilder()
        .setCustomId(`transfer_cancel_${userId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

    const row = new ActionRowBuilder()
        .addComponents(confirmButton, cancelButton);

    await interaction.reply({ embeds: [confirmEmbed], components: [row], flags: MessageFlags.Ephemeral });
}

async function handleTransferConfirm(interaction, userId, selectedGen, genAmount) {
    // Verify user
    if (interaction.user.id !== userId) {
        return await interaction.reply({
            content: 'This button is not for you.',
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferUpdate();

    // Calculate points needed
    const genIndex = globalValues.gensAfterGodly.indexOf(selectedGen);
    const pointsPerGen = globalValues.pointsPerGodlyGen * Math.pow(10, genIndex);
    const totalPoints = Math.ceil(parseFloat(genAmount) * pointsPerGen);

    // Get user profile
    let profileData = await dbUtils.ensureProfile(userId, interaction.guild?.id ?? null);

    // Final validation
    if (profileData.balance < totalPoints) {
        return await interaction.followUp({
            content: `❌ Insufficient balance. Transaction cancelled.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Check withdraw limits again
    const canWithdrawResult = await withdrawUtil.canWithdraw(totalPoints, profileData);
    if (!canWithdrawResult.allowed) {
        return await interaction.followUp({
            content: `❌ Cannot complete transfer: ${canWithdrawResult.reason}`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Process withdrawal
    await withdrawUtil.processWithdrawal(totalPoints, profileData);

    // Subtract points from balance using utility function
    const updateResult = await dbUtils.updateBalance(
        userId,
        -totalPoints,
        { interaction },
        { serverId: interaction.guild?.id ?? null, checkBalance: false }
    );

    if (!updateResult.success) {
        return await interaction.followUp({
            content: `❌ Failed to complete transfer: ${updateResult.reason}`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Refresh profile data to get updated balance
    const profileModel = require('../models/profileSchema');
    profileData = await profileModel.findOne({ userId });

    // Create success embed
    const successEmbed = new EmbedBuilder()
        .setTitle('✅ Transfer Successful!')
        .setColor(0x2ECC71)
        .setDescription(`You have successfully transferred points to gens!`)
        .addFields(
            {
                name: '🎯 Gen Type',
                value: selectedGen.charAt(0).toUpperCase() + selectedGen.slice(1),
                inline: true
            },
            {
                name: '💰 Gens Received',
                value: `${genAmount} gens`,
                inline: true
            },
            {
                name: '📊 Points Spent',
                value: `${totalPoints.toLocaleString()} points`,
                inline: true
            },
            {
                name: '💳 New Balance',
                value: `${profileData.balance.toLocaleString()} points`,
                inline: true
            },
            {
                name: '📅 Weekly Withdrawn',
                value: `${profileData.weeklyWithdrawAmount.toLocaleString()} / ${globalValues.maxWithdrawPerWeek.toLocaleString()} points`,
                inline: true
            }
        )
        .setFooter({ text: 'Thank you for your transfer!', iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed], components: [] });
}

async function handleTransferCancel(interaction, userId) {
    // Verify user
    if (interaction.user.id !== userId) {
        return await interaction.reply({
            content: 'This button is not for you.',
            flags: MessageFlags.Ephemeral
        });
    }

    const cancelEmbed = new EmbedBuilder()
        .setTitle('❌ Transfer Cancelled')
        .setColor(0x95A5A6)
        .setDescription('Your transfer has been cancelled. No points were deducted.')
        .setTimestamp();

    await interaction.update({ embeds: [cancelEmbed], components: [] });
}

module.exports.handleTransferCancel = handleTransferCancel;
module.exports.handleTransferAmountModal = handleTransferAmountModal;