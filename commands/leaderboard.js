const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const profileModel = require('../models/profileSchema');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the top players on the server'),

    async execute(interaction, profileData, opts = {}) {
        const ephemeral = opts.ephemeral ?? false;
        await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

        try {
            // Fetch all profiles sorted by balance
            const allProfiles = await profileModel.find({ serverID: interaction.guild.id })
                .sort({ balance: -1 })
                .lean();

            if (!allProfiles || allProfiles.length === 0) {
                return await interaction.editReply({
                    content: 'No players found on the leaderboard yet!',
                    flags: ephemeral ? MessageFlags.Ephemeral : undefined
                });
            }

            const ITEMS_PER_PAGE = 10;
            const totalPages = Math.ceil(allProfiles.length / ITEMS_PER_PAGE);
            let currentPage = 0;

            // Function to generate embed for a specific page
            async function generateLeaderboardEmbed(page) {
                const start = page * ITEMS_PER_PAGE;
                const end = start + ITEMS_PER_PAGE;
                const pageProfiles = allProfiles.slice(start, end);

                let description = '';
                for (let i = 0; i < pageProfiles.length; i++) {
                    const profile = pageProfiles[i];
                    const rank = start + i + 1;

                    try {
                        const user = await interaction.client.users.fetch(profile.userId);
                        const username = user.username;
                        description += `\`#${rank}\` **${username}**: ${profile.balance.toLocaleString()} points\n`;
                    } catch (error) {
                        console.error(`Failed to fetch user ${profile.userId}:`, error);
                        description += `\`#${rank}\` **Unknown User**: ${profile.balance.toLocaleString()} points\n`;
                    }
                }

                const embed = new EmbedBuilder()
                    .setTitle('🏆 Leaderboard 🏆')
                    .setDescription(description)
                    .setColor(0xFFD700)
                    .setFooter({ text: `Page ${page + 1} of ${totalPages} • Total Players: ${allProfiles.length}` })
                    .setTimestamp();

                return embed;
            }

            // Function to generate buttons
            function generateButtons(page) {
                const previousButton = new ButtonBuilder()
                    .setCustomId('leaderboard_previous')
                    .setLabel('◀ Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === 0);

                const nextButton = new ButtonBuilder()
                    .setCustomId('leaderboard_next')
                    .setLabel('Next ▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page >= totalPages - 1);

                const row = new ActionRowBuilder()
                    .addComponents(previousButton, nextButton);

                return row;
            }

            // Send initial message
            const embed = await generateLeaderboardEmbed(currentPage);
            const row = totalPages > 1 ? generateButtons(currentPage) : null;

            const message = await interaction.editReply({
                embeds: [embed],
                components: row ? [row] : [],
                flags: ephemeral ? MessageFlags.Ephemeral : undefined
            });

            // Auto-delete the reply after 60 seconds if ephemeral
            if (ephemeral) {
                setTimeout(async () => {
                    try {
                        await interaction.deleteReply();
                    } catch (_err) {
                        // Ignore deletion errors
                    }
                }, 60000);
            }

            // If only one page, no need for collector
            if (totalPages <= 1) {
                return;
            }

            // Create button collector with 5 minute timeout
            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 5 * 60 * 1000 // 5 minutes
            });

            collector.on('collect', async i => {
                // CRITICAL: Defer the update immediately to acknowledge the interaction
                // This must happen within 3 seconds of the button click
                try {
                    await i.deferUpdate();
                } catch (error) {
                    console.error('Failed to defer button interaction:', error);
                    return; // Exit early if we can't defer
                }

                try {
                    // Update current page
                    if (i.customId === 'leaderboard_next' && currentPage < totalPages - 1) {
                        currentPage++;
                    } else if (i.customId === 'leaderboard_previous' && currentPage > 0) {
                        currentPage--;
                    }

                    // Generate new embed and buttons
                    const newEmbed = await generateLeaderboardEmbed(currentPage);
                    const newRow = generateButtons(currentPage);

                    // Edit the deferred update
                    await i.editReply({
                        embeds: [newEmbed],
                        components: [newRow]
                    });
                } catch (error) {
                    console.error('Error updating leaderboard page:', error);
                    // Don't try to respond again - we already deferred
                }
            });

            collector.on('end', async (_collected, reason) => {
                try {
                    // Disable buttons when collector ends
                    const disabledButtons = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('leaderboard_previous')
                                .setLabel('◀ Previous')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(true),
                            new ButtonBuilder()
                                .setCustomId('leaderboard_next')
                                .setLabel('Next ▶')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(true)
                        );

                    // Get current embed
                    const currentEmbed = await generateLeaderboardEmbed(currentPage);

                    // Only update if reason is time (not if message was deleted)
                    if (reason === 'time') {
                        await interaction.editReply({
                            embeds: [currentEmbed],
                            components: [disabledButtons]
                        }).catch(err => {
                            console.log('Could not disable leaderboard buttons:', err.message);
                        });
                    }
                } catch (error) {
                    console.error('Error disabling leaderboard buttons:', error);
                }
            });

        } catch (error) {
            console.error('Error in leaderboard command:', error);

            const errorMessage = 'An error occurred while fetching the leaderboard. Please try again.';

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: errorMessage,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await interaction.reply({
                    content: errorMessage,
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    },
};