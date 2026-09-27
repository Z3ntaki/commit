const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'commit.db'));

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        github_username TEXT NOT NULL,
        last_event_id TEXT,
        commit_count INTEGER DEFAULT 0,
        UNIQUE(guild_id, github_username)
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS pending_verifications (
        discord_id TEXT PRIMARY KEY,
        github_username TEXT NOT NULL,
        verification_code TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL
    )
`);

module.exports = {
    setPendingVerification: (discordId, githubUsername, code, guildId, channelId) => {
        const stmt = db.prepare(`
            INSERT INTO pending_verifications (discord_id, github_username, verification_code, guild_id, channel_id) 
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(discord_id) 
            DO UPDATE SET github_username = excluded.github_username, verification_code = excluded.verification_code, guild_id = excluded.guild_id, channel_id = excluded.channel_id
        `);
        return stmt.run(discordId, githubUsername, code, guildId, channelId);
    },
    getPendingVerification: (discordId) => {
        const stmt = db.prepare('SELECT * FROM pending_verifications WHERE discord_id = ?');
        return stmt.get(discordId);
    },
    deletePendingVerification: (discordId) => {
        const stmt = db.prepare('DELETE FROM pending_verifications WHERE discord_id = ?');
        return stmt.run(discordId);
    },
    addTrackedUser: (guildId, channelId, discordId, githubUsername) => {
        const stmt = db.prepare(`
            INSERT INTO tracked_users (guild_id, channel_id, discord_id, github_username) 
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id, github_username) 
            DO UPDATE SET channel_id = excluded.channel_id, discord_id = excluded.discord_id
        `);
        return stmt.run(guildId, channelId, discordId, githubUsername);
    },
    removeTrackedUser: (guildId, githubUsername) => {
        const stmt = db.prepare('DELETE FROM tracked_users WHERE guild_id = ? AND github_username = ?');
        return stmt.run(guildId, githubUsername);
    },
    getTrackedUsersByGuild: (guildId) => {
        const stmt = db.prepare('SELECT * FROM tracked_users WHERE guild_id = ? ORDER BY commit_count DESC');
        return stmt.all(guildId);
    },
    getAllTrackedUsers: () => {
        const stmt = db.prepare('SELECT * FROM tracked_users');
        return stmt.all();
    },
    updateUserCommitData: (id, lastEventId, commitsAdded) => {
        const stmt = db.prepare('UPDATE tracked_users SET last_event_id = ?, commit_count = commit_count + ? WHERE id = ?');
        return stmt.run(lastEventId, commitsAdded, id);
    }
};
