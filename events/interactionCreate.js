const { Events, MessageFlags } = require('discord.js');
const profileModel = require('../models/profileSchema');

// Import handlers
const { handleAutocomplete } = require('./handlers/autocompleteHandler');
const { handleUserSelectMenu, handleStringSelectMenu } = require('./handlers/selectMenuHandler');
const { handleModalSubmit } = require('./handlers/modalHandler');
const { handleCommand } = require('./handlers/commandHandler');
const { handleButtonInteraction } = require('./handlers/buttonHandler');

// Import game trackers for exports
const { activeRPSGames, pendingRPSChallenges } = require('./handlers/games/rpsHandler');

// Initialize global game trackers
if (!global.activeTTTGames) {
    global.activeTTTGames = new Map();
}

if (!global.activeC4Games) {
    global.activeC4Games = new Map();
}

module.exports = {
    name: Events.InteractionCreate,
    pendingRPSChallenges, // Export so rps.js can access it
    activeRPSGames, // Export so rps.js can access it
    async execute(interaction) {
        // Helper to make ephemeral messages that auto-delete after 30 seconds
        const replyEphemeral = async (options) => {
            const message = await interaction.reply({ ...options, flags: MessageFlags.Ephemeral, fetchReply: true });
            setTimeout(async () => {
                try {
                    await interaction.deleteReply();
                } catch (_err) {
                    // Ignore errors
                }
            }, 30000);
            return message;
        };

        // Handle autocomplete interactions
        if (interaction.isAutocomplete()) {
            return await handleAutocomplete(interaction);
        }

        // Get or create user profile
        let profileData;
        try {
            profileData = await profileModel.findOne({ userId: interaction.user.id });
            if (!profileData) {
                profileData = await profileModel.create({
                    userId: interaction.user.id,
                    serverID: interaction.guild?.id ?? null,
                });
            }
        } catch (error) {
            console.log(error);
        }

        // Handle user select menus (donate recipient selection)
        if (interaction.isUserSelectMenu()) {
            return await handleUserSelectMenu(interaction, replyEphemeral);
        }

        // Handle string select menus (help, transfer)
        if (interaction.isStringSelectMenu()) {
            return await handleStringSelectMenu(interaction);
        }

        // Handle modal submissions (gamble, donate, transfer)
        if (interaction.isModalSubmit()) {
            return await handleModalSubmit(interaction, profileData, replyEphemeral);
        }

        // Handle chat input commands
        if (interaction.isChatInputCommand()) {
            return await handleCommand(interaction, profileData, replyEphemeral);
        }

        // Handle button interactions
        if (interaction.isButton()) {
            return await handleButtonInteraction(interaction, profileData, replyEphemeral);
        }
    },
};
