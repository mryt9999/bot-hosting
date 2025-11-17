const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ComponentType } = require('discord.js');
const profileModel = require('../models/profileSchema');
const dbUtils = require('../utils/dbUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rps')
        .setDescription('Challenge someone to Rock Paper Scissors')
        .addUserOption(option =>
            option
                .setName('opponent')
                .setDescription('The player to challenge')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('bet')
                .setDescription('Amount of points to bet')
                .setRequired(true)
                .setMinValue(10)
        ),

    async execute(interaction, profileData, opts = {}) {
        try {
            const opponent = interaction.options.getUser('opponent');
            const betAmount = interaction.options.getInteger('bet');
            const challenger = interaction.user;

            // Validation checks
            if (opponent.id === challenger.id) {
                return await interaction.reply({
                    content: '❌ You cannot challenge yourself!',
                    flags: [MessageFlags.Ephemeral]
                });
            }

            if (opponent.bot) {
                return await interaction.reply({
                    content: '❌ You cannot challenge bots!',
                    flags: [MessageFlags.Ephemeral]
                });
            }

            // Check challenger balance
            if (profileData.balance < betAmount) {
                return await interaction.reply({
                    content: `❌ You need ${betAmount.toLocaleString()} points to make this bet. You have ${profileData.balance.toLocaleString()} points.`,
                    flags: [MessageFlags.Ephemeral]
                });
            }

            // Check opponent balance
            const opponentProfile = await dbUtils.ensureProfile(opponent.id, interaction.guild.id);
            if (opponentProfile.balance < betAmount) {
                return await interaction.reply({
                    content: `❌ ${opponent.username} doesn't have enough points for this bet. They have ${opponentProfile.balance.toLocaleString()} points.`,
                    flags: [MessageFlags.Ephemeral]
                });
            }

            // Create challenge embed
            const challengeEmbed = new EmbedBuilder()
                .setTitle('🪨📄✂️ Rock Paper Scissors Challenge!')
                .setDescription(`${challenger} challenges ${opponent} to RPS!`)
                .addFields(
                    { name: 'Bet Amount', value: `${betAmount.toLocaleString()} points each`, inline: true },
                    { name: 'Total Pot', value: `${(betAmount * 2).toLocaleString()} points`, inline: true }
                )
                .setColor(0xF39C12)
                .setTimestamp();

            const acceptButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`rps_accept_${challenger.id}_${opponent.id}_${betAmount}`)
                    .setLabel('Accept Challenge')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`rps_decline_${challenger.id}_${opponent.id}`)
                    .setLabel('Decline')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

            await interaction.reply({
                content: `${opponent}`,
                embeds: [challengeEmbed],
                components: [acceptButton]
            });

            // Track this pending challenge
            const { pendingRPSChallenges } = require('../events/interactionCreate');
            const challengeKey = `${challenger.id}_${opponent.id}`;
            pendingRPSChallenges.set(challengeKey, {
                challengerId: challenger.id,
                opponentId: opponent.id,
                betAmount,
                timestamp: Date.now()
            });

            // Auto-expire after 30 seconds
            setTimeout(() => {
                pendingRPSChallenges.delete(challengeKey);
            }, 30000);

        } catch (error) {
            console.error('Error in rps command:', error);
            const replyMethod = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
            await interaction[replyMethod]({
                content: 'An error occurred while processing the RPS challenge.',
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};