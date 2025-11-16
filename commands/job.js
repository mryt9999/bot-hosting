const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const globalValues = require('../globalValues.json');
const profileModel = require('../models/profileSchema');

/**
 * Get user's level based on their Arcane roles
 * @param {GuildMember} member - Discord guild member
 * @returns {number} User's level (0 if no Arcane role found)
 */
function getUserLevel(member) {
    let userLevel = 0;

    // Check all Arcane role rewards to find the highest level role the user has
    for (const arcaneRole of globalValues.ArcaneRoleRewards) {
        if (member.roles.cache.has(arcaneRole.roleId)) {
            // User has this Arcane role, update level if it's higher
            if (arcaneRole.level > userLevel) {
                userLevel = arcaneRole.level;
            }
        }
    }

    return userLevel;
}

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
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'owned') {
            const member = interaction.member;
            const userJobRoles = await getUserJobRoles(member);

            if (userJobRoles.length === 0) {
                return await interaction.reply({
                    content: 'You do not have any job roles.',
                    flags: [MessageFlags.Ephemeral]
                });
            }

            // Calculate totals
            let totalDailyPay = 0;
            let totalWithdrawBonus = 0;

            let jobListText = '';

            for (const job of userJobRoles) {
                totalDailyPay += job.pointReward;
                if (job.extraWithdrawLimit) {
                    totalWithdrawBonus += job.extraWithdrawLimit;
                }

                jobListText += `**${job.jobName}**\n`;
                jobListText += `${job.jobDescription || 'No description available.'}\n`;
                jobListText += `Pay: ${job.pointReward.toLocaleString()} points`;

                if (job.extraWithdrawLimit) {
                    jobListText += ` • +${job.extraWithdrawLimit.toLocaleString()} withdraw limit`;
                }

                jobListText += '\n\n';
            }

            const embed = new EmbedBuilder()
                .setTitle('💼 Your Job Roles')
                .setDescription(jobListText.trim())
                .setColor(0x3498DB)
                .addFields(
                    { name: 'Total Daily Pay', value: `${totalDailyPay.toLocaleString()} points`, inline: true },
                    { name: 'Total Jobs', value: `${userJobRoles.length} / ${globalValues.maxJobsPerUser}`, inline: true }
                )
                .setFooter({ text: `${interaction.user.username}'s Jobs`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            if (totalWithdrawBonus > 0) {
                embed.addFields({
                    name: 'Total Withdraw Bonus',
                    value: `+${totalWithdrawBonus.toLocaleString()} weekly limit`,
                    inline: true
                });
            }

            await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        if (subcommand === 'list') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const userLevel = getUserLevel(interaction.member);
            const userJobCount = globalValues.paidRoleInfo.filter(job =>
                interaction.member.roles.cache.has(job.roleId)
            ).length;

            const allJobs = globalValues.paidRoleInfo.filter(job =>
                job.jobName && job.jobDescription
            );

            if (allJobs.length === 0) {
                return await interaction.editReply({
                    content: '❌ There are no available jobs at the moment.'
                });
            }

            // Build job list as string
            let jobListText = '';

            for (const job of allJobs) {
                const hasJob = interaction.member.roles.cache.has(job.roleId);
                const meetsLevel = !job.levelRequirement || userLevel >= job.levelRequirement;
                const isPrivate = job.privateJob === true;

                // Status emoji
                let statusEmoji = '📋';
                if (hasJob) {
                    statusEmoji = '✅';
                } else if (isPrivate) {
                    statusEmoji = '🔐';
                } else if (!meetsLevel) {
                    statusEmoji = '🔒';
                }

                // Build job entry
                jobListText += `${statusEmoji} **${job.jobName}**`;

                if (isPrivate) {
                    jobListText += ' *(Private)*';
                }

                jobListText += '\n';
                jobListText += `Pay: ${job.pointReward.toLocaleString()} points`;

                if (job.extraWithdrawLimit) {
                    jobListText += ` • +${job.extraWithdrawLimit.toLocaleString()} withdraw limit`;
                }

                // Level requirement, only show if userLevel is less than requirement
                if (job.levelRequirement && userLevel < job.levelRequirement) {
                    jobListText += ` • Level ${job.levelRequirement} required`;
                }

                //if (isPrivate) {
                //    jobListText += ` • Admin assigned only`;
                //}

                jobListText += '\n\n';
            }

            const jobListEmbed = new EmbedBuilder()
                .setTitle('💼 Available Job Roles 💼')
                .setDescription(
                    `**Your Level:** ${userLevel} | **Jobs:** ${userJobCount}/${globalValues.maxJobsPerUser}\n\n` +
                    `${jobListText.trim()}\n\n`
                )
                .setColor(0x3498DB)
                .setFooter({ text: `${interaction.user.username}'s Job List`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            await interaction.editReply({ embeds: [jobListEmbed] });
        }

        if (subcommand === 'info') {
            const jobName = interaction.options.getString('jobname');
            const jobInfo = globalValues.paidRoleInfo.find(j => j.jobName === jobName);

            if (!jobInfo) {
                return await interaction.reply({
                    content: 'Job role not found.',
                    flags: [MessageFlags.Ephemeral]
                });
            }

            const embed = new EmbedBuilder()
                .setTitle(`💼 Job Role: ${jobInfo.jobName} 💼`)
                .setDescription(jobInfo.jobDescription || 'No description available.')
                .addFields({ name: 'Pay', value: `${jobInfo.pointReward.toLocaleString()} points`, inline: false })
                .setColor(0x3498DB)
                .setTimestamp();

            if (jobInfo.extraWithdrawLimit) {
                embed.addFields({
                    name: 'Bonus',
                    value: `+${jobInfo.extraWithdrawLimit.toLocaleString()} weekly withdraw limit`,
                    inline: false
                });
            }

            if (jobInfo.levelRequirement) {
                embed.addFields({
                    name: 'Level Requirement',
                    value: `Level ${jobInfo.levelRequirement}`,
                    inline: false
                });
            }

            if (jobInfo.privateJob) {
                embed.addFields({
                    name: 'Type',
                    value: 'Private (Admin assigned only)',
                    inline: false
                });
            }

            await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        if (subcommand === 'apply') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const jobName = interaction.options.getString('jobname');
            const jobInfo = globalValues.paidRoleInfo.find(job => job.jobName === jobName);

            if (!jobInfo) {
                return await interaction.editReply({
                    content: '❌ This is not a valid job role.'
                });
            }

            // Check if job is private
            if (jobInfo.privateJob) {
                return await interaction.editReply({
                    content: '❌ This job is private and cannot be applied for. It must be assigned by an administrator.'
                });
            }

            // Check level requirement if it exists
            if (jobInfo.levelRequirement) {
                const userLevel = getUserLevel(interaction.member);

                if (userLevel < jobInfo.levelRequirement) {
                    return await interaction.editReply({
                        content: `❌ You do not meet the level requirement for **${jobInfo.jobName}**.\n\n` +
                            `**Required Level:** ${jobInfo.levelRequirement}\n` +
                            `**Your Level:** ${userLevel}\n\n` +
                            `You need to reach level ${jobInfo.levelRequirement} to apply for this job. Level up by being active in the server!`
                    });
                }
            }

            // Check if user already has this role
            if (interaction.member.roles.cache.has(jobInfo.roleId)) {
                return await interaction.editReply({
                    content: `❌ You already have the **${jobInfo.jobName}** job!`
                });
            }

            // Check if user has reached max jobs limit
            const userJobCount = globalValues.paidRoleInfo.filter(job =>
                interaction.member.roles.cache.has(job.roleId) && !job.privateJob
            ).length;

            if (userJobCount >= globalValues.maxJobsPerUser) {
                return await interaction.editReply({
                    content: `❌ You have reached the maximum number of jobs (${globalValues.maxJobsPerUser}).\n\n` +
                        'Please quit one of your current jobs using `/job quit` before applying for a new one.'
                });
            }

            // All checks passed, add the role
            try {
                const targetRole = interaction.guild.roles.cache.get(jobInfo.roleId);

                if (!targetRole) {
                    return await interaction.editReply({
                        content: '❌ Job role not found in this server. Please contact an administrator.'
                    });
                }

                await interaction.member.roles.add(targetRole);

                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Job Application Successful!')
                    .setColor(0x2ECC71)
                    .setDescription(`You have been assigned the **${jobInfo.jobName}** job!`)
                    .addFields(
                        { name: 'Job Description', value: jobInfo.jobDescription || 'No description available', inline: false },
                        { name: 'Daily Pay', value: `${jobInfo.pointReward.toLocaleString()} points`, inline: true },
                        { name: 'Current Jobs', value: `${userJobCount + 1} / ${globalValues.maxJobsPerUser}`, inline: true }
                    )
                    .setTimestamp();

                if (jobInfo.extraWithdrawLimit) {
                    successEmbed.addFields({
                        name: 'Bonus',
                        value: `+${jobInfo.extraWithdrawLimit.toLocaleString()} weekly withdraw limit`,
                        inline: false
                    });
                }

                await interaction.editReply({ embeds: [successEmbed] });

            } catch (error) {
                console.error('Error applying for job:', error);
                await interaction.editReply({
                    content: '❌ An error occurred while assigning the job role. Please contact an administrator.'
                });
            }
        }

        if (subcommand === 'quit') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const jobName = interaction.options.getString('jobname');
            const jobInfo = globalValues.paidRoleInfo.find(job => job.jobName === jobName);

            if (!jobInfo) {
                return await interaction.editReply({
                    content: '❌ Job role not found.'
                });
            }

            // Check if user has this role
            if (!interaction.member.roles.cache.has(jobInfo.roleId)) {
                return await interaction.editReply({
                    content: `❌ You don't have the **${jobInfo.jobName}** job!`
                });
            }

            try {
                const targetRole = interaction.guild.roles.cache.get(jobInfo.roleId);

                if (!targetRole) {
                    return await interaction.editReply({
                        content: '❌ Job role not found in this server. Please contact an administrator.'
                    });
                }

                await interaction.member.roles.remove(targetRole);

                const quitEmbed = new EmbedBuilder()
                    .setTitle('👋 Job Resignation')
                    .setColor(0xE67E22)
                    .setDescription(`You have quit the **${jobInfo.jobName}** job.`)
                    .setFooter({ text: 'You can apply for other jobs with /job apply', iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();

                await interaction.editReply({ embeds: [quitEmbed] });

            } catch (error) {
                console.error('Error quitting job:', error);
                await interaction.editReply({
                    content: '❌ An error occurred while removing the job role. Please contact an administrator.'
                });
            }
        }
    }
};