const { MessageFlags } = require('discord.js');

/**
 * Handles modal submission interactions (gamble, donate, transfer)
 */
async function handleModalSubmit(interaction, profileData, replyEphemeral) {
    // Handle transfer modals
    if (interaction.customId.startsWith('transfer_')) {
        const transferCommand = interaction.client.commands.get('transfer');
        if (transferCommand && transferCommand.handleTransferModal) {
            try {
                await transferCommand.handleTransferModal(interaction);
            } catch (error) {
                console.error('Error handling transfer modal:', error);
                const replyMethod = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
                await interaction[replyMethod]({
                    content: 'An error occurred while processing your input.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
        return;
    }

    // Gamble modal
    if (interaction.customId.startsWith('gambleModal:')) {
        const amountRaw = interaction.fields.getTextInputValue('gambleAmount');
        const amount = parseInt(amountRaw.replace(/[, ]/g, ''), 10);

        if (isNaN(amount) || amount <= 0) {
            return await replyEphemeral({ content: 'Please enter a valid positive number for the amount.' });
        }

        const cmd = interaction.client.commands.get('gamble');
        if (!cmd) {
            return await replyEphemeral({ content: 'Gamble command not found.' });
        }

        try {
            // Pass flags to make it ephemeral, and mark as invoked by modal
            await cmd.execute(interaction, profileData, {
                amount,
                invokedByModal: true,
                flags: MessageFlags.Ephemeral
            });
        } catch (err) {
            console.error('Error executing gamble from modal:', err);
            if (!interaction.replied && !interaction.deferred) {
                return await replyEphemeral({ content: 'Error executing gamble.' });
            }
        }
        return;
    }

    // Donate modal (customId format: donateModal:<invokerId>:<targetId>)
    if (interaction.customId.startsWith('donateModal:')) {
        const parts = interaction.customId.split(':');
        const invokerId = parts[1];
        const targetId = parts[2];

        if (interaction.user.id !== invokerId) {
            return await replyEphemeral({ content: 'You cannot perform this donate action.' });
        }

        const amountRaw = interaction.fields.getTextInputValue('donateAmount').trim();
        const amount = parseInt(amountRaw.replace(/[, ]/g, ''), 10);

        if (isNaN(amount) || amount <= 0) {
            return await replyEphemeral({ content: 'Please enter a valid positive number for the amount.' });
        }

        let targetMember;
        try {
            targetMember = await interaction.guild.members.fetch(targetId);
        } catch (err) {
            console.error('Failed to fetch donate target:', err);
            return await replyEphemeral({ content: 'Could not find that user in this server. Please try again.' });
        }

        const cmd = interaction.client.commands.get('donate');
        if (!cmd) {
            return await replyEphemeral({ content: 'Donate command not found.' });
        }

        try {
            await cmd.execute(interaction, profileData, {
                amount,
                targetId: targetMember.id,
                invokedByModal: true,
                flags: MessageFlags.Ephemeral
            });
        } catch (err) {
            console.error('Error executing donate from modal:', err);
            if (!interaction.replied && !interaction.deferred) {
                return await replyEphemeral({ content: 'Error executing donate.' });
            }
        }
        return;
    }
}

module.exports = { handleModalSubmit };
