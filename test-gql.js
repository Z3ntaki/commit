require('dotenv').config();
const axios = require('axios');

async function run() {
    const serverUsers = [
        { discord_id: "123", github_username: "Z3ntaki" }
    ];

    const leaderboardData = [];
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

            console.log(res.data);
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
    console.log(leaderboardData);
}

run();
