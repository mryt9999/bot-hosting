const { pointDropAmounts, pointDropCooldownInMinutes } = require('../globalValues.json');
const { Events, EmbedBuilder } = require('discord.js');
const { updateBalance } = require('../utils/dbUtils');

// eevery pointDropCooldownInMinutes minutes, a random amount of points from pointDropAmounts will be dropped in pointdrop channel
const pointdropChannelId = '1434198160330457149'; // Replace with your pointdrop channel ID
const pointdropPingRoleId = '1450516300504760480'; // Replace with your pointdrop ping role ID

module.exports = {
    name: 'pointDrop',
    async execute(client) {
        //handles creating pointdrop and returns a function to call to start the point drop interval
        console.log('PointDrop handler loaded');
        const dropPoints = async () => {
            try {
                const pointdropChannel = await client.channels.fetch(pointdropChannelId);
                if (!pointdropChannel) {
                    console.error('pointdrop channel not found for point drop');
                    return;
                }
                // Select a random amount from pointDropAmounts
                const randomIndex = Math.floor(Math.random() * pointDropAmounts.length);
                const pointsToDrop = pointDropAmounts[randomIndex];
                const pointDropEmbed = new EmbedBuilder()
                    .setTitle('💰 Point Drop!')
                    .setDescription(`A drop of **${pointsToDrop}** points has appeared! Be the first to type \`claim\` to collect the points!`)
                    .setColor(0xFFD700)
                    .setTimestamp();

                // also include a ping to the pointdrop ping role
                await pointdropChannel.send({ content: `<@&${pointdropPingRoleId}>`, embeds: [pointDropEmbed] });
                //await pointdropChannel.send({ content: `@here`, embeds: [pointDropEmbed] });


                // Create a message collector to listen for "claim"
                const filter = m => m.content.toLowerCase() === 'claim' && !m.author.bot;
                const collector = pointdropChannel.createMessageCollector({ filter, max: 1, time: 180000 }); // 3 minutes to claim
                collector.on('collect', async m => {
                    // Award points to the user
                    const updateResult = await updateBalance(
                        m.author.id,
                        pointsToDrop,
                        { client: client },
                        { serverId: m.guild?.id ?? null }
                    );
                    if (updateResult.success) {
                        const successEmbed = new EmbedBuilder()
                            .setTitle('🎉 Points Claimed!')
                            .setDescription(`You have successfully claimed **${pointsToDrop}** points!`)
                            .setColor(0x00FF00)
                            .setTimestamp();
                        await pointdropChannel.send({ content: `<@${m.author.id}>`, embeds: [successEmbed] });
                    } else {
                        console.error(`Failed to award points for point drop to ${m.author.id}:`, updateResult.reason);
                    }
                });
                collector.on('end', collected => {
                    if (collected.size === 0) {
                        pointdropChannel.send('No one claimed the point drop in time! Better luck next time!');
                    }
                });
            } catch (error) {
                console.error('Error during point drop:', error);
            }
        };

        // Start the interval for point drops, remember that pointdropcooldowninminutes is an array of possible cooldowns
        //make a new interval after each drop with a random cooldown from the array
        const scheduleNextDrop = () => {
            const randomIndex = Math.floor(Math.random() * pointDropCooldownInMinutes.length);
            const cooldown = pointDropCooldownInMinutes[randomIndex];
            setTimeout(async () => {
                await dropPoints();
                scheduleNextDrop();
            }, cooldown * 60 * 1000);
        };

        // Start the first drop
        scheduleNextDrop();

        //setInterval(dropPoints, pointDropCooldownInMinutes * 60 * 1000);
        console.log(`Point drop will occur every random amount of minutes.`);
    }
};