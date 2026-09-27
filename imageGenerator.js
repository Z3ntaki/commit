const sharp = require('sharp');
const axios = require('axios');

async function fetchBase64Image(url) {
    if (!url) return '';
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:image/png;base64,${Buffer.from(response.data).toString('base64')}`;
    } catch (e) {
        return '';
    }
}

async function generateLeaderboardImage(guildName, topUsers) {
    const allAvatars = await Promise.all(topUsers.map(u => fetchBase64Image(u.avatar_url)));
    
    const width = 800;
    const rowHeight = 60;
    const listStartY = 130;
    const height = listStartY + (topUsers.length * rowHeight) + 30;
    
    let svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#090c10" />
                <stop offset="100%" stop-color="#161b22" />
            </linearGradient>
            <clipPath id="circleClipRow"><circle cx="20" cy="20" r="20"/></clipPath>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#bg)" rx="20" />
        
        <text x="400" y="60" font-family="Arial, sans-serif" font-size="38" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="2">
            🏆 GITHUB LEADERBOARD
        </text>
        <text x="400" y="95" font-family="Arial, sans-serif" font-size="18" fill="#8b949e" text-anchor="middle" font-weight="bold">
            ${(guildName || 'SERVER').toUpperCase()}
        </text>
    `;

    // Generate rows for all users
    for (let i = 0; i < topUsers.length; i++) {
        const u = topUsers[i];
        const yPos = listStartY + (i * rowHeight);
        
        // Colors for top 3
        let rankColor = '#8b949e';
        if (i === 0) rankColor = '#ffd700';
        else if (i === 1) rankColor = '#c0c0c0';
        else if (i === 2) rankColor = '#cd7f32';

        svg += `
            <g transform="translate(40, ${yPos})">
                <rect width="720" height="50" fill="#21262d" rx="10" />
                
                <text x="40" y="32" font-family="Arial, sans-serif" font-size="22" font-weight="900" fill="${rankColor}" text-anchor="middle">${i + 1}</text>
                
                <g transform="translate(80, 5)">
                    <image href="${allAvatars[i]}" width="40" height="40" clip-path="url(#circleClipRow)" />
                </g>
                
                <text x="140" y="32" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#c9d1d9">${u.github_username}</text>
                
                <text x="690" y="32" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#39d353" text-anchor="end">${u.commits.toLocaleString()} commits</text>
            </g>
        `;
    }

    svg += `</svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { generateLeaderboardImage };
