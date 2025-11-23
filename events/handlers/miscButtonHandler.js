const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, MessageFlags } = require('discord.js');

/**
 * Handles help navigation buttons
 */
async function handleHelpButtons(interaction) {
    if (interaction.customId === 'help_back_to_list') {
        const { createMainHelpEmbed, createCommandSelectMenu } = require('../../commands/help');
        const mainEmbed = createMainHelpEmbed(interaction);
        const selectMenu = createCommandSelectMenu(interaction);

        await interaction.update({
            embeds: [mainEmbed],
            components: [selectMenu]
        });
        return true;
    }
    return false;
}

/**
 * Handles transfer buttons
 */
async function handleTransferButtons(interaction) {
    if (interaction.customId.startsWith('transfer_cancel_')) {
        const userId = interaction.customId.replace('transfer_cancel_', '');
        const { handleTransferCancel } = require('../../commands/transfer');
        await handleTransferCancel(interaction, userId);
        return true;
    }

    if (interaction.customId.startsWith('transfer_')) {
        const transferCommand = interaction.client.commands.get('transfer');
        if (transferCommand && transferCommand.handleTransferButton) {
            try {
                await transferCommand.handleTransferButton(interaction);
            } catch (error) {
                console.error('Error handling transfer button:', error);
                const replyMethod = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
                await interaction[replyMethod]({
                    content: 'An error occurred while processing your request.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
        return true;
    }
    return false;
}

/**
 * Handles loan buttons
 */
async function handleLoanButtons(interaction) {
    // Loan accept button
    if (interaction.customId.startsWith('loan_accept_')) {
        const loanId = interaction.customId.replace('loan_accept_', '');
        const { processLoanAcceptance } = require('../../commands/loan');
        await processLoanAcceptance(interaction, loanId);
        return true;
    }

    // Loan confirm button (high interest confirmation)
    if (interaction.customId.startsWith('loan_confirm_')) {
        const loanId = interaction.customId.replace('loan_confirm_', '');
        const { processLoanAcceptance } = require('../../commands/loan');
        await processLoanAcceptance(interaction, loanId);
        return true;
    }

    // Loan cancel button (high interest warning cancellation)
    if (interaction.customId.startsWith('loan_cancel_')) {
        const cancelEmbed = new EmbedBuilder()
            .setTitle('❌ Loan Cancelled')
            .setColor(0x95A5A6)
            .setDescription('You have cancelled this loan.')
            .setTimestamp();

        await interaction.update({
            embeds: [cancelEmbed],
            components: []
        });
        return true;
    }
    return false;
}

/**
 * Handles command menu buttons (cmd:*)
 */
async function handleCommandMenuButtons(interaction, profileData, replyEphemeral) {
    if (interaction.customId.startsWith('cmd:')) {
        const cmdName = interaction.customId.split(':')[1];
        const command = interaction.client.commands.get(cmdName);

        if (!command) {
            return true;
        }

        // Open a modal for gamble so player can enter an amount
        if (cmdName === 'gamble') {
            const modal = new ModalBuilder()
                .setCustomId(`gambleModal:${interaction.user.id}`)
                .setTitle('Gamble Amount');

            const amountInput = new TextInputBuilder()
                .setCustomId('gambleAmount')
                .setLabel('Amount of points to gamble')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter amount (numbers only)')
                .setRequired(true);

            const row = new ActionRowBuilder().addComponents(amountInput);

            await interaction.showModal(modal.addComponents(row));
            return true;
        }

        // For donate: present a user select so the player can pick recipient easily
        if (cmdName === 'donate') {
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId(`donateSelect:${interaction.user.id}`)
                .setPlaceholder('Select a recipient to donate to')
                .setMinValues(1)
                .setMaxValues(1);

            const row = new ActionRowBuilder().addComponents(userSelect);

            await replyEphemeral({
                content: 'Choose a recipient for your donation:',
                components: [row]
            });
            return true;
        }

        // If command has no required options, execute it directly
        if (!command.data.options?.some(opt => opt.required)) {
            try {
                const sensitive = ['leaderboard', 'balance', 'daily'];
                const opts = { invokedByButton: true, ephemeral: sensitive.includes(command.data.name) };
                await command.execute(interaction, profileData, opts);
            } catch (error) {
                console.error(error);
                if (!interaction.replied && !interaction.deferred) {
                    await replyEphemeral({
                        content: 'Error executing the command!',
                    });
                }
            }

            return true;
        }

        // If command has required options, show info embed
        const cmdEmbed = new EmbedBuilder()
            .setTitle(`/${command.data.name}`)
            .setDescription(command.data.description)
            .setColor('#4CAF50');

        if (command.data.options?.length > 0) {
            const optionsText = command.data.options
                .map(opt => `• **${opt.name}**: ${opt.description}`)
                .join('\n');
            cmdEmbed.addFields({ name: 'Options', value: optionsText });
        }

        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('back')
                    .setLabel('Back to Menu')
                    .setStyle(ButtonStyle.Secondary)
            );

        await replyEphemeral({
            embeds: [cmdEmbed],
            components: [buttonRow]
        });
        return true;
    }
    return false;
}

/**
 * Handles close/back buttons
 */
async function handleCloseBackButtons(interaction) {
    if (interaction.customId === 'close' || interaction.customId === 'back') {
        try {
            await interaction.deferUpdate();
            await interaction.deleteReply();
        } catch (err) {
            console.error('Error handling close/back button:', err);
        }
        return true;
    }
    return false;
}

module.exports = {
    handleHelpButtons,
    handleTransferButtons,
    handleLoanButtons,
    handleCommandMenuButtons,
    handleCloseBackButtons
};
