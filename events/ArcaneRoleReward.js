const { Events } = require('discord.js');
const profileModel = require('../models/profileSchema');
const { ArcaneRoleRewards } = require('../globalValues.json');
const balanceChangeEvent = require('./balanceChange');

console.log('ArcaneRoleReward handler loaded');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        console.log(`GuildMemberUpdate event triggered for userId: ${newMember?.id}`);

        try {
            // Ensure we have fresh member objects (fallback fetch if needed)
            if (!oldMember || !newMember) {
                console.debug('Missing member object(s), attempting to fetch fresh member data');
                try {
                    newMember = await newMember.guild.members.fetch(newMember.id);
                    oldMember = await newMember.guild.members.fetch(newMember.id); // best-effort
                } catch (e) {
                    console.error('Failed to fetch member data:', e);
                }
            }

            // Debug sizes
            console.debug('old roles:', oldMember?.roles?.cache?.size ?? 'n/a', 'new roles:', newMember?.roles?.cache?.size ?? 'n/a');

            const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
            if (!addedRoles || addedRoles.size === 0) {
                console.debug('No added roles detected');
                return;
            }

            // Get or create user profile
            let profileData = await profileModel.findOne({ userId: newMember.id });
            if (!profileData) {
                profileData = await profileModel.create({
                    userId: newMember.id,
                    serverID: newMember.guild.id,
                    claimedArcaneRoles: []
                });
            }

            // Ensure claimedArcaneRoles exists (for existing profiles created before this field was added)
            if (!profileData.claimedArcaneRoles) {
                profileData.claimedArcaneRoles = [];
            }

            for (const role of addedRoles.values()) {
                console.log(`New role added: ${role.id} (${role.name}) to userId: ${newMember.id}`);

                // ArcaneRoleRewards is an array of { roleId, pointReward }
                const arcaneReward = ArcaneRoleRewards.find(reward => reward.roleId === role.id);
                if (!arcaneReward) continue;

                // Check if user has already claimed this role reward
                if (profileData.claimedArcaneRoles.includes(role.id)) {
                    console.log(`User ${newMember.id} has already claimed reward for role ${role.id}, skipping`);

                    // Optionally notify user they've already claimed this reward
                    try {
                        await newMember.send(
                            `ℹ️ You've already claimed the reward for the **${role.name}** role. Rewards can only be claimed once per user.`
                        ).catch(err => {
                            console.debug(`Could not send already-claimed DM to userId: ${newMember.id}`, err);
                        });
                    } catch (err) {
                        console.debug('Failed to send already-claimed notification:', err);
                    }

                    continue; // Skip to next role
                }

                const pointReward = arcaneReward.pointReward || 0;
                console.log(`Awarding ${pointReward} points for role ${role.id} to ${newMember.id} (first time claim)`);

                // Update the user's profile: add points AND mark role as claimed
                await profileModel.findOneAndUpdate(
                    { userId: newMember.id },
                    {
                        $inc: { balance: pointReward },
                        $addToSet: { claimedArcaneRoles: role.id }, // Add role ID to claimed array (prevents duplicates)
                        $setOnInsert: { serverID: newMember.guild.id }
                    },
                    { upsert: true, new: true }
                );
                // Trigger balanceChange event manually
                await balanceChangeEvent.execute(newMember);

                //send a reply to the user inside the channel where he sent his last message
                //dont send a dm
                const lastMsg = global.userLastMessageChannel?.get(newMember.id);
                if (lastMsg) {
                    try {
                        const channel = await newMember.guild.channels.fetch(lastMsg.channelId);
                        if (channel?.isTextBased?.()) {
                            await channel.send(`🎉 Congratulations <@${newMember.id}>! You received ${pointReward} points from **${role.name}**.`);
                        }
                    } catch (err) {
                        console.error(`Could not send message to channel ${lastMsg.channelId}:`, err);
                    }
                } else {
                    // fallback to DM
                    await newMember.send(`🎉 You received ${pointReward} points!`).catch(console.error);
                }
            }
        } catch (error) {
            console.error(`Error processing Arcane role reward for ${newMember?.user?.tag ?? newMember?.id}:`, error);
        }
    }
};