const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const profileModel = require('../models/profileSchema');
const { transferPoints } = require('../utils/dbUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('donate')
        .setDescription('Donate points to another player')
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The player to donate points to')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('The amount of points to donate')
                .setRequired(true)
                .setMinValue(1)),
    async execute(interaction, profileData, opts = {}) {
        // accept either opts.flags (MessageFlags) or opts.ephemeral (legacy boolean)
        const ephemeral = opts.flags ? (opts.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral : !!opts.ephemeral;
        const callerFlags = opts.flags ?? (opts.ephemeral ? MessageFlags.Ephemeral : undefined);
        const flags = callerFlags ? { flags: callerFlags } : {};

        // Determine target and amount (prefer opts from modal/select)
        const targetId = opts.targetId ?? interaction.options?.getUser('player')?.id;
        const amount = typeof opts.amount === 'number' ? opts.amount : interaction.options?.getInteger('amount');

        if (!targetId) {
            const msg = 'No recipient specified.';
            if (!interaction.replied && !interaction.deferred) { return interaction.reply({ content: msg, ...flags }); }
            return interaction.followUp({ content: msg, ...flags });
        }

        if (!amount || isNaN(amount) || amount <= 0) {
            const msg = 'Please provide a valid positive amount to donate.';
            if (!interaction.replied && !interaction.deferred) { return interaction.reply({ content: msg, ...flags }); }
            return interaction.followUp({ content: msg, ...flags });
        }

        const senderId = interaction.user.id;
        if (senderId === targetId) {
            const msg = "You can't donate to yourself.";
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
            } else {
                await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
            }
            // Auto-delete the reply after 30 seconds if ephemeral
            if (ephemeral) {
                setTimeout(async () => {
                    try {
                        await interaction.deleteReply();
                    } catch (_err) {
                        // ignore
                    }
                }, 30000);
            }
            return;
        }

        // ensure sender profile exists (profileData may already be provided)
        try {
            if (!profileData) {
                profileData = await profileModel.findOne({ userId: senderId });
                if (!profileData) {
                    profileData = await profileModel.create({ userId: senderId, serverID: interaction.guild?.id ?? null });
                }
            }
        } catch (_err) {
            console.error('Failed to load sender profile:', err);
        }

        const senderBalance = profileData?.balance ?? 0;
        if (amount > senderBalance) {
            const msg = `Insufficient funds. You have ${senderBalance.toLocaleString()} points.`;
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
            } else if (interaction.deferred) {
                await interaction.editReply({ content: msg, flags: MessageFlags.Ephemeral });
            } else {
                await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
            }
            // Auto-delete the reply after 30 seconds if ephemeral
            if (ephemeral) {
                setTimeout(async () => {
                    try {
                        await interaction.deleteReply();
                    } catch (_err) {
                        // ignore
                    }
                }, 30000);
            }
            return;
        }

        // perform the transfer using atomic transaction
        let transferResult;
        try {
            transferResult = await transferPoints(senderId, targetId, amount, { interaction });
        } catch (_err) {
            console.error('Failed to execute transferPoints:', err);
            const msg = 'Failed to complete the donation. Please try again later.';
            if (!interaction.replied && !interaction.deferred) { return interaction.reply({ content: msg, ...flags }); }
            if (interaction.deferred) { return interaction.editReply({ content: msg }); }
            return interaction.followUp({ content: msg, ...flags });
        }

        // Handle transfer result
        if (!transferResult.success) {
            if (transferResult.reason === 'insufficient_funds') {
                // This shouldn't happen given the check above, but handle it anyway
                const msg = `Insufficient funds. You have ${senderBalance.toLocaleString()} points.`;
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: msg, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
                }
                // Auto-delete the reply after 30 seconds if ephemeral
                if (ephemeral) {
                    setTimeout(async () => {
                        try {
                            await interaction.deleteReply();
                        } catch (_err) {
                            // ignore
                        }
                    }, 30000);
                }
                return;
            } else {
                // Other errors (invalid_amount, db_error)
                console.error('Transfer failed:', transferResult.reason, transferResult.error);
                const msg = 'Failed to complete the donation. Please try again later.';
                if (!interaction.replied && !interaction.deferred) { return interaction.reply({ content: msg, ...flags }); }
                if (interaction.deferred) { return interaction.editReply({ content: msg }); }
                return interaction.followUp({ content: msg, ...flags });
            }
        }

        // Transfer successful - balance change events are already fired by transferPoints
        // Build success embed
        const senderName = interaction.user.username;
        let recipientUser;
        try {
            recipientUser = await interaction.client.users.fetch(targetId);
        } catch {
            recipientUser = { username: 'Unknown User', id: targetId };
        }

        const embed = new EmbedBuilder()
            .setTitle('Donation Sent 💸')
            .setColor(0xFAA61A)
            .addFields(
                { name: 'From', value: `${senderName} (<@${senderId}>)`, inline: true },
                { name: 'To', value: `${recipientUser.username} (<@${targetId}>)`, inline: true },
                { name: 'Amount', value: `🪙 ${amount.toLocaleString()} points`, inline: false }
            )
            .setFooter({ text: 'Thank you for supporting other players!' })
            .setTimestamp();

        // send interaction confirmation
        try {
            if (interaction.deferred) {
                await interaction.editReply({ embeds: [embed] });
            } else if (!interaction.replied) {
                await interaction.reply({ embeds: [embed], ...flags });
            } else {
                await interaction.followUp({ embeds: [embed], ...flags });
            }
            // Auto-delete the reply after 30 seconds if ephemeral
            if (ephemeral) {
                setTimeout(async () => {
                    try {
                        await interaction.deleteReply();
                    } catch (_err) {
                        // ignore
                    }
                }, 30000);
            }
        } catch (_err) {
            console.error('Failed to send donate confirmation:', _err);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'Donation completed, but I failed to send a confirmation.', flags: MessageFlags.Ephemeral });
                }
            } catch { }
        }

        // ANNOUNCEMENT: attempt to send a public message to a channel
        (async () => {
            try {
                // channel priority: opts.announceChannelId -> env DONATION_CHANNEL_ID -> channel named "donations" -> guild.systemChannel -> first text channel
                const announceChannelId = opts.announceChannelId ?? process.env.DONATION_CHANNEL_ID;
                let announceChannel = null;

                if (announceChannelId && interaction.guild) {
                    announceChannel = interaction.guild.channels.cache.get(announceChannelId) ?? await interaction.guild.channels.fetch(announceChannelId).catch(() => null);
                }

                if (!announceChannel && interaction.guild) {
                    announceChannel = interaction.guild.channels.cache.find(ch => ch.name === 'donations' && ch.isTextBased?.()) || interaction.guild.systemChannel || interaction.channel;
                }

                if (!announceChannel) { return; }

                // build a public announcement embed (slightly different for channel)
                const announceEmbed = new EmbedBuilder()
                    .setTitle('New Donation 💸')
                    .setColor(0xFFD700)
                    .setDescription(`${interaction.user} donated **${amount.toLocaleString()}** points to **${recipientUser.username}**`)
                    .addFields(
                        { name: 'Donor', value: `<@${senderId}>`, inline: true },
                        { name: 'Recipient', value: `<@${targetId}>`, inline: true },
                        { name: 'Amount', value: `🪙 ${amount.toLocaleString()} points`, inline: false }
                    )
                    .setTimestamp();

                await announceChannel.send({ embeds: [announceEmbed] });
            } catch (_err) {
                console.error('Failed to send donation announcement:', err);
            }
        })();
    },
};