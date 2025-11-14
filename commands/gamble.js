const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const profileModel = require('../models/profileSchema');
const balanceChangeEvent = require('../events/balanceChange');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gamble')
        .setDescription('gamble points with 50/50 odds')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('The amount of points to gamble')
                .setRequired(true)
                .setMinValue(1)),
    async execute(interaction, profileData, opts = {}) {
        // accept either opts.ephemeral (boolean) or opts.flags (MessageFlags value)
        const ephemeral = opts.flags ? (opts.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral : !!opts.ephemeral;
        const callerFlags = opts.flags ?? (opts.ephemeral ? MessageFlags.Ephemeral : undefined);
        const flags = callerFlags ? { flags: callerFlags } : {};
        const deferOpts = callerFlags ? { flags: callerFlags } : {};

        if (!opts.invokedByModal) {
            // Normal slash command - defer as usual
            const deferOpts = callerFlags ? { flags: callerFlags } : {};
            await interaction.deferReply(deferOpts);
        } else {
            // Modal submit - just reply, don't defer (modal submit is already a response)
            // The modal interaction is fresh, we can reply directly
        }

        // Determine amount: prefer opts.amount (from modal) otherwise use slash option
        const amount = typeof opts.amount === 'number' ? opts.amount : interaction.options?.getInteger('amount');
        if (!amount || isNaN(amount) || amount <= 0) {
            if (!interaction.replied && !interaction.deferred) {
                return await interaction.reply({ content: 'Invalid gamble amount.', ...flags });
            } else {
                return await interaction.followUp({ content: 'Invalid gamble amount.', ...flags });
            }
        }

        // ensure profileData exists
        if (!profileData) {
            try {
                profileData = await profileModel.findOne({ userId: interaction.user.id });
                if (!profileData) {
                    profileData = await profileModel.create({
                        userId: interaction.user.id,
                        serverID: interaction.guild?.id ?? null,
                    });
                }
            } catch (_err) {
                console.error('Failed to fetch/create profileData for gamble:', err);
            }
        }

        const balance = profileData?.balance ?? 0;

        if (amount > balance) {
            // decide ephemeral behavior:
            // - respect caller flags (opts.flags or opts.ephemeral)
            // - otherwise, make insufficient-funds ephemeral when amount came from the slash integer option
            const amountFromSlashOption = typeof opts.amount !== 'number' && !!interaction.options?.getInteger('amount');
            const ephemeralForInsuff = callerFlags ?? (amountFromSlashOption ? MessageFlags.Ephemeral : undefined);
            const insuffFlags = ephemeralForInsuff ? { flags: ephemeralForInsuff } : {};

            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'You do not have enough points to make this gamble.', ...insuffFlags });
                } else if (interaction.deferred) {
                    await interaction.editReply('You do not have enough points to make this gamble.');
                } else {
                    await interaction.followUp({ content: 'You do not have enough points to make this gamble.', ...insuffFlags });
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
                console.error('Failed to notify insufficient funds:', err);
            }
            return;
        }

        // Defer reply if not already (respect ephemeral option)
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply(deferOpts);
            }
        } catch (_err) {
            console.error('Failed to defer gamble reply:', _err);
        }

        // 50/50 gamble
        const win = Math.random() < 0.5;
        try {
            if (win) {
                await profileModel.findOneAndUpdate(
                    { userId: interaction.user.id },
                    { $inc: { balance: amount } }
                );
                let targetMember;
                try {
                    targetMember = await interaction.guild.members.fetch(interaction.user.id);
                } catch (_err) {
                    console.error('Failed to fetch target member for balance change event:', err);
                }
                // FIRE BALANCE CHANGE EVENT
                balanceChangeEvent.execute(targetMember);
                if (interaction.deferred) {
                    await interaction.editReply(`🎉 Congratulations! You won ${amount} points!`);
                } else {
                    await interaction.followUp({ content: `🎉 Congratulations! You won ${amount} points!`, ...flags });
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
            } else {
                await profileModel.findOneAndUpdate(
                    { userId: interaction.user.id },
                    { $inc: { balance: -amount } }
                );
                let targetMember;
                try {
                    targetMember = await interaction.guild.members.fetch(interaction.user.id);
                } catch (_err) {
                    console.error('Failed to fetch target member for balance change event:', err);
                }
                // FIRE BALANCE CHANGE EVENT
                balanceChangeEvent.execute(targetMember);
                if (interaction.deferred) {
                    await interaction.editReply(`💔 you lost ${amount} points. Better luck next time!`);
                } else {
                    await interaction.followUp({ content: `💔 you lost ${amount} points. Better luck next time!`, ...flags });
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
            }
        } catch (_err) {
            console.error('Failed during gamble update/reply:', _err);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'Error processing gamble.', ...flags });
                }
            } catch { }
        }

        // ANNOUNCEMENT: attempt to send a public message to a channel
        (async () => {
            try {
                // channel priority: opts.announceChannelId -> env GAMBLING_CHANNEL_ID -> channel named "gambling" -> guild.systemChannel -> first text channel
                const announceChannelId = opts.announceChannelId ?? process.env.GAMBLING_CHANNEL_ID;
                let announceChannel = null;

                if (announceChannelId && interaction.guild) {
                    announceChannel = interaction.guild.channels.cache.get(announceChannelId) ?? await interaction.guild.channels.fetch(announceChannelId).catch(() => null);
                }

                if (!announceChannel && interaction.guild) {
                    announceChannel = interaction.guild.channels.cache.find(ch => ch.name === 'gambling' && ch.isTextBased?.()) || interaction.guild.systemChannel || interaction.channel;
                }

                if (!announceChannel) { return; }

                msg = win ? `🎉 ${interaction.user} Won ${amount} points!` : `💔 ${interaction.user} lost ${amount} points.`;

                await announceChannel.send({ content: msg, timestamp: Date.now() });
            } catch (_err) {
                console.error('Failed to send GAMBLING announcement:', err);
            }
        })();
    },
};
