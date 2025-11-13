const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const profileModel = require('../models/profileSchema');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the server leaderboard'),
    async execute(interaction, profileData = null, opts = {}) {
        try {
            // Handle ephemeral flag from opts
            const ephemeral = !!opts.ephemeral;
            const deferOpts = ephemeral ? { flags: MessageFlags.Ephemeral } : {};

            await interaction.deferReply(deferOpts);

            // Fetch all profiles for this server, sorted by balance
            const profiles = await profileModel.find({ serverID: interaction.guild.id })
                .sort({ balance: -1 })
                .limit(100); // Limit to top 100 to avoid performance issues

            if (!profiles || profiles.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('🏆Leaderboard🏆')
                    .setDescription('No users found in the leaderboard yet.')
                    .setColor(0x95A5A6)
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            }

            // Pagination setup
            const usersPerPage = 10;
            let currentPage = 0;
            const totalPages = Math.ceil(profiles.length / usersPerPage);

            // Function to generate embed for a specific page
            const generateEmbed = async (page) => {
                const start = page * usersPerPage;
                const end = start + usersPerPage;
                const pageProfiles = profiles.slice(start, end);

                // Build leaderboard text
                const leaderboardText = await Promise.all(pageProfiles.map(async (profile, index) => {
                    const globalRank = start + index + 1;
                    // let medal = '';

                    // Add medals for top 3
                    // if (globalRank === 1) medal = '🥇';
                    //  else if (globalRank === 2) medal = '🥈';
                    // else if (globalRank === 3) medal = '🥉';

                    try {
                        const user = await interaction.client.users.fetch(profile.userId);
                        return `\`#${globalRank.toString()}\` **${user.username}**: ${profile.balance.toLocaleString()} points`;
                    } catch (error) {
                        return `\`#${globalRank.toString()}\` **Unknown User** - 🪙 ${profile.balance.toLocaleString()} points`;
                    }
                }));

                const embed = new EmbedBuilder()
                    .setTitle('🏆 Leaderboard 🏆')
                    .setDescription(leaderboardText.join('\n'))
                    .setColor(0xFFD700)
                    .setFooter({ text: `Your balance: ${profiles.find(p => p.userId === interaction.user.id)?.balance.toLocaleString() || 0} points | your rank: ${profiles.findIndex(p => p.userId === interaction.user.id) + 1 || 0} \n Page ${page + 1}/${totalPages}` })
                    .setTimestamp();

                return embed;
            };

            // Function to generate buttons
            const generateButtons = (page) => {
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('leaderboard_prev')
                            .setLabel('◀ Previous')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(page === 0),
                        new ButtonBuilder()
                            .setCustomId('leaderboard_next')
                            .setLabel('Next ▶')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(page === totalPages - 1)
                    );
                return row;
            };

            // Send initial message
            const embed = await generateEmbed(currentPage);
            const components = totalPages > 1 ? [generateButtons(currentPage)] : [];

            const message = await interaction.editReply({
                embeds: [embed],
                components: components
            });

            // Auto-delete the reply after 60 seconds if ephemeral
            if (ephemeral) {
                setTimeout(async () => {
                    try {
                        await interaction.deleteReply();
                    } catch (_err) {
                        // ignore
                    }
                }, 60000);
            }

            // If only one page, no need for collector
            if (totalPages <= 1) {return;}

            // Create button collector
            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: opts.ephemeral ? 58000 : 300000 // 5 minutes, or 58 seconds if the opts are ephemeral
            });

            collector.on('collect', async (buttonInteraction) => {
                // Check if the button clicker is the command invoker
                if (buttonInteraction.user.id !== interaction.user.id) {
                    return await buttonInteraction.reply({
                        content: 'These buttons are not for you!',
                        flags: 64 // Ephemeral
                    });
                }

                // Update page
                if (buttonInteraction.customId === 'leaderboard_next') {
                    currentPage = Math.min(currentPage + 1, totalPages - 1);
                } else if (buttonInteraction.customId === 'leaderboard_prev') {
                    currentPage = Math.max(currentPage - 1, 0);
                }

                // Update message
                await buttonInteraction.update({
                    embeds: [await generateEmbed(currentPage)],
                    components: [generateButtons(currentPage)],
                });
            });

            collector.on('end', async () => {
                // Disable buttons after timeout
                try {
                    await interaction.editReply({
                        components: []
                    });
                } catch (error) {
                    console.debug('Failed to remove buttons after timeout:', error);
                }
            });

        } catch (error) {
            console.error('Error generating leaderboard:', error);

            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({
                        content: 'Failed to generate leaderboard. Please try again later.'
                    });
                } else {
                    await interaction.reply({
                        content: 'Failed to generate leaderboard. Please try again later.',
                        flags: 64 // Ephemeral
                    });
                }
            } catch (followUpError) {
                console.error('Failed to send error message:', followUpError);
            }
        }
    },
};