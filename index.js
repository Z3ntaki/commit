require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const sharp = require('sharp');
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
        description: 'Track a GitHub user\'s commits in this channel (No verification needed).',
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
        description: 'Verify your GitHub account to link it to your Discord profile.',
        options: [
            {
                name: 'username',
                description: 'The GitHub username you want to verify (leave blank if checking pending verification)',
                type: 3,
                required: false,
            }
        ]
    },
    {
        name: 'me',
        description: 'View your verified GitHub profile card and contribution graph.',
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
        await db.addTrackedUser(interaction.guildId, interaction.channelId, username);
        await interaction.reply(`✅ Now tracking GitHub user **${username}** in this channel! New commits will be posted here.`);
    }

    if (interaction.commandName === 'untrack') {
        const username = interaction.options.getString('username');
        await db.removeTrackedUser(interaction.guildId, username);
        await interaction.reply(`🛑 Stopped tracking GitHub user **${username}**.`);
    }

    if (interaction.commandName === 'leaderboard') {
        await interaction.deferReply();
        const users = await db.getTrackedUsersByGuild(interaction.guildId);
        
        if (users.length === 0) {
            return interaction.editReply('No users are currently being tracked in this server. Use `/track <username>` to start!');
        }

        const verifiedUsers = await db.getAllVerifiedUsers();
        const verifiedMap = {};
        for (const v of verifiedUsers) {
            verifiedMap[v.github_username] = v.discord_id;
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏆 Server Commit Leaderboard`)
            .setColor('#FFD700')
            .setDescription(
                users.map((u, i) => {
                    const discordPing = verifiedMap[u.github_username] ? `(<@${verifiedMap[u.github_username]}>)` : '';
                    return `**${i + 1}.** [${u.github_username}](https://github.com/${u.github_username}) - ${u.commit_count} commits ${discordPing}`;
                }).join('\n')
            );

        await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'verify') {
        const usernameInput = interaction.options.getString('username');
        
        if (usernameInput) {
            const code = `commit-bot-${Math.floor(1000 + Math.random() * 9000)}`;
            await db.setPendingVerification(interaction.user.id, usernameInput, code);
            return interaction.reply({
                content: `🔒 **Verification Required for \`${usernameInput}\`**\nTo prove you own this GitHub account, please add the following code to your GitHub profile bio:\n\n\`${code}\`\n\nOnce you have saved your bio, run the \`/verify\` command (without arguments) here!`,
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });
        const pending = await db.getPendingVerification(interaction.user.id);
        
        if (!pending) {
            return interaction.editReply('❌ You don\'t have a pending verification. Run `/verify <username>` first.');
        }

        try {
            const response = await axios.get(`https://api.github.com/users/${pending.github_username}`);
            const bio = response.data.bio || '';

            if (bio.includes(pending.verification_code)) {
                await db.addVerifiedUser(pending.discord_id, pending.github_username);
                await db.deletePendingVerification(pending.discord_id);
                return interaction.editReply('✅ **Verification successful!** Your Discord account is now permanently linked. Try running `/me`!');
            } else {
                return interaction.editReply(`❌ The verification code \`${pending.verification_code}\` was not found in the bio for **${pending.github_username}**.\n\nPlease make sure you saved it and try again.`);
            }
        } catch (err) {
            console.error(err);
            return interaction.editReply(`❌ Error checking GitHub API. Make sure the username **${pending.github_username}** is correct.`);
        }
    }

    if (interaction.commandName === 'me') {
        await interaction.deferReply();
        const verified = await db.getVerifiedUser(interaction.user.id);
        
        if (!verified) {
            return interaction.editReply('❌ You have not verified your GitHub account! Run `/verify <username>` first.');
        }

        try {
            // Fetch SVG Graph
            const svgResponse = await axios.get(`https://ghchart.rshah.org/${verified.github_username}`);
            const svgBuffer = Buffer.from(svgResponse.data);
            
            // Convert to PNG 
            const pngBuffer = await sharp(svgBuffer).png().toBuffer();
            const attachment = new AttachmentBuilder(pngBuffer, { name: 'chart.png' });
            
            // Fetch basic profile info
            const response = await axios.get(`https://api.github.com/users/${verified.github_username}`);
            const profile = response.data;
            
            const embed = new EmbedBuilder()
                .setColor('#238636')
                .setAuthor({ name: verified.github_username, iconURL: profile.avatar_url, url: `https://github.com/${verified.github_username}` })
                .setTitle(`${profile.name || verified.github_username}'s GitHub Profile`)
                .setDescription(`**Public Repos:** ${profile.public_repos}\n**Followers:** ${profile.followers}\n**Bio:** ${profile.bio || 'None'}`)
                .setImage('attachment://chart.png')
                .setFooter({ text: 'Contribution Graph (Last Year)' });
                
            await interaction.editReply({ embeds: [embed], files: [attachment] });
        } catch (err) {
            console.error(err);
            return interaction.editReply('❌ Failed to fetch your GitHub data or generate the graph. The API might be down.');
        }
    }
});

if (process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN !== 'your_bot_token_here') {
    client.login(process.env.DISCORD_TOKEN);
} else {
    console.log('Bot login skipped because no valid token was found.');
}
