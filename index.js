require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const sharp = require('sharp');
const express = require('express');
const db = require('./database');

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Commit Bot is running!');
});

app.get('/auth/github/callback', async (req, res) => {
    const code = req.query.code;
    const discordId = req.query.state; // We passed their Discord ID in the state parameter

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

    if (interaction.commandName === 'track') {
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
            if (process.env.GITHUB_TOKEN) headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
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
        
        // 1. Get all verified users globally
        const allVerified = await db.getAllVerifiedUsers();
        
        if (allVerified.length === 0) {
            return interaction.editReply('❌ Nobody has verified their GitHub account yet! Run `/verify` to link your account.');
        }

        // 2. Filter to only users who are in this specific Discord server
        // We fetch each user individually to avoid needing the privileged GUILD_MEMBERS intent!
        const serverUsers = [];
        await Promise.all(allVerified.map(async (u) => {
            try {
                await interaction.guild.members.fetch(u.discord_id);
                serverUsers.push(u); // If fetch succeeds, they are in the server
            } catch (err) {
                // If it fails, they are not in this server, ignore them
            }
        }));

        if (serverUsers.length === 0) {
            return interaction.editReply('❌ No verified GitHub users are in this server yet.');
        }

        if (!process.env.GITHUB_TOKEN) {
            return interaction.editReply('❌ The bot owner needs to set GITHUB_TOKEN to use the true leaderboard.');
        }

        const leaderboardData = [];

        // 3. Batch GraphQL queries (up to 20 users per request) for lightning-fast speeds
        const CHUNK_SIZE = 20;
        for (let i = 0; i < serverUsers.length; i += CHUNK_SIZE) {
            const chunk = serverUsers.slice(i, i + CHUNK_SIZE);
            
            let queryFields = '';
            chunk.forEach((user, index) => {
                queryFields += `
                  user_${index}: user(login: "${user.github_username}") {
                    contributionsCollection {
                      contributionCalendar {
                        totalContributions
                      }
                    }
                  }
                `;
            });

            try {
                const res = await axios.post(
                    'https://api.github.com/graphql',
                    { query: `query { ${queryFields} }` },
                    { headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}` } }
                );

                const data = res.data.data;
                if (!data) continue;

                chunk.forEach((user, index) => {
                    const userData = data[`user_${index}`];
                    if (userData) {
                        leaderboardData.push({
                            discord_id: user.discord_id,
                            github_username: user.github_username,
                            commits: userData.contributionsCollection.contributionCalendar.totalContributions
                        });
                    }
                });
            } catch (err) {
                console.error('GraphQL Batch Error:', err.message);
            }
        }

        // 4. Sort by commits descending and grab the top 10
        leaderboardData.sort((a, b) => b.commits - a.commits);
        const top10 = leaderboardData.slice(0, 10);

        // 5. Build the beautiful embed
        const embed = new EmbedBuilder()
            .setColor('#238636')
            .setTitle(`🏆 Server GitHub Leaderboard`)
            .setDescription(`Top open-source contributors in **${interaction.guild.name}** over the last year!\n\n` + 
                top10.map((user, index) => {
                    let medal = '🏅';
                    if (index === 0) medal = '🥇';
                    if (index === 1) medal = '🥈';
                    if (index === 2) medal = '🥉';
                    
                    return `${medal} **${index + 1}.** <@${user.discord_id}> (${user.github_username})\n└ 💻 **${user.commits.toLocaleString()}** contributions`;
                }).join('\n\n')
            )
            .setFooter({ text: 'Run /verify to join the leaderboard!' });

        await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'verify') {
        const clientId = process.env.GITHUB_CLIENT_ID;
        
        if (!clientId) {
            return interaction.reply({ content: '❌ The bot owner has not set up the GITHUB_CLIENT_ID yet!', ephemeral: true });
        }

        let hostUrl = process.env.HOST_URL || `http://localhost:${port}`;
        if (hostUrl.endsWith('/')) hostUrl = hostUrl.slice(0, -1); // Remove trailing slash
        
        const redirectUri = encodeURIComponent(`${hostUrl}/auth/github/callback`);
        
        const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&state=${interaction.user.id}`;
        
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
            if (process.env.GITHUB_TOKEN) headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
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
