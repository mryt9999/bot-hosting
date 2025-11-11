const { Events } = require('discord.js');
const { dailyRolePay } = require('../globalValues.json');

// Map userId -> { channelId, timestamp }
if (!global.userLastMessageChannel) {global.userLastMessageChannel = new Map();}

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot) {return;}

        // check all the roles in dailyRolePay and see if the user has any of them
        //check only if 24 hours have passed since lastDailyRolePay
        const profileModel = require('../models/profileSchema');
        const profileData = await profileModel.findOne({ userId: message.author.id });
        const now = Date.now();
        if (profileData) {
            const lastPay = profileData.lastDailyRolePay || 0;
            if (now - lastPay >= 86400000) { // 24 hours
                // list all of the roles
                let totalPay = 0;
                const rolesPaidFor = [];
                for (const rolePay of dailyRolePay) {
                    const roleId = rolePay.roleId;
                    const pointReward = rolePay.pointReward || 0;
                    if (message.member.roles.cache.has(roleId)) {
                        totalPay += pointReward;
                        //push a table containing the role mention and the point reward
                        //create new table
                        const roleTable = new Map();
                        //dont make the role mention ping ussers
                        roleTable.set(`${message.guild.roles.cache.get(roleId).name}`, pointReward);
                        rolesPaidFor.push(roleTable);
                    }
                }
                if (totalPay > 0) {
                    //add the points to the user's profile
                    await profileModel.findOneAndUpdate(
                        { userId: message.author.id },
                        { $inc: { balance: totalPay }, $set: { lastDailyRolePay: now } },
                        { new: true }
                    );
                    //send all the roles paid for in a message seperated with \n
                    const rolesList = rolesPaidFor.map(roleTable => {
                        for (const [roleMention, points] of roleTable) {
                            return `${roleMention} (${points} points)`;
                        }
                    }).join('\n');
                    await message.channel.send(`<@${message.author.id}>, you have received daily points for your roles:\n${rolesList}`);
                }
            }
        }

        global.userLastMessageChannel.set(message.author.id, {
            channelId: message.channel.id,
            guildId: message.guild?.id,
            timestamp: Date.now()
        });
    }
};