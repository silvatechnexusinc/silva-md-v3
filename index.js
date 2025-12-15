require('dotenv').config();

// Create necessary directories
const fs = require('fs');
const dirs = ['sessions', 'silvaxlab', 'temp', 'logs', 'lib'];
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
if (bot && typeof bot.init === 'function') {
    console.log('🚀 Starting Silva MD Bot...');
    bot.init();
} else {
    console.error('❌ Bot initialization failed - check silva.js exports');
    process.exit(1);
}

// Keep alive server for Heroku
const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'online',
        bot: 'Silva MD',
        version: '3.0.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Health check server running on port ${PORT}`);
});

// Handle Heroku SIGTERM gracefully
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully');
    server.close(() => {
        console.log('✅ HTTP server closed');
        process.exit(0);
    });
});
