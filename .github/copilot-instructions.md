# Copilot Instructions

## Repository Purpose

This repository contains a Discord Economy Bot built with Discord.js v14 and MongoDB. The bot provides an interactive economy system with features including:
- Point management (balance, daily claims, donations)
- Gambling system with public announcements
- Task system with weekly resets
- Job/role-based rewards
- Leaderboard tracking
- Admin commands for point management
- Loan system with interest tracking

## Technology Stack

- **Node.js**: v16.9.0 or higher (CommonJS modules)
- **Discord.js**: v14.24.2 (slash commands, interactions)
- **MongoDB**: Database via Mongoose v8.19.2
- **Linting**: ESLint v9.39.0 with custom configuration

## Setup and Installation

### Prerequisites
1. Node.js v16.9.0 or higher installed
2. MongoDB database accessible
3. Discord Bot Token and Application Client ID
4. Discord Guild (server) ID

### Installation Steps
1. Install dependencies:
   ```bash
   npm ci
   ```

2. Create `.env` file with required environment variables:
   ```
   DISCORD_TOKEN=your_discord_bot_token
   CLIENT_ID=your_discord_application_client_id
   GUILD_ID=your_discord_guild_id
   MONGODB_SRV=mongodb+srv://username:password@cluster.mongodb.net/dbname
   GAMBLING_CHANNEL_ID=optional_channel_id
   DONATION_CHANNEL_ID=optional_channel_id
   ```

3. Deploy slash commands:
   ```bash
   node deploy-commands.js
   ```

4. Start the bot:
   ```bash
   node index.js
   ```

## Build and Test Commands

### Linting
- Run linter: `npm run lint`
- Auto-fix linting issues: `npm run lint:fix`

### Testing
Currently, there is no test suite configured. The test script will exit with an error.

## Code Style Guidelines

### ESLint Configuration
The project uses a custom ESLint configuration (eslint.config.js) with the following rules:
- **Indentation**: 4 spaces
- **Quotes**: Single quotes (with escape allowance)
- **Semicolons**: Required
- **No var**: Use `let` or `const` instead
- **Prefer const**: Use `const` when variables are not reassigned
- **Curly braces**: Required for all control statements (if, for, while, etc.)
- **Object spacing**: Spaces inside curly braces
- **Arrow spacing**: Spaces around arrows in arrow functions
- **Keyword spacing**: Spaces after keywords (if, for, while, etc.)

### Naming Conventions
- Use camelCase for variables and functions
- Use PascalCase for class names and schemas
- Use descriptive names that indicate purpose

### Error Handling
- Always use try-catch blocks for async operations
- Use ephemeral messages (flags: [MessageFlags.Ephemeral]) for error messages
- Check if interaction is already replied/deferred before responding
- Use proper error logging with console.log/console.error

### Interaction Handling Patterns
When working with Discord interactions:
1. Check if the interaction has already been replied to or deferred
2. Use `interaction.deferred` or `interaction.replied` properties
3. Use `interaction.editReply()` for deferred interactions
4. Use `interaction.reply()` for new responses
5. Use ephemeral flags for sensitive/error messages

Example pattern:
```javascript
try {
    // Your logic here
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: 'Response', flags: [MessageFlags.Ephemeral] });
    } else {
        await interaction.reply({ content: 'Response', flags: [MessageFlags.Ephemeral] });
    }
} catch (error) {
    console.error('Error:', error);
    // Handle error reply
}
```

## Project Structure

```
bot-hosting/
├── commands/              # Slash command implementations
│   ├── admin.js          # Admin commands (addpoints, subtractpoints, completetask)
│   ├── balance.js        # Balance viewing command
│   ├── commandMenu.js    # Interactive button-based command menu
│   ├── daily.js          # Daily point claim with cooldown
│   ├── donate.js         # Point donation system with announcements
│   ├── gamble.js         # Gambling with 50/50 odds and announcements
│   ├── job.js            # Job/role application and management
│   ├── leaderboard.js    # Top 10 players leaderboard
│   ├── loan.js           # Loan system with interest
│   ├── task.js           # Task list and info commands
│   ├── transfer.js       # Point transfer with Arcane role rewards
│   └── viewActiveLoans.js # View active loans
├── events/               # Discord.js event handlers
│   ├── ready.js          # Bot ready event (task reset scheduler)
│   ├── interactionCreate.js # Interaction handling and routing
│   └── balanceChange.js  # Balance change event for role updates
├── models/               # MongoDB Mongoose schemas
│   ├── profileSchema.js  # User profile (userId, balance, lastDaily)
│   ├── taskSchema.js     # Task completion tracking
│   └── loanSchema.js     # Loan tracking
├── utils/                # Utility functions
│   ├── dbUtils.js        # Database transaction helpers
│   ├── interactionHelper.js # Interaction response helpers
│   └── taskManager.js    # Task management and reset logic
├── index.js              # Main bot entry point
├── deploy-commands.js    # Deploy slash commands to Discord
├── globalValues.json     # Configuration (roles, tasks, rewards, limits)
├── eslint.config.js      # ESLint configuration
└── package.json          # Dependencies and scripts
```

## Database Schemas

### Profile Schema
- `userId`: String (unique Discord user ID)
- `serverID`: String (Discord server/guild ID)
- `balance`: Number (default: 100)
- `lastDaily`: Number (timestamp, default: 0)

### Task Schema
- `userId`: String (Discord user ID)
- `serverID`: String (Discord server ID)
- `taskId`: String (task identifier from globalValues.json)
- `completionsThisWeek`: Number (default: 0)
- `lastCompletionDate`: Date
- `weekStartDate`: Date (for weekly reset tracking)

### Loan Schema
- Tracks user loans with interest calculations

## Configuration Files

### globalValues.json
Central configuration file containing:
- `dailyMin`, `dailyMax`: Range for daily point rewards
- `pointMultiplier`: Global point multiplier
- `roleRequirements`: Array of objects with `roleId` and `pointRequirement` for automatic role assignment
- `paidRoleInfo`: Job/role information with point rewards
- `taskInfo`: Array of tasks with IDs, names, max completions per week, and point rewards
- `ArcaneRoleRewards`: Special role rewards for transfers
- `maxJobsPerUser`: Maximum jobs a user can have
- Withdrawal limits and settings

### .env
Environment variables (never commit this file):
- `DISCORD_TOKEN`: Bot token for authentication
- `CLIENT_ID`: Discord application client ID
- `GUILD_ID`: Discord server/guild ID
- `MONGODB_SRV`: MongoDB connection string
- `GAMBLING_CHANNEL_ID`: Optional channel for gambling announcements
- `DONATION_CHANNEL_ID`: Optional channel for donation announcements

## Development Guidelines

### Adding New Commands
1. Create a new file in `/commands/` directory
2. Export an object with:
   - `data`: SlashCommandBuilder instance
   - `execute`: Async function with signature `async execute(interaction, profileData, opts = {})`
3. The command will be automatically loaded by `index.js`
4. Deploy commands with `node deploy-commands.js`

### Working with Database Transactions
- Use transaction helpers from `utils/dbUtils.js` for atomic operations
- Always handle transaction failures gracefully
- Use sessions for operations that require atomicity

### Task System
- Tasks reset every Monday at 00:00:00 UTC (configured in `events/ready.js`)
- Use `utils/taskManager.js` for task operations
- Task completion updates are tracked in the Task schema

### Role Management
- Balance changes trigger role updates via `events/balanceChange.js`
- Role requirements are defined in `globalValues.json`
- Roles are automatically assigned when balance thresholds are met

## Common Patterns

### Command Structure
```javascript
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const profileModel = require('../models/profileSchema');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('commandname')
        .setDescription('Command description'),
    async execute(interaction, profileData, opts = {}) {
        try {
            // Command logic
            await interaction.reply({ content: 'Success', flags: [MessageFlags.Ephemeral] });
        } catch (error) {
            console.error('Error in commandname:', error);
            const replyMethod = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
            await interaction[replyMethod]({
                content: 'An error occurred.',
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};
```

### Database Query Pattern
```javascript
const profile = await profileModel.findOne({ userId: user.id, serverID: interaction.guild.id });
if (!profile) {
    // Handle missing profile
}
```

## Important Notes

- All commands use slash commands (Discord.js v14 interactions)
- Profiles are auto-created when users interact with the bot
- Use ephemeral messages for errors and sensitive information
- Always validate user inputs and check permissions for admin commands
- MongoDB connection is established in `index.js` before bot login
- Event handlers are automatically loaded from the `/events/` directory
- Commands are automatically loaded from the `/commands/` directory

## Security Considerations

- Never commit `.env` file or expose tokens
- Admin commands check for Administrator permissions
- Validate all user inputs before database operations
- Use atomic transactions for critical balance operations
- Prevent self-donations and invalid transfers
- Check balance before allowing gambling or donations
