const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, MessageFlags, Collection } = require('discord.js');
const { Routes } = require('discord-api-types/v10');
const profileModel = require("../models/profileSchema");

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        ///////////////////////////////
        if (interaction.isAutocomplete()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command || !command.autocomplete) return;

            try {
                await command.autocomplete(interaction);
            } catch (error) {
                console.error('Error handling autocomplete:', error);
            }
            return;
        }

        //  make this remove ephemeral messages after 30 seconds
        const replyEphemeral = async (options) => {
            const message = await interaction.reply({ ...options, flags: MessageFlags.Ephemeral, fetchReply: true });
            setTimeout(async () => {
                try {
                    await interaction.deleteReply();
                } catch (err) {
                    // ignore
                }
            }, 30000);
            return message;
        };
        /////////////////////////////////
        //////////////////////////////////////

        // Get user db information first
        let profileData;
        try {
            profileData = await profileModel.findOne({ userId: interaction.user.id });
            if (!profileData) {
                profileData = await profileModel.create({
                    userId: interaction.user.id,
                    serverID: interaction.guild?.id ?? null,
                });
            }
        } catch (err) {
            console.log(err);
        }

        /////////
        // Handle user select for donate recipient
        if (interaction.isUserSelectMenu() && interaction.customId.startsWith('donateSelect:')) {
            // ensure only the original invoker can use this select
            const [, invokerId] = interaction.customId.split(':');
            if (interaction.user.id !== invokerId) {
                return await replyEphemeral({ content: 'You cannot choose a recipient for someone else\'s donate action.' });
            }

            const targetId = interaction.values[0];
            // show modal to enter amount, embed target id into customId so modal handler knows it
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

        // Handle modal submit for gamble and donate
        if (interaction.isModalSubmit()) {
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
        /////////

        // Handle regular commands
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;

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
            return;
        }

        // Handle button interactions
        if (interaction.isButton() && interaction.customId.startsWith('cmd:')) {
            const cmdName = interaction.customId.split(':')[1];
            const command = interaction.client.commands.get(cmdName);

            if (!command) return;

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
                return;
            }

            // For donate: present a user select so the player can pick recipient easily
            if (cmdName === 'donate') {
                const userSelect = new UserSelectMenuBuilder()
                    .setCustomId(`donateSelect:${interaction.user.id}`)
                    .setPlaceholder('Select a recipient to donate to')
                    .setMinValues(1)
                    .setMaxValues(1);

                const row = new ActionRowBuilder().addComponents(userSelect);

                return await replyEphemeral({
                    content: 'Choose a recipient for your donation:',
                    components: [row]
                });
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

                return;
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

            return await replyEphemeral({
                embeds: [cmdEmbed],
                components: [buttonRow]
            });
        }

        // Handle back button
        if (interaction.isButton() && interaction.customId === 'back') {
            const menuCommand = interaction.client.commands.get('commandmenu');
            await menuCommand.execute(interaction);
        }
    },
};