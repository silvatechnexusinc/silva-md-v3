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
║      Advanced WhatsApp Bot            ║
║      with Plugin System               ║
║           SYLIVANUS                   ║
╚═══════════════════════════════════════╝
`);

console.log('📁 Checking required files...');

// Check if config.js exists
if (!fs.existsSync('./config.js')) {
    console.error('❌ config.js not found! Creating template...');
    const template = `module.exports = {
    BOT_NAME: 'Silva MD',
    VERSION: '3.0.0',
    PREFIX: '.',
    BOT_MODE: 'public', // public, private
    OWNER_NUMBER: '1234567890',
    SESSION_ID: '',
    ALLOWED_USERS: [],
    AUTO_REPLY: true,
    ANTI_DELETE: true,
    DEBUG_MODE: true
};`;
    fs.writeFileSync('./config.js', template);
    console.log('✅ Created config.js template. Please edit it with your settings.');
}

// Create lib directory with handlers if not exists
const libDir = './lib';
if (!fs.existsSync(libDir)) {
    fs.mkdirSync(libDir, { recursive: true });
}

// Create minimal handler files if they don't exist
const handlers = {
    'status.js': `// Status handler
module.exports = {
    setup: (sock, config) => {
        console.log('Status handler initialized');
        // Add status handling logic here
    }
};`,
    
    'antidelete.js': `// Anti-delete handler
module.exports = {
    setup: (sock, config) => {
        console.log('Anti-delete handler initialized');
        // Add anti-delete logic here
    }
};`,
    
    'newsletter.js': `// Newsletter handler
module.exports = {
    followChannels: (sock) => {
        console.log('Newsletter follow channels initialized');
    },
    setupNewsletterHandlers: (sock) => {
        console.log('Newsletter handlers initialized');
    }
};`
};

Object.entries(handlers).forEach(([file, content]) => {
    const filePath = path.join(libDir, file);
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content);
        console.log(\`✅ Created \${file}\`);
    }
});

// Start the bot
const { bot } = require('./silva.js');
if (bot && typeof bot.init === 'function') {
    console.log('🚀 Starting Silva MD Bot...');
    bot.init().catch(error => {
        console.error('❌ Bot startup failed:', error);
        process.exit(1);
    });
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
    console.log(\`🌐 Health check server running on port \${PORT}\`);
});

// Handle SIGTERM gracefully
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully');
    server.close(() => {
        console.log('✅ HTTP server closed');
        process.exit(0);
    });
});

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down...');
    server.close(() => {
        process.exit(0);
    });
});
