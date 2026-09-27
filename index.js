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
                type: 3,
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
    },
    {
        name: 'verify',
        description: 'Verify your GitHub account after adding the code to your bio.',
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
    const users = await db.getAllTrackedUsers();
    
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

            if (latestEvent.id !== user.last_event_id) {
                let newCommitsAdded = 0;

                const newPushEvents = [];
                for (const event of pushEvents) {
                    if (event.id === user.last_event_id) break;
                    newPushEvents.push(event);
                }

                if (!user.last_event_id) {
                    await db.updateUserCommitData(user.id, latestEvent.id, 0);
                    continue;
                }

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
                                    .setDescription(commit.message.substring(0, 2048))
                                    .setTimestamp(new Date(event.created_at));

                                await channel.send({ embeds: [embed] });
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Failed to send message to channel ${user.channel_id}:`, err);
                }

                await db.updateUserCommitData(user.id, latestEvent.id, newCommitsAdded);
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
        const code = `commit-bot-${Math.floor(1000 + Math.random() * 9000)}`;
        
        await db.setPendingVerification(interaction.user.id, username, code, interaction.guildId, interaction.channelId);
        
        await interaction.reply({
            content: `🔒 **Verification Required for \`${username}\`**\nTo prove you own this GitHub account, please add the following code to your GitHub profile bio:\n\n\`${code}\`\n\nOnce you have saved your bio, run the \`/verify\` command here!`,
            ephemeral: true 
        });
    }

    if (interaction.commandName === 'verify') {
        await interaction.deferReply({ ephemeral: true });
        const pending = await db.getPendingVerification(interaction.user.id);
        
        if (!pending) {
            return interaction.editReply('❌ You don\'t have a pending verification. Run `/track <username>` first.');
        }

        try {
            const response = await axios.get(`https://api.github.com/users/${pending.github_username}`);
            const bio = response.data.bio || '';

            if (bio.includes(pending.verification_code)) {
                await db.addTrackedUser(pending.guild_id, pending.channel_id, pending.discord_id, pending.github_username);
                await db.deletePendingVerification(pending.discord_id);
                
                const channel = await client.channels.fetch(pending.channel_id);
                if (channel) {
                    channel.send(`✅ Now tracking GitHub user **${pending.github_username}**! Commits will be posted here.`);
                }

                return interaction.editReply('✅ **Verification successful!** You can now remove the code from your GitHub bio.');
            } else {
                return interaction.editReply(`❌ The verification code \`${pending.verification_code}\` was not found in the bio for **${pending.github_username}**.\n\nPlease make sure you saved it and try again.`);
            }
        } catch (err) {
            console.error(err);
            return interaction.editReply(`❌ Error checking GitHub API. Make sure the username **${pending.github_username}** is correct.`);
        }
    }

    if (interaction.commandName === 'untrack') {
        const username = interaction.options.getString('username');
        await db.removeTrackedUser(interaction.guildId, username);
        await interaction.reply(`🛑 Stopped tracking GitHub user **${username}**.`);
    }

    if (interaction.commandName === 'leaderboard') {
        const users = await db.getTrackedUsersByGuild(interaction.guildId);
        
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
