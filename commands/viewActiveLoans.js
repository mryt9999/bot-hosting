const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const loanModel = require('../models/loanSchema');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('activeloans')
        .setDescription('View all currently active loans in the server'),
    async execute(interaction, profileData) {
        try {
            // Defer reply as this might take a moment to fetch
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            // Find all active and overdue loans in this server
            const activeLoans = await loanModel.find({
                serverID: interaction.guild.id,
                status: { $in: ['active', 'overdue'] }
            }).sort({ dueAt: 1 }); // Sort by due date (soonest first)

            if (activeLoans.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('📊 Active Loans')
                    .setDescription('There are currently no active loans in this server.')
                    .setColor(0x95A5A6)
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            }

            // Pagination setup
            const loansPerPage = 15;
            let currentPage = 0;
            const totalPages = Math.ceil(activeLoans.length / loansPerPage);

            // Function to generate embed for a specific page
            const generateEmbed = (page) => {
                const start = page * loansPerPage;
                const end = start + loansPerPage;
                const pageLoans = activeLoans.slice(start, end);

                const loansList = pageLoans.map((loan, index) => {
                    const globalIndex = start + index;
                    const remaining = loan.paybackAmount - loan.amountPaid;
                    const progress = ((loan.amountPaid / loan.paybackAmount) * 100).toFixed(0);
                    const overdueTag = loan.status === 'overdue' ? ' ⚠️' : '';
                    const dueTimestamp = `<t:${Math.floor(loan.dueAt / 1000)}:R>`;

                    // Compact format: #ID | Lender→Borrower | Remaining/Total (progress%) | Due date
                    return `\`${(globalIndex + 1).toString().padStart(2, '0')}\` <@${loan.lenderId}>→<@${loan.borrowerId}> | 🪙 ${remaining.toLocaleString()}/${loan.paybackAmount.toLocaleString()} (\`${progress}%\`) | ${dueTimestamp}${overdueTag}`;
                });

                const embed = new EmbedBuilder()
                    .setTitle(`📊 Active Loans (${activeLoans.length} total)`)
                    .setColor(0x3498DB)
                    .setDescription(loansList.join('\n'))
                    .setFooter({ text: `⚠️ = Overdue | Format: Lender→Borrower | Remaining/Total (Progress%) | Due • Page ${page + 1}/${totalPages}` })
                    .setTimestamp();

                return embed;
            };

            // Function to generate buttons
            const generateButtons = (page) => {
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('activeloans_prev')
                            .setLabel('◀ Previous')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(page === 0),
                        new ButtonBuilder()
                            .setCustomId('activeloans_next')
                            .setLabel('Next ▶')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(page === totalPages - 1)
                    );
                return row;
            };

            // Send initial message
            const embed = generateEmbed(currentPage);
            const components = totalPages > 1 ? [generateButtons(currentPage)] : [];

            const message = await interaction.editReply({
                embeds: [embed],
                components: components
            });

            // If only one page, no need for collector
            if (totalPages <= 1) {return;}

            // Create button collector
            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 300_000 // 5 minutes
            });

            collector.on('collect', async (buttonInteraction) => {
                // Check if the button clicker is the command invoker
                if (buttonInteraction.user.id !== interaction.user.id) {
                    return await buttonInteraction.reply({
                        content: 'These buttons are not for you!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                // Update page
                if (buttonInteraction.customId === 'activeloans_next') {
                    currentPage = Math.min(currentPage + 1, totalPages - 1);
                } else if (buttonInteraction.customId === 'activeloans_prev') {
                    currentPage = Math.max(currentPage - 1, 0);
                }

                // Update message
                await buttonInteraction.update({
                    embeds: [generateEmbed(currentPage)],
                    components: [generateButtons(currentPage)]
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
            console.error('Error fetching active loans:', error);

            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({
                        content: 'Failed to fetch active loans. Please try again later.',
                    });
                } else {
                    await interaction.reply({
                        content: 'Failed to fetch active loans. Please try again later.',
                        flags: MessageFlags.Ephemeral
                    });
                }
            } catch (followUpError) {
                console.error('Failed to send error message:', followUpError);
            }
        }
    },
};