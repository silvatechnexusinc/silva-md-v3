const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

const config = {
    // Bot Settings
    SESSION_ID: process.env.SESSION_ID || '',
    PREFIX: process.env.PREFIX || '.',
    BOT_NAME: process.env.BOT_NAME || 'Silva MD',
    OWNER_NUMBER: process.env.OWNER_NUMBER || '',
    
    // Bot Features
    MODS_ONLY: process.env.MODS_ONLY === 'true',
    DEBUG_MODE: process.env.DEBUG_MODE === 'true',
    AUTO_READ: process.env.AUTO_READ !== 'false',
    AUTO_TYPING: process.env.AUTO_TYPING === 'true',
    AUTO_REPLY: process.env.AUTO_REPLY === 'true',
    
    // Plugin Settings
    PLUGINS_ENABLED: process.env.PLUGINS_ENABLED !== 'false',
    PLUGINS_DIR: process.env.PLUGINS_DIR || 'silvaxlab',
    MAX_PLUGINS: parseInt(process.env.MAX_PLUGINS) || 50,
    
    // Media Settings
    MAX_UPLOAD_SIZE: parseInt(process.env.MAX_UPLOAD_SIZE) || 100, // MB
    AUTO_DOWNLOAD: process.env.AUTO_DOWNLOAD === 'true',
    
    // API Keys
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    DEEPAI_API_KEY: process.env.DEEPAI_API_KEY || '',
    
    // Database (Optional)
    MONGODB_URI: process.env.MONGODB_URI || '',
    
    // Server
    PORT: parseInt(process.env.PORT) || 3000,
    HOST: process.env.HOST || '0.0.0.0',
    
    // Bot Metadata
    VERSION: '3.0.0',
    AUTHOR: 'Silva Tech Nexus',
    GITHUB: 'https://github.com/silvatech/silva-md-bot',
    
    // Global Context Info (for all messages)
    GLOBAL_CONTEXT: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363200367779016@newsletter',
            newsletterName: '◢◤ Silva Tech Nexus',
            serverMessageId: 144
        }
    },
    
    // Command List
    COMMANDS: {
        info: ['ping', 'menu', 'help', 'owner', 'stats', 'speed'],
        media: ['sticker', 'toimg', 'take', 'ttp', 'attp', 'emix'],
        downloader: ['play', 'yt', 'ig', 'fb', 'tik', 'twitter'],
        group: ['kick', 'add', 'promote', 'demote', 'tagall', 'link'],
        tools: ['calc', 'wiki', 'weather', 'tr', 'ssweb', 'get'],
        fun: ['gpt', 'dalle', 'quote', 'joke', 'fact', 'meme'],
        owner: ['eval', 'exec', 'broadcast', 'setprefix', 'ban']
    },
    
    // Response Messages
    MESSAGES: {
        welcome: "👋 Welcome to *Silva MD Bot*!\nType .menu to see all commands.",
        error: "❌ An error occurred. Please try again later.",
        noPrefix: "Please use the prefix *{{prefix}}* before commands.",
        ownerOnly: "⚠️ This command is only for the bot owner.",
        groupOnly: "⚠️ This command only works in groups.",
        adminOnly: "⚠️ This command requires admin privileges.",
        wait: "⏳ Please wait..."
    }
};

// Create directories if they don't exist
const dirs = ['sessions', 'silvaxlab', 'assets', 'temp', 'lib'];
dirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
});

// Export configuration
module.exports = config;
