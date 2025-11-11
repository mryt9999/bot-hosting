const { Events } = require('discord.js');
const profileModel = require("../models/profileSchema");
const { ArcaneRoleRewards } = require("../globalValues.json");

// Event handler for when a member receives an Arcane role
// Awards points based on the role they received
module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        try {
            // Check which roles were added
            const addedRoles = newMember.roles.cache.filter(
                role => !oldMember.roles.cache.has(role.id)
            );

            if (addedRoles.size === 0) {
                return; // No new roles added
            }

            // Check if any of the added roles are Arcane roles
            for (const [roleId] of addedRoles) {
                const arcaneReward = ArcaneRoleRewards.find(
                    reward => reward.roleId === roleId
                );

                if (arcaneReward) {
                    // Found an Arcane role - award points
                    const pointReward = arcaneReward.pointReward;

                    // Update the user's profile with the reward
                    await profileModel.findOneAndUpdate(
                        { userId: newMember.id },
                        {
                            $inc: { balance: pointReward },
                            $setOnInsert: { serverID: newMember.guild.id }
                        },
                        { upsert: true, new: true }
                    );

                    // Send a DM to the user about their reward
                    try {
                        await newMember.send(
                            `🎉 Congratulations! You've been awarded **${pointReward.toLocaleString()}** points for receiving the Arcane role!`
                        );
                    } catch (dmError) {
                        console.log(`Couldn't send Arcane reward DM to ${newMember.user.tag}`);
                    }

                    console.log(`Awarded ${pointReward} points to ${newMember.user.tag} for Arcane role ${roleId}`);
                }
            }
        } catch (error) {
            console.error(`Error processing Arcane role reward for ${newMember.user.tag}:`, error);
        }
    }
};