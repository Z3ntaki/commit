require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'placeholder_key';
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = {
    setPendingVerification: async (discordId, githubUsername, code, guildId, channelId) => {
        const { error } = await supabase
            .from('pending_verifications')
            .upsert({ 
                discord_id: discordId, 
                github_username: githubUsername, 
                verification_code: code, 
                guild_id: guildId, 
                channel_id: channelId 
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
    addTrackedUser: async (guildId, channelId, discordId, githubUsername) => {
        // Upsert relying on unique constraint (guild_id, github_username) in Supabase
        const { error } = await supabase
            .from('tracked_users')
            .upsert({ 
                guild_id: guildId, 
                channel_id: channelId, 
                discord_id: discordId, 
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
        // Fetch current commit count before updating (to simulate SQL commit_count = commit_count + X)
        const { data: user, error: fetchError } = await supabase
            .from('tracked_users')
            .select('commit_count')
            .eq('id', id)
            .single();
            
        if (fetchError) {
             console.error('Error fetching user for commit update:', fetchError);
             return;
        }

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
