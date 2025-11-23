const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');

/**
 * Handles user select menu interactions (donate recipient selection)
 */
async function handleUserSelectMenu(interaction, replyEphemeral) {
    if (interaction.customId.startsWith('donateSelect:')) {
        // Ensure only the original invoker can use this select
        const [, invokerId] = interaction.customId.split(':');
        if (interaction.user.id !== invokerId) {
            return await replyEphemeral({ content: 'You cannot choose a recipient for someone else\'s donate action.' });
        }

        const targetId = interaction.values[0];
        // Show modal to enter amount, embed target id into customId so modal handler knows it
        const modal = new ModalBuilder()
            .setCustomId(`donateModal:${invokerId}:${targetId}`)
            .setTitle('Donate Points');

        const amountInput = new TextInputBuilder()
            .setCustomId('donateAmount')
            .setLabel('Amount to donate')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter amount (numbers only)')
            .setRequired(true);

        const row = new ActionRowBuilder().addComponents(amountInput);
        await interaction.showModal(modal.addComponents(row));
        return;
    }
}

/**
 * Handles string select menu interactions (help and transfer)
 */
async function handleStringSelectMenu(interaction) {
    if (interaction.customId === 'help_command_select') {
        const commandName = interaction.values[0];
        const command = interaction.client.commands.get(commandName);

        if (!command) {
            return await interaction.update({
                content: '❌ Command not found.',
                embeds: [],
                components: []
            });
        }

        const { createCommandDetailEmbed, createCommandSelectMenu, createBackButton } = require('../../commands/help');
        const detailEmbed = createCommandDetailEmbed(command, interaction);
        const selectMenu = createCommandSelectMenu(interaction);
        const backButton = createBackButton();

        await interaction.update({
            embeds: [detailEmbed],
            components: [selectMenu, backButton]
        });
    }

    // Handle transfer select menus
    if (interaction.customId.startsWith('transfer_')) {
        const transferCommand = interaction.client.commands.get('transfer');
        if (transferCommand && transferCommand.handleTransferSelect) {
            try {
                await transferCommand.handleTransferSelect(interaction);
            } catch (error) {
                console.error('Error handling transfer select menu:', error);
                const replyMethod = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
                await interaction[replyMethod]({
                    content: 'An error occurred while processing your selection.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
        return;
    }
}

module.exports = {
    handleUserSelectMenu,
    handleStringSelectMenu
};
