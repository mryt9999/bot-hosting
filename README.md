# Discord Economy Bot

A feature-rich Discord bot that provides an interactive economy system with points, gambling, donations, leaderboards, and role-based rewards.

## Features

### Core Commands
- **`/balance`** - Check your or another player's point balance
- **`/daily`** - Claim your daily points (24-hour cooldown)
- **`/gamble <amount>`** - Gamble points with 50/50 odds
- **`/donate <player> <amount>`** - Donate points to another player
- **`/leaderboard`** - View the top 10 players
- **`/commandmenu`** - Interactive button-based command menu (Admin only)

### Admin Commands
- **`/admin addpoints <player> <amount>`** - Add points to a player's balance
- **`/admin subtractpoints <player> <amount>`** - Remove points from a player's balance

### Automated Features
- **Auto Profile Creation** - Profiles are automatically created for users when they interact with the bot
- **Role Rewards** - Automatically assigns roles based on point thresholds
- **Balance Change Events** - Updates roles when player balances change
- **Announcement System** - Posts public announcements for gambling and donations

## Setup Instructions

### Prerequisites
- Node.js (v16.9.0 or higher)
- MongoDB database
- Discord Bot Token
- Discord Application Client ID

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd bot-hosting
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_client_id
GUILD_ID=your_discord_guild_id
MONGODB_SRV=your_mongodb_connection_string
GAMBLING_CHANNEL_ID=channel_id_for_gambling_announcements (optional)
DONATION_CHANNEL_ID=channel_id_for_donation_announcements (optional)
```

4. Configure role rewards and daily point ranges in `globalValues.json`:
```json
{
    "dailyMin": 1000,
    "dailyMax": 2000,
    "roleRequirements": [
        {
            "roleId": "role_id_here",
            "pointRequirement": 5000
        }
    ]
}
```

5. Deploy slash commands:
```bash
node deploy-commands.js
```

6. Start the bot:
```bash
node index.js
```

## Project Structure

```
bot-hosting/
├── commands/           # Slash command implementations
│   ├── admin.js       # Admin commands
│   ├── balance.js     # Balance viewing
│   ├── daily.js       # Daily point claims
│   ├── donate.js      # Point donations
│   ├── gamble.js      # Gambling functionality
│   ├── leaderboard.js # Leaderboard display
│   └── commandMenu.js # Interactive command menu
├── events/            # Discord event handlers
│   ├── ready.js       # Bot ready event
│   ├── interactionCreate.js # Interaction handling
│   └── balanceChange.js     # Balance change events
├── models/            # MongoDB schemas
│   └── profileSchema.js # User profile schema
├── utils/             # Utility functions
│   ├── dbUtils.js     # Database transaction utilities
│   └── interactionHelper.js # Interaction helpers
├── index.js           # Main bot entry point
├── deploy-commands.js # Command deployment script
└── globalValues.json  # Configuration values
```

## Database Schema

### Profile Schema
```javascript
{
    userId: String,      // Discord user ID (unique)
    serverID: String,    // Discord server ID
    balance: Number,     // User's point balance (default: 100)
    lastDaily: Number    // Timestamp of last daily claim (default: 0)
}
```

## Configuration

### Role Requirements
Configure automatic role assignments in `globalValues.json`. Users receive roles when their balance reaches specified thresholds:

```json
"roleRequirements": [
    {
        "roleId": "1437171794518737088",
        "pointRequirement": 5000
    }
]
```

### Daily Points
Set the range for daily point rewards:
```json
"dailyMin": 1000,
"dailyMax": 2000
```

## Development

### Code Style
- Use consistent error handling with try-catch blocks
- Follow existing patterns for interaction replies (handle deferred/replied states)
- Use ephemeral messages for error states and sensitive information
- Implement proper MongoDB transaction support where applicable

### Adding New Commands
1. Create a new file in `/commands/` directory
2. Export an object with `data` (SlashCommandBuilder) and `execute` function
3. Restart bot or redeploy commands

Example:
```javascript
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mycommand')
        .setDescription('My command description'),
    async execute(interaction, profileData, opts = {}) {
        // Command logic here
    },
};
```

## Error Handling

The bot includes comprehensive error handling:
- Database connection errors are logged
- Failed interactions are caught and reported
- Ephemeral error messages for user-facing issues
- Fallback mechanisms for transaction failures

## Security Features

- Admin commands require Administrator permissions
- Atomic database transactions for point transfers
- Input validation for all user inputs
- Protection against self-donations
- Balance verification before transactions

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

ISC

## Support

For issues or questions, please open an issue on the repository.
