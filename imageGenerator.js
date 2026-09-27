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
    const listStartY = 330;
    const rowHeight = 60;
    const height = Math.max(listStartY + (Math.max(0, topUsers.length - 3)) * rowHeight + 40, 350);
    
    let svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#090c10" />
                <stop offset="100%" stop-color="#161b22" />
            </linearGradient>
            <clipPath id="circleClip"><circle cx="50" cy="50" r="50"/></clipPath>
            <clipPath id="circleClipSm"><circle cx="40" cy="40" r="40"/></clipPath>
            <clipPath id="circleClipRow"><circle cx="20" cy="20" r="20"/></clipPath>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#bg)" rx="20" />
        
        <text x="400" y="65" font-family="Arial, sans-serif" font-size="42" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="2">
            🏆 GITHUB LEADERBOARD
        </text>
        <text x="400" y="100" font-family="Arial, sans-serif" font-size="20" fill="#8b949e" text-anchor="middle" font-weight="bold">
            ${(guildName || 'SERVER').toUpperCase()}
        </text>
    `;

    // 1st Place
    if (topUsers[0]) {
        svg += `
            <g transform="translate(350, 130)">
                <text x="50" y="-15" font-family="Arial, sans-serif" font-size="24" font-weight="900" fill="#ffd700" text-anchor="middle">1ST</text>
                <circle cx="50" cy="50" r="54" fill="#ffd700" />
                <image href="${allAvatars[0]}" width="100" height="100" clip-path="url(#circleClip)" />
                <text x="50" y="135" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#ffd700" text-anchor="middle">${topUsers[0].github_username}</text>
                <text x="50" y="160" font-family="Arial, sans-serif" font-size="18" fill="#c9d1d9" text-anchor="middle">${topUsers[0].commits.toLocaleString()} commits</text>
            </g>
        `;
    }

    // 2nd Place
    if (topUsers[1]) {
        svg += `
            <g transform="translate(200, 160)">
                <text x="40" y="-15" font-family="Arial, sans-serif" font-size="18" font-weight="900" fill="#c0c0c0" text-anchor="middle">2ND</text>
                <circle cx="40" cy="40" r="44" fill="#c0c0c0" />
                <image href="${allAvatars[1]}" width="80" height="80" clip-path="url(#circleClipSm)" />
                <text x="40" y="110" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#c0c0c0" text-anchor="middle">${topUsers[1].github_username}</text>
                <text x="40" y="130" font-family="Arial, sans-serif" font-size="14" fill="#c9d1d9" text-anchor="middle">${topUsers[1].commits.toLocaleString()} commits</text>
            </g>
        `;
    }

    // 3rd Place
    if (topUsers[2]) {
        svg += `
            <g transform="translate(520, 160)">
                <text x="40" y="-15" font-family="Arial, sans-serif" font-size="18" font-weight="900" fill="#cd7f32" text-anchor="middle">3RD</text>
                <circle cx="40" cy="40" r="44" fill="#cd7f32" />
                <image href="${allAvatars[2]}" width="80" height="80" clip-path="url(#circleClipSm)" />
                <text x="40" y="110" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#cd7f32" text-anchor="middle">${topUsers[2].github_username}</text>
                <text x="40" y="130" font-family="Arial, sans-serif" font-size="14" fill="#c9d1d9" text-anchor="middle">${topUsers[2].commits.toLocaleString()} commits</text>
            </g>
        `;
    }

    // 4th-10th Places
    for (let i = 3; i < topUsers.length; i++) {
        const u = topUsers[i];
        const yPos = listStartY + ((i - 3) * rowHeight);
        svg += `
            <g transform="translate(50, ${yPos})">
                <rect width="700" height="50" fill="#21262d" rx="10" />
                <text x="30" y="32" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#8b949e" text-anchor="middle">${i + 1}</text>
                <g transform="translate(60, 5)">
                    <image href="${allAvatars[i]}" width="40" height="40" clip-path="url(#circleClipRow)" />
                </g>
                <text x="120" y="32" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#c9d1d9">${u.github_username}</text>
                <text x="670" y="32" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#39d353" text-anchor="end">${u.commits.toLocaleString()} commits</text>
            </g>
        `;
    }

    svg += `</svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { generateLeaderboardImage };
