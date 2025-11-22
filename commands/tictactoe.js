const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const profileModel = require('../models/profileSchema');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tictactoe')
        .setDescription('Challenge someone to a game of Tic Tac Toe')
        .addUserOption(option =>
            option
                .setName('opponent')
                .setDescription('The user you want to challenge')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('bet')
                .setDescription('Amount of points to bet')
                .setRequired(true)
                .setMinValue(1)
        ),
    async execute(interaction, profileData) {
        try {
            const challenger = interaction.user;
            const opponent = interaction.options.getUser('opponent');
            const betAmount = interaction.options.getInteger('bet');

            // Validation checks
            if (opponent.bot) {
                return await interaction.reply({
                    content: '❌ You cannot challenge a bot to Tic Tac Toe.',
                    flags: [MessageFlags.Ephemeral]
                });
            }

            if (opponent.id === challenger.id) {
                return await interaction.reply({
                    content: '❌ You cannot challenge yourself to Tic Tac Toe.',
                    flags: [MessageFlags.Ephemeral]
                });
            }

            // Check challenger balance
            const challengerProfile = await profileModel.findOne({
                userId: challenger.id,
                serverID: interaction.guild.id
            });

            if (!challengerProfile || challengerProfile.balance < betAmount) {
                return await interaction.reply({
                    content: `❌ You don't have enough points. You have ${challengerProfile?.balance || 0} points.`,
                    flags: [MessageFlags.Ephemeral]
                });
            }

            // Check opponent balance
            const opponentProfile = await profileModel.findOne({
                userId: opponent.id,
                serverID: interaction.guild.id
            });

            if (!opponentProfile) {
                return await interaction.reply({
                    content: `❌ ${opponent.username} doesn't have a profile yet.`,
                    flags: [MessageFlags.Ephemeral]
                });
            }

            if (opponentProfile.balance < betAmount) {
                return await interaction.reply({
                    content: `❌ ${opponent.username} doesn't have enough points. They have ${opponentProfile.balance} points.`,
                    flags: [MessageFlags.Ephemeral]
                });
            }

            // Create challenge embed
            const challengeEmbed = new EmbedBuilder()
                .setTitle('⭕ Tic Tac Toe Challenge')
                .setDescription(`${challenger} has challenged ${opponent} to a game of Tic Tac Toe!`)
                .addFields(
                    { name: '💰 Bet Amount', value: `${betAmount.toLocaleString()} points each`, inline: true },
                    { name: '⭕ X Player', value: challenger.username, inline: true },
                    { name: '❌ O Player', value: opponent.username, inline: true }
                )
                .setColor(0x3498DB)
                .setTimestamp();

            const acceptButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ttt_accept_${challenger.id}_${opponent.id}_${betAmount}`)
                    .setLabel('Accept Challenge')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`ttt_decline_${challenger.id}_${opponent.id}`)
                    .setLabel('Decline Challenge')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

            await interaction.reply({
                content: `${opponent}`,
                embeds: [challengeEmbed],
                components: [acceptButton]
            });

        } catch (error) {
            console.error('Error in tictactoe command:', error);
            const replyMethod = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
            await interaction[replyMethod]({
                content: '❌ An error occurred while creating the challenge.',
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};