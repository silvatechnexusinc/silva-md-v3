require('dotenv').config();

// Create necessary directories
const fs = require('fs');
const dirs = ['sessions', 'silvaxlab', 'temp', 'logs'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

console.log(`
╔═══════════════════════════════════════╗
║                                       ║
║         SILVA MD BOT v3.0             ║
║        Advanced WhatsApp Bot          ║
║        with Plugin System             ║
║            SYLIVANUS                  ║
╚═══════════════════════════════════════╝
`);

// Start the bot
const { bot } = require('./silva.js');
bot.init();

// Keep alive server for Heroku
const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'online',
        bot: 'Silva MD',
        version: '3.0.0',
        uptime: process.uptime()
    }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
});
