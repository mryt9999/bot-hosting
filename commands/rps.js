const { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { startChallengeTimeout } = require('../events/handlers/games/challengeTimeoutHandler');
const { pendingRPSChallenges } = require('../events/handlers/games/rpsHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rps')
        .setDescription('Challenge someone to Rock Paper Scissors')
        .addUserOption(option =>
            option.setName('opponent')
                .setDescription('The user you want to challenge')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('Amount of points to bet')
                .setRequired(true)
                .setMinValue(0)),
    async execute(interaction, profileData) {
        try {
            const opponent = interaction.options.getUser('opponent');
            const betAmount = interaction.options.getInteger('bet');

            // Validation
            if (opponent.bot) {
                return await interaction.reply({
                    content: '❌ You cannot challenge a bot!',
                    flags: [MessageFlags.Ephemeral]
                });
            }

            if (opponent.id === interaction.user.id) {
                return await interaction.reply({
                    content: '❌ You cannot challenge yourself!',
                    flags: [MessageFlags.Ephemeral]
                });
            }

            if (profileData.balance < betAmount) {
                return await interaction.reply({
                    content: `❌ You don't have enough points! Your balance: ${profileData.balance.toLocaleString()}`,
                    flags: [MessageFlags.Ephemeral]
                });
            }

            const challengeKey = `${interaction.user.id}_${opponent.id}`;
            if (pendingRPSChallenges.has(challengeKey)) {
                return await interaction.reply({
                    content: '❌ You already have a pending challenge with this player!',
                    flags: [MessageFlags.Ephemeral]
                });
            }

            pendingRPSChallenges.set(challengeKey, true);

            const challengeEmbed = new EmbedBuilder()
                .setTitle('🪨📄✂️ Rock Paper Scissors Challenge')
                .setDescription(`<@${interaction.user.id}> challenges <@${opponent.id}> to Rock Paper Scissors!`)
                .addFields(
                    { name: 'Bet Amount', value: `${betAmount.toLocaleString()} points`, inline: true },
                    { name: 'Time Limit', value: '60 seconds to accept', inline: true }
                )
                .setColor(0xF39C12)
                .setTimestamp();

            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`rps_accept_${interaction.user.id}_${opponent.id}_${betAmount}`)
                        .setLabel('Accept')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'),
                    new ButtonBuilder()
                        .setCustomId(`rps_decline_${interaction.user.id}_${opponent.id}`)
                        .setLabel('Decline')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('❌')
                );

            const challengeMessage = await interaction.reply({
                content: `<@${opponent.id}>`,
                embeds: [challengeEmbed],
                components: [buttons],
                fetchReply: true
            });

            // Start the 1-minute timeout
            startChallengeTimeout(challengeMessage, 'rps', interaction.user.id, opponent.id);

        } catch (error) {
            console.error('Error in rps command:', error);
            const replyMethod = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
            await interaction[replyMethod]({
                content: '❌ An error occurred while creating the challenge.',
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};