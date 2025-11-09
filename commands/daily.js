const { SlashCommandBuilder, time, MessageFlags } = require('discord.js');
const parseMilliseconds = require("parse-ms-2");
const profileModel = require("../models/profileSchema");
const { dailyMin, dailyMax } = require("../globalValues.json");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('daily points'),
    async execute(interaction, profileData = null, opts = {}) {
        const ephemeral = !!opts.ephemeral;
        const deferOpts = ephemeral ? { flags: MessageFlags.Ephemeral } : {};

        const id = interaction.user.id;

        // ensure profileData exists
        if (!profileData) {
            try {
                profileData = await profileModel.findOne({ userId: id });
                if (!profileData) {
                    profileData = await profileModel.create({
                        userId: id,
                        serverID: interaction.guild?.id ?? null,
                    });
                }
            } catch (err) {
                console.error('Failed to fetch/create profileData:', err);
            }
        }

        const lastDaily = profileData?.lastDaily ?? 0;
        const cooldown = 86400000; // 24 hours
        const timeLeft = cooldown - (Date.now() - lastDaily);

        // If still on cooldown, reply/edit reply (respect previous replies)
        if (timeLeft > 0) {
            try {
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply(deferOpts);
                }
            } catch (err) {
                console.error('Failed to defer for cooldown message:', err);
            }

            const { hours, minutes, seconds } = parseMilliseconds(timeLeft);
            const msg = `Already claimed. You can collect again in ${hours}h ${minutes}m ${seconds}s.`;

            try {
                if (interaction.deferred) {
                    await interaction.editReply(msg);
                } else if (!interaction.replied) {
                    // not deferred and not replied -> reply now (use flags if needed)
                    if (ephemeral) await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
                    else await interaction.reply({ content: msg });
                } else {
                    await interaction.followUp({ content: msg, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
                }
                // Auto-delete the reply after 30 seconds if ephemeral
                if (ephemeral) {
                    setTimeout(async () => {
                        try {
                            await interaction.deleteReply();
                        } catch (err) {
                            // ignore
                        }
                    }, 30000);
                }
            } catch (err) {
                console.error('Failed to send cooldown message:', err);
            }
            return;
        }

        // Proceed to claim daily: defer first only if needed
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply(deferOpts);
            }
        } catch (err) {
            console.error('Failed to defer before awarding daily:', err);
        }

        const randomPoints = Math.floor(Math.random() * (dailyMax - dailyMin + 1)) + dailyMin;

        try {
            await profileModel.findOneAndUpdate(
                { userId: id },
                {
                    $set: { lastDaily: Date.now() },
                    $inc: { balance: randomPoints },
                },
                { upsert: true }
            );
        } catch (err) {
            console.error('Failed to update daily claim:', err);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    if (ephemeral) await interaction.reply({ content: 'Error claiming daily.', flags: MessageFlags.Ephemeral });
                    else await interaction.reply({ content: 'Error claiming daily.' });
                } else if (interaction.deferred) {
                    await interaction.editReply('Error claiming daily.');
                } else {
                    await interaction.followUp({ content: 'Error claiming daily.', flags: ephemeral ? MessageFlags.Ephemeral : undefined });
                }
            } catch { }
            return;
        }

        // Send success message
        const successMsg = `You have collected your daily **${randomPoints.toLocaleString()}** points! Come back in 24 hours for more.`;
        try {
            if (interaction.deferred) {
                await interaction.editReply(successMsg);
            } else if (!interaction.replied) {
                if (ephemeral) await interaction.reply({ content: successMsg, flags: MessageFlags.Ephemeral });
                else await interaction.reply({ content: successMsg });
            } else {
                await interaction.followUp({ content: successMsg, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
            }
            // Auto-delete the reply after 30 seconds if ephemeral
            if (ephemeral) {
                setTimeout(async () => {
                    try {
                        await interaction.deleteReply();
                    } catch (err) {
                        // ignore
                    }
                }, 30000);
            }
        } catch (err) {
            console.error('Failed to send daily success message:', err);
        }
    },
};
