/**
 * Handles chat input command interactions
 */
async function handleCommand(interaction, profileData, replyEphemeral) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
        return;
    }

    try {
        await command.execute(interaction, profileData);
    } catch (error) {
        console.error(error);
        if (!interaction.replied && !interaction.deferred) {
            await replyEphemeral({
                content: 'There was an error executing this command!',
            });
        }
    }
}

module.exports = { handleCommand };
