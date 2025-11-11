const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('commandmenu')
        .setDescription('Opens the interactive command menu')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        // Create the main embed
        const menuEmbed = new EmbedBuilder()
            .setTitle('Economy Bot Command Menu')
            .setDescription('Click the buttons below to use commands!')
            .setColor('#FF6B6B')
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .addFields(
                { name: '🪙 Points', value: 'Collect points.', inline: true },
                { name: '🎲 Games', value: 'Gamble your points', inline: true },
                { name: '📊 Stats', value: 'View your balance', inline: true }
            )
            .setFooter({ text: 'Select a command button below to get started!' })
            .setTimestamp();

        // Get all non-admin commands
        const commands = interaction.client.commands.filter(cmd =>
            !cmd.data.default_member_permissions &&
            cmd.data.name !== 'commandmenu'
        );

        // Create buttons (5 per row maximum)
        const rows = [];
        let currentRow = [];

        commands.forEach(cmd => {
            if (currentRow.length === 5) {
                rows.push(new ActionRowBuilder().addComponents(currentRow));
                currentRow = [];
            }

            currentRow.push(
                new ButtonBuilder()
                    .setCustomId(`cmd:${cmd.data.name}`)
                    .setLabel(cmd.data.name)
                    .setStyle(ButtonStyle.Primary)
            );
        });

        // Add any remaining buttons
        if (currentRow.length > 0) {
            rows.push(new ActionRowBuilder().addComponents(currentRow));
        }

        await interaction.reply({
            embeds: [menuEmbed],
            components: rows
        });
    }
};
