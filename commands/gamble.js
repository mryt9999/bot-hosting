const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const profileModel = require('../models/profileSchema');
const { updateBalance } = require('../utils/dbUtils');
const { safeDefer, safeReply } = require('../utils/interactionHelper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gamble')
        .setDescription('Gamble your points with 50/50 odds')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('The amount of points to gamble')
                .setRequired(true)
                .setMinValue(1)),
    async execute(interaction, profileData, opts = {}) {
        // Resolve flags/ephemeral preferences from opts

        const flagsValue = opts.flags;
        const ephemeralFlag = opts.flags ? (opts.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral : !!opts.ephemeral;
        const replyFlags = flagsValue ?? (ephemeralFlag ? MessageFlags.Ephemeral : undefined);
        const ephemeral = replyFlags ? (replyFlags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral : false;

        // Defer early for normal slash commands (modal submits should not be deferred)
        if (!opts.invokedByModal) {
            const deferred = await safeDefer(interaction, { ephemeral: ephemeralFlag });
            if (deferred === null) {
                console.warn('Gamble: interaction expired before processing.');
                return;
            }
        }

        // Determine bet amount (modal or slash)
        const amount = typeof opts.amount === 'number' ? opts.amount : interaction.options?.getInteger('amount');
        if (!amount || isNaN(amount) || amount <= 0) {
            await safeReply(interaction, { content: 'Invalid gamble amount.', flags: replyFlags });
            return;
        }

        // Ensure profile exists
        try {
            if (!profileData) {
                profileData = await profileModel.findOne({ userId: interaction.user.id });
                if (!profileData) {
                    profileData = await profileModel.create({
                        userId: interaction.user.id,
                        serverID: interaction.guild?.id ?? null
                    });
                }
            }
        } catch (err) {
            console.error('Failed to fetch/create profileData for gamble:', err);
            await safeReply(interaction, { content: 'An internal error occurred.', flags: MessageFlags.Ephemeral });
            return;
        }

        const balance = profileData?.balance ?? 0;

        // Insufficient funds
        if (amount > balance) {
            const insuffMsg = 'You do not have enough points to make this gamble.';
            const sent = await safeReply(interaction, { content: insuffMsg, ephemeral: true });
            // Auto-delete ephemeral replies (best-effort)
            if (ephemeralFlag && sent) {
                setTimeout(async () => {
                    try {
                        await interaction.deleteReply();
                    } catch (_) { /* ignore */ }
                }, 30000);
            }
            return;
        }

        // Perform gamble (50/50)
        //const win = Math.random() < 0.5;
        //perform gamble with 2% house edge
        const win = Math.random() < 0.49;
        try {
            const balanceChange = win ? amount : -amount;
            const updateResult = await updateBalance(
                interaction.user.id,
                balanceChange,
                { interaction },
                { serverId: interaction.guild?.id ?? null }
            );

            if (!updateResult.success) {
                await safeReply(interaction, { content: 'An error occurred while processing your gamble.', flags: MessageFlags.Ephemeral });
                return;
            }

            const resultMsg = win
                ? `🎉 Congratulations! You won ${amount.toLocaleString()} points!`
                : `💔 You lost ${amount.toLocaleString()} points. Better luck next time!`;

            await safeReply(interaction, { content: resultMsg, ephemeral: ephemeral });

            if (ephemeralFlag) {
                setTimeout(async () => {
                    try {
                        await interaction.deleteReply();
                    } catch (_) { /* ignore */ }
                }, 30000);
            }
        } catch (err) {
            console.error('Failed during gamble update/reply:', err);
            // Try to notify user nicely (best effort)
            try {
                await safeReply(interaction, { content: 'Error processing gamble.', flags: MessageFlags.Ephemeral });
            } catch (_) { /* ignore */ }
            return;
        }

        // ANNOUNCEMENT (fire-and-forget, safe)
        (async () => {
            try {
                const announceChannelId = opts.announceChannelId ?? process.env.GAMBLING_CHANNEL_ID;
                let announceChannel = null;

                if (announceChannelId && interaction.guild) {
                    announceChannel = interaction.guild.channels.cache.get(announceChannelId)
                        ?? await interaction.guild.channels.fetch(announceChannelId).catch(() => null);
                }

                if (!announceChannel && interaction.guild) {
                    announceChannel = interaction.guild.channels.cache.find(ch => ch.name === 'gambling' && ch.isTextBased?.())
                        || interaction.guild.systemChannel
                        || interaction.channel;
                }

                if (!announceChannel) return;

                const announceMsg = win
                    ? `🎉 ${interaction.user} won ${amount.toLocaleString()} points!`
                    : `💔 ${interaction.user} lost ${amount.toLocaleString()} points.`;

                await announceChannel.send({ content: announceMsg });
            } catch (err) {
                console.error('Failed to send GAMBLING announcement:', err);
            }
        })();
    },
};