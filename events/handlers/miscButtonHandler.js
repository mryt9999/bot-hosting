const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, MessageFlags } = require('discord.js');
const { createMainHelpEmbed, createCommandSelectMenu } = require('../../commands/help');
const { handleCancel } = require('../../commands/transfer');
const { processLoanAcceptance } = require('../../commands/loan');
const { updateBalance } = require('../../utils/dbUtils');

/**
 * Handles help navigation buttons
 */
async function handleHelpButtons(interaction) {
    if (interaction.customId === 'help_back_to_list') {
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
        await handleCancel(interaction, userId);
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
        await processLoanAcceptance(interaction, loanId);
        return true;
    }

    // Loan confirm button (high interest confirmation)
    if (interaction.customId.startsWith('loan_confirm_')) {
        const loanId = interaction.customId.replace('loan_confirm_', '');
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

async function handleTriviaButtons(interaction) {
    if (!interaction.customId.startsWith('trivia_answer_')) {
        return false;
    }

    const parts = interaction.customId.split('_');
    const userId = parts[2];
    const answerId = parts[3];

    // Check if this is the correct user
    if (interaction.user.id !== userId) {
        return interaction.reply({
            content: 'This trivia question is not for you!',
            flags: [MessageFlags.Ephemeral]
        });
    }

    const triviaCache = global.activeTriviaQuestions || new Map();
    const triviaKey = `${userId}_${interaction.message.id}`;
    const triviaData = triviaCache.get(triviaKey);

    if (!triviaData) {
        return interaction.reply({
            content: 'This trivia question has expired or is no longer valid.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Check if expired
    if (Date.now() > triviaData.expiresAt) {
        triviaCache.delete(triviaKey);

        // Disable buttons instead of removing them
        const disabledRow = new ActionRowBuilder();
        for (const component of interaction.message.components[0].components) {
            const disabledButton = ButtonBuilder.from(component)
                .setDisabled(true);
            disabledRow.addComponents(disabledButton);
        }

        await interaction.message.edit({ components: [disabledRow] }).catch(() => { });

        return interaction.reply({
            content: 'This trivia question has expired!',
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Disable buttons after answering
    const disabledRow = new ActionRowBuilder();
    for (const component of interaction.message.components[0].components) {
        const disabledButton = ButtonBuilder.from(component)
            .setDisabled(true);
        disabledRow.addComponents(disabledButton);
    }

    await interaction.message.edit({ components: [disabledRow] });

    const isCorrect = answerId === triviaData.correctAnswer;

    if (isCorrect) {
        // Award points
        const updateResult = await updateBalance(
            interaction.user.id,
            triviaData.rewardPoints,
            { client: interaction.client },
            { serverId: triviaData.guildId }
        );

        if (updateResult.success) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('✅ Correct Answer!')
                        .setDescription(`You earned **${triviaData.rewardPoints}** points!\n\n${triviaData.explanation}`)
                        .setColor(0x00FF00)
                ]
            });
        } else {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('✅ Correct Answer!')
                        .setDescription(`You got it right, but there was an error awarding points.\n\n${triviaData.explanation}`)
                        .setColor(0xFFA500)
                ]
            });
        }
    } else {
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Incorrect Answer')
                    .setDescription(`The correct answer was **${triviaData.correctAnswer}**.\n\n${triviaData.explanation}`)
                    .setColor(0xFF0000)
            ]
        });
    }

    // Clean up trivia data
    triviaCache.delete(triviaKey);
    return true;
}

module.exports = {
    handleHelpButtons,
    handleTransferButtons,
    handleLoanButtons,
    handleCommandMenuButtons,
    handleCloseBackButtons,
    handleTriviaButtons
};
