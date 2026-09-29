require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'placeholder_key';
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = {
    // Pending verification codes
    setPendingVerification: async (discordId, githubUsername, code) => {
        const { error } = await supabase
            .from('pending_verifications')
            .upsert({ 
                discord_id: discordId, 
                github_username: githubUsername, 
                verification_code: code
            });
        if (error) console.error('Error setting pending verification:', error);
    },
    getPendingVerification: async (discordId) => {
        const { data, error } = await supabase
            .from('pending_verifications')
            .select('*')
            .eq('discord_id', discordId)
            .single();
        if (error && error.code !== 'PGRST116') console.error('Error getting pending verification:', error);
        return data;
    },
    deletePendingVerification: async (discordId) => {
        const { error } = await supabase
            .from('pending_verifications')
            .delete()
            .eq('discord_id', discordId);
        if (error) console.error('Error deleting pending verification:', error);
    },

    // Global Verified Users
    addVerifiedUser: async (discordId, githubUsername) => {
        const { error } = await supabase
            .from('verified_users')
            .upsert({ discord_id: discordId, github_username: githubUsername });
        if (error) console.error('Error adding verified user:', error);
    },
    getVerifiedUser: async (discordId) => {
        const { data, error } = await supabase
            .from('verified_users')
            .select('*')
            .eq('discord_id', discordId)
            .single();
        if (error && error.code !== 'PGRST116') console.error('Error getting verified user:', error);
        return data;
    },
    getAllVerifiedUsers: async () => {
        let allData = [];
        let page = 0;
        const pageSize = 1000;
        
        while (true) {
            const { data, error } = await supabase
                .from('verified_users')
                .select('*')
                .range(page * pageSize, (page + 1) * pageSize - 1);
                
            if (error) {
                console.error('Error getting all verified users:', error);
                break;
            }
            if (!data || data.length === 0) break;
            
            allData = allData.concat(data);
            if (data.length < pageSize) break;
            page++;
        }
        return allData;
    },

    // Per-server Tracked Users
    addTrackedUser: async (guildId, channelId, githubUsername) => {
        const { error } = await supabase
            .from('tracked_users')
            .upsert({ 
                guild_id: guildId, 
                channel_id: channelId, 
                github_username: githubUsername
            }, { onConflict: 'guild_id,github_username' });
        
        if (error) console.error('Error adding tracked user:', error);
    },
    removeTrackedUser: async (guildId, githubUsername) => {
        const { error } = await supabase
            .from('tracked_users')
            .delete()
            .eq('guild_id', guildId)
            .eq('github_username', githubUsername);
        if (error) console.error('Error removing tracked user:', error);
    },
    getTrackedUsersByGuild: async (guildId) => {
        const { data, error } = await supabase
            .from('tracked_users')
            .select('*')
            .eq('guild_id', guildId)
            .order('commit_count', { ascending: false });
        if (error) console.error('Error getting tracked users by guild:', error);
        return data || [];
    },
    getAllTrackedUsers: async () => {
        const { data, error } = await supabase
            .from('tracked_users')
            .select('*');
        if (error) console.error('Error getting all tracked users:', error);
        return data || [];
    },
    updateUserCommitData: async (id, lastEventId, commitsAdded) => {
        const { data: user, error: fetchError } = await supabase
            .from('tracked_users')
            .select('commit_count')
            .eq('id', id)
            .single();
            
        if (fetchError) return;

        const { error } = await supabase
            .from('tracked_users')
            .update({ 
                last_event_id: lastEventId, 
                commit_count: (user.commit_count || 0) + commitsAdded 
            })
            .eq('id', id);
            
        if (error) console.error('Error updating user commit data:', error);
    }
};
