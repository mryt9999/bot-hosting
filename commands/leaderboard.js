const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('@discordjs/builders');
const profileModel = require('../models/profileSchema');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Shows top 10 players with highest points'),
    async execute(interaction, profileData, opts = {}) {
        const ephemeral = !!opts.ephemeral;
        // defer reply if not already deferred/replied (use ephemeral if requested)
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.deferReply({ ephemeral: !!opts.ephemeral });
            }
        } catch (_err) {
            console.error('Failed to defer reply:', err);
        }

        const { id } = interaction.user;
        const { balance } = profileData;

        const leaderboardEmbed = new EmbedBuilder()
            .setTitle('🏆 Leaderboard 🏆')
            .setDescription('Top 10 players with highest points')
            .setColor(0xFFD700)
            .setFooter({ text: `Your Balance: ${balance} points` });

        const members = await profileModel.find().sort({ balance: -1 }).catch(err => {
            console.error(err);
            return [];
        });

        if (!members || members.length === 0) {
            const noDataText = 'No leaderboard data available.';
            if (interaction.deferred) {
                await interaction.editReply({ content: noDataText });
            } else if (!interaction.replied) {
                await interaction.reply({ content: noDataText, ephemeral: !!opts.ephemeral });
            } else {
                await interaction.followUp({ content: noDataText, ephemeral: !!opts.ephemeral });
            }
            return;
        }

        const memberIndex = members.findIndex((member) => member.userId === id);
        leaderboardEmbed.setFooter({ text: `Your Balance: ${balance} points | Your Rank: #${memberIndex + 1}` });

        const topTen = members.slice(0, 10);

        let desc = '';
        for (let i = 0; i < topTen.length; i++) {
            try {
                const memberObj = await interaction.guild.members.fetch(topTen[i].userId);
                const userObj = memberObj?.user;
                if (!userObj) {continue;}
                const userBalance = topTen[i].balance;
                desc += `**#${i + 1}. ${userObj.username}**: ${userBalance} points\n`;
            } catch (_err) {
                // couldn't fetch this member, skip
                continue;
            }
        }

        if (desc !== '') {
            leaderboardEmbed.setDescription(desc);
        }

        try {
            if (interaction.deferred) {
                await interaction.editReply({ embeds: [leaderboardEmbed] });

            } else if (!interaction.replied) {
                await interaction.reply({ embeds: [leaderboardEmbed], ephemeral: !!opts.ephemeral });

            } else {
                await interaction.followUp({ embeds: [leaderboardEmbed], ephemeral: !!opts.ephemeral });
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
            console.error('Failed to send leaderboard reply:', err);
            // best-effort fallback
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'Error showing leaderboard.', flags: MessageFlags.Ephemeral });
                }
            } catch { }
        }
    },
};
