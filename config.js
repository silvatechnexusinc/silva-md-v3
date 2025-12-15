module.exports = {
    // Session & Authentication
    SESSION_ID: process.env.SESSION_ID || '',
    PREFIX: process.env.PREFIX || '.',
    BOT_NAME: process.env.BOT_NAME || 'Silva MD',
    OWNER_NUMBER: process.env.OWNER_NUMBER || '',
    
    // Bot Settings
    BOT_MODE: process.env.BOT_MODE || 'public', // public, private
    DEBUG_MODE: process.env.DEBUG_MODE === 'true',
    AUTO_READ: process.env.AUTO_READ !== 'false',
    AUTO_TYPING: process.env.AUTO_TYPING === 'true',
    AUTO_REPLY: process.env.AUTO_REPLY === 'true',
    
    // Status Handler Settings
    AUTO_VIEW_STATUS: process.env.AUTO_VIEW_STATUS === 'true',
    AUTO_LIKE_STATUS: process.env.AUTO_LIKE_STATUS === 'true',
    AUTO_LIKE_EMOJI: process.env.AUTO_LIKE_EMOJI ? 
        process.env.AUTO_LIKE_EMOJI.split(',') : ['❤️', '😍', '🔥'],
    STATUS_REQUEST_KEYWORDS: process.env.STATUS_REQUEST_KEYWORDS ? 
        process.env.STATUS_REQUEST_KEYWORDS.split(',') : ['status', 'story', 'stories'],
    
    // Antidelete Settings
    ANTI_DELETE: process.env.ANTI_DELETE === 'true',
    ANTI_DELETE_GROUP: process.env.ANTI_DELETE_GROUP === 'true',
    ANTI_DELETE_PRIVATE: process.env.ANTI_DELETE_PRIVATE === 'true',
    
    // Newsletter Settings
    NEWSLETTER_JIDS: process.env.NEWSLETTER_JIDS ? 
        process.env.NEWSLETTER_JIDS.split(',') : [],
    AUTO_FOLLOW_NEWSLETTER: process.env.AUTO_FOLLOW_NEWSLETTER === 'true',
    
    // Plugin Settings
    PLUGINS_DIR: process.env.PLUGINS_DIR || 'silvaxlab',
    
    // Allowed Users (for private mode)
    ALLOWED_USERS: process.env.ALLOWED_USERS ? 
        process.env.ALLOWED_USERS.split(',') : [],
    
    // Bot Info
    VERSION: '3.0.0',
    AUTHOR: 'Silva Tech Nexus',
    GITHUB: 'https://github.com/SilvaTechB/silva-md-bot',
    
    // Messages
    MESSAGES: {
        groupOnly: '⚠️ This command only works in groups.',
        adminOnly: '⚠️ This command requires admin privileges.',
        ownerOnly: '⚠️ This command is only for the bot owner.'
    }
};
