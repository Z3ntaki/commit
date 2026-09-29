require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const sharp = require('sharp');
const express = require('express');
const db = require('./database');
const { generateLeaderboardImage } = require('./imageGenerator');

const leaderboardCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Commit Bot is running!');
});

app.get('/auth/github/callback', async (req, res) => {
    const code = req.query.code;
    const stateStr = req.query.state || '';
    const [discordId, guildId] = stateStr.split('___');

    if (!code || !discordId) {
        return res.status(400).send('Invalid request: Missing code or state');
    }

    try {
        // Exchange code for access token
        const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code: code
        }, {
            headers: { Accept: 'application/json' }
        });

        const accessToken = tokenResponse.data.access_token;
        if (!accessToken) {
            return res.status(400).send('Authentication failed: Could not get access token');
        }

        // Fetch user profile from GitHub
        const userResponse = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const githubUsername = userResponse.data.login;

        // Save directly to the Database!
        await db.addVerifiedUser(discordId, githubUsername);
        
        // If they verified inside a server, add them to that server's leaderboard automatically
        if (guildId && guildId !== 'undefined' && guildId !== 'null' && guildId !== 'dm') {
            await db.addTrackedUser(guildId, null, githubUsername);
            leaderboardCache.delete(guildId); // clear cache
        }

        res.send(`<div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h1 style="color: #238636;">Verification Successful! 🎉</h1>
            <p>You have successfully linked your Discord account to GitHub user <b>${githubUsername}</b>.</p>
            <p>You can close this tab and return to Discord to use <code>/me</code>!</p>
        </div>`);
    } catch (err) {
        console.error('OAuth Error:', err.response?.data || err.message);
        res.status(500).send('An error occurred during verification.');
    }
});

app.listen(port, () => {
    console.log(`Web server listening on port ${port}`);
});

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
        name: 'graph',
        description: 'View a GitHub user\'s contribution graph.',
        options: [
            {
                name: 'username',
                description: 'The GitHub username to view',
                type: 3,
                required: true,
            }
        ]
    },
    {
        name: 'leaderboard',
        description: 'View the leaderboard for tracked GitHub commits.',
        options: [
            {
                name: 'type',
                description: 'Which leaderboard to view (server or global)',
                type: 3,
                required: false,
                choices: [
                    { name: 'Server', value: 'server' },
                    { name: 'Global', value: 'global' }
                ]
            }
        ]
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

// --- GitHub Polling Logic Removed per user request ---

client.on('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log(`Bot is ready!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply('Pong! 🏓 The bot is online.');
    }

    if (interaction.commandName === 'graph') {
        await interaction.deferReply();
        const username = interaction.options.getString('username');
        
        try {
            // Fetch SVG Graph
            const svgResponse = await axios.get(`https://ghchart.rshah.org/${username}`);
            let svgString = svgResponse.data;
            
            // Convert Light Mode SVG to GitHub Dark Mode
            svgString = svgString.replace(/#eeeeee|#ebedf0/gi, '#161b22'); // Empty
            svgString = svgString.replace(/#c6e48b|#9be9a8/gi, '#0e4429'); // L1
            svgString = svgString.replace(/#7bc96f|#40c463/gi, '#006d32'); // L2
            svgString = svgString.replace(/#239a3b|#30a14e/gi, '#26a641'); // L3
            svgString = svgString.replace(/#196127|#216e39/gi, '#39d353'); // L4
            svgString = svgString.replace(/#767676/gi, '#c9d1d9'); // Text
            
            const svgBuffer = Buffer.from(svgString);
            
            // Convert to PNG with dark background
            const pngBuffer = await sharp(svgBuffer).flatten({ background: '#0d1117' }).png().toBuffer();
            const attachment = new AttachmentBuilder(pngBuffer, { name: 'chart.png' });
            
            // Fetch basic profile info for extra details
            const headers = {};
            if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
            const profileResponse = await axios.get(`https://api.github.com/users/${username}`, { headers });
            const profile = profileResponse.data;
            
            const embed = new EmbedBuilder()
                .setColor('#238636')
                .setAuthor({ name: `${profile.login}'s GitHub Activity`, iconURL: profile.avatar_url, url: profile.html_url })
                .setThumbnail(profile.avatar_url)
                .setDescription(profile.bio ? `*${profile.bio}*` : '')
                .addFields(
                    { name: '📦 Repos', value: `${profile.public_repos}`, inline: true },
                    { name: '👥 Followers', value: `${profile.followers}`, inline: true },
                    { name: '🏢 Company', value: profile.company || 'None', inline: true }
                )
                .setImage('attachment://chart.png');
                
            await interaction.editReply({ embeds: [embed], files: [attachment] });
        } catch (err) {
            console.error(err);
            await interaction.editReply(`❌ Could not generate graph for **${username}**. Make sure the username is correct or try again later.`);
        }
    }



    if (interaction.commandName === 'leaderboard') {
        await interaction.deferReply();
        try {
            const type = interaction.options.getString('type') || 'server';
            const isGlobal = type === 'global';

            if (!isGlobal && !interaction.guildId) {
                return interaction.editReply('❌ This command can only be used in a server.');
            }

            const cacheKey = isGlobal ? 'global_leaderboard' : interaction.guildId;

            if (!process.env.GITHUB_TOKEN) {
                return interaction.editReply('❌ The bot owner needs to set GITHUB_TOKEN in the environment variables (using a GitHub Personal Access Token) to use the true leaderboard.');
            }

            if (leaderboardCache.has(cacheKey)) {
                const cached = leaderboardCache.get(cacheKey);
                if (Date.now() - cached.timestamp < CACHE_TTL) {
                    const attachment = new AttachmentBuilder(cached.imageBuffer, { name: 'leaderboard.png' });
                    const embed = new EmbedBuilder()
                        .setColor('#0d1117')
                        .setImage('attachment://leaderboard.png')
                        .setFooter({ text: 'Run /verify to join the leaderboard! (Cached)' });
                    return interaction.editReply({ embeds: [embed], files: [attachment] });
                }
            }

            let serverUsers = [];

            if (isGlobal) {
                const allVerified = await db.getAllVerifiedUsers();
                if (allVerified.length === 0) {
                    return interaction.editReply('❌ Nobody has verified their GitHub account yet!');
                }
                serverUsers = allVerified.map(u => ({ github_username: u.github_username }));
            } else {
                // 1. Get tracked users for this specific server directly from the database
                let trackedUsers = await db.getTrackedUsersByGuild(interaction.guildId);
                const trackedUsernames = new Set(trackedUsers.map(u => u.github_username));
                
                // 2. Auto-sync: Check if there are globally verified users in this server who aren't tracked yet
                const allVerified = await db.getAllVerifiedUsers();
                const missingVerified = allVerified.filter(u => !trackedUsernames.has(u.github_username));
                
                if (missingVerified.length > 0) {
                    let addedNew = false;
                    await Promise.all(missingVerified.map(async (u) => {
                        try {
                            const member = await interaction.guild.members.fetch(u.discord_id);
                            if (member) {
                                await db.addTrackedUser(interaction.guildId, null, u.github_username);
                                trackedUsers.push(u);
                                addedNew = true;
                            }
                        } catch (err) {
                            // User not in server or fetch blocked
                        }
                    }));
                    if (addedNew) {
                        leaderboardCache.delete(interaction.guildId); // force fresh image gen
                    }
                }
                
                if (trackedUsers.length === 0) {
                    return interaction.editReply('❌ Nobody in this server is on the leaderboard yet! Run `/verify` to join.');
                }

                // 3. Map to the expected format
                serverUsers = trackedUsers.map(u => ({
                    github_username: u.github_username
                }));
            }

            const leaderboardData = [];
            const CHUNK_SIZE = 20;
            const MAX_CONCURRENT = 3;
            const fetchPromises = [];

            for (let i = 0; i < serverUsers.length; i += CHUNK_SIZE) {
                const chunk = serverUsers.slice(i, i + CHUNK_SIZE);
                let queryFields = '';
                chunk.forEach((user, index) => {
                    queryFields += `
                      user_${index}: user(login: "${user.github_username}") {
                        avatarUrl
                        contributionsCollection {
                          contributionCalendar {
                            totalContributions
                            weeks {
                              contributionDays {
                                contributionCount
                                date
                              }
                            }
                          }
                        }
                      }
                    `;
                });

                fetchPromises.push(() => axios.post(
                    'https://api.github.com/graphql',
                    { query: `query { ${queryFields} }` },
                    { headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}` } }
                ).then(res => ({ data: res.data.data, chunk })));
            }

            try {
                const results = [];
                for (let i = 0; i < fetchPromises.length; i += MAX_CONCURRENT) {
                    const batch = fetchPromises.slice(i, i + MAX_CONCURRENT).map(f => f());
                    const batchResults = await Promise.all(batch);
                    results.push(...batchResults);
                }
                
                for (const res of results) {
                    const data = res.data;
                    if (!data) continue;

                    res.chunk.forEach((user, index) => {
                        const userData = data[`user_${index}`];
                        if (userData && userData.contributionsCollection) {
                            const calendar = userData.contributionsCollection.contributionCalendar;
                            
                            // Calculate streak
                            let days = [];
                            calendar.weeks.forEach(w => {
                                w.contributionDays.forEach(d => days.push(d));
                            });
                            
                            let currentStreak = 0;
                            for (let j = days.length - 1; j >= 0; j--) {
                                const count = days[j].contributionCount;
                                // Ignore today if 0 since day isn't over
                                if (j === days.length - 1 && count === 0) continue;
                                if (count > 0) currentStreak++;
                                else break; // Streak broken
                            }

                            leaderboardData.push({
                                github_username: user.github_username,
                                avatar_url: userData.avatarUrl,
                                commits: calendar.totalContributions,
                                streak: currentStreak
                            });
                        }
                    });
                }
            } catch (err) {
                console.error('GraphQL Batch Error:', err.message);
            }

            if (leaderboardData.length === 0) {
                return interaction.editReply('❌ Failed to fetch leaderboard data. Your GITHUB_TOKEN might be invalid or expired.');
            }

            // 4. Sort by commits descending and grab the top 10
            leaderboardData.sort((a, b) => b.commits - a.commits);
            const top10 = leaderboardData.slice(0, 10);

            // 5. Build the beautiful image!
            const guildName = isGlobal ? 'GLOBAL' : (interaction.guild ? interaction.guild.name : 'this server');
            const imageBuffer = await generateLeaderboardImage(guildName, top10);
            
            // Save to cache
            leaderboardCache.set(cacheKey, {
                timestamp: Date.now(),
                imageBuffer: imageBuffer
            });

            const attachment = new AttachmentBuilder(imageBuffer, { name: 'leaderboard.png' });
            
            const embed = new EmbedBuilder()
                .setColor('#0d1117')
                .setImage('attachment://leaderboard.png')
                .setFooter({ text: 'Run /verify to join the leaderboard!' });

            await interaction.editReply({ embeds: [embed], files: [attachment] });
        } catch (error) {
            console.error('Leaderboard error:', error);
            await interaction.editReply(`❌ An unexpected error occurred: ${error.message || error}`);
        }
    }

    if (interaction.commandName === 'verify') {
        // First check if they are already verified globally
        const verified = await db.getVerifiedUser(interaction.user.id);
        if (verified && interaction.guildId) {
            // Automatically add them to this server's leaderboard
            await db.addTrackedUser(interaction.guildId, interaction.channelId, verified.github_username);
            leaderboardCache.delete(interaction.guildId); // clear cache
            return interaction.reply({ 
                content: `✅ You are already verified globally as **${verified.github_username}**!\nI have automatically added you to this server's leaderboard.`, 
                ephemeral: true 
            });
        }

        const clientId = process.env.GITHUB_CLIENT_ID;
        
        if (!clientId) {
            return interaction.reply({ content: '❌ The bot owner has not set up the GITHUB_CLIENT_ID yet!', ephemeral: true });
        }

        let hostUrl = process.env.HOST_URL || `http://localhost:${port}`;
        if (hostUrl.endsWith('/')) hostUrl = hostUrl.slice(0, -1); // Remove trailing slash
        
        const redirectUri = encodeURIComponent(`${hostUrl}/auth/github/callback`);
        
        // Pass both user ID and guild ID in the state so we know where to add them after OAuth
        const guildId = interaction.guildId || 'dm';
        const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&state=${interaction.user.id}___${guildId}`;
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Link GitHub Account')
                    .setURL(oauthUrl)
                    .setStyle(ButtonStyle.Link)
            );
        
        await interaction.reply({
            content: `🔒 **Verify your GitHub Account**\n\nClick the button below to securely log in with GitHub. This will permanently link your Discord account to your GitHub profile!`,
            components: [row],
            ephemeral: true 
        });
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
            let svgString = svgResponse.data;
            
            // Convert Light Mode SVG to GitHub Dark Mode
            svgString = svgString.replace(/#eeeeee|#ebedf0/gi, '#161b22'); // Empty
            svgString = svgString.replace(/#c6e48b|#9be9a8/gi, '#0e4429'); // L1
            svgString = svgString.replace(/#7bc96f|#40c463/gi, '#006d32'); // L2
            svgString = svgString.replace(/#239a3b|#30a14e/gi, '#26a641'); // L3
            svgString = svgString.replace(/#196127|#216e39/gi, '#39d353'); // L4
            svgString = svgString.replace(/#767676/gi, '#c9d1d9'); // Text
            
            const svgBuffer = Buffer.from(svgString);
            
            // Convert to PNG with dark background
            const pngBuffer = await sharp(svgBuffer).flatten({ background: '#0d1117' }).png().toBuffer();
            const attachment = new AttachmentBuilder(pngBuffer, { name: 'chart.png' });
            
            // Fetch basic profile info
            const headers = {};
            if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
            const response = await axios.get(`https://api.github.com/users/${verified.github_username}`, { headers });
            const profile = response.data;
            
            const embed = new EmbedBuilder()
                .setColor('#238636')
                .setAuthor({ name: `${profile.login}'s Verified Profile`, iconURL: profile.avatar_url, url: profile.html_url })
                .setThumbnail(profile.avatar_url)
                .setDescription(profile.bio ? `*${profile.bio}*` : '')
                .addFields(
                    { name: '📦 Public Repos', value: `${profile.public_repos}`, inline: true },
                    { name: '👥 Followers', value: `${profile.followers}`, inline: true },
                    { name: '⭐ Following', value: `${profile.following}`, inline: true }
                )
                .setImage('attachment://chart.png')
                .setFooter({ text: 'Linked via Commit Tracker' });
                
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
