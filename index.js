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
            
            const embed = new EmbedBuilder()
                .setColor('#238636')
                .setTitle(`Now tracking: ${username}`)
                .setDescription(`✅ Successfully started tracking **${username}** in this channel!\n\nHere is their recent activity:`)
                .setImage('attachment://chart.png');
                
            await interaction.editReply({ embeds: [embed], files: [attachment] });
        } catch (err) {
            console.error(err);
            // Fallback if the graph API fails
            await interaction.editReply(`✅ Now tracking GitHub user **${username}** in this channel! New commits will be posted here.`);
        }
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
