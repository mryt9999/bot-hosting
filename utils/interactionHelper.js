// Helper to reply to interactions safely and consistently

const { MessageFlags } = require('discord.js');

/**
 * Safely reply to an interaction, handling deferred/replied states
 * @param {Object} interaction - Discord interaction object
 * @param {Object} options - Reply options
 * @param {string} options.content - Message content
 * @param {Array} options.embeds - Message embeds
 * @param {boolean} options.ephemeral - Whether message should be ephemeral
 * @param {number} options.deleteAfterMs - Auto-delete after milliseconds (default: 30000 for ephemeral)
 */
async function safeReply(interaction, options = {}) {
    const { content, embeds, ephemeral, deleteAfterMs } = options;
    const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
    const deleteAfter = deleteAfterMs ?? (ephemeral ? 30000 : null);

    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ content, embeds, flags });
        } else if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content, embeds });
        } else {
            await interaction.followUp({ content, embeds, ephemeral });
        }

        if (ephemeral && deleteAfter) {
            setTimeout(async () => {
                try {
                    await interaction.deleteReply();
                } catch (err) {
                    // Silently ignore - message may have been manually deleted
                }
            }, deleteAfter);
        }
    } catch (err) {
        console.error('safeReply failed:', err);
    }
}

/**
 * Reply with an ephemeral error message that auto-deletes after 30 seconds
 * @param {Object} interaction - Discord interaction object
 * @param {string} message - Error message to display
 */
async function replyError(interaction, message) {
    return safeReply(interaction, {
        content: message,
        ephemeral: true,
        deleteAfterMs: 30000
    });
}

/**
 * Reply with a success message
 * @param {Object} interaction - Discord interaction object
 * @param {string} message - Success message to display
 * @param {boolean} ephemeral - Whether message should be ephemeral
 */
async function replySuccess(interaction, message, ephemeral = false) {
    return safeReply(interaction, {
        content: message,
        ephemeral,
        deleteAfterMs: ephemeral ? 30000 : null
    });
}

module.exports = {
    safeReply,
    replyError,
    replySuccess,
};
