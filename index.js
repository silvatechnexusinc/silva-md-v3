require('dotenv').config();
const config = require('./config.js');
const { SilvaBot } = require('./silva.js');

console.clear();
console.log(`
╔═══════════════════════════════════════╗
║                                       ║
║      ░██████╗██╗██╗░░░██╗██╗░░██╗    ║
║      ██╔════╝██║██║░░░██║██║░░██║    ║
║      ╚█████╗░██║██║░░░██║███████║    ║
║      ░╚═══██╗██║██║░░░██║██╔══██║    ║
║      ██████╔╝██║╚██████╔╝██║░░██║    ║
║      ╚═════╝░╚═╝░╚═════╝░╚═╝░░╚═╝    ║
║                                       ║
║        ███╗░░░███╗██████╗░           ║
║        ████╗░████║██╔══██╗           ║
║        ██╔████╔██║██║░░██║           ║
║        ██║╚██╔╝██║██║░░██║           ║
║        ██║░╚═╝░██║██████╔╝           ║
║        ╚═╝░░░░░╚═╝╚═════╝░           ║
║                                       ║
║     Advanced WhatsApp Bot v${config.VERSION}     ║
║       by ${config.AUTHOR}        ║
║                                       ║
╚═══════════════════════════════════════╝
`);

// Start the bot
const bot = new SilvaBot();
bot.init();

// Keep alive for hosting platforms
const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'online',
        bot: config.BOT_NAME,
        version: config.VERSION,
        uptime: process.uptime(),
        platform: process.platform
    }));
});

server.listen(config.PORT, config.HOST, () => {
    console.log(`🌐 Server running on http://${config.HOST}:${config.PORT}`);
});

// Handle process termination
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Silva MD Bot...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM. Shutting down...');
    process.exit(0);
});
