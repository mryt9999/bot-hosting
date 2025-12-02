//manages trivia related functions and values

const { gensAfterGodly } = require('../globalValues.json');


/**
 * Creates randomized multiple choice options
 * @param {string} correctAnswer - The correct answer text
 * @param {string[]} wrongOptions - Array of wrong answer texts
 * @param {number} totalOptions - Total number of options to include (default: 4)
 * @returns {{ options: Array, correctAnswer: string }} - Options array and correct answer ID
 */
function createMultipleChoiceOptions(correctAnswer, wrongOptions, totalOptions = 4) {
    const numWrong = totalOptions - 1;

    // Shuffle wrong options and take only what we need
    const shuffledWrong = [...wrongOptions].sort(() => Math.random() - 0.5).slice(0, numWrong);

    // Create all options with isCorrect flag
    const allOptions = [
        { text: correctAnswer, isCorrect: true },
        ...shuffledWrong.map(text => ({ text, isCorrect: false }))
    ];

    // Shuffle all options together
    allOptions.sort(() => Math.random() - 0.5);

    // Assign IDs (A, B, C, D...) and find correct answer
    let correctAnswerId = '';
    const options = allOptions.map((opt, index) => {
        const id = String.fromCharCode(65 + index);
        if (opt.isCorrect) {
            correctAnswerId = id;
        }
        return { id, text: opt.text };
    });

    return { options, correctAnswer: correctAnswerId };
}

const HardRewardPoints = 1000;
const MediumRewardPoints = 750;
const EasyRewardPoints = 500;

//first go trough the logic that will define what the trivia question, answer, etc will be
//the logic will be a function that handles it all and returns the final object with question, answer, etc

// make an array of functions that return trivia questions and answers
const triviaQuestions = [
    {
        triviaReturner: function () {
            //gens value is in increments of 10 times, and the efficency of each higher gen is 3 times more than the previous gen
            //so gen 1 is 1x and costs 1, gen 2 is 3x and costs 10, gen 3 is 9x and costs 100, gen 4 is 27x and costs 1000, gen 5 is 81x and costs 10000, gen 6 is 243x and costs 100000, gen 7 is 729x and costs 1 million, gen 8 is 2187x and costs 10 million, gen 9 is 6561x and costs 100 million, gen 10 is 19683x and costs 1 billion
            //go trough the gensAfterGodly array and pick 2 random gens from it
            //and then create a question asking which gen is more efficient cost and efficency wise
            //but the gens cant be the same
            //make sure gen1 index is always atleast worth 2. so between 2 and the arrays length -1
            //and gen2 index can be 1 or 2 index lower then gen1 index

            const gen1Index = Math.floor(Math.random() * (gensAfterGodly.length - 2)) + 2;

            const indexDifference = Math.random() < 0.5 ? 1 : 2; // 50% chance of -1 or -2
            const gen2Index = gen1Index - indexDifference;

            const gen1 = gensAfterGodly[gen1Index];
            const gen2 = gensAfterGodly[gen2Index];
            //now calculate the cost and efficency of each gen
            const gen1Cost = 10 ** (gen1Index + 1);
            const gen2Cost = 10 ** (gen2Index + 1);
            const gen1Efficency = 3 ** (gen1Index + 1);
            const gen2Efficency = 3 ** (gen2Index + 1);

            const gen1EfficencyPerCost = gen1Efficency / gen1Cost;
            const gen2EfficencyPerCost = gen2Efficency / gen2Cost;
            //determine random amount of gen2, between 1 and 100, but it can only be 1,10,20,30,40,50,60,70,80,90,100
            const gen2AmountOptions = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
            const gen2Amount = gen2AmountOptions[Math.floor(Math.random() * gen2AmountOptions.length)];
            const gen2TotalEfficency = gen2EfficencyPerCost * gen2Amount * gen2Cost;
            //now determine how many gen1 are needed to match that efficency
            //const gen1Amount = gen2TotalEfficency / gen1EfficencyPerCost / gen1Cost;

            //determine random amount of gen1, between 1 and 50, but it can only be 1,3,6,9,15,21,25,33,40,45,50
            const gen1AmountOptions = [1, 3, 6, 9, 15, 21, 25, 33, 40, 45, 50];
            const gen1Amount = gen1AmountOptions[Math.floor(Math.random() * gen1AmountOptions.length)];
            const gen1TotalEfficency = gen1EfficencyPerCost * gen1Amount * gen1Cost;


            // Create option objects with letter identifiers
            const options = [
                {
                    id: 'A',
                    text: `${gen1Amount}x ${gen1.name}`,
                    value: gen1TotalEfficency
                },
                {
                    id: 'B',
                    text: `${gen2Amount}x ${gen2.name}`,
                    value: gen2TotalEfficency
                }
            ];

            // Determine correct answer
            const correctAnswer = gen1TotalEfficency > gen2TotalEfficency ? 'A' : 'B';

            return {
                question: 'Which produces more cash?',
                options: options,
                correctAnswer: correctAnswer,
                explanation: `Option ${correctAnswer} produces ${Math.max(gen1TotalEfficency, gen2TotalEfficency).toLocaleString()} cash vs ${Math.min(gen1TotalEfficency, gen2TotalEfficency).toLocaleString()} cash`,
                category: 'Game Knowledge',
                difficulty: 'Hard',
                rewardPoints: HardRewardPoints
            };
        }
    },
    {
        triviaReturner: function () {
            //same as before but now ask which gen is more cost efficient
            const gen1Index = Math.floor(Math.random() * (gensAfterGodly.length - 2)) + 2;

            const indexDifference = Math.random() < 0.5 ? 1 : 2; // 50% chance of -1 or -2
            const gen2Index = gen1Index - indexDifference;
            const gen1 = gensAfterGodly[gen1Index];
            const gen2 = gensAfterGodly[gen2Index];
            //now calculate the cost and efficency of each gen
            const gen1Cost = 10 ** (gen1Index + 1);
            const gen2Cost = 10 ** (gen2Index + 1);
            const gen1Efficency = 3 ** (gen1Index + 1);
            const gen2Efficency = 3 ** (gen2Index + 1);
            const gen1EfficencyPerCost = gen1Efficency / gen1Cost;
            const gen2EfficencyPerCost = gen2Efficency / gen2Cost;
            //determine random amount of gen2
            const gen2AmountOptions = [1, 3, 5, 10, 15, 20, 30, 50];
            const gen2Amount = gen2AmountOptions[Math.floor(Math.random() * gen2AmountOptions.length)];
            const gen2TotalEfficencyPerCost = gen2EfficencyPerCost * gen2Amount;
            //now determine how many gen1 are needed to match that efficency
            //const gen1Amount = gen2TotalEfficencyPerCost / gen1EfficencyPerCost;
            //determine random amount of gen1
            const gen1AmountOptions = [1, 2, 3, 4, 5, 10];
            const gen1Amount = gen1AmountOptions[Math.floor(Math.random() * gen1AmountOptions.length)];
            const gen1TotalEfficencyPerCost = gen1EfficencyPerCost * gen1Amount;
            // Create option objects with letter identifiers
            const options = [
                {
                    id: 'A',
                    text: `${gen1Amount}x ${gen1.name}`,
                    value: gen1TotalEfficencyPerCost
                },
                {
                    id: 'B',
                    text: `${gen2Amount}x ${gen2.name}`,
                    value: gen2TotalEfficencyPerCost
                }
            ];
            // Determine correct answer
            const correctAnswer = gen1TotalEfficencyPerCost > gen2TotalEfficencyPerCost ? 'A' : 'B';
            return {
                question: 'Which is more cost efficient?',
                options: options,
                correctAnswer: correctAnswer,
                explanation: `Option ${correctAnswer} has ${Math.max(gen1TotalEfficencyPerCost, gen2TotalEfficencyPerCost).toFixed(6)} cash per point vs ${Math.min(gen1TotalEfficencyPerCost, gen2TotalEfficencyPerCost).toFixed(6)} cash per point`,
                category: 'Game Knowledge',
                difficulty: 'Hard',
                rewardPoints: HardRewardPoints
            };
        }
    },
    {
        triviaReturner: function () {
            //crate question
            const crates = [
                { name: 'Quantum Crate', level: 20 },
                { name: 'Plasma Crate', level: 25 },
                { name: 'Radiant Crate', level: 30 },
                { name: 'Surge Crate', level: 35 },
                { name: 'Chroma Crate', level: 38 },
                { name: 'Blossom Crate', level: 40 }
            ];
            const correctCrate = crates[Math.floor(Math.random() * crates.length)];
            const wrongOptions = crates.filter(c => c.name !== correctCrate.name).map(c => c.name);

            const { options, correctAnswer } = createMultipleChoiceOptions(
                correctCrate.name,
                wrongOptions,
                3
            );

            return {
                question: `What level is required for ${correctCrate.name}?`,
                options: options,
                correctAnswer: correctAnswer,
                explanation: `Answer: ${correctCrate.name} requires level ${correctCrate.level}.`,
                category: 'Game Knowledge',
                difficulty: 'Medium',
                rewardPoints: MediumRewardPoints
            };
        }
    },
    {
        triviaReturner: function () {
            //requirements for crates
            //for example 1k kills, 250 stars etc, and what crate it belongs to
            //medium difficulty
            const crates = [
                { name: 'Quantum Crate', requirement: '1h playtime' },
                { name: 'Plasma Crate', requirement: 'Complete Star Obby' },
                { name: 'Chroma Crate', requirement: '1k kills' },
                { name: 'Blossom Crate', requirement: '250 stars' }
            ];
            const correctCrate = crates[Math.floor(Math.random() * crates.length)];
            const wrongOptions = crates.filter(c => c.requirement !== correctCrate.requirement).map(c => c.requirement);

            const { options, correctAnswer } = createMultipleChoiceOptions(
                correctCrate.requirement,
                wrongOptions,
                3
            );

            return {
                question: `What is the requirement for ${correctCrate.name}?`,
                options: options,
                correctAnswer: correctAnswer,
                explanation: `Answer: ${correctCrate.name} requires ${correctCrate.requirement}.`,
                category: 'Game Knowledge',
                difficulty: 'Medium',
                rewardPoints: MediumRewardPoints
            };
        }
    },
    {
        triviaReturner: function () {
            //what items exist in the game
            const thingsThatExist = [
                'Pulse',
                'Magnet',
                'Turret',
                'Camera',
                'Door',
                'Sign',
                'Team Totem',
                'Alarm',
                'Respawn Beacon',
                'Damaging Pad',
                'Healing Pad',
                'Radio',
            ];
            const thingsThatDoNotExist = [
                'Shield',
                'Drone',
                'Trap',
                'Mine',
                'Teleport Pad',
                'Radar',
                'Jukebox',
                'Boost Pad',
                'Hologram',
                'Torch',
                'Conveyor Belt',
                'Compass',
                'Talisman',
                'Artifact',
                'Gadget',
                'Blueprint',
                'Banner',
                'Relic',
                'Decoy',
                'Beacon',
                'Flare',
                'Dummy',
                'Tripwire',
                'Solar Panel',
                'Portal',
                'Vault',
                'Speed Boost Pad',
                'Gravity Pad',
                'Motion Sensor',
                'Siren',
                'Speaker',
                'Scanner',
                'Lever',
                'Button',
                'Crate Dropper',
                'Energy Shield',
                'Pressure Plate',
                'Gate',
                'Fence',
                'Dispenser',
                'Chest',
                'Vending Machine',
                'Crafting Table',
                'Anvil',
                'Furnace',
                'Upgrade Station',
                'Flag',
                'Elevator',
                'Moving Platform',
                'Stairs',
                'Laser Fence',
                'Zipline',
                'Proximity Mine',
                'Trap Door',
                'Drawbridge',
                'Sentry Gun',
                'Flame Turret',
                'Frost Turret',
                'Jump Pad',
                'Aura Emitter',
            ];

            const correctThing = thingsThatExist[Math.floor(Math.random() * thingsThatExist.length)];

            const { options, correctAnswer } = createMultipleChoiceOptions(
                correctThing,
                thingsThatDoNotExist,
                4
            );

            return {
                question: 'Which one of these things exist in the game?',
                options: options,
                correctAnswer: correctAnswer,
                explanation: `Answer: ${correctThing} exists in the game.`,
                category: 'Game Knowledge',
                difficulty: 'Easy',
                rewardPoints: EasyRewardPoints
            };
        }
    },
    {
        triviaReturner: function () {
            //what Walls exist in the game
            const wallsThatExist = [
                'Wooden Wall',
                'Temporary Wall',
                'Stone Wall',
                'Brick Wall',
                'Iron Wall',
                'Diamond Wall',
                'Obsidian Wall',
                'Ladder Wall',
                'Transparent Wall',
                'Light Wall',
                'Dirt Wall',
                'Sand Wall',
                'Carpet Wall',
                'Bookshelf Wall',
            ];
            const wallsThatDoNotExist = [
                'Plastic Wall',
                'Rubber Wall',
                'Concrete Wall',
                'Paper Wall',
                'Metal Wall',
                'Gold Wall',
                'Silver Wall',
                'Copper Wall',
                'Marble Wall',
                'Granite Wall',
                'Ice Wall',
                'Reinforced Wall',
                'Mirror Wall',
                'Invisible Wall',
                'Cotton Wall',
                'Emerald Wall',
                'Clay Wall',
                'Bamboo Wall',
                'Steel Wall',
                'Titanium Wall',
                'Rock Wall',
                'Oak Wall',
                'Bedrock Wall',
                'Crystal Wall',
                'Water Wall',
                'Lava Wall',
                'Slime Wall',
                'Bone Wall',
                'Mud Wall',
            ];

            const correctWall = wallsThatExist[Math.floor(Math.random() * wallsThatExist.length)];

            const { options, correctAnswer } = createMultipleChoiceOptions(
                correctWall,
                wallsThatDoNotExist,
                4
            );

            return {
                question: 'Which one of these walls exist in the game?',
                options: options,
                correctAnswer: correctAnswer,
                explanation: `Answer: ${correctWall} exists in the game.`,
                category: 'Game Knowledge',
                difficulty: 'Easy',
                rewardPoints: EasyRewardPoints
            };
        }
    },
    {
        triviaReturner: function () {
            //what achivements exist in the game
            const achivementsThatExist = [
                'Total Cash Earned',
                'Total Notes Collected',
                'Playtime',
                'Multiplier',
                'Rebirths',
                'Players Killed',
                'Stars Collected',
            ];
            const achivementsThatDoNotExist = [
                'Hyper Stars Collected',
                'Highest Gen Reached',
                'Total Walls Built',
                'Total Crates Opened',
                'Total Deaths',
                'Total Jumps',
                'Highest Kill Streak',
                'Fastest Obby Completion',
                'Highest level Reached',
                'Total Respawns',
                'Total Tokens Earned',
                'Times Pulsed',
                'Magnets Placed',
                'Turrets Built',
                'Doors Opened',
            ];

            const correctAchivement = achivementsThatExist[Math.floor(Math.random() * achivementsThatExist.length)];

            const { options, correctAnswer } = createMultipleChoiceOptions(
                correctAchivement,
                achivementsThatDoNotExist,
                4
            );

            return {
                question: 'Which one of these achivements exist in the game?',
                options: options,
                correctAnswer: correctAnswer,
                explanation: `Answer: ${correctAchivement} exists in the game.`,
                category: 'Game Knowledge',
                difficulty: 'Easy',
                rewardPoints: EasyRewardPoints
            };
        }
    },
    {
        triviaReturner: function () {
            //Who sells token upgrades in the game?
            const correctAnswer = 'Rufus';
            const wrongOptions = [
                "Rupus",
                "Rafus",
                "Refus",
                "Rufes",
                "Rufis",
                "Rufux",
                "Rufas",
                "Rufon",
                "Rufum",
                "Rufusx",
                "Rufuss",
                "Rufuze",
                "Rufuto",
                "Rufen",
                "Rufax",
                "Rufex",
                "Rufox",
                "Rufyx",
                "Roofus",
                "Ruffus",
                "Ruphus",
                "Rufius",
                "Rufeus",
                "Rufous",
                "Rufius",
                "Rufman",
                "Rufkin",
                "Rufson",
                "Rufley",
                "Rufton",
                "Rufford",
                "Rufbert",
                "Rufalus",
                "Rufinus",
                "Ruferic",
                "Rufwald",
                "Rufgar",
                "Rufrik",
                "Rufmir",
                "Rufvar",
                "Rufnar",
                "Ruflor",
                "Rufmor",
                "Rufgor",
                "Rufkor",
                "Rufthor",
                "Rufvald",
                "Rufgrim",
                "Rufbrand",
                "Rufwen",
                "Rufren",
                "Rufden",
                "Rufben",
                "Rufken",
                "Ruflen",
                "Ruften",
                "Rufven",
                "Rufzen",
                "Rufpen"
            ];

            const { options, correctAnswer: correctId } = createMultipleChoiceOptions(
                correctAnswer,
                wrongOptions,
                4
            );

            return {
                question: 'Who sells token upgrades in the game?',
                options: options,
                correctAnswer: correctId,
                explanation: `Answer: ${correctAnswer} sells token upgrades in the game.`,
                category: 'Game Knowledge',
                difficulty: 'Easy',
                rewardPoints: EasyRewardPoints
            };
        }
    },
    {
        triviaReturner: function () {
            //Who is the owner of the game?
            const correctAnswer = 'Speezy';
            const wrongOptions = [
                "Speezi",
                "Spezzy",
                'Peezy',
                'Beezy',
                'Sleezy',
                'Sneezy',
                'Squeezy',
                'Leezy',
                'Freezy',
                'Greazy',
                'Kneezy',
                'Lizzy',
                'Sleazy',
                'Zpeezy',
                'Speyzy',
                'Peezi',
                'Pseezy',
                'Seezpy',
                'Seepzy',
            ];

            const { options, correctAnswer: correctId } = createMultipleChoiceOptions(
                correctAnswer,
                wrongOptions,
                4
            );

            return {
                question: 'Who is the owner of the game?',
                options: options,
                correctAnswer: correctId,
                explanation: `Answer: ${correctAnswer} is the owner of the game.`,
                category: 'Game Knowledge',
                difficulty: 'Easy',
                rewardPoints: EasyRewardPoints
            };
        }
    },
    {
        triviaReturner: function () {
            //Where does the Star Obby Event spawn?
            const correctAnswer = 'Lobby';
            const wrongOptions = [
                'Spawn',
                'Zone',
                'Height Limit',
                'Under Map',
                'Under Spawn',
                'Above Spawn',
                'Edge of Map',
            ];

            const { options, correctAnswer: correctId } = createMultipleChoiceOptions(
                correctAnswer,
                wrongOptions,
                4
            );

            return {
                question: 'Where does the Star Obby Event spawn?',
                options: options,
                correctAnswer: correctId,
                explanation: `Answer: The Star Obby Event spawns in the ${correctAnswer}.`,
                category: 'Game Knowledge',
                difficulty: 'Easy',
                rewardPoints: EasyRewardPoints
            };
        }
    },
    {
        triviaReturner: function () {
            //How much notes to activate fever mode?
            const correctAnswer = '200k Notes';
            const wrongOptions = [
                '100k Notes',
                '150k Notes',
                '250k Notes',
                '300k Notes',
                '350k Notes',
                '400k Notes',
                '450k Notes',
                '500k Notes',
                '80k Notes',
                '50k Notes',
                '10k Notes',
            ];

            const { options, correctAnswer: correctId } = createMultipleChoiceOptions(
                correctAnswer,
                wrongOptions,
                4
            );

            return {
                question: 'How much notes needed to activate fever mode?',
                options: options,
                correctAnswer: correctId,
                explanation: `Answer: ${correctAnswer} is needed to activate fever mode.`,
                category: 'Game Knowledge',
                difficulty: 'Medium',
                rewardPoints: MediumRewardPoints
            };
        }
    },
    {
        triviaReturner: function () {
            //What is the chanche of hyper fever?
            const correctAnswer = '10%';
            const wrongOptions = [
                '1%',
                '5%',
                '15%',
                '20%',
                '25%',
                '30%',
                '35%',
                '40%',
                '45%',
                '50%',
            ];

            const { options, correctAnswer: correctId } = createMultipleChoiceOptions(
                correctAnswer,
                wrongOptions,
                4
            );
            return {
                question: 'What is the chance of hyper fever?',
                options: options,
                correctAnswer: correctId,
                explanation: `Answer: The chance of hyper fever is ${correctAnswer}.`,
                category: 'Game Knowledge',
                difficulty: 'Medium',
                rewardPoints: MediumRewardPoints
            };
        }
    },
    {
        triviaReturner: function () {
            //What is the chanche of hyper star?
            const correctAnswer = '10%';
            const wrongOptions = [
                '1%',
                '5%',
                '15%',
                '20%',
                '25%',
                '30%',
                '35%',
                '40%',
                '45%',
                '50%',
            ];

            const { options, correctAnswer: correctId } = createMultipleChoiceOptions(
                correctAnswer,
                wrongOptions,
                4
            );
            return {
                question: 'What is the chance of hyper star?',
                options: options,
                correctAnswer: correctId,
                explanation: `Answer: The chance of hyper star is ${correctAnswer}.`,
                category: 'Game Knowledge',
                difficulty: 'Medium',
                rewardPoints: MediumRewardPoints
            };
        }
    },
    {
        triviaReturner: function () {
            //Who is Billy and how does he spawn? 
            const correctAnswer = 'Cube that shoots multiplier notes, low spawn chance when collecting star';
            const wrongOptions = [
                //fit all within 80 characters
                'sphere that shoots random gen, spawns every 10h',
                'pyramid that shoots random crate, spawns when collecting star',
                'star that shoots 1M notes, spawns when completing obby',
                'cube that shoots multiplier notes, spawns when opening 10 crates',
                'cube that shoots multiplier notes, spawns every 5h',
                'cube that shoots random gen, low spawn chance from star',
                'cube that shoots multiplier notes, very high spawn chance from star',
                'cube that shoots cash, low spawn chance from star',
                'cube that shoots crate notes, low spawn chance from star',
                'sphere that rolls while giving multiplier, spawns from star',
            ];
            const { options, correctAnswer: correctId } = createMultipleChoiceOptions(
                correctAnswer,
                wrongOptions,
                4
            );
            return {
                question: 'Who is Billy and how does he spawn?',
                options: options,
                correctAnswer: correctId,
                explanation: `Answer: ${correctAnswer}`,
                category: 'Game Knowledge',
                difficulty: 'Hard',
                rewardPoints: HardRewardPoints
            };
        }
    }
];

//export a function that will get a random trivia question from the array
module.exports.getRandomTriviaQuestion = function () {
    const randomIndex = Math.floor(Math.random() * triviaQuestions.length);
    return triviaQuestions[randomIndex].triviaReturner();
};