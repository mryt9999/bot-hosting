const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, MessageFlags } = require('discord.js');
const { createMainHelpEmbed, createCommandSelectMenu } = require('../../commands/help');
const { handleCancel } = require('../../commands/transfer');
const { processLoanAcceptance } = require('../../commands/loan');
const { updateBalance } = require('../../utils/dbUtils');
const profileModel = require('../../models/profileSchema');
const globalValues = require('../../globalValues.json');

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

        await interaction.update({ components: [disabledRow] }).catch(() => { });

        return interaction.followUp({
            content: 'This trivia question has expired!',
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Defer the update immediately to acknowledge the interaction
    await interaction.deferUpdate().catch(async (error) => {
        console.error('Failed to defer trivia button interaction:', error);
        // If defer fails, the interaction token is already expired
        return;
    });

    // Disable buttons after answering
    const disabledRow = new ActionRowBuilder();
    for (const component of interaction.message.components[0].components) {
        const disabledButton = ButtonBuilder.from(component)
            .setDisabled(true);
        disabledRow.addComponents(disabledButton);
    }

    await interaction.editReply({ components: [disabledRow] });

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
            await interaction.followUp({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('✅ Correct Answer!')
                        .setDescription(`You earned **${triviaData.rewardPoints}** points!\n\n${triviaData.explanation}`)
                        .setColor(0x00FF00)
                ]
            });
        } else {
            await interaction.followUp({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('✅ Correct Answer!')
                        .setDescription(`You got it right, but there was an error awarding points.\n\n${triviaData.explanation}`)
                        .setColor(0xFFA500)
                ]
            });
        }
    } else {
        await interaction.followUp({
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

/**
 * Handles bank purchase buttons
 */
async function handleBankPurchase(interaction) {
    if (interaction.customId === 'bank_purchase_yes') {
        // Check if this user is the one who initiated the command
        if (interaction.message.interaction && interaction.message.interaction.user.id !== interaction.user.id) {
            await interaction.update({
                content: `❌ Only <@${interaction.message.interaction.user.id}> can press this button.`,
                flags: [MessageFlags.Ephemeral]
            });
            return true;
        }

        // Get current profile and floor balance to handle decimals
        const currentProfile = await profileModel.findOne({ userId: interaction.user.id });
        if (!currentProfile) {
            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ff5252')
                        .setTitle('Error')
                        .setDescription('Profile not found.')
                ],
                components: []
            });
            return true;
        }

        const flooredBalance = Math.floor(currentProfile.balance);

        // Check if user already owns bank or has insufficient funds
        if (currentProfile.bankOwned) {
            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ff5252')
                        .setTitle('Bank Already Owned')
                        .setDescription('You already own a bank!')
                ],
                components: []
            });
            return true;
        }

        if (flooredBalance < globalValues.bankFeatureCost) {
            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ff5252')
                        .setTitle('Insufficient Funds')
                        .setDescription(`You need **${globalValues.bankFeatureCost.toLocaleString()}** points but only have **${flooredBalance.toLocaleString()}** points.`)
                ],
                components: []
            });
            return true;
        }

        // Purchase bank atomically - deduct balance and set bankOwned in single operation
        const updatedProfile = await profileModel.findOneAndUpdate(
            {
                userId: interaction.user.id,
                bankOwned: false  // Only allow purchase if bank not already owned
            },
            {
                $set: {
                    balance: Math.floor(currentProfile.balance - globalValues.bankFeatureCost),
                    bankOwned: true,
                    bankBalance: 0
                }
            },
            { new: true }
        );

        if (!updatedProfile) {
            // Shouldn't reach here given our checks above, but handle it
            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ff5252')
                        .setTitle('Purchase Failed')
                        .setDescription('Failed to process your bank purchase. Please try again.')
                ],
                components: []
            });
            return true;
        }

        // Trigger balance change event
        try {
            const balanceChangeEvent = require('../../events/balanceChange');
            const member = await interaction.guild.members.fetch(interaction.user.id);
            balanceChangeEvent.execute(member);
        } catch (err) {
            console.error('Failed to trigger balance change event:', err);
        }

        await interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setColor('#4caf50')
                    .setTitle('Bank Purchased!')
                    .setDescription(`You successfully purchased your bank for **${globalValues.bankFeatureCost.toLocaleString()}** points!\n\nYou can now use:\n• **/bank deposit** to deposit points to your bank\n• **/bank withdraw** to withdraw points from your bank\n• **/bank view** to view bank details`)
                    .addFields(
                        { name: 'New Balance', value: `${updatedProfile.balance.toLocaleString()}`, inline: true },
                        { name: 'Bank Balance', value: `${updatedProfile.bankBalance.toLocaleString()}`, inline: true }
                    )
            ],
            components: []
        });
        return true;
    }

    if (interaction.customId === 'bank_purchase_no') {
        // Check if this user is the one who initiated the command
        if (interaction.message.interaction && interaction.message.interaction.user.id !== interaction.user.id) {
            await interaction.update({
                content: `❌ Only <@${interaction.message.interaction.user.id}> can press this button.`,
                flags: [MessageFlags.Ephemeral]
            });
            return true;
        }

        await interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setColor('#9e9e9e')
                    .setTitle('Purchase Cancelled')
                    .setDescription('You cancelled the bank purchase.')
            ],
            components: []
        });
        return true;
    }

    return false;
}

/**
 * Handles bank defense purchase buttons
 */
async function handleBankDefensePurchase(interaction) {
    const DEFENSES = {
        minor: { tier: 1, cost: 10000, reduction: 50, duration: 7 * 24 * 60 * 60 * 1000 },
        normal: { tier: 2, cost: 30000, reduction: 80, duration: 7 * 24 * 60 * 60 * 1000 },
        major: { tier: 3, cost: 100000, reduction: 99, duration: 7 * 24 * 60 * 60 * 1000 }
    };

    if (!interaction.customId.startsWith('defense_purchase_')) {
        return false;
    }

    const defenseType = interaction.customId.replace('defense_purchase_', '');
    const defense = DEFENSES[defenseType];

    if (!defense) {
        return false;
    }

    // Check if this user is the one who initiated the command
    if (interaction.message.interaction && interaction.message.interaction.user.id !== interaction.user.id) {
        await interaction.update({
            content: `❌ Only <@${interaction.message.interaction.user.id}> can press this button.`,
            flags: [MessageFlags.Ephemeral]
        });
        return true;
    }

    const profile = await profileModel.findOne({ userId: interaction.user.id, serverID: interaction.guild.id });

    if (!profile) {
        await interaction.update({
            content: '❌ Profile not found.',
            flags: [MessageFlags.Ephemeral]
        });
        return true;
    }

    // Check if user owns a bank
    if (!profile.bankOwned) {
        await interaction.update({
            content: '❌ You must own a bank to purchase defenses.',
            flags: [MessageFlags.Ephemeral]
        });
        return true;
    }

    // Check if user can upgrade (can only buy if higher tier than current)
    const now = Date.now();
    const isDefenseActive = profile.bankDefenseExpiresAt > now;

    if (isDefenseActive && profile.bankDefenseLevel >= defense.tier) {
        const tierNames = { 1: 'Minor', 2: 'Normal', 3: 'Major' };
        await interaction.update({
            content: `❌ You can only purchase a higher tier defense. You currently have **${tierNames[profile.bankDefenseLevel]}** defense active.`,
            flags: [MessageFlags.Ephemeral]
        });
        return true;
    }

    // Check balance and purchase defense atomically
    if (profile.balance < defense.cost) {
        await interaction.update({
            content: `❌ You need **${defense.cost.toLocaleString()}** points but only have **${profile.balance.toLocaleString()}** points.`,
            flags: [MessageFlags.Ephemeral]
        });
        return true;
    }

    // Purchase defense using atomic operation to prevent concurrent purchases
    const updatedProfile = await profileModel.findOneAndUpdate(
        {
            userId: interaction.user.id,
            serverID: interaction.guild.id,
            balance: { $gte: defense.cost }
        },
        {
            $inc: { balance: -defense.cost },
            $set: {
                bankDefenseLevel: defense.tier,
                bankDefenseExpiresAt: now + defense.duration
            }
        },
        { new: true }
    );

    if (!updatedProfile) {
        // Balance check failed or was modified by another request
        await interaction.update({
            content: `❌ Insufficient balance. The defense purchase was not completed.`,
            flags: [MessageFlags.Ephemeral]
        });
        return true;
    }

    // Trigger balance change event
    try {
        const balanceChangeEvent = require('../../events/balanceChange');
        const member = await interaction.guild.members.fetch(interaction.user.id);
        balanceChangeEvent.execute(member);
    } catch (err) {
        console.error('Failed to trigger balance change event:', err);
    }

    const tierNames = { 1: 'Minor', 2: 'Normal', 3: 'Major' };
    const tierEmojis = { 1: '🛡️', 2: '⚔️', 3: '👑' };

    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setColor('#4caf50')
                .setTitle(`${tierEmojis[defense.tier]} Defense Purchased!`)
                .setDescription(`You purchased a **${tierNames[defense.tier]} Defense** for **${defense.cost.toLocaleString()}** points.`)
                .addFields(
                    { name: 'Reduction', value: `${defense.reduction}% of steal amount blocked`, inline: true },
                    { name: 'Duration', value: '7 days', inline: true },
                    { name: 'Expires At', value: `<t:${Math.floor(updatedProfile.bankDefenseExpiresAt / 1000)}:R>`, inline: true },
                    { name: 'New Balance', value: `${profile.balance.toLocaleString()} points`, inline: true }
                )
        ],
        components: []
    });
    return true;
}

module.exports = {
    handleHelpButtons,
    handleTransferButtons,
    handleLoanButtons,
    handleCommandMenuButtons,
    handleCloseBackButtons,
    handleTriviaButtons,
    handleBankPurchase,
    handleBankDefensePurchase
};
