const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const globalValues = require('../globalValues.json');
const profileModel = require('../models/profileSchema');
const dbUtils = require('../utils/dbUtils');

const genChoices = globalValues.gensAfterGodly.map(gen => ({
    name: gen,
    value: gen
}));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('transfer')
        .setDescription('Transfer points or view point value in gens')
        .addSubcommand(subcommand =>
            subcommand
                .setName('calculator')
                .setDescription('Show how many gens your points are worth')
                .addStringOption(option =>
                    option.setName('gen')
                        .setDescription('The gen to view the point value in')
                        .setRequired(false)
                        .addChoices(...genChoices))),
    async execute(interaction, profileData = null, opts = {}) {
        await interaction.deferReply();

        const subcommand = interaction.options.getSubcommand();
        // Ensure profileData exists
        if (!profileData) {
            profileData = await dbUtils.ensureProfile(interaction.user.id, interaction.guild?.id ?? null);
        }
        if (subcommand === 'calculator') {
            const genOption = interaction.options.getString('gen');
            const points = profileData.balance;
            let genValue;

            if (genOption) {
                // Calculate value in specified gen
                const genIndex = globalValues.gensAfterGodly.indexOf(genOption);
                if (genIndex === -1) {
                    return await interaction.editReply({ content: 'Invalid gen specified.' });
                }
                const pointsPerGen = globalValues.pointsPerGodlyGen * Math.pow(10, genIndex);
                genValue = points / pointsPerGen;

                // Format: no decimals if whole number part has 2+ digits
                const wholeNumber = Math.floor(genValue);
                const formattedValue = wholeNumber >= 10 ? wholeNumber.toLocaleString() : genValue.toFixed(2);

                const embed = new EmbedBuilder()
                    .setColor(0x00D9FF) // Cyan/blue color
                    .setTitle('✨ Gen Value Calculator')
                    .setDescription(`**${points.toLocaleString()}** points = **${formattedValue}** ${genOption}'s`)
                    .setFooter({ text: interaction.user.username, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            }

            // Determine closest gen - find highest gen where value >= 1
            let closestGen = 'godly';
            let closestGenIndex = -1;

            for (let i = globalValues.gensAfterGodly.length - 1; i >= 0; i--) {
                const pointsPerGen = globalValues.pointsPerGodlyGen * Math.pow(10, i);
                const genCount = points / pointsPerGen;

                if (genCount >= 1) {
                    closestGen = globalValues.gensAfterGodly[i];
                    closestGenIndex = i;
                    break;
                }
            }

            const pointsPerClosestGen = closestGenIndex >= 0
                ? globalValues.pointsPerGodlyGen * Math.pow(10, closestGenIndex)
                : globalValues.pointsPerGodlyGen;
            genValue = points / pointsPerClosestGen;

            // Format: no decimals if whole number part has 2+ digits
            const wholeNumber = Math.floor(genValue);
            const formattedValue = wholeNumber >= 10 ? wholeNumber.toLocaleString() : genValue.toFixed(2);

            const embed = new EmbedBuilder()
                .setColor(0x00D9FF) // Cyan/blue color
                .setTitle('✨ Gen Value Calculator')
                .setDescription(`**${points.toLocaleString()}** points = **${formattedValue}** ${closestGen}'s`)
                .setFooter({ text: interaction.user.username, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            return await interaction.editReply({ embeds: [embed] });
        }
    }
};