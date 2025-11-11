const profileModel = require('../models/profileSchema');
const { roleRequirements } = require('../globalValues.json');

//only add the role if the user meets the requirements, and also if the user doesn't already have role with higher requirements
// Event handler for when a user's balance changes
module.exports = {
    name: 'balanceChange',
    async execute(member) {
        try {
            // Fetch the latest profile data
            const profileData = await profileModel.findOne({ userId: member.id });
            if (!profileData) {return;} // No profile found
            const userBalance = profileData.balance;

            // Determine the highest role the user qualifies for
            //loop trough each array inside roleRequirements
            let newRoleId = null;
            let lastReq = 0;
            for (const [_arrayIndex, array] of Object.entries(roleRequirements)) {
                if (userBalance >= array.pointRequirement) {
                    // Check if user already has a higher role
                    if (!newRoleId || array.pointRequirement > lastReq) {
                        newRoleId = array.roleId;
                        lastReq = array.pointRequirement;
                    }
                }
            }

            // Remove roles that the user no longer qualifies for
            for (const array of Object.values(roleRequirements)) {
                if (member.roles.cache.has(array.roleId) && array.roleId !== newRoleId) {
                    await member.roles.remove(array.roleId);
                }
            }
            // Add the new role if applicable
            if (newRoleId && !member.roles.cache.has(newRoleId)) {
                await member.roles.add(newRoleId);
            }
        } catch (error) {
            console.error(`Error processing balance change for userId: ${member.id}`, error);
        }
    }
};
