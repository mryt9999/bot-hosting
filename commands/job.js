const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const globalValues = require('../globalValues.json');
const profileModel = require('../models/profileSchema');

// Generate job choices from globalValues, only include jobs that have jobName defined
const jobChoices = globalValues.paidRoleInfo
    .filter(job => job.jobName) // Filter out entries without jobName
    .map(job => ({
        name: job.jobName,
        value: job.jobName
    }));

//create a function that returns all job roles a user has from paidRoleInfo
async function getUserJobRoles(member) {
    const userJobRoles = [];
    //only check from jobChoices not all roles in paidRoleInfo
    for (const job of jobChoices) {
        const jobInfo = globalValues.paidRoleInfo.find(j => j.jobName === job.name);
        if (jobInfo && member.roles.cache.has(jobInfo.roleId)) {
            userJobRoles.push(jobInfo);
        }
    }
    return userJobRoles;
}

// create a job command with the subcommands:
// owned -gives a list of job roles the user has, the description, and their pay
// list - lists all job roles available with their  pay, but dont include description
// info - gives info about a specific job role with description and pay
// apply - allows the user to apply for a job role and get it instantly, if they have less than maxJobsPerUser roles, and if it isnt privateRole, and if they dont already have the role
// quit - allows the user to quit a job role they have, and removes the role from them
module.exports = {
    data: new SlashCommandBuilder()
        .setName('job')
        .setDescription('Manage and view job roles')
        .addSubcommand(subcommand =>
            subcommand
                .setName('owned')
                .setDescription('List all job roles you currently have'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all available job roles'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Get information about a specific job role')
                .addStringOption(option =>
                    option
                        .setName('jobname')
                        .setDescription('The name of the job role')
                        .setRequired(true)
                        .addChoices(...jobChoices)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('apply')
                .setDescription('Apply for a job role')
                .addStringOption(option =>
                    option
                        .setName('jobname')
                        .setDescription('The name of the job role')
                        .setRequired(true)
                        .addChoices(...jobChoices)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('quit')
                .setDescription('Quit a job role')
                .addStringOption(option =>
                    option
                        .setName('jobname')
                        .setDescription('The name of the job role')
                        .setRequired(true)
                        //only add choices for job roles the user has with getUserJobRoles
                        .setAutocomplete(true))), // Enable autocomplete instead of static choices
    async autocomplete(interaction) {
        // Handle autocomplete for the quit subcommand
        if (interaction.options.getSubcommand() === 'quit') {
            const member = interaction.member;
            const userJobRoles = await getUserJobRoles(member);

            const focusedValue = interaction.options.getFocused().toLowerCase();

            // Filter user's jobs based on what they're typing
            const filtered = userJobRoles
                .filter(job => job.jobName.toLowerCase().includes(focusedValue))
                .map(job => ({
                    name: job.jobName,
                    value: job.jobName
                }))
                .slice(0, 25); // Discord limits to 25 choices

            await interaction.respond(filtered);
        }
    },

    async execute(interaction, profileData, opts = {}) {
        // Your execute logic here
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'owned') {
            const member = interaction.member;
            const userJobRoles = await getUserJobRoles(member);
            if (userJobRoles.length === 0) {
                return await interaction.reply({ content: 'You do not have any job roles.', ephemeral: true });
            }
            const embed = new EmbedBuilder()
                .setTitle('💼 Your Job Roles 💼')
                .setColor(0x3498DB)
                .setTimestamp();
            for (const job of userJobRoles) {
                embed.addFields({
                    name: job.jobName,
                    value: `${job.jobDescription || 'No description available.'}\nPay: ${job.pointReward} points`,
                    inline: false
                });
            }
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        if (subcommand === 'list') {
            const embed = new EmbedBuilder()
                .setTitle('💼 Available Job Roles 💼')
                .setColor(0x3498DB)
                .setTimestamp();
            for (const job of jobChoices) {
                const jobInfo = globalValues.paidRoleInfo.find(j => j.jobName === job.name);
                embed.addFields({
                    name: job.name,
                    value: `Pay: ${jobInfo.pointReward} points`,
                    inline: false
                });
            }
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        if (subcommand === 'info') {
            const jobName = interaction.options.getString('jobname');
            const jobInfo = globalValues.paidRoleInfo.find(j => j.jobName === jobName);
            if (!jobInfo) {
                return await interaction.reply({ content: 'Job role not found.', ephemeral: true });
            }
            const embed = new EmbedBuilder()
                .setTitle(`💼 Job Role: ${jobInfo.jobName} 💼`)
                .setDescription(jobInfo.jobDescription || 'No description available.')
                .addFields({ name: 'Pay', value: `${jobInfo.pointReward} points`, inline: false })
                .setColor(0x3498DB)
                .setTimestamp();
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        if (subcommand === 'apply') {
            const jobName = interaction.options.getString('jobname');
            const jobInfo = globalValues.paidRoleInfo.find(j => j.jobName === jobName);
            if (!jobInfo) {
                return await interaction.reply({ content: 'Job role not found.', ephemeral: true });
            }
            const member = interaction.member;
            const userJobRoles = await getUserJobRoles(member);
            if (userJobRoles.length >= globalValues.maxJobsPerUser) {
                return await interaction.reply({ content: `You can only have up to ${globalValues.maxJobsPerUser} job roles.`, ephemeral: true });
            }
            if (member.roles.cache.has(jobInfo.roleId)) {
                return await interaction.reply({ content: 'You already have this job role.', ephemeral: true });
            }
            if (jobInfo.privateJob) {
                return await interaction.reply({ content: 'This job role is private and cannot be applied for.', ephemeral: true });
            }
            // Add the role to the member
            await member.roles.add(jobInfo.roleId);
            await interaction.reply({ content: `You have successfully applied for the ${jobInfo.jobName} job role. Use \`/job owned\` to see your jobs.`, ephemeral: true });
        }
        if (subcommand === 'quit') {
            const jobName = interaction.options.getString('jobname');
            const jobInfo = globalValues.paidRoleInfo.find(j => j.jobName === jobName);
            if (!jobInfo) {
                return await interaction.reply({ content: 'Job role not found.', ephemeral: true });
            }
            const member = interaction.member;
            if (!member.roles.cache.has(jobInfo.roleId)) {
                return await interaction.reply({ content: 'You do not have this job role.', ephemeral: true });
            }
            // Remove the role from the member
            await member.roles.remove(jobInfo.roleId);
            await interaction.reply({ content: `You have successfully quit the ${jobInfo.jobName} job role.`, ephemeral: true });
        }
    }
};