const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const dbUtils = require('../utils/dbUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dice')
        .setDescription('Roll the dice and test your luck!')
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('Amount to bet')
                .setRequired(true)
                .setMinValue(1)),
    async execute(interaction, profileData) {
        try {
            const betAmount = interaction.options.getInteger('bet');

            if (profileData.balance < betAmount) {
                return await interaction.reply({
                    content: `❌ Insufficient balance! You have ${profileData.balance.toLocaleString()} points.`,
                    flags: [MessageFlags.Ephemeral]
                });
            }

            const dice1 = Math.floor(Math.random() * 6) + 1;
            const dice2 = Math.floor(Math.random() * 6) + 1;
            const total = dice1 + dice2;

            let winMultiplier = 0;
            let outcome = '';
            let color = 0xE74C3C;

            // Balanced payout structure
            if (dice1 === dice2) {
                // Doubles = win 2x (16.67% chance)
                winMultiplier = 2;
                outcome = `🎉 **DOUBLES!** You rolled ${dice1} and ${dice2}!\nYou won ${(betAmount * winMultiplier).toLocaleString()} points! (2x)`;
                color = 0x2ECC71;
            } else if (total === 7) {
                // Lucky 7 = win 2x (16.67% chance)
                winMultiplier = 2;
                outcome = `🍀 **LUCKY 7!** You rolled ${dice1} and ${dice2}!\nYou won ${(betAmount * winMultiplier).toLocaleString()} points! (2x)`;
                color = 0x2ECC71;
            } else if (total >= 8) {
                // High roll (8-12) = break even (33.33% chance)
                winMultiplier = 1;
                outcome = `😐 High roll (${total}). You rolled ${dice1} and ${dice2}.\nYou broke even!`;
                color = 0xF39C12;
            } else {
                // Low roll (2-6, excluding 7) = lose (33.33% chance)
                outcome = `💔 Low roll (${total}). You rolled ${dice1} and ${dice2}.\nYou lost ${betAmount.toLocaleString()} points.`;
            }

            const netChange = (betAmount * winMultiplier) - betAmount;
            profileData.balance += netChange;
            await profileData.save();

            // Trigger balance change event
            try {
                const balanceChangeEvent = require('../events/balanceChange');
                balanceChangeEvent.execute(interaction.member);
            } catch (err) {
                console.error('Failed to trigger balance change event:', err);
            }

            const diceEmbed = new EmbedBuilder()
                .setTitle('🎲 Dice Roll')
                .setDescription(outcome)
                .addFields(
                    { name: 'Dice 1', value: `🎲 ${dice1}`, inline: true },
                    { name: 'Dice 2', value: `🎲 ${dice2}`, inline: true },
                    { name: 'Total', value: `${total}`, inline: true },
                    { name: 'Bet', value: `${betAmount.toLocaleString()} points`, inline: true },
                    { name: 'New Balance', value: `${profileData.balance.toLocaleString()} points`, inline: true }
                )
                .setColor(color)
                .setTimestamp();

            await interaction.reply({ embeds: [diceEmbed] });

        } catch (error) {
            console.error('Error in dice command:', error);
            const replyMethod = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
            await interaction[replyMethod]({
                content: '❌ An error occurred while rolling dice.',
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};