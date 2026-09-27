require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const db = require('./database');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// Commands definition
const commands = [
    {
        name: 'ping',
        description: 'Replies with Pong and confirms the bot is online!',
    },
    {
        name: 'track',
        description: 'Track a GitHub user\'s commits in this channel.',
        options: [
            {
                name: 'username',
                description: 'The GitHub username to track',
                type: 3, // ApplicationCommandOptionType.String
                required: true,
            }
        ]
    },
    {
        name: 'untrack',
        description: 'Stop tracking a GitHub user in this server.',
        options: [
            {
                name: 'username',
                description: 'The GitHub username to untrack',
                type: 3, 
                required: true,
            }
        ]
    },
    {
        name: 'leaderboard',
        description: 'View the server leaderboard for tracked GitHub commits.',
    }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        if (process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN !== 'your_bot_token_here') {
             await rest.put(
                 Routes.applicationCommands(process.env.CLIENT_ID),
                 { body: commands },
             );
             console.log('Successfully reloaded application (/) commands.');
        }
    } catch (error) {
        console.error('Error refreshing commands:', error);
    }
})();

// --- GitHub Polling Logic ---
async function checkGitHubCommits() {
    const users = db.getAllTrackedUsers();
    
    for (const user of users) {
        try {
            const headers = {};
            if (process.env.GITHUB_TOKEN) {
                headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
            }

            const response = await axios.get(`https://api.github.com/users/${user.github_username}/events/public`, {
                headers,
                timeout: 5000
            });

            const events = response.data;
            const pushEvents = events.filter(e => e.type === 'PushEvent');

            if (pushEvents.length === 0) continue;

            const latestEvent = pushEvents[0];

            // Check if this is a new event
            if (latestEvent.id !== user.last_event_id) {
                let newCommitsAdded = 0;

                // Find all new events since last_event_id
                const newPushEvents = [];
                for (const event of pushEvents) {
                    if (event.id === user.last_event_id) break;
                    newPushEvents.push(event);
                }

                // First time tracking: just save the latest event ID to avoid spamming old commits.
                if (!user.last_event_id) {
                    db.updateUserCommitData(user.id, latestEvent.id, 0);
                    continue;
                }

                // Post embeds for new commits
                try {
                    const channel = await client.channels.fetch(user.channel_id);
                    if (channel) {
                        for (const event of newPushEvents.reverse()) {
                            const commits = event.payload.commits;
                            newCommitsAdded += commits.length;

                            for (const commit of commits) {
                                const embed = new EmbedBuilder()
                                    .setColor('#0099ff')
                                    .setAuthor({ name: user.github_username, iconURL: event.actor.avatar_url, url: `https://github.com/${user.github_username}` })
                                    .setTitle(`New Commit in ${event.repo.name}`)
                                    .setURL(`https://github.com/${event.repo.name}/commit/${commit.sha}`)
                                    .setDescription(commit.message.substring(0, 2048)) // Discord limits desc to 4096, keeping it safe
                                    .setTimestamp(new Date(event.created_at));

                                await channel.send({ embeds: [embed] });
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Failed to send message to channel ${user.channel_id}:`, err);
                }

                db.updateUserCommitData(user.id, latestEvent.id, newCommitsAdded);
            }
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log(`GitHub user ${user.github_username} not found.`);
            } else if (error.response && error.response.status === 403) {
                console.log(`GitHub API rate limit exceeded. Please add a GITHUB_TOKEN to .env`);
            } else {
                console.error(`Error fetching for ${user.github_username}:`, error.message);
            }
        }
    }
}

client.on('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log(`Bot is ready to start tracking commits!`);

    // Poll GitHub every 3 minutes (180,000 ms)
    setInterval(checkGitHubCommits, 180000);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply('Pong! 🏓 The commit tracker bot is online.');
    }

    if (interaction.commandName === 'track') {
        const username = interaction.options.getString('username');
        db.addTrackedUser(interaction.guildId, interaction.channelId, interaction.user.id, username);
        await interaction.reply(`✅ Now tracking GitHub user **${username}** in this channel! New commits will be posted here.`);
    }

    if (interaction.commandName === 'untrack') {
        const username = interaction.options.getString('username');
        db.removeTrackedUser(interaction.guildId, username);
        await interaction.reply(`🛑 Stopped tracking GitHub user **${username}**.`);
    }

    if (interaction.commandName === 'leaderboard') {
        const users = db.getTrackedUsersByGuild(interaction.guildId);
        
        if (users.length === 0) {
            return interaction.reply('No users are currently being tracked in this server. Use `/track <username>` to start!');
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏆 Server Commit Leaderboard`)
            .setColor('#FFD700')
            .setDescription(
                users.map((u, i) => `**${i + 1}.** [${u.github_username}](https://github.com/${u.github_username}) - ${u.commit_count} commits (<@${u.discord_id}>)`).join('\n')
            );

        await interaction.reply({ embeds: [embed] });
    }
});

if (process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN !== 'your_bot_token_here') {
    client.login(process.env.DISCORD_TOKEN);
} else {
    console.log('Bot login skipped because no valid token was found.');
}
