require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

// Initialize the Discord client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

// Basic commands for the bot
const commands = [
    {
        name: 'ping',
        description: 'Replies with Pong and confirms the bot is online!',
    },
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        // Only attempt to register commands if a real token is provided
        if (process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN !== 'your_bot_token_here') {
             await rest.put(
                 Routes.applicationCommands(process.env.CLIENT_ID),
                 { body: commands },
             );
             console.log('Successfully reloaded application (/) commands.');
        } else {
             console.log('⚠️ DISCORD_TOKEN is missing or invalid. Please update your .env file with your bot token from the Discord Developer Portal.');
        }
    } catch (error) {
        console.error('Error refreshing commands:', error);
    }
})();

client.on('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log(`Bot is ready to start tracking commits!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply('Pong! 🏓 The commit tracker bot is online.');
    }
});

// Start the bot if a token is provided
if (process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN !== 'your_bot_token_here') {
    client.login(process.env.DISCORD_TOKEN);
} else {
    console.log('Bot login skipped because no valid token was found.');
}
