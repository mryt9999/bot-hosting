const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const profileModel = require('../models/profileSchema');
const loanModel = require('../models/loanSchema');
const { transferPoints } = require('../utils/dbUtils');
const { safeDefer, safeReply } = require('../utils/interactionHelper'); // added import

// Helper function to send loan logs to the designated channel
async function sendLoanLog(client, guildId, embed) {
    try {
        // Priority: env LOAN_LOGS_CHANNEL_ID -> channel named "loan-logs" -> channel named "logs"
        const logChannelId = process.env.LOAN_LOGS_CHANNEL_ID;
        let logChannel = null;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) { return; }

        if (logChannelId) {
            logChannel = guild.channels.cache.get(logChannelId) ?? await guild.channels.fetch(logChannelId).catch(() => null);
        }

        if (!logChannel) {
            logChannel = guild.channels.cache.find(ch =>
                (ch.name === 'loan-logs' || ch.name === 'logs') && ch.isTextBased?.()
            );
        }

        if (logChannel?.isTextBased?.()) {
            await logChannel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Failed to send loan log:', error);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loan')
        .setDescription('Manage loans between players')
        .addSubcommand(subcommand =>
            subcommand
                .setName('offer')
                .setDescription('Offer a loan to another player')
                .addUserOption(option =>
                    option.setName('player')
                        .setDescription('The player to offer a loan to')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('The amount to loan')
                        .setRequired(true)
                        .setMinValue(1))
                .addIntegerOption(option =>
                    option.setName('payback')
                        .setDescription('The total amount to be paid back')
                        .setRequired(true)
                        .setMinValue(1))
                .addIntegerOption(option =>
                    option.setName('duration')
                        .setDescription('Duration in hours until loan is due')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('accept')
                .setDescription('Accept a pending loan offer')
                .addStringOption(option =>
                    option.setName('loan_id')
                        .setDescription('The ID of the loan to accept')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('repay')
                .setDescription('Repay an active loan')
                .addStringOption(option =>
                    option.setName('loan_id')
                        .setDescription('The ID of the loan to repay')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Amount to repay (leave empty to pay full amount)')
                        .setRequired(false)
                        .setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List your active loans'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('pending')
                .setDescription('List your pending loan offers')),
    async execute(interaction, profileData) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'offer') {
            return await handleOffer(interaction, profileData);
        } else if (subcommand === 'accept') {
            return await handleAccept(interaction, profileData);
        } else if (subcommand === 'repay') {
            return await handleRepay(interaction, profileData);
        } else if (subcommand === 'list') {
            return await handleList(interaction);
        } else if (subcommand === 'pending') {
            return await handlePending(interaction);
        }
    },
};

async function handleOffer(interaction, profileData) {
    const lender = interaction.user;
    const borrower = interaction.options.getUser('player');
    const loanAmount = interaction.options.getInteger('amount');
    const paybackAmount = interaction.options.getInteger('payback');
    const durationHours = interaction.options.getInteger('duration');

    // Validation
    if (lender.id === borrower.id) {
        return await interaction.reply({
            content: "You can't offer a loan to yourself.",
            flags: MessageFlags.Ephemeral
        });
    }

    if (paybackAmount < loanAmount) {
        return await interaction.reply({
            content: 'The payback amount must be at least equal to the loan amount.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Check if lender has enough balance
    if (!profileData) {
        profileData = await profileModel.findOne({ userId: lender.id });
        if (!profileData) {
            profileData = await profileModel.create({
                userId: lender.id,
                serverID: interaction.guild?.id ?? null
            });
        }
    }

    if (profileData.balance < loanAmount) {
        return await interaction.reply({
            content: `Insufficient funds. You have ${profileData.balance.toLocaleString()} points but need ${loanAmount.toLocaleString()} points.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Create loan contract
    const durationMs = durationHours * 60 * 60 * 1000;
    const loan = await loanModel.create({
        lenderId: lender.id,
        borrowerId: borrower.id,
        serverID: interaction.guild?.id ?? null,
        loanAmount: loanAmount,
        paybackAmount: paybackAmount,
        duration: durationMs,
        status: 'pending'
    });

    // Log to loan-logs channel
    const logEmbed = new EmbedBuilder()
        .setTitle('📝 New Loan Offer Created')
        .setColor(0x3498DB)
        .addFields(
            { name: 'Loan ID', value: `\`${loan._id}\``, inline: false },
            { name: 'Lender', value: `<@${lender.id}> (${lender.tag})`, inline: true },
            { name: 'Borrower', value: `<@${borrower.id}> (${borrower.tag})`, inline: true },
            { name: 'Loan Amount', value: `🪙 ${loanAmount.toLocaleString()} points`, inline: false },
            { name: 'Payback Amount', value: `🪙 ${paybackAmount.toLocaleString()} points`, inline: true },
            { name: 'Interest', value: `🪙 ${(paybackAmount - loanAmount).toLocaleString()} points`, inline: true },
            { name: 'Duration', value: `${durationHours} hour(s)`, inline: true },
            { name: 'Status', value: '⏳ Pending Acceptance', inline: false }
        )
        .setFooter({ text: 'Created at' })
        .setTimestamp();

    await sendLoanLog(interaction.client, interaction.guild.id, logEmbed);

    // Create accept button
    const acceptButton = new ButtonBuilder()
        .setCustomId(`loan_accept_${loan._id}`)
        .setLabel('Accept Loan')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

    const row = new ActionRowBuilder()
        .addComponents(acceptButton);


    // Create embed for the loan offer
    const embed = new EmbedBuilder()
        .setTitle('💰 Loan Offer Created')
        .setColor(0x3498DB)
        .setDescription(`A loan contract has been created and sent to ${borrower.username}.`)
        .addFields(
            { name: 'Lender', value: `<@${lender.id}>`, inline: true },
            { name: 'Borrower', value: `<@${borrower.id}>`, inline: true },
            { name: 'Loan Amount', value: `🪙 ${loanAmount.toLocaleString()} points`, inline: false },
            { name: 'Payback Amount', value: `🪙 ${paybackAmount.toLocaleString()} points`, inline: true },
            { name: 'Duration', value: `${durationHours} hour(s)`, inline: true },
            { name: 'Loan ID', value: `\`${loan._id}\``, inline: false }
        )
        .setFooter({ text: 'The borrower can click the button below or use /loan accept' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed], components: [row] });

    // Try to DM the borrower without button
    try {
        const dmEmbed = new EmbedBuilder()
            .setTitle('📬 New Loan Offer')
            .setColor(0xF1C40F)
            .setDescription(`${lender.username} has offered you a loan!`)
            .addFields(
                { name: 'Loan Amount', value: `🪙 ${loanAmount.toLocaleString()} points`, inline: false },
                { name: 'Payback Amount', value: `🪙 ${paybackAmount.toLocaleString()} points`, inline: true },
                { name: 'Duration', value: `${durationHours} hour(s)`, inline: true },
                { name: 'Interest', value: `🪙 ${(paybackAmount - loanAmount).toLocaleString()} points`, inline: false },
                { name: 'Loan ID', value: `\`${loan._id}\``, inline: false }
            )
            .setFooter({ text: 'Use /loan accept to accept this offer or /loan pending to view all pending offers' })
            .setTimestamp();

        await borrower.send({ embeds: [dmEmbed] });
    } catch (error) {
        console.error('Failed to DM borrower:', error);
    }
}

async function handleAccept(interaction, profileData) {
    const loanId = interaction.options.getString('loan_id');

    return await processLoanAcceptance(interaction, loanId, profileData);
}

// Shared function for accepting loans (used by both command and button)
async function processLoanAcceptance(interaction, loanId, profileData = null) {
    const userId = interaction.user.id;

    // Find the loan
    let loan;
    try {
        loan = await loanModel.findById(loanId);
    } catch (_error) {
        const message = 'Invalid loan ID. Please check the ID and try again.';
        if (interaction.isButton()) {
            return await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        }
        return await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }

    if (!loan) {
        const message = 'Loan not found. It may have been cancelled or already accepted.';
        if (interaction.isButton()) {
            return await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        }
        return await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }

    // Verify the user is the borrower
    if (loan.borrowerId !== userId) {
        const message = 'This button is not for you. Only the borrower can accept this loan.';
        if (interaction.isButton()) {
            return await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        }
        return await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }

    // Check if loan is still pending
    if (loan.status !== 'pending') {
        const message = `This loan has already been ${loan.status}.`;
        if (interaction.isButton()) {
            return await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        }
        return await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }

    // Calculate interest rate
    const interestAmount = loan.paybackAmount - loan.loanAmount;
    const interestRate = (interestAmount / loan.loanAmount) * 100;
    const isHighInterest = loan.paybackAmount > (loan.loanAmount * 2);

    // Check if this is a confirmation from the high interest warning
    const isConfirmation = interaction.customId.startsWith('loan_confirm_');

    // If high interest and not a confirmation, show warning
    if (isHighInterest && !isConfirmation && interaction.isButton()) {
        const warningEmbed = new EmbedBuilder()
            .setTitle('⚠️ High Interest Warning')
            .setColor(0xE74C3C)
            .setDescription('This loan has a very high interest rate!')
            .addFields(
                { name: 'Loan Amount', value: `🪙 ${loan.loanAmount.toLocaleString()} points`, inline: true },
                { name: 'Payback Amount', value: `🪙 ${loan.paybackAmount.toLocaleString()} points`, inline: true },
                { name: 'Interest', value: `🪙 ${interestAmount.toLocaleString()} points (${interestRate.toFixed(1)}%)`, inline: false },
                { name: '⚠️ Warning', value: `You will pay back **more than double** the loan amount!\n\nAre you sure you want to accept this loan?`, inline: false }
            )
            .setFooter({ text: 'Think carefully before accepting' })
            .setTimestamp();

        const confirmButton = new ButtonBuilder()
            .setCustomId(`loan_confirm_${loan._id}`)
            .setLabel('Yes, Accept Loan')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('✅');

        const cancelButton = new ButtonBuilder()
            .setCustomId(`loan_cancel_${loan._id}`)
            .setLabel('No, Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌');

        const row = new ActionRowBuilder()
            .addComponents(confirmButton, cancelButton);

        return await interaction.reply({
            embeds: [warningEmbed],
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }

    // If this was a confirmation, acknowledge it
    if (isConfirmation && interaction.isButton()) {
        await interaction.deferUpdate();
    }

    // Transfer points from lender to borrower
    const transferResult = await transferPoints(loan.lenderId, loan.borrowerId, loan.loanAmount, { interaction });

    if (!transferResult.success) {
        let message;
        if (transferResult.reason === 'insufficient_funds') {
            message = 'The lender no longer has sufficient funds for this loan.';
        } else {
            message = 'Failed to process the loan. Please try again later.';
        }

        if (interaction.isButton()) {
            if (isConfirmation) {
                return await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
            }
            return await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        }
        return await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }

    // Update loan status
    const acceptedAt = Date.now();
    const dueAt = acceptedAt + loan.duration;
    await loanModel.findByIdAndUpdate(loanId, {
        status: 'active',
        acceptedAt: acceptedAt,
        dueAt: dueAt
    });

    // Log to loan-logs channel
    const logEmbed = new EmbedBuilder()
        .setTitle('✅ Loan Accepted & Activated')
        .setColor(0x2ECC71)
        .addFields(
            { name: 'Loan ID', value: `\`${loan._id}\``, inline: false },
            { name: 'Lender', value: `<@${loan.lenderId}>`, inline: true },
            { name: 'Borrower', value: `<@${loan.borrowerId}>`, inline: true },
            { name: 'Loan Amount Transferred', value: `🪙 ${loan.loanAmount.toLocaleString()} points`, inline: false },
            { name: 'Amount Due', value: `🪙 ${loan.paybackAmount.toLocaleString()} points`, inline: true },
            { name: 'Interest Rate', value: `${interestRate.toFixed(1)}%`, inline: true },
            { name: 'Due Date', value: `<t:${Math.floor(dueAt / 1000)}:F>`, inline: true },
            { name: 'Status', value: '✅ Active', inline: false }
        )
        .setFooter({ text: 'Accepted at' })
        .setTimestamp();

    await sendLoanLog(interaction.client, interaction.guild.id, logEmbed);

    // Balance change events are already fired by transferPoints
    // Create confirmation embed
    const embed = new EmbedBuilder()
        .setTitle('✅ Loan Accepted')
        .setColor(0x2ECC71)
        .setDescription(`You have accepted the loan from <@${loan.lenderId}>.`)
        .addFields(
            { name: 'Received', value: `🪙 ${loan.loanAmount.toLocaleString()} points`, inline: false },
            { name: 'Must Pay Back', value: `🪙 ${loan.paybackAmount.toLocaleString()} points`, inline: true },
            //{ name: 'Interest', value: `🪙 ${interestAmount.toLocaleString()} points (${interestRate.toFixed(1)}%)`, inline: true },
            { name: 'Due Date', value: `<t:${Math.floor(dueAt / 1000)}:R>`, inline: false },
            { name: 'Loan ID', value: `\`${loan._id}\``, inline: false }
        )
        .setFooter({ text: 'Use /loan repay to pay back the loan early' })
        .setTimestamp();

    // If this was a button interaction, update the original message
    if (interaction.isButton()) {
        if (isConfirmation) {
            // Update the confirmation message to remove buttons
            try {
                await interaction.editReply({ components: [] });
            } catch (error) {
                console.error('Failed to update confirmation message:', error);
            }

            // Send follow-up with confirmation
            await interaction.followUp({ embeds: [embed] });

            // Update the original loan offer message
            try {
                const originalMessage = await interaction.channel.messages.fetch(interaction.message.reference?.messageId).catch(() => null);
                if (originalMessage) {
                    const disabledButton = new ButtonBuilder()
                        .setCustomId(`loan_accept_${loan._id}`)
                        .setLabel('Loan Accepted')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('✅')
                        .setDisabled(true);

                    const disabledRow = new ActionRowBuilder()
                        .addComponents(disabledButton);

                    await originalMessage.edit({ components: [disabledRow] });
                }
            } catch (error) {
                console.error('Failed to update original loan offer:', error);
            }
        } else {
            // Disable the button
            const disabledButton = new ButtonBuilder()
                .setCustomId(`loan_accept_${loan._id}`)
                .setLabel('Loan Accepted')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('✅')
                .setDisabled(true);

            const disabledRow = new ActionRowBuilder()
                .addComponents(disabledButton);

            // Update the message to disable the button
            try {
                await interaction.update({ components: [disabledRow] });
            } catch (error) {
                console.error('Failed to update button:', error);
                // If update fails, just reply instead
                await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                return;
            }

            // Send follow-up with confirmation
            await interaction.followUp({ embeds: [embed] });
        }
    } else {
        await interaction.reply({ embeds: [embed] });
    }

    // Notify the lender
    try {
        const lender = await interaction.client.users.fetch(loan.lenderId);
        const lenderEmbed = new EmbedBuilder()
            .setTitle('✅ Loan Accepted')
            .setColor(0x2ECC71)
            .setDescription(`<@${loan.borrowerId}> has accepted your loan offer!`)
            .addFields(
                { name: 'Loan Amount', value: `🪙 ${loan.loanAmount.toLocaleString()} points`, inline: false },
                { name: 'Payback Amount', value: `🪙 ${loan.paybackAmount.toLocaleString()} points`, inline: true },
                { name: 'Interest', value: `🪙 ${interestAmount.toLocaleString()} points (${interestRate.toFixed(1)}%)`, inline: true },
                { name: 'Due Date', value: `<t:${Math.floor(dueAt / 1000)}:R>`, inline: false },
                { name: 'Loan ID', value: `\`${loan._id}\``, inline: false }
            )
            .setTimestamp();

        await lender.send({ embeds: [lenderEmbed] });
    } catch (error) {
        console.error('Failed to notify lender:', error);
    }

    // Schedule automatic enforcement
    scheduleEnforcement(loan._id, dueAt, interaction.client);
}

// ...existing code for handleRepay, handleList, handlePending...

async function handleRepay(interaction, profileData) {
    try {
        const loanId = interaction.options.getString('loan_id');
        const repayAmount = interaction.options.getInteger('amount');
        const userId = interaction.user.id;

        // Find the loan
        let loan;
        try {
            loan = await loanModel.findById(loanId);
        } catch (_error) {
            return await safeReply(interaction, { content: 'Invalid loan ID. Please check the ID and try again.', flags: MessageFlags.Ephemeral });
        }

        if (!loan) {
            return await safeReply(interaction, { content: 'Loan not found.', flags: MessageFlags.Ephemeral });
        }

        // Verify the user is the borrower
        if (loan.borrowerId !== userId) {
            return await safeReply(interaction, { content: 'You are not the borrower of this loan.', flags: MessageFlags.Ephemeral });
        }

        // Check status
        if (loan.status !== 'active' && loan.status !== 'overdue') {
            return await safeReply(interaction, { content: `This loan is ${loan.status} and cannot be repaid.`, flags: MessageFlags.Ephemeral });
        }

        // Calculate amounts
        const remainingAmount = loan.paybackAmount - loan.amountPaid;
        const amountToRepay = repayAmount || remainingAmount;

        if (amountToRepay > remainingAmount) {
            return await safeReply(interaction, { content: `You only need to pay ${remainingAmount.toLocaleString()} points. Cannot overpay.`, flags: MessageFlags.Ephemeral });
        }

        // Ensure borrower profile exists
        if (!profileData) {
            profileData = await profileModel.findOne({ userId: userId });
            if (!profileData) {
                profileData = await profileModel.create({
                    userId: userId,
                    serverID: interaction.guild?.id ?? null
                });
            }
        }

        const borrowerBalance = profileData.balance;
        if (borrowerBalance < amountToRepay) {
            return await safeReply(interaction, { content: `Insufficient funds. You have ${borrowerBalance.toLocaleString()} points but need ${amountToRepay.toLocaleString()} points to make this payment.`, flags: MessageFlags.Ephemeral });
        }

        // Defer early (decide ephemeral here)
        await safeDefer(interaction, { ephemeral: true });

        // Transfer points (long op)
        const transferResult = await transferPoints(loan.borrowerId, loan.lenderId, amountToRepay, { interaction });

        if (!transferResult.success) {
            const msg = transferResult.reason === 'insufficient_funds'
                ? 'The transfer failed due to insufficient funds.'
                : 'Failed to process the repayment. Please try again later.';
            return await safeReply(interaction, { content: msg, flags: MessageFlags.Ephemeral });
        }

        // Update loan
        const newAmountPaid = loan.amountPaid + amountToRepay;
        const isFullyPaid = newAmountPaid >= loan.paybackAmount;

        await loanModel.findByIdAndUpdate(loanId, {
            amountPaid: newAmountPaid,
            status: isFullyPaid ? 'paid' : 'active',
            ...(isFullyPaid && { paidAt: new Date() })
        });

        // Log to loan channel
        const logEmbed = new EmbedBuilder()
            .setTitle(isFullyPaid ? '✅ Loan Fully Repaid (Manual)' : '💵 Partial Repayment Made')
            .setColor(isFullyPaid ? 0x2ECC71 : 0xF39C12)
            .addFields(
                { name: 'Loan ID', value: `\`${loan._id}\``, inline: false },
                { name: 'Lender', value: `<@${loan.lenderId}>`, inline: true },
                { name: 'Borrower', value: `<@${loan.borrowerId}>`, inline: true },
                { name: 'Payment Amount', value: `🪙 ${amountToRepay.toLocaleString()} points`, inline: false },
                { name: 'Total Paid', value: `🪙 ${newAmountPaid.toLocaleString()} / ${loan.paybackAmount.toLocaleString()}`, inline: true },
                { name: 'Remaining', value: `🪙 ${(loan.paybackAmount - newAmountPaid).toLocaleString()} points`, inline: true },
                { name: 'Status', value: isFullyPaid ? '✅ Fully Paid' : '💵 Partially Paid', inline: false }
            )
            .setFooter({ text: 'Repayment made at' })
            .setTimestamp();

        await sendLoanLog(interaction.client, interaction.guild.id, logEmbed);

        // Confirmation embed (edited into deferred reply)
        const confirmEmbed = new EmbedBuilder()
            .setTitle(isFullyPaid ? '✅ Loan Fully Repaid' : '💵 Partial Payment Made')
            .setColor(isFullyPaid ? 0x2ECC71 : 0xF39C12)
            .setDescription(isFullyPaid ? `You have fully repaid your loan to <@${loan.lenderId}>!` : `You have made a payment on your loan to <@${loan.lenderId}>.`)
            .addFields(
                { name: 'Amount Paid', value: `🪙 ${amountToRepay.toLocaleString()} points`, inline: false },
                { name: 'Total Paid', value: `🪙 ${newAmountPaid.toLocaleString()} points`, inline: true },
                { name: 'Remaining', value: `🪙 ${(loan.paybackAmount - newAmountPaid).toLocaleString()} points`, inline: true }
            )
            .setFooter({ text: isFullyPaid ? 'Thank you for your timely payment!' : 'Future earnings will automatically go toward loan repayment' })
            .setTimestamp();

        await safeReply(interaction, { embeds: [confirmEmbed], ephemeral: false });

        // Notify lender if fully paid
        if (isFullyPaid) {
            try {
                const lender = await interaction.client.users.fetch(loan.lenderId);
                const lenderEmbed = new EmbedBuilder()
                    .setTitle('✅ Loan Fully Repaid')
                    .setDescription(`<@${loan.borrowerId}> has fully repaid their loan!`)
                    .addFields(
                        { name: 'Amount Received', value: `🪙 ${loan.paybackAmount.toLocaleString()} points`, inline: false },
                        { name: 'Profit', value: `🪙 ${(loan.paybackAmount - loan.loanAmount).toLocaleString()} points`, inline: true }
                    )
                    .setTimestamp();

                await lender.send({ embeds: [lenderEmbed] });
            } catch (error) {
                console.error('Failed to notify lender:', error);
            }
        }
    } catch (err) {
        console.error('handleRepay error:', err);
        if (err?.code === 10062) {
            // Interaction expired/unknown — nothing to do
            return;
        }
        // Try to reply with ephemeral error (safeReply handles expired interactions)
        try {
            await safeReply(interaction, { content: 'An error occurred while processing your repayment.', flags: MessageFlags.Ephemeral });
        } catch (_e) {
            // ignore
        }
    }
}

async function handleList(interaction) {
    try {
        const userId = interaction.user.id;

        // Find all active and overdue loans where user is either lender or borrower
        const loansAsLender = await loanModel.find({
            lenderId: userId,
            status: { $in: ['active', 'overdue'] }
        });

        const loansAsBorrower = await loanModel.find({
            borrowerId: userId,
            status: { $in: ['active', 'overdue'] }
        });

        // Helper to format a single loan entry (truncate long fields)
        function formatLoanLine(roleLabel, loan) {
            const dueDate = `<t:${Math.floor(loan.dueAt / 1000)}:R>`;
            const remaining = loan.paybackAmount - loan.amountPaid;
            const overdueTag = loan.status === 'overdue' ? ' ⚠️ **OVERDUE**' : '';
            let line = `**ID:** \`${loan._id}\`\n**${roleLabel}:** <@${roleLabel === 'Lender' ? loan.lenderId : loan.borrowerId}>\n**Remaining:** 🪙 ${remaining.toLocaleString()} / ${loan.paybackAmount.toLocaleString()}\n**Due:** ${dueDate}${overdueTag}`;
            if (line.length > 800) {
                line = line.slice(0, 797) + '...';
            }
            return line;
        }

        // Build items list with headers
        const items = [];

        if (loansAsLender.length > 0) {
            items.push('💸 **Loans You Gave**');
            for (const loan of loansAsLender) items.push(formatLoanLine('Borrower', loan));
        }

        if (loansAsBorrower.length > 0) {
            items.push('💳 **Loans You Owe**');
            for (const loan of loansAsBorrower) items.push(formatLoanLine('Lender', loan));
        }

        // If nothing, simple reply
        if (items.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('💰 Your Active Loans')
                .setColor(0x3498DB)
                .setDescription('You have no active loans.')
                .setTimestamp();

            return await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // Pagination: N items per page (header lines count too)
        const ITEMS_PER_PAGE = 4;
        const pages = [];
        for (let i = 0; i < items.length; i += ITEMS_PER_PAGE) {
            const chunk = items.slice(i, i + ITEMS_PER_PAGE).join('\n\n');
            pages.push(chunk);
        }

        let pageIndex = 0;
        const totalPages = pages.length;

        const embed = new EmbedBuilder()
            .setTitle('💰 Your Active Loans')
            .setColor(0x3498DB)
            .setDescription(pages[pageIndex])
            .setFooter({ text: `Page ${pageIndex + 1}/${totalPages}` })
            .setTimestamp();

        // If only one page, no buttons needed
        if (totalPages === 1) {
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            return;
        }

        // Build buttons
        const prevButton = new ButtonBuilder()
            .setCustomId('loan_prev')
            .setLabel('Prev')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);

        const nextButton = new ButtonBuilder()
            .setCustomId('loan_next')
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary);

        const closeButton = new ButtonBuilder()
            .setCustomId('loan_close')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(prevButton, nextButton, closeButton);

        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });

        // Fetch the reply and create collector
        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            time: 2 * 60 * 1000, // 2 minutes
            filter: i => i.user.id === interaction.user.id
        });

        collector.on('collect', async i => {
            try {
                await i.deferUpdate();

                if (i.customId === 'loan_next') {
                    pageIndex = Math.min(pageIndex + 1, totalPages - 1);
                } else if (i.customId === 'loan_prev') {
                    pageIndex = Math.max(pageIndex - 1, 0);
                } else if (i.customId === 'loan_close') {
                    collector.stop('closed');
                    return;
                }

                // Update button disabled states
                prevButton.setDisabled(pageIndex === 0);
                nextButton.setDisabled(pageIndex === totalPages - 1);

                // Update embed and message
                const updatedEmbed = EmbedBuilder.from(embed)
                    .setDescription(pages[pageIndex])
                    .setFooter({ text: `Page ${pageIndex + 1}/${totalPages}` });

                await interaction.editReply({ embeds: [updatedEmbed], components: [row] });
            } catch (err) {
                console.error('Error handling loan list pagination interaction:', err);
            }
        });

        collector.on('end', async (_, reason) => {
            try {
                // disable buttons when ended
                prevButton.setDisabled(true);
                nextButton.setDisabled(true);
                closeButton.setDisabled(true);
                const disabledRow = new ActionRowBuilder().addComponents(prevButton, nextButton, closeButton);
                await interaction.editReply({ components: [disabledRow] });
            } catch (err) {
                console.error('Failed to disable pagination buttons after collector end:', err);
            }
        });
    } catch (error) {
        console.error('Error in /loan list:', error);
        const replyMethod = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
        await interaction[replyMethod]({
            content: 'An error occurred while listing loans.',
            flags: [MessageFlags.Ephemeral]
        });
    }
}

async function handlePending(interaction) {
    const userId = interaction.user.id;

    // Find pending loans where user is borrower
    const pendingLoans = await loanModel.find({
        borrowerId: userId,
        status: 'pending'
    });

    const embed = new EmbedBuilder()
        .setTitle('📬 Pending Loan Offers')
        .setColor(0xF1C40F)
        .setTimestamp();

    if (pendingLoans.length === 0) {
        embed.setDescription('You have no pending loan offers.');
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } else {
        const loansText = pendingLoans.map(loan => {
            const durationHours = Math.floor(loan.duration / (60 * 60 * 1000));
            const interest = loan.paybackAmount - loan.loanAmount;
            return `**ID:** \`${loan._id}\`\n**Lender:** <@${loan.lenderId}>\n**Loan Amount:** 🪙 ${loan.loanAmount.toLocaleString()}\n**Payback:** 🪙 ${loan.paybackAmount.toLocaleString()} (Interest: ${interest.toLocaleString()})\n**Duration:** ${durationHours} hour(s)\n`;
        }).join('\n');
        embed.setDescription(loansText);
        embed.setFooter({ text: 'Use /loan accept <loan_id> or click the Accept button on the loan offer' });

        // Add accept buttons for each pending loan
        const buttons = pendingLoans.slice(0, 5).map(loan => // Limit to 5 buttons per row
            new ButtonBuilder()
                .setCustomId(`loan_accept_${loan._id}`)
                .setLabel(`Accept ${loan._id.toString().slice(-6)}`)
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅')
        );

        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }

        await interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
    }
}

// Schedule automatic enforcement when loan is due
function scheduleEnforcement(loanId, dueAt, client) {
    const delay = dueAt - Date.now();

    if (delay <= 0) {
        // Already overdue, enforce immediately
        enforceLoan(loanId, client);
    } else {
        // Schedule for later
        setTimeout(() => {
            enforceLoan(loanId, client);
        }, delay);
    }
}

// Enforce loan payment when due
async function enforceLoan(loanId, client) {
    try {
        const loan = await loanModel.findById(loanId);

        if (!loan || loan.status !== 'active') {
            return; // Loan was already paid or doesn't exist
        }

        //return if the loans dueAt isnt due yet (might be called early)
        if (loan.dueAt > Date.now()) {
            return;
        }

        const remainingAmount = loan.paybackAmount - loan.amountPaid;

        // Mark loan as overdue instead of forcing payment
        await loanModel.findByIdAndUpdate(loanId, {
            status: 'overdue'
        });

        // Log to loan-logs channel
        const guild = client.guilds.cache.find(g => g.id === loan.serverID);
        if (guild) {
            const logEmbed = new EmbedBuilder()
                .setTitle('⚠️ Loan Overdue')
                .setColor(0xE74C3C)
                .addFields(
                    { name: 'Loan ID', value: `\`${loan._id}\``, inline: false },
                    { name: 'Lender', value: `<@${loan.lenderId}>`, inline: true },
                    { name: 'Borrower', value: `<@${loan.borrowerId}>`, inline: true },
                    { name: 'Amount Remaining', value: `🪙 ${remainingAmount.toLocaleString()} points`, inline: false },
                    { name: 'Status', value: '⚠️ Overdue - Auto-repayment active', inline: false }
                )
                .setFooter({ text: 'Became overdue at' })
                .setTimestamp();

            await sendLoanLog(client, guild.id, logEmbed);
        }

        // Notify borrower
        try {
            const borrower = await client.users.fetch(loan.borrowerId);
            const borrowerEmbed = new EmbedBuilder()
                .setTitle('⚠️ Loan Overdue')
                .setColor(0xE74C3C)
                .setDescription(`Your loan from <@${loan.lenderId}> is now overdue.`)
                .addFields(
                    { name: 'Amount Remaining', value: `🪙 ${remainingAmount.toLocaleString()} points`, inline: false },
                    { name: 'Auto-Repayment', value: 'All future points you earn will automatically go toward repaying this loan until it is fully paid.', inline: false }
                )
                .setTimestamp();

            await borrower.send({ embeds: [borrowerEmbed] });
        } catch (error) {
            console.error('Failed to notify borrower of overdue loan:', error);
        }

        // Notify lender
        try {
            const lender = await client.users.fetch(loan.lenderId);
            const lenderEmbed = new EmbedBuilder()
                .setTitle('⚠️ Loan Overdue')
                .setColor(0xE74C3C)
                .setDescription(`<@${loan.borrowerId}>'s loan is now overdue.`)
                .addFields(
                    { name: 'Amount Remaining', value: `🪙 ${remainingAmount.toLocaleString()} points`, inline: false },
                    { name: 'Auto-Repayment', value: 'The borrower\'s future earnings will automatically go toward repaying this loan.', inline: false }
                )
                .setTimestamp();

            await lender.send({ embeds: [lenderEmbed] });
        } catch (error) {
            console.error('Failed to notify lender of overdue loan:', error);
        }
    } catch (error) {
        console.error('Failed to mark loan as overdue:', error);
    }
}


// On bot startup, reschedule all active loans that are still pending enforcement
async function rescheduleActiveLoans(client) {
    try {
        const activeLoans = await loanModel.find({ status: 'active' });

        for (const loan of activeLoans) {
            if (loan.dueAt > 0) {
                scheduleEnforcement(loan._id, loan.dueAt, client);
            }
        }

        console.log(`Rescheduled ${activeLoans.length} active loans for enforcement.`);
    } catch (error) {
        console.error('Failed to reschedule active loans:', error);
    }
}

const activeAutoRepayments = new Set();

// Auto-repayment function - called when borrower's balance increases
async function autoRepayLoans(userId, client, guildId) {
    // Check if auto-repayment is already in progress for this user
    const repaymentKey = `${userId}_${guildId}`;
    if (activeAutoRepayments.has(repaymentKey)) {
        console.log(`[Loan] Auto-repayment already in progress for user ${userId}`);
        return;
    }

    try {
        // Mark as in progress
        activeAutoRepayments.add(repaymentKey);

        // Find all overdue loans for this borrower
        const loans = await loanModel.find({
            borrowerId: userId,
            status: { $in: ['overdue', 'active'] },
            dueAt: { $lt: Date.now() } // Only loans that are actually due
        }).sort({ dueAt: 1 }); // Prioritize loans that are due soonest

        if (loans.length === 0) {
            return; // No overdue loans
        }

        // Get current balance
        const profile = await profileModel.findOne({ userId });
        let availableBalance = profile?.balance || 0;

        if (availableBalance <= 0) {
            return; // No balance to use for repayment
        }

        // Process each loan
        for (const loan of loans) {
            if (availableBalance <= 0) {
                break; // No more balance available
            }

            const remainingAmount = loan.paybackAmount - loan.amountPaid;
            const amountToRepay = Math.min(availableBalance, remainingAmount);

            // Transfer points - need to pass client context
            const transferResult = await transferPoints(userId, loan.lenderId, amountToRepay, { client, skipAutoRepay: true });

            if (transferResult.success) {
                availableBalance -= amountToRepay;
                const newAmountPaid = loan.amountPaid + amountToRepay;
                const isFullyPaid = newAmountPaid >= loan.paybackAmount;

                // Update loan
                await loanModel.findByIdAndUpdate(loan._id, {
                    amountPaid: newAmountPaid,
                    status: isFullyPaid ? 'paid' : loan.status,
                    ...(isFullyPaid && { paidAt: new Date() })
                });

                console.log(`[Loan] Auto-repaid ${amountToRepay} points for loan ${loan._id}. Fully paid: ${isFullyPaid}`);

                // Log to loan-logs channel
                const logEmbed = new EmbedBuilder()
                    .setTitle(isFullyPaid ? '✅ Loan Fully Repaid (Auto-Payment)' : '💵 Auto-Payment Made')
                    .setColor(isFullyPaid ? 0x2ECC71 : 0xF39C12)
                    .addFields(
                        { name: 'Loan ID', value: `\`${loan._id}\``, inline: false },
                        { name: 'Lender', value: `<@${loan.lenderId}>`, inline: true },
                        { name: 'Borrower', value: `<@${userId}>`, inline: true },
                        { name: 'Auto-Payment Amount', value: `🪙 ${amountToRepay.toLocaleString()} points`, inline: false },
                        { name: 'Total Paid', value: `🪙 ${newAmountPaid.toLocaleString()} / ${loan.paybackAmount.toLocaleString()}`, inline: true },
                        { name: 'Remaining', value: `🪙 ${(loan.paybackAmount - newAmountPaid).toLocaleString()} points`, inline: true },
                        { name: 'Status', value: isFullyPaid ? '✅ Fully Paid' : '💵 Auto-Payment Active', inline: false }
                    )
                    .setFooter({ text: 'Auto-payment processed at' })
                    .setTimestamp();

                await sendLoanLog(client, guildId, logEmbed);

                // Notify borrower
                try {
                    const borrower = await client.users.fetch(userId);
                    const embed = new EmbedBuilder()
                        .setTitle(isFullyPaid ? '✅ Loan Auto-Repaid (Completed)' : '💵 Auto-Payment Made')
                        .setColor(isFullyPaid ? 0x2ECC71 : 0xF39C12)
                        .setDescription(isFullyPaid
                            ? `Your loan to <@${loan.lenderId}> has been fully repaid automatically!`
                            : `Automatic payment of 🪙 ${amountToRepay.toLocaleString()} points made toward your loan to <@${loan.lenderId}>.`)
                        .addFields(
                            { name: 'Amount Paid', value: `🪙 ${amountToRepay.toLocaleString()} points`, inline: false },
                            { name: 'Total Paid', value: `🪙 ${newAmountPaid.toLocaleString()} / ${loan.paybackAmount.toLocaleString()}`, inline: true }
                        );

                    if (!isFullyPaid) {
                        embed.addFields({
                            name: 'Remaining',
                            value: `🪙 ${(loan.paybackAmount - newAmountPaid).toLocaleString()} points`,
                            inline: true
                        });
                        embed.setFooter({ text: 'Future earnings will continue to auto-repay until loan is fully paid' });
                    }

                    embed.setTimestamp();

                    await borrower.send({ embeds: [embed] });
                } catch (error) {
                    console.error('Failed to notify borrower of auto-repayment:', error);
                }

                // Notify lender if fully paid
                if (isFullyPaid) {
                    try {
                        const lender = await client.users.fetch(loan.lenderId);
                        const lenderEmbed = new EmbedBuilder()
                            .setTitle('✅ Loan Fully Repaid (Auto-Payment)')
                            .setColor(0x2ECC71)
                            .setDescription(`<@${userId}> has fully repaid their loan through automatic payments!`)
                            .addFields(
                                { name: 'Total Received', value: `🪙 ${loan.paybackAmount.toLocaleString()} points`, inline: false },
                                { name: 'Profit', value: `🪙 ${(loan.paybackAmount - loan.loanAmount).toLocaleString()} points`, inline: true }
                            )
                            .setTimestamp();

                        await lender.send({ embeds: [lenderEmbed] });
                    } catch (error) {
                        console.error('Failed to notify lender of auto-repayment:', error);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Failed to process auto-repayment:', error);
    } finally {
        // Remove from active set
        activeAutoRepayments.delete(repaymentKey);
    }
}


async function cleanupExpiredPendingLoans(client) {
    try {
        const twelveHoursAgo = Date.now() - (12 * 60 * 60 * 1000);

        const expiredLoans = await loanModel.find({
            status: 'pending',
            createdAt: { $lt: twelveHoursAgo }
        });

        for (const loan of expiredLoans) {
            // Log to loan-logs channel
            const guild = client.guilds.cache.find(g => g.id === loan.serverID);
            if (guild) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('⏰ Loan Offer Expired')
                    .setColor(0x95A5A6)
                    .addFields(
                        { name: 'Loan ID', value: `\`${loan._id}\``, inline: false },
                        { name: 'Lender', value: `<@${loan.lenderId}>`, inline: true },
                        { name: 'Borrower', value: `<@${loan.borrowerId}>`, inline: true },
                        { name: 'Loan Amount', value: `🪙 ${loan.loanAmount.toLocaleString()} points`, inline: true },
                        { name: 'Status', value: '⏰ Expired (not accepted within 12 hours)', inline: false }
                    )
                    .setFooter({ text: 'Expired at' })
                    .setTimestamp();

                await sendLoanLog(client, guild.id, logEmbed);
            }

            // Notify borrower that offer expired
            try {
                const borrower = await client.users.fetch(loan.borrowerId);
                const embed = new EmbedBuilder()
                    .setTitle('⏰ Loan Offer Expired')
                    .setColor(0x95A5A6)
                    .setDescription(`The loan offer from <@${loan.lenderId}> has expired.`)
                    .addFields(
                        { name: 'Loan Amount', value: `🪙 ${loan.loanAmount.toLocaleString()} points`, inline: true },
                        { name: 'Loan ID', value: `\`${loan._id}\``, inline: true }
                    )
                    .setTimestamp();

                await borrower.send({ embeds: [embed] });
            } catch (error) {
                console.error(`Failed to notify borrower ${loan.borrowerId}:`, error);
            }
        }

        const result = await loanModel.deleteMany({
            status: 'pending',
            createdAt: { $lt: twelveHoursAgo }
        });

        if (result.deletedCount > 0) {
            console.log(`Cleaned up ${result.deletedCount} expired pending loans.`);
        }
    } catch (error) {
        console.error('Failed to cleanup expired pending loans:', error);
    }
}

// Run cleanup every hour
function startPendingLoanCleanup(client) {
    // Run immediately on startup
    cleanupExpiredPendingLoans(client);

    // Then run every hour
    setInterval(() => {
        cleanupExpiredPendingLoans(client);
    }, 60 * 60 * 1000); // 1 hour
}

// Auto-repay overdue loans when user balance increases
async function autoRepayOverdueLoans(client) {
    const overdueLoans = await loanModel.find({
        status: 'active',
        dueAt: { $lt: Date.now() }
    });

    for (const loan of overdueLoans) {
        await autoRepayLoans(loan.borrowerId, client);
    }
}
async function resolveWrongOverdueLoans(client) {
    try {
        const wronglyOverdueLoans = await loanModel.find({
            status: 'overdue',
            dueAt: { $gt: Date.now() }
        });
        for (const loan of wronglyOverdueLoans) {
            await loanModel.findByIdAndUpdate(loan._id, {
                status: 'active'
            });
            console.log(`Resolved wrongly overdue loan ${loan._id}, set status back to active.`);
        }
    } catch (error) {
        console.error('Failed to resolve wrongly overdue loans:', error);
    }
}

// Export functions
module.exports.startPendingLoanCleanup = startPendingLoanCleanup;
module.exports.rescheduleActiveLoans = rescheduleActiveLoans;
module.exports.autoRepayLoans = autoRepayLoans;
module.exports.processLoanAcceptance = processLoanAcceptance;
module.exports.autoRepayOverdueLoans = autoRepayOverdueLoans;
module.exports.resolveWrongOverdueLoans = resolveWrongOverdueLoans;