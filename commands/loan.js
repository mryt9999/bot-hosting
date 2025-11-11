//create a loan command with subcommands: send loan, repay amount of loan, view loans owed, view loans given
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const profileModel = require('../models/profileSchema');
const balanceChangeEvent = require('../events/balanceChange');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loan')
        .setDescription('Manage loans between users')
        .addSubcommand(subcommand =>
            subcommand
                .setName('send')
                .setDescription('Send a loan to another user') //only 1 loan per user at a time
                .addUserOption(option =>
                    option.setName('player')
                        .setDescription('The player to send the loan to')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('The amount of the loan')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('duration')
                        .setDescription('Duration of the loan in hours')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount_owed')
                        .setDescription('What the borrower has to pay back')
                        .setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('repay')
                .setDescription('Repay a loan') //prompts user to select which loan to repay, and after that the amount to repay, up to the total owed amount
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View your loans') //gives list of loans given with buttons to switch pages if more than 5
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view-owed')
                .setDescription('View loans you owe') //gives list of loans owed with buttons to switch pages if more than 5
        ),
    async execute(interaction) {
        await interaction.deferReply();

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'send') {
            const player = interaction.options.getUser('player');
            const amount = interaction.options.getInteger('amount');

            // Handle sending loan logic here

        } else if (subcommand === 'repay') {
            const amount = interaction.options.getInteger('amount');

            // Handle repaying loan logic here

        } else if (subcommand === 'view') {

            // Handle viewing loans logic here

        } else if (subcommand === 'view-owed') {

            // Handle viewing owed loans logic here

        }

        await interaction.editReply({ content: 'Loan command executed' });
    }
};