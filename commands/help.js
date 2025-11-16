const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('View all available commands and how to use them'),

    async execute(interaction) {
        const mainEmbed = createMainHelpEmbed(interaction);
        const selectMenu = createCommandSelectMenu(interaction);

        await interaction.reply({
            embeds: [mainEmbed],
            components: [selectMenu]
        });
    }
};

function createMainHelpEmbed(interaction) {
    const categories = categorizeCommands(interaction.client.commands, interaction);

    const embed = new EmbedBuilder()
        .setTitle('📚 Economy Bot - Command List')
        .setDescription('Select a command from the dropdown menu to view detailed information.')
        .setColor(0x5865F2)
        .setThumbnail(interaction.client.user.displayAvatarURL())
        .setFooter({ text: 'Choose a command to see its subcommands and usage' })
        .setTimestamp();

    // Add all commands grouped by category
    for (const [category, commands] of Object.entries(categories)) {
        if (commands.length === 0) {
            continue;
        }

        const commandList = commands.map(cmd => {
            const hasSubcommands = cmd.data.options?.some(opt => opt.type === 1);
            if (hasSubcommands) {
                const subCount = cmd.data.options.filter(opt => opt.type === 1).length;
                return `\`/${cmd.data.name}\` - ${cmd.data.description} (${subCount} subcommands)`;
            }
            return `\`/${cmd.data.name}\` - ${cmd.data.description}`;
        }).join('\n');

        embed.addFields({
            name: `${getCategoryEmoji(category)} ${category}`,
            value: commandList || 'No commands',
            inline: false
        });
    }

    return embed;
}

function createCommandDetailEmbed(command, interaction) {
    const hasSubcommands = command.data.options?.some(opt => opt.type === 1);

    const embed = new EmbedBuilder()
        .setTitle(`📖 \`${command.data.name}\` Command`)
        .setDescription(command.data.description)
        .setColor(0x5865F2)
        .setFooter({ text: 'Click "Back to List" to return to all commands' })
        .setTimestamp();

    if (hasSubcommands) {
        // List all subcommands with their options
        const subcommands = command.data.options.filter(opt => opt.type === 1);

        for (const subCmd of subcommands) {
            let fieldValue = `**Description:** ${subCmd.description}\n**Usage:** \`/${command.data.name} ${subCmd.name}\``;

            // Add options if they exist
            if (subCmd.options && subCmd.options.length > 0) {
                const optionsList = subCmd.options.map(opt => {
                    let optStr = `• \`${opt.name}\`${opt.required ? ' **(required)**' : ' (optional)'} - ${opt.description}`;

                    if (opt.choices && opt.choices.length > 0) {
                        const choicesList = opt.choices.map(c => `\`${c.name}\``).join(', ');
                        optStr += `\n  Choices: ${choicesList}`;
                    }

                    return optStr;
                }).join('\n');

                fieldValue += `\n\n**Options:**\n${optionsList}`;
            }

            embed.addFields({
                name: `\`/${command.data.name} ${subCmd.name}\``,
                value: fieldValue,
                inline: false
            });
        }
    } else {
        // Simple command - show options
        let usage = `\`/${command.data.name}\``;

        if (command.data.options && command.data.options.length > 0) {
            const regularOptions = command.data.options.filter(opt => opt.type !== 1);

            if (regularOptions.length > 0) {
                const optionsList = regularOptions.map(opt => {
                    let optStr = `• \`${opt.name}\`${opt.required ? ' **(required)**' : ' (optional)'} - ${opt.description}`;

                    if (opt.choices && opt.choices.length > 0) {
                        const choicesList = opt.choices.map(c => `\`${c.name}\``).join(', ');
                        optStr += `\n  Choices: ${choicesList}`;
                    }

                    return optStr;
                }).join('\n');

                embed.addFields({
                    name: 'Options',
                    value: optionsList,
                    inline: false
                });
            }
        }

        embed.addFields({
            name: 'Usage',
            value: usage,
            inline: false
        });
    }

    return embed;
}

function createCommandSelectMenu(interaction) {
    const commands = interaction.client.commands;
    const selectOptions = [];

    commands.forEach(cmd => {
        // Skip admin commands if user is not admin
        if (cmd.data.default_member_permissions && !interaction.memberPermissions?.has(cmd.data.default_member_permissions)) {
            return;
        }

        const category = getCategoryForCommand(cmd.data.name);
        const hasSubcommands = cmd.data.options?.some(opt => opt.type === 1);

        let description = cmd.data.description.substring(0, 100);
        if (hasSubcommands) {
            const subCount = cmd.data.options.filter(opt => opt.type === 1).length;
            description = `${description} (${subCount} subcommands)`;
        }

        selectOptions.push({
            label: `/${cmd.data.name}`,
            description: description,
            value: cmd.data.name,
            emoji: getCategoryEmoji(category)
        });
    });

    // Sort options alphabetically
    selectOptions.sort((a, b) => a.label.localeCompare(b.label));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('help_command_select')
        .setPlaceholder('Select a command to view details')
        .addOptions(selectOptions.slice(0, 25)); // Discord limit of 25 options

    return new ActionRowBuilder().addComponents(selectMenu);
}

function createBackButton() {
    const button = new ButtonBuilder()
        .setCustomId('help_back_to_list')
        .setLabel('Back to List')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('◀️');

    return new ActionRowBuilder().addComponents(button);
}

function categorizeCommands(commands, interaction) {
    const categories = {
        'Points & Daily': [],
        'Games': [],
        'Stats & Info': [],
        'Jobs & Tasks': [],
        'Transfers': [],
        'Loans': [],
        'Admin': [],
        'Settings': []
    };

    const categoryMapping = {
        'daily': 'Points & Daily',
        'balance': 'Stats & Info',
        'donate': 'Points & Daily',
        'gamble': 'Games',
        'leaderboard': 'Stats & Info',
        'job': 'Jobs & Tasks',
        'task': 'Jobs & Tasks',
        'transfer': 'Transfers',
        'loan': 'Loans',
        'viewactiveloans': 'Loans',
        'admin': 'Admin',
        'help': 'Settings',
        'commandmenu': 'Settings'
    };

    commands.forEach(cmd => {
        // Skip admin commands if user is not admin
        if (cmd.data.default_member_permissions && !interaction.memberPermissions?.has(cmd.data.default_member_permissions)) {
            return;
        }

        const category = categoryMapping[cmd.data.name] || 'Settings';
        categories[category].push(cmd);
    });

    return categories;
}

function getCategoryForCommand(commandName) {
    const categoryMapping = {
        'daily': 'Points & Daily',
        'balance': 'Stats & Info',
        'donate': 'Points & Daily',
        'gamble': 'Games',
        'leaderboard': 'Stats & Info',
        'job': 'Jobs & Tasks',
        'task': 'Jobs & Tasks',
        'transfer': 'Transfers',
        'loan': 'Loans',
        'viewactiveloans': 'Loans',
        'admin': 'Admin',
        'help': 'Settings',
        'commandmenu': 'Settings'
    };

    return categoryMapping[commandName] || 'Settings';
}

function getCategoryEmoji(category) {
    const emojiMap = {
        'Points & Daily': '🪙',
        'Games': '🎲',
        'Stats & Info': '📊',
        'Jobs & Tasks': '💼',
        'Transfers': '💸',
        'Loans': '🏦',
        'Admin': '⚙️',
        'Settings': '⚙️'
    };
    return emojiMap[category] || '📋';
}

// Export helper functions for interactionCreate.js
module.exports.createCommandDetailEmbed = createCommandDetailEmbed;
module.exports.createMainHelpEmbed = createMainHelpEmbed;
module.exports.createCommandSelectMenu = createCommandSelectMenu;
module.exports.createBackButton = createBackButton;