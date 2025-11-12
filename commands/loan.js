const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const profileModel = require('../models/profileSchema');
const loanModel = require('../models/loanSchema');
const balanceChangeEvent = require('../events/balanceChange');
const { transferPoints } = require('../utils/dbUtils');

// Helper function to send loan logs to the designated channel
async function sendLoanLog(client, guildId, embed) {
    try {
        // Priority: env LOAN_LOGS_CHANNEL_ID -> channel named "loan-logs" -> channel named "logs"
        const logChannelId = process.env.LOAN_LOGS_CHANNEL_ID;
        let logChannel = null;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;

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
        .setFooter({ text: `Created at` })
        .setTimestamp();

    await sendLoanLog(interaction.client, interaction.guild.id, logEmbed);

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
        .setFooter({ text: 'The borrower must accept this loan offer using /loan accept' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    // Try to DM the borrower
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

async function handleAccept(interaction) {
    const loanId = interaction.options.getString('loan_id');
    const userId = interaction.user.id;

    // Find the loan
    let loan;
    try {
        loan = await loanModel.findById(loanId);
    } catch (_error) {
        return await interaction.reply({
            content: 'Invalid loan ID. Please check the ID and try again.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (!loan) {
        return await interaction.reply({
            content: 'Loan not found. It may have been cancelled or already accepted.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Verify the user is the borrower
    if (loan.borrowerId !== userId) {
        return await interaction.reply({
            content: 'You are not the borrower of this loan.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Check if loan is still pending
    if (loan.status !== 'pending') {
        return await interaction.reply({
            content: `This loan has already been ${loan.status}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Transfer points from lender to borrower
    const transferResult = await transferPoints(loan.lenderId, loan.borrowerId, loan.loanAmount);

    if (!transferResult.success) {
        if (transferResult.reason === 'insufficient_funds') {
            return await interaction.reply({
                content: 'The lender no longer has sufficient funds for this loan.',
                flags: MessageFlags.Ephemeral
            });
        } else {
            return await interaction.reply({
                content: 'Failed to process the loan. Please try again later.',
                flags: MessageFlags.Ephemeral
            });
        }
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
            { name: 'Due Date', value: `<t:${Math.floor(dueAt / 1000)}:F>`, inline: true },
            { name: 'Status', value: '✅ Active', inline: false }
        )
        .setFooter({ text: `Accepted at` })
        .setTimestamp();

    await sendLoanLog(interaction.client, interaction.guild.id, logEmbed);

    // Fire balance change events
    try {
        const lenderMember = await interaction.guild.members.fetch(loan.lenderId);
        const borrowerMember = await interaction.guild.members.fetch(loan.borrowerId);
        balanceChangeEvent.execute(lenderMember);
        balanceChangeEvent.execute(borrowerMember);
    } catch (error) {
        console.error('Failed to fetch members for balance change event:', error);
    }

    // Create confirmation embed
    const embed = new EmbedBuilder()
        .setTitle('✅ Loan Accepted')
        .setColor(0x2ECC71)
        .setDescription(`You have accepted the loan from <@${loan.lenderId}>.`)
        .addFields(
            { name: 'Received', value: `🪙 ${loan.loanAmount.toLocaleString()} points`, inline: false },
            { name: 'Must Pay Back', value: `🪙 ${loan.paybackAmount.toLocaleString()} points`, inline: true },
            { name: 'Due Date', value: `<t:${Math.floor(dueAt / 1000)}:R>`, inline: true },
            { name: 'Loan ID', value: `\`${loan._id}\``, inline: false }
        )
        .setFooter({ text: 'Use /loan repay to pay back the loan early' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });

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
                { name: 'Due Date', value: `<t:${Math.floor(dueAt / 1000)}:R>`, inline: true },
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

async function handleRepay(interaction, profileData) {
    const loanId = interaction.options.getString('loan_id');
    const repayAmount = interaction.options.getInteger('amount');
    const userId = interaction.user.id;

    // Find the loan
    let loan;
    try {
        loan = await loanModel.findById(loanId);
    } catch (_error) {
        return await interaction.reply({
            content: 'Invalid loan ID. Please check the ID and try again.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (!loan) {
        return await interaction.reply({
            content: 'Loan not found.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Verify the user is the borrower
    if (loan.borrowerId !== userId) {
        return await interaction.reply({
            content: 'You are not the borrower of this loan.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Check if loan is active or overdue
    if (loan.status !== 'active' && loan.status !== 'overdue') {
        return await interaction.reply({
            content: `This loan is ${loan.status} and cannot be repaid.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Calculate remaining amount
    const remainingAmount = loan.paybackAmount - loan.amountPaid;
    const amountToRepay = repayAmount || remainingAmount;

    if (amountToRepay > remainingAmount) {
        return await interaction.reply({
            content: `You only need to pay ${remainingAmount.toLocaleString()} points. Cannot overpay.`,
            flags: MessageFlags.Ephemeral
        });
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

    // Check if borrower has enough balance - don't allow negative
    if (borrowerBalance < amountToRepay) {
        return await interaction.reply({
            content: `Insufficient funds. You have ${borrowerBalance.toLocaleString()} points but need ${amountToRepay.toLocaleString()} points to make this payment. Your future earnings will automatically go toward loan repayment.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Transfer points
    const transferResult = await transferPoints(loan.borrowerId, loan.lenderId, amountToRepay);

    if (!transferResult.success) {
        return await interaction.reply({
            content: 'Failed to process the repayment. Please try again later.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Update loan
    const newAmountPaid = loan.amountPaid + amountToRepay;
    const isFullyPaid = newAmountPaid >= loan.paybackAmount;

    await loanModel.findByIdAndUpdate(loanId, {
        amountPaid: newAmountPaid,
        status: isFullyPaid ? 'paid' : 'active',
        ...(isFullyPaid && { paidAt: new Date() }) // Set paidAt timestamp when fully paid
    });

    // Log to loan-logs channel
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
        .setFooter({ text: `Repayment made at` })
        .setTimestamp();

    await sendLoanLog(interaction.client, interaction.guild.id, logEmbed);

    // Fire balance change events
    try {
        const lenderMember = await interaction.guild.members.fetch(loan.lenderId);
        const borrowerMember = await interaction.guild.members.fetch(loan.borrowerId);
        balanceChangeEvent.execute(lenderMember);
        balanceChangeEvent.execute(borrowerMember);
    } catch (error) {
        console.error('Failed to fetch members for balance change event:', error);
    }

    // Create confirmation embed
    const embed = new EmbedBuilder()
        .setTitle(isFullyPaid ? '✅ Loan Fully Repaid' : '💵 Partial Payment Made')
        .setColor(isFullyPaid ? 0x2ECC71 : 0xF39C12)
        .setDescription(isFullyPaid
            ? `You have fully repaid your loan to <@${loan.lenderId}>!`
            : `You have made a payment on your loan to <@${loan.lenderId}>.`)
        .addFields(
            { name: 'Amount Paid', value: `🪙 ${amountToRepay.toLocaleString()} points`, inline: false },
            { name: 'Total Paid', value: `🪙 ${newAmountPaid.toLocaleString()} points`, inline: true },
            { name: 'Remaining', value: `🪙 ${(loan.paybackAmount - newAmountPaid).toLocaleString()} points`, inline: true }
        )
        .setFooter({ text: isFullyPaid ? 'Thank you for your timely payment!' : 'Future earnings will automatically go toward loan repayment' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    // Notify the lender
    if (isFullyPaid) {
        try {
            const lender = await interaction.client.users.fetch(loan.lenderId);
            const lenderEmbed = new EmbedBuilder()
                .setTitle('✅ Loan Fully Repaid')
                .setColor(0x2ECC71)
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
}

async function handleList(interaction) {
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

    const embed = new EmbedBuilder()
        .setTitle('💰 Your Active Loans')
        .setColor(0x3498DB)
        .setTimestamp();

    if (loansAsLender.length === 0 && loansAsBorrower.length === 0) {
        embed.setDescription('You have no active loans.');
    } else {
        if (loansAsLender.length > 0) {
            const lenderText = loansAsLender.map(loan => {
                const dueDate = `<t:${Math.floor(loan.dueAt / 1000)}:R>`;
                const remaining = loan.paybackAmount - loan.amountPaid;
                const overdueTag = loan.status === 'overdue' ? ' ⚠️ **OVERDUE**' : '';
                return `**ID:** \`${loan._id}\`\n**Borrower:** <@${loan.borrowerId}>\n**Remaining:** 🪙 ${remaining.toLocaleString()} / ${loan.paybackAmount.toLocaleString()}\n**Due:** ${dueDate}${overdueTag}\n`;
            }).join('\n');
            embed.addFields({ name: '💸 Loans You Gave', value: lenderText });
        }

        if (loansAsBorrower.length > 0) {
            const borrowerText = loansAsBorrower.map(loan => {
                const dueDate = `<t:${Math.floor(loan.dueAt / 1000)}:R>`;
                const remaining = loan.paybackAmount - loan.amountPaid;
                const overdueTag = loan.status === 'overdue' ? ' ⚠️ **OVERDUE**' : '';
                return `**ID:** \`${loan._id}\`\n**Lender:** <@${loan.lenderId}>\n**Remaining:** 🪙 ${remaining.toLocaleString()} / ${loan.paybackAmount.toLocaleString()}\n**Due:** ${dueDate}${overdueTag}\n`;
            }).join('\n');
            embed.addFields({ name: '💳 Loans You Owe', value: borrowerText });
        }
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
    } else {
        const loansText = pendingLoans.map(loan => {
            const durationHours = Math.floor(loan.duration / (60 * 60 * 1000));
            const interest = loan.paybackAmount - loan.loanAmount;
            return `**ID:** \`${loan._id}\`\n**Lender:** <@${loan.lenderId}>\n**Loan Amount:** 🪙 ${loan.loanAmount.toLocaleString()}\n**Payback:** 🪙 ${loan.paybackAmount.toLocaleString()} (Interest: ${interest.toLocaleString()})\n**Duration:** ${durationHours} hour(s)\n`;
        }).join('\n');
        embed.setDescription(loansText);
        embed.setFooter({ text: 'Use /loan accept <loan_id> to accept an offer' });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
                .setFooter({ text: `Became overdue at` })
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

// Auto-repayment function - called when borrower's balance increases
async function autoRepayLoans(userId, client, guildId) {
    try {
        // Find all overdue loans for this borrower
        const loans = await loanModel.find({
            borrowerId: userId,
            status: { $in: ['overdue'] }
        }).sort({ dueAt: 1 }); // Prioritize loans that are due soonest

        if (loans.length === 0) {
            return; // No active loans
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

            // Transfer points
            const transferResult = await transferPoints(userId, loan.lenderId, amountToRepay);

            if (transferResult.success) {
                availableBalance -= amountToRepay;
                const newAmountPaid = loan.amountPaid + amountToRepay;
                const isFullyPaid = newAmountPaid >= loan.paybackAmount;

                // Update loan
                await loanModel.findByIdAndUpdate(loan._id, {
                    amountPaid: newAmountPaid,
                    status: isFullyPaid ? 'paid' : loan.status,
                    ...(isFullyPaid && { paidAt: new Date() }) // Set paidAt timestamp when fully paid
                });

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
                    .setFooter({ text: `Auto-payment processed at` })
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
                            name: 'Remaining', value: `🪙 ${(loan.paybackAmount - newAmountPaid).toLocaleString()} points`, inline: true
                        });
                    }

                    embed.setFooter({ text: 'Future earnings will continue to auto-repay until loan is fully paid' })
                        .setTimestamp();

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
                    .setFooter({ text: `Expired at` })
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

// Export functions
module.exports.startPendingLoanCleanup = startPendingLoanCleanup;
module.exports.rescheduleActiveLoans = rescheduleActiveLoans;
module.exports.autoRepayLoans = autoRepayLoans;