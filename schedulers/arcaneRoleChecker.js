const cron = require('node-cron');
const profileModel = require('../models/profileSchema');
const { ArcaneRoleRewards } = require('../globalValues.json');
const { updateBalance } = require('../utils/dbUtils');

console.log('Arcane Role Checker scheduler loaded');

/**
 * Check all guild members for unclaimed Arcane role rewards
 * This runs periodically to catch any missed role assignments
 */
async function checkUnclaimedRoleRewards(client) {
    console.log('[ArcaneRoleChecker] Starting hourly unclaimed role reward check');

    try {
        // Get all guilds the bot is in
        const guilds = client.guilds.cache;

        for (const [guildId, guild] of guilds) {
            console.log(`[ArcaneRoleChecker] Checking guild: ${guild.name} (${guildId})`);

            try {
                // Fetch all members (required for role data)
                await guild.members.fetch();

                // Iterate through all members
                for (const [memberId, member] of guild.members.cache) {
                    // Skip bots
                    if (member.user.bot) {
                        continue;
                    }

                    // Get user profile
                    let profileData = await profileModel.findOne({ userId: memberId });
                    if (!profileData) {
                        profileData = await profileModel.create({
                            userId: memberId,
                            serverID: guildId,
                            claimedArcaneRoles: []
                        });
                    }

                    // Ensure claimedArcaneRoles exists
                    if (!profileData.claimedArcaneRoles) {
                        profileData.claimedArcaneRoles = [];
                    }

                    // Check each Arcane role
                    for (const arcaneReward of ArcaneRoleRewards) {
                        const { roleId, pointReward } = arcaneReward;

                        // Skip if already claimed
                        if (profileData.claimedArcaneRoles.includes(roleId)) {
                            continue;
                        }

                        // Check if member has this role
                        if (member.roles.cache.has(roleId)) {
                            console.log(`[ArcaneRoleChecker] Found unclaimed reward: User ${memberId} has role ${roleId} but hasn't claimed ${pointReward} points`);

                            try {
                                // Mark role as claimed
                                await profileModel.findOneAndUpdate(
                                    { userId: memberId },
                                    {
                                        $addToSet: { claimedArcaneRoles: roleId },
                                        $setOnInsert: { serverID: guildId }
                                    },
                                    { upsert: true }
                                );

                                // Award points
                                const updateResult = await updateBalance(
                                    memberId,
                                    pointReward,
                                    { client },
                                    { serverId: guildId }
                                );

                                if (updateResult.success) {
                                    console.log(`[ArcaneRoleChecker] Successfully awarded ${pointReward} points to ${member.user.tag} for role ${roleId}`);

                                    // Get role name for notification
                                    const role = guild.roles.cache.get(roleId);
                                    const roleName = role?.name || 'Unknown Role';

                                    // Send notification to user's last message channel or DM
                                    const lastMsg = global.userLastMessageChannel?.get(memberId);
                                    if (lastMsg) {
                                        try {
                                            const channel = await guild.channels.fetch(lastMsg.channelId);
                                            if (channel?.isTextBased?.()) {
                                                await channel.send(`🎉 Congratulations <@${memberId}>! You received ${pointReward} points from **${roleName}** (automatic reward claim).`);
                                            }
                                        } catch (err) {
                                            console.debug(`[ArcaneRoleChecker] Could not send message to channel ${lastMsg.channelId}:`, err);
                                            // Fallback to DM
                                            try {
                                                await member.send(`🎉 You received ${pointReward} points from **${roleName}**! (This was an automatic reward for a role you already had)`).catch(console.error);
                                            } catch (dmErr) {
                                                console.debug(`[ArcaneRoleChecker] Could not send DM to ${memberId}:`, dmErr);
                                            }
                                        }
                                    } else {
                                        // Fallback to DM
                                        try {
                                            await member.send(`🎉 You received ${pointReward} points from **${roleName}**! (This was an automatic reward for a role you already had)`).catch(console.error);
                                        } catch (dmErr) {
                                            console.debug(`[ArcaneRoleChecker] Could not send DM to ${memberId}:`, dmErr);
                                        }
                                    }
                                } else {
                                    console.error(`[ArcaneRoleChecker] Failed to award points to ${member.user.tag} for role ${roleId}:`, updateResult.reason);
                                }
                            } catch (error) {
                                console.error(`[ArcaneRoleChecker] Error awarding role reward to ${member.user.tag}:`, error);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`[ArcaneRoleChecker] Error checking guild ${guild.name}:`, error);
            }
        }

        console.log('[ArcaneRoleChecker] Hourly check completed');
    } catch (error) {
        console.error('[ArcaneRoleChecker] Error in hourly check:', error);
    }
}

/**
 * Initialize the scheduler
 * @param {Client} client - Discord.js client instance
 */
function initializeArcaneRoleChecker(client) {
    // Run every hour at minute 0 (e.g., 1:00, 2:00, 3:00, etc.)
    cron.schedule('0 * * * *', async () => {
        await checkUnclaimedRoleRewards(client);
    });

    console.log('[ArcaneRoleChecker] Scheduler initialized - will run every hour at :00');

    // Optional: Run once on startup after a delay
    setTimeout(async () => {
        console.log('[ArcaneRoleChecker] Running initial check on startup');
        await checkUnclaimedRoleRewards(client);
    }, 30000); // Wait 30 seconds after bot starts
}

module.exports = {
    initializeArcaneRoleChecker,
    checkUnclaimedRoleRewards
};