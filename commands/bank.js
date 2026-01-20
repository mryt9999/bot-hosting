const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const mongoose = require('mongoose');
const profileModel = require('../models/profileSchema');
const bankModel = require('../models/bankSchema');
const policeTaxModel = require('../models/policeTaxSchema');
const globalValues = require('../globalValues.json');
const { calculateInterestRate } = require('../schedulers/bankInterestScheduler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bank')
        .setDescription('Manage your bank')
        .addSubcommand(subcommand =>
            subcommand
                .setName('deposit')
                .setDescription('Deposit points to a bank')
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('The amount of points to deposit')
                        .setRequired(true)
                        .setMinValue(1))
                .addUserOption(option =>
                    option.setName('recipient')
                        .setDescription('The bank owner to deposit to (optional - your bank if not specified)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('withdraw')
                .setDescription('Withdraw points from your bank')
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('The amount of points to withdraw')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View bank information')
                .addUserOption(option =>
                    option.setName('player')
                        .setDescription('View another player\'s bank (optional)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('defense')
                .setDescription('View and purchase bank defenses'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('rob')
                .setDescription('Rob points from another player\'s bank')
                .addUserOption(option =>
                    option.setName('target')
                        .setDescription('The player to rob from')
                        .setRequired(true))),
    async execute(interaction, profileData, opts = {}) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'deposit') {
            return await handleDeposit(interaction, profileData, opts);
        } else if (subcommand === 'withdraw') {
            return await handleWithdraw(interaction, profileData, opts);
        } else if (subcommand === 'view') {
            return await handleView(interaction, profileData, opts);
        } else if (subcommand === 'defense') {
            return await handleBankDefense(interaction, profileData, opts);
        } else if (subcommand === 'rob') {
            return await handleRob(interaction, profileData, opts);
        }
    },
};

async function handleDeposit(interaction, profileData, opts) {
    const ephemeral = opts.flags ? (opts.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral : !!opts.ephemeral;
    const callerFlags = opts.flags ?? (opts.ephemeral ? MessageFlags.Ephemeral : undefined);
    const flags = callerFlags ? { flags: callerFlags } : {};

    const amount = typeof opts.amount === 'number' ? opts.amount : interaction.options?.getInteger('amount');
    const recipientOption = interaction.options?.getUser('recipient');
    // Only treat as recipient if it's explicitly provided and NOT the command user
    const recipientId = recipientOption?.id && recipientOption.id !== interaction.user.id ? recipientOption.id : null;

    console.log('Bank Deposit Debug:', {
        recipientId,
        recipientOption: recipientOption?.username,
        amount,
        bankOwned: profileData.bankOwned,
        userId: interaction.user.id,
        hasRecipientId: !!recipientId
    });

    // Fetch fresh profile data to ensure latest bank ownership status
    const freshProfileData = await profileModel.findOne({ userId: interaction.user.id, serverID: interaction.guild.id }) || profileData;

    // If no recipient specified, deposit to own bank
    if (!recipientId) {
        // Check if user owns a bank
        if (!freshProfileData.bankOwned) {
            // Show purchase prompt
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('bank_purchase_yes')
                        .setLabel('Yes, Purchase Bank')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('bank_purchase_no')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );

            const embed = new EmbedBuilder()
                .setColor('#ff9800')
                .setTitle('Bank Feature Not Owned')
                .setDescription(`You don't have a bank yet! Would you like to purchase the bank feature for **${globalValues.bankFeatureCost.toLocaleString()}** points?\n\nOnce you own a bank, you can:\n• Deposit and withdraw points from your own bank\n• Receive deposits from other players`)
                .setFooter({ text: 'Bank Purchase' });

            const msg = await interaction.reply({
                embeds: [embed],
                components: [row],
                ...flags,
                fetchReply: true
            });

            interaction.bankPurchaseMsg = msg.id;
            return;
        }

        // Validate amount
        if (!amount || amount <= 0) {
            const embed = new EmbedBuilder()
                .setColor('#ff5252')
                .setTitle('Invalid Amount')
                .setDescription('Please specify a valid amount to deposit.');

            if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
            return interaction.editReply({ embeds: [embed] });
        }

        // User owns bank, deposit to own bank
        if (amount > freshProfileData.balance) {
            const embed = new EmbedBuilder()
                .setColor('#ff5252')
                .setTitle('Insufficient Balance')
                .setDescription(`You need **${amount.toLocaleString()}** points but only have **${freshProfileData.balance.toLocaleString()}** points.`);

            if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
            return interaction.editReply({ embeds: [embed] });
        }

        // Deduct from balance and add to bank using atomic operation
        const updateResult = await profileModel.findOneAndUpdate(
            { userId: interaction.user.id, serverID: interaction.guild.id, balance: { $gte: amount } },
            { $inc: { balance: -amount, bankBalance: amount } },
            { new: true }
        );

        if (!updateResult) {
            // Balance wasn't sufficient or profile was modified concurrently
            const currentProfile = await profileModel.findOne({ userId: interaction.user.id, serverID: interaction.guild.id });
            const embed = new EmbedBuilder()
                .setColor('#ff5252')
                .setTitle('Insufficient Balance')
                .setDescription(`You need **${amount.toLocaleString()}** points but only have **${currentProfile.balance.toLocaleString()}** points.`);

            if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
            return interaction.editReply({ embeds: [embed] });
        }

        const embed = new EmbedBuilder()
            .setColor('#4caf50')
            .setTitle('Deposited to Your Bank')
            .setDescription(`Successfully deposited **${amount.toLocaleString()}** points to your bank.`)
            .addFields(
                { name: 'New Balance', value: `${updateResult.balance.toLocaleString()}`, inline: true },
                { name: 'Bank Balance', value: `${updateResult.bankBalance.toLocaleString()}`, inline: true }
            );

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    // Deposit to another player's bank
    const recipient = await profileModel.findOne({ userId: recipientId, serverID: interaction.guild.id });

    if (!recipient) {
        const embed = new EmbedBuilder()
            .setColor('#ff5252')
            .setTitle('User Not Found')
            .setDescription('The specified user has no profile on this server.');

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    if (!recipient.bankOwned) {
        const embed = new EmbedBuilder()
            .setColor('#ff5252')
            .setTitle('No Bank Found')
            .setDescription(`<@${recipientId}> does not own a bank yet.`);

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    if (amount > freshProfileData.balance) {
        const embed = new EmbedBuilder()
            .setColor('#ff5252')
            .setTitle('Insufficient Balance')
            .setDescription(`You need **${amount.toLocaleString()}** points but only have **${freshProfileData.balance.toLocaleString()}** points.`);

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    // Deduct from depositor's balance using atomic operation
    const depositorUpdateResult = await profileModel.findOneAndUpdate(
        { userId: interaction.user.id, serverID: interaction.guild.id, balance: { $gte: amount } },
        { $inc: { balance: -amount } },
        { new: true }
    );

    if (!depositorUpdateResult) {
        // Balance check failed - get current balance for error message
        const currentProfile = await profileModel.findOne({ userId: interaction.user.id, serverID: interaction.guild.id });
        const embed = new EmbedBuilder()
            .setColor('#ff5252')
            .setTitle('Insufficient Balance')
            .setDescription(`You need **${amount.toLocaleString()}** points but only have **${currentProfile?.balance?.toLocaleString() || '0'}** points.`);

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    // Add to recipient's bank using atomic operation
    const recipientUpdateResult = await profileModel.findOneAndUpdate(
        { userId: recipientId, serverID: interaction.guild.id },
        { $inc: { bankBalance: amount } },
        { new: true }
    );

    if (!recipientUpdateResult) {
        // Recipient profile was deleted - refund the depositor
        await profileModel.updateOne(
            { userId: interaction.user.id, serverID: interaction.guild.id },
            { $inc: { balance: amount } }
        );
        const embed = new EmbedBuilder()
            .setColor('#ff5252')
            .setTitle('Recipient Not Found')
            .setDescription(`<@${recipientId}>'s profile was deleted. Your points have been refunded.`);

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    // Record the deposit
    await bankModel.create({
        bankOwnerId: recipientId,
        depositerId: interaction.user.id,
        serverID: interaction.guild.id,
        amount: amount,
        depositedAt: Date.now()
    });

    const embed = new EmbedBuilder()
        .setColor('#4caf50')
        .setTitle('Deposit Successful')
        .setDescription(`You deposited **${amount.toLocaleString()}** points to <@${recipientId}>'s bank.`)
        .addFields(
            { name: 'Your New Balance', value: `${depositorUpdateResult.balance.toLocaleString()}`, inline: true },
            { name: 'Recipient Bank', value: `${recipientUpdateResult.bankBalance.toLocaleString()}`, inline: true }
        );

    if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
    return interaction.editReply({ embeds: [embed] });
}

async function handleWithdraw(interaction, profileData, opts) {
    const ephemeral = opts.flags ? (opts.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral : !!opts.ephemeral;
    const callerFlags = opts.flags ?? (opts.ephemeral ? MessageFlags.Ephemeral : undefined);
    const flags = callerFlags ? { flags: callerFlags } : {};

    const amount = typeof opts.amount === 'number' ? opts.amount : interaction.options?.getInteger('amount');

    // Check if user owns a bank
    if (!profileData.bankOwned) {
        const embed = new EmbedBuilder()
            .setColor('#ff5252')
            .setTitle('No Bank Owned')
            .setDescription('You must own a bank to withdraw points. Use `/bank deposit` to purchase a bank for 10,000 points.');

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    // Check if user has enough in bank
    if (amount > profileData.bankBalance) {
        const embed = new EmbedBuilder()
            .setColor('#ff5252')
            .setTitle('Insufficient Bank Balance')
            .setDescription(`You need **${amount.toLocaleString()}** points but only have **${profileData.bankBalance.toLocaleString()}** in your bank.`);

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    // Withdraw from bank to balance using atomic operation
    const withdrawResult = await profileModel.findOneAndUpdate(
        { userId: interaction.user.id, serverID: interaction.guild.id, bankBalance: { $gte: amount } },
        { $inc: { bankBalance: -amount, balance: amount } },
        { new: true }
    );

    if (!withdrawResult) {
        // Bank balance check failed - get current balance for error message
        const currentProfile = await profileModel.findOne({ userId: interaction.user.id, serverID: interaction.guild.id });
        const embed = new EmbedBuilder()
            .setColor('#ff5252')
            .setTitle('Insufficient Bank Balance')
            .setDescription(`You need **${amount.toLocaleString()}** points but only have **${currentProfile?.bankBalance?.toLocaleString() || '0'}** in your bank.`);

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
        .setColor('#4caf50')
        .setTitle('Withdrawal Successful')
        .setDescription(`Successfully withdrew **${amount.toLocaleString()}** points from your bank.`)
        .addFields(
            { name: 'New Balance', value: `${withdrawResult.balance.toLocaleString()}`, inline: true },
            { name: 'Bank Balance', value: `${withdrawResult.bankBalance.toLocaleString()}`, inline: true }
        );

    if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
    return interaction.editReply({ embeds: [embed] });
}

async function handleView(interaction, profileData, opts) {
    const ephemeral = opts.flags ? (opts.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral : !!opts.ephemeral;
    const callerFlags = opts.flags ?? (opts.ephemeral ? MessageFlags.Ephemeral : undefined);
    const flags = callerFlags ? { flags: callerFlags } : {};

    const targetUser = interaction.options?.getUser('player');
    const targetId = targetUser?.id || interaction.user.id;
    const isOwnBank = targetId === interaction.user.id;

    let targetProfile = isOwnBank ? profileData : await profileModel.findOne({ userId: targetId, serverID: interaction.guild.id });

    if (!targetProfile) {
        const embed = new EmbedBuilder()
            .setColor('#ff5252')
            .setTitle('User Not Found')
            .setDescription('The specified user has no profile on this server.');

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    if (!targetProfile.bankOwned) {
        const embed = new EmbedBuilder()
            .setColor('#ffa500')
            .setTitle('No Bank')
            .setDescription(`<@${targetId}> does not own a bank yet.`);

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    // Get recent deposits
    const deposits = await bankModel.find({ bankOwnerId: targetId, serverID: interaction.guild.id })
        .sort({ depositedAt: -1 })
        .limit(10);

    // Calculate interest earnings
    const interestRate = calculateInterestRate(targetProfile.bankBalance);
    const interestPerHour = Math.floor(targetProfile.bankBalance * interestRate);

    const embed = new EmbedBuilder()
        .setColor('#2196f3')
        .setTitle(`${isOwnBank ? 'Your' : `${targetUser.username}'s`} Bank`)
        .setDescription(`**Bank Balance:** ${targetProfile.bankBalance.toLocaleString()} points`)
        .addFields(
            { name: 'Account Balance', value: `${targetProfile.balance.toLocaleString()}`, inline: true },
            { name: 'Total Assets', value: `${(targetProfile.balance + targetProfile.bankBalance).toLocaleString()}`, inline: true },
            { name: '💰 Interest Rate', value: `${(interestRate * 100).toFixed(3)}% per hour`, inline: true },
            { name: '📈 Interest Earned', value: `${interestPerHour.toLocaleString()} points per hour`, inline: true }
        );

    if (deposits.length > 0) {
        const depositList = deposits.map(d => `• <@${d.depositerId}>: ${d.amount.toLocaleString()} pts`).join('\n');
        embed.addFields({
            name: 'Recent Deposits',
            value: depositList || 'No deposits yet'
        });
    }

    if (isOwnBank) {
        embed.setFooter({ text: 'Use /bank deposit or /bank withdraw to manage your bank' });
    }

    if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
    return interaction.editReply({ embeds: [embed] });
}

const DEFENSES = {
    minor: { tier: 1, cost: 10000, reduction: 50, duration: 7 * 24 * 60 * 60 * 1000 },
    normal: { tier: 2, cost: 30000, reduction: 80, duration: 7 * 24 * 60 * 60 * 1000 },
    major: { tier: 3, cost: 100000, reduction: 99, duration: 7 * 24 * 60 * 60 * 1000 }
};

async function handleBankDefense(interaction, profileData, opts) {
    const ephemeral = opts.flags ? (opts.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral : !!opts.ephemeral;
    const callerFlags = opts.flags ?? (opts.ephemeral ? MessageFlags.Ephemeral : undefined);
    const flags = callerFlags ? { flags: callerFlags } : {};

    const freshProfileData = await profileModel.findOne({ userId: interaction.user.id, serverID: interaction.guild.id }) || profileData;

    if (!freshProfileData.bankOwned) {
        const embed = new EmbedBuilder()
            .setColor('#ff5252')
            .setTitle('No Bank Owned')
            .setDescription('You must own a bank to purchase defenses. Use `/bank deposit` to purchase a bank first.');

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('defense_purchase_minor')
                .setLabel('Minor Defense')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🛡️'),
            new ButtonBuilder()
                .setCustomId('defense_purchase_normal')
                .setLabel('Normal Defense')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('⚔️'),
            new ButtonBuilder()
                .setCustomId('defense_purchase_major')
                .setLabel('Major Defense')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('👑')
        );

    const currentDefenseLevel = freshProfileData.bankDefenseLevel;
    const defenseExpiresAt = freshProfileData.bankDefenseExpiresAt;
    const now = Date.now();
    const isDefenseActive = defenseExpiresAt > now;

    let defenseInfo = 'No active defense';
    if (isDefenseActive) {
        const defenseNames = { 1: 'Minor Defense', 2: 'Normal Defense', 3: 'Major Defense' };
        const daysLeft = Math.ceil((defenseExpiresAt - now) / (24 * 60 * 60 * 1000));
        defenseInfo = `**${defenseNames[currentDefenseLevel]}** - Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;
    }

    const embed = new EmbedBuilder()
        .setColor('#2196f3')
        .setTitle('🛡️ Bank Defenses')
        .setDescription('Protect your bank from robbers! Purchase a defense to reduce steal amounts.')
        .addFields(
            {
                name: 'Current Defense',
                value: defenseInfo,
                inline: false
            },
            {
                name: 'Minor Defense 🛡️',
                value: `Cost: 10,000 points\nReduction: 50%\nDuration: 7 days`,
                inline: true
            },
            {
                name: 'Normal Defense ⚔️',
                value: `Cost: 30,000 points\nReduction: 80%\nDuration: 7 days`,
                inline: true
            },
            {
                name: 'Major Defense 👑',
                value: `Cost: 100,000 points\nReduction: 99%\nDuration: 7 days`,
                inline: true
            },
            {
                name: 'Your Balance',
                value: `${freshProfileData.balance.toLocaleString()} points`,
                inline: false
            }
        );

    if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({ embeds: [embed], components: [row], ...flags });
    }
    return interaction.editReply({ embeds: [embed], components: [row] });
}

const ROB_COOLDOWN = 5 * 60 * 60 * 1000;
/**
 * Calculate and update police tax based on robbery activity
 * Uses exponential growth with diminishing returns at higher tax rates
 * Also decreases tax when robberies are infrequent
 * 
 * Increase formula: increase = (robberyAmount / 500) * e^(-currentTaxRate * 4) / 50
 * Decay formula: If no robberies in 1 hour, decay = currentTaxRate * 0.05 per hour
 */
async function updatePoliceTax(robberyAmount) {
    try {
        let policeTax = await policeTaxModel.findById('policeTax');

        if (!policeTax) {
            policeTax = await policeTaxModel.create({
                _id: 'policeTax',
                currentTaxRate: 0,
                totalRobberyAmount: 0,
                robberyCount: 0,
                lastUpdatedAt: Date.now()
            });
        }

        // Check if we need to apply decay (no robberies in last hour)
        const timeSinceLastRobbery = Date.now() - policeTax.lastUpdatedAt;
        const ONE_HOUR = 60 * 60 * 1000;

        let currentRate = policeTax.currentTaxRate;

        // Apply decay if more than 1 hour has passed since last robbery
        if (timeSinceLastRobbery > ONE_HOUR) {
            const hoursPassed = timeSinceLastRobbery / ONE_HOUR;
            const decayPerHour = 0.05; // 5% reduction per hour of inactivity
            const decayAmount = currentRate * decayPerHour * hoursPassed;
            currentRate = Math.max(currentRate - decayAmount, 0);
        }

        // Exponential growth formula with diminishing returns
        // robberyAmount normalized to 500 (smaller baseline for faster growth)
        // Lower exponent (4 instead of 8) for faster initial growth
        const baseIncrease = (robberyAmount / 500) * Math.exp(-currentRate * 4) / 50;

        const newTaxRate = Math.min(currentRate + baseIncrease, 0.95); // Cap at 95%

        // Update tax rate, robbery tracking, and timestamp
        await policeTaxModel.findByIdAndUpdate(
            'policeTax',
            {
                $set: { currentTaxRate: newTaxRate, lastUpdatedAt: Date.now() },
                $inc: { totalRobberyAmount: robberyAmount, robberyCount: 1 }
            },
            { new: true }
        );

        return newTaxRate;
    } catch (err) {
        console.error('Failed to update police tax:', err);
        return 0;
    }
}

/**
 * Get current police tax rate (with decay applied if needed)
 */
async function getPoliceTax() {
    try {
        let policeTax = await policeTaxModel.findById('policeTax');
        if (!policeTax) {
            policeTax = await policeTaxModel.create({
                _id: 'policeTax',
                currentTaxRate: 0,
                totalRobberyAmount: 0,
                robberyCount: 0,
                lastUpdatedAt: Date.now()
            });
        }

        // Apply decay based on time since last robbery (without saving)
        const timeSinceLastRobbery = Date.now() - policeTax.lastUpdatedAt;
        const ONE_HOUR = 60 * 60 * 1000;

        let currentRate = policeTax.currentTaxRate;

        if (timeSinceLastRobbery > ONE_HOUR) {
            const hoursPassed = timeSinceLastRobbery / ONE_HOUR;
            const decayPerHour = 0.05; // 5% reduction per hour of inactivity
            const decayAmount = currentRate * decayPerHour * hoursPassed;
            currentRate = Math.max(currentRate - decayAmount, 0);
        }

        return currentRate;
    } catch (err) {
        console.error('Failed to get police tax:', err);
        return 0;
    }
}
function calculateStealPercentage(bankBalance) {
    // Exponential decay curve - decreases with balance
    // Drops fast at first, then flattens out

    const maxRate = 0.10; // 10% maximum for low balances
    const halfPoint = 14743; // Kept the same to anchor low-balance rates
    const exponent = 0.69; // Slightly lowered for higher rates at large balances while keeping low rates similar

    // Exponential decay: rate = maxRate / (1 + (balance / halfPoint)^exponent)
    const rate = maxRate / (1 + Math.pow(bankBalance / halfPoint, exponent));

    return rate;
}

async function handleRob(interaction, profileData, opts) {
    const ephemeral = opts.flags ? (opts.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral : !!opts.ephemeral;
    const callerFlags = opts.flags ?? (opts.ephemeral ? MessageFlags.Ephemeral : undefined);
    const flags = callerFlags ? { flags: callerFlags } : {};

    const targetUser = interaction.options.getUser('target');

    const robberProfile = await profileModel.findOne({ userId: interaction.user.id, serverID: interaction.guild.id });
    const targetProfile = await profileModel.findOne({ userId: targetUser.id, serverID: interaction.guild.id });

    if (!targetProfile || !targetProfile.bankOwned) {
        const embed = new EmbedBuilder()
            .setColor('#ff5252')
            .setTitle('Cannot Rob')
            .setDescription(`<@${targetUser.id}> does not own a bank or has no profile on this server.`);

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    if (targetProfile.bankBalance <= 0) {
        const embed = new EmbedBuilder()
            .setColor('#ff5252')
            .setTitle('Empty Bank')
            .setDescription(`<@${targetUser.id}>'s bank is empty.`);

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    const now = Date.now();

    // Attempt atomic cooldown check and update of lastRobAt
    // This prevents two concurrent rob requests from both bypassing the cooldown
    let robberUpdated = null;
    if (robberProfile) {
        robberUpdated = await profileModel.findOneAndUpdate(
            {
                userId: interaction.user.id,
                serverID: interaction.guild.id,
                $or: [
                    { lastRobAt: { $lt: now - ROB_COOLDOWN } },  // Last rob is old enough
                    { lastRobAt: { $exists: false } }  // Or never robbed before
                ]
            },
            { $set: { lastRobAt: now } },
            { new: true }
        );

        if (!robberUpdated) {
            // Cooldown is still active or another request already claimed the rob window
            const lastRob = robberProfile.lastRobAt || 0;
            const timeLeft = Math.ceil((ROB_COOLDOWN - (now - lastRob)) / 60000);
            const embed = new EmbedBuilder()
                .setColor('#ff9800')
                .setTitle('Cooldown Active')
                .setDescription(`You can rob again in **${timeLeft}** minute${timeLeft !== 1 ? 's' : ''}.`);

            if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
            return interaction.editReply({ embeds: [embed] });
        }
    } else {
        // Create new profile with rob timestamp
        robberUpdated = await profileModel.create({
            userId: interaction.user.id,
            serverID: interaction.guild.id,
            balance: 0,
            lastRobAt: now
        });
    }

    const stealPercentage = calculateStealPercentage(targetProfile.bankBalance);
    let stealAmount = Math.floor(targetProfile.bankBalance * stealPercentage);

    let defenseReduction = 0;
    if (targetProfile.bankDefenseExpiresAt > now) {
        const defenseReductions = { 1: 0.5, 2: 0.8, 3: 0.99 };
        defenseReduction = defenseReductions[targetProfile.bankDefenseLevel] || 0;
        stealAmount = Math.floor(stealAmount * (1 - defenseReduction));
    }

    // Get current police tax and calculate tax amount
    const policeTaxRate = await getPoliceTax();
    const taxAmount = Math.floor(stealAmount * policeTaxRate);
    const amountAfterTax = stealAmount - taxAmount;

    // Update police tax based on this robbery
    const newPoliceTaxRate = await updatePoliceTax(stealAmount);

    // Update target's bank balance atomically
    const targetUpdated = await profileModel.findOneAndUpdate(
        { userId: targetUser.id, serverID: interaction.guild.id },
        { $inc: { bankBalance: -stealAmount } },
        { new: true }
    );

    if (!targetUpdated) {
        // Target profile was deleted - don't proceed
        const embed = new EmbedBuilder()
            .setColor('#ff9800')
            .setTitle('Robbery Failed')
            .setDescription(`The target player's profile no longer exists on this server.`);

        if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
        return interaction.editReply({ embeds: [embed] });
    }

    // Update robber's balance with the stolen amount (after taxes)
    await profileModel.updateOne(
        { userId: interaction.user.id, serverID: interaction.guild.id },
        { $inc: { balance: amountAfterTax } }
    );

    try {
        const balanceChangeEvent = require('../events/balanceChange');
        const robberMember = await interaction.guild.members.fetch(interaction.user.id);
        const targetMember = await interaction.guild.members.fetch(targetUser.id);
        balanceChangeEvent.execute(robberMember);
        balanceChangeEvent.execute(targetMember);
    } catch (err) {
        console.error('Failed to trigger balance change event:', err);
    }

    // Log robbery to channel
    try {
        const logChannelId = process.env.BANKROB_LOGS_CHANNEL_ID;
        if (logChannelId) {
            const channel = await interaction.client.channels.fetch(logChannelId);
            if (channel && channel.isTextBased()) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#ff6b6b')
                    .setTitle('🏦 Bank Robbery Logged')
                    .setDescription(`**Robber:** <@${interaction.user.id}>\n**Victim:** <@${targetUser.id}>`)
                    .addFields(
                        { name: 'Amount Stolen', value: `${stealAmount.toLocaleString()} points`, inline: true },
                        { name: 'Steal Rate', value: `${(stealPercentage * 100).toFixed(2)}%`, inline: true },
                        { name: 'Target Bank Balance', value: `${targetProfile.bankBalance.toLocaleString()} points`, inline: true },
                        { name: '🚔 Police Tax', value: `${(policeTaxRate * 100).toFixed(2)}%`, inline: true },
                        { name: 'Tax Amount', value: `${taxAmount.toLocaleString()} points`, inline: true },
                        { name: 'After Tax', value: `${amountAfterTax.toLocaleString()} points`, inline: true }
                    );

                if (defenseReduction > 0) {
                    logEmbed.addFields({
                        name: '🛡️ Defense Reduction',
                        value: `${Math.floor(defenseReduction * 100)}% of steal amount blocked`,
                        inline: false
                    });
                }

                logEmbed.setTimestamp();
                await channel.send({ embeds: [logEmbed] });
            }
        }
    } catch (err) {
        console.error('Failed to log robbery:', err);
    }

    const embed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle('🏦 Robbery Successful!')
        .setDescription(`You robbed <@${targetUser.id}>'s bank!`)
        .addFields(
            { name: 'Amount Stolen', value: `${stealAmount.toLocaleString()} points`, inline: true },
            { name: 'Steal Rate', value: `${(stealPercentage * 100).toFixed(2)}%`, inline: true },
            { name: 'Target Balance', value: `${targetProfile.bankBalance.toLocaleString()} points`, inline: true },
            { name: '🚔 Police Tax', value: `${(policeTaxRate * 100).toFixed(2)}%`, inline: true },
            { name: 'Tax Paid', value: `${taxAmount.toLocaleString()} points`, inline: true },
            { name: 'Stolen After Taxes', value: `${amountAfterTax.toLocaleString()} points`, inline: true }
        );

    if (defenseReduction > 0) {
        embed.addFields({
            name: '🛡️ Defense Active',
            value: `Reduced steal by ${Math.floor(defenseReduction * 100)}%`,
            inline: false
        });
    }

    embed.setFooter({ text: `Next rob available in ${ROB_COOLDOWN / (60 * 60 * 1000)} hours` });

    if (!interaction.replied && !interaction.deferred) { return interaction.reply({ embeds: [embed], ...flags }); }
    return interaction.editReply({ embeds: [embed] });
}
