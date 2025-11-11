// Helper to reply to interactions safely and consistently

const { MessageFlags } = require('discord.js');

async function safeReply(interaction, options = {}) {
    // options: { content, embeds, ephemeral, deleteAfterMs }
    const { content, embeds, ephemeral, deleteAfterMs } = options;
    const flags = ephemeral ? MessageFlags.Ephemeral : undefined;

    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ content, embeds, flags });
        } else if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content, embeds, flags });
        } else {
            await interaction.followUp({ content, embeds, ephemeral });
        }

        if (ephemeral && deleteAfterMs) {
            setTimeout(async () => {
                try {
                    await interaction.deleteReply();
                } catch (err) {
                    // ignore
                }
            }, deleteAfterMs);
        }
    } catch (err) {
        console.error('safeReply failed:', err);
    }
}

module.exports = {
    safeReply,
};
