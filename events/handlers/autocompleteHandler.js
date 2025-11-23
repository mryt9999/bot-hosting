/**
 * Handles autocomplete interactions
 */
async function handleAutocomplete(interaction) {
    const command = interaction.client.commands.get(interaction.commandName);

    if (!command || !command.autocomplete) {
        return;
    }

    try {
        await command.autocomplete(interaction);
    } catch (error) {
        console.error('Error handling autocomplete:', error);
    }
}

module.exports = { handleAutocomplete };
