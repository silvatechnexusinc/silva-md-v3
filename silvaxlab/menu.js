// Menu command
const config = require('../config.js');
const handler = {
    help: ['menu'],
    tags: ['info'],
    command: /^menu$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: false,
    
    execute: async ({ jid, sock, message }) => {
        const menuText = `┌─「 *SILVA MD* 」─
│
│ ⚡ *BOT STATUS*
│ • Mode: ${config.BOT_MODE || 'public'}
│ • Prefix: ${config.PREFIX}
│ • Version: ${config.VERSION}
│
│ 📋 *AVAILABLE COMMANDS*
│ • ${config.PREFIX}ping - Check bot status
│ • ${config.PREFIX}sticker - Create sticker
│ • ${config.PREFIX}owner - Show owner info
│ • ${config.PREFIX}help - Show help
│ • ${config.PREFIX}menu - This menu
│ • ${config.PREFIX}plugins - List plugins
│ • ${config.PREFIX}stats - Bot statistics
│
│ └─「 *SILVA TECH* 」`;
        
        await sock.sendMessage(jid, { text: menuText }, { quoted: message });
    }
};

module.exports = { handler };
