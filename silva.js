const {
    makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    downloadMediaMessage,
    getContentType,
    Browsers,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    delay,
    generateWAMessageFromContent
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const NodeCache = require('node-cache');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const os = require('os');

// Import configuration
const config = require('./config.js');

// Import modular handlers
const statusHandler = require('./lib/status');
const antideleteHandler = require('./lib/antidelete');
const newsletterHandler = require('./lib/newsletter');

// Global Context Info for Newsletter Tag
const globalContextInfo = {
    forwardingScore: 999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363200367779016@newsletter',
        newsletterName: '◢◤ Silva Tech Nexus ◢◤',
        serverMessageId: 144
    }
};

// Enhanced pino logger with proper configuration
const logger = pino({
    level: config.DEBUG_MODE ? 'debug' : 'error',
    transport: config.DEBUG_MODE ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    } : undefined
});

// Enhanced Bot Logger with better formatting
class BotLogger {
    log(type, message) {
        const timestamp = new Date().toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        const colors = {
            SUCCESS: '\x1b[32m',
            ERROR: '\x1b[31m',
            INFO: '\x1b[36m',
            WARNING: '\x1b[33m',
            BOT: '\x1b[35m',
            DEBUG: '\x1b[90m',
            RESET: '\x1b[0m'
        };
        
        const logType = type.padEnd(8);
        const color = colors[type] || colors.INFO;
        console.log(`${color}[${timestamp}] [${logType}] ${message}${colors.RESET}`);
    }
}

const botLogger = new BotLogger();

// Load Session from Compressed Base64
async function loadSession() {
    try {
        const credsPath = './sessions/creds.json';
        
        if (!fs.existsSync('./sessions')) {
            fs.mkdirSync('./sessions', { recursive: true });
        }
        
        // Clean old sessions if exists
        if (fs.existsSync(credsPath)) {
            try {
                fs.unlinkSync(credsPath);
                botLogger.log('INFO', "♻️ Old session removed");
            } catch (e) {
                // Ignore error if file doesn't exist
            }
        }

        if (!config.SESSION_ID || typeof config.SESSION_ID !== 'string') {
            botLogger.log('WARNING', "SESSION_ID missing, using QR");
            return false;
        }

        const [header, b64data] = config.SESSION_ID.split('~');

        if (header !== "Silva" || !b64data) {
            botLogger.log('ERROR', "Invalid session format");
            return false;
        }

        const cleanB64 = b64data.replace('...', '');
        const compressedData = Buffer.from(cleanB64, 'base64');
        const decompressedData = zlib.gunzipSync(compressedData);

        fs.writeFileSync(credsPath, decompressedData, "utf8");
        botLogger.log('SUCCESS', "✅ Session loaded successfully");
        return true;
    } catch (e) {
        botLogger.log('ERROR', "Session Error: " + e.message);
        return false;
    }
}

// Utility Functions
class Functions {
    constructor() {
        this.tempDir = path.join(__dirname, './temp');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        this.typingSessions = new Map();
    }

    async isAdmin(message, sock) {
        if (!message.key.remoteJid.endsWith('@g.us')) return false;
        
        try {
            const metadata = await sock.groupMetadata(message.key.remoteJid);
            const participant = message.key.participant || message.key.remoteJid;
            const adminList = metadata.participants.filter(p => p.admin).map(p => p.id);
            return adminList.includes(participant);
        } catch (error) {
            botLogger.log('DEBUG', 'Admin check error: ' + error.message);
            return false;
        }
    }

    async isBotAdmin(jid, sock) {
        if (!jid.endsWith('@g.us')) return false;
        
        try {
            const metadata = await sock.groupMetadata(jid);
            const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const botParticipant = metadata.participants.find(p => p.id === botJid);
            return botParticipant ? botParticipant.admin !== null : false;
        } catch (error) {
            return false;
        }
    }

    isOwner(sender) {
        if (!config.OWNER_NUMBER) return false;
        
        let ownerJid = config.OWNER_NUMBER;
        if (!ownerJid.includes('@s.whatsapp.net')) {
            ownerJid = ownerJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        }
        
        const senderJid = sender.includes('@') ? sender : sender + '@s.whatsapp.net';
        return senderJid === ownerJid;
    }

    isAllowed(sender, jid) {
        if (this.isOwner(sender)) return true;
        if (config.BOT_MODE === 'public') return true;
        
        if (config.BOT_MODE === 'private') {
            if (jid.endsWith('@g.us')) return true;
            if (config.ALLOWED_USERS && Array.isArray(config.ALLOWED_USERS)) {
                const senderNumber = sender.split('@')[0];
                return config.ALLOWED_USERS.includes(senderNumber);
            }
            return false;
        }
        return true;
    }

    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    formatJid(number) {
        if (!number) return null;
        const cleaned = number.replace(/[^0-9]/g, '');
        if (cleaned.length < 10) return null;
        return cleaned + '@s.whatsapp.net';
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Start typing indicator
    async startTyping(jid, sock) {
        try {
            await sock.sendPresenceUpdate('composing', jid);
            this.typingSessions.set(jid, Date.now());
        } catch (error) {
            botLogger.log('DEBUG', 'Typing error: ' + error.message);
        }
    }

    // Stop typing indicator
    async stopTyping(jid, sock) {
        try {
            await sock.sendPresenceUpdate('paused', jid);
            this.typingSessions.delete(jid);
        } catch (error) {
            botLogger.log('DEBUG', 'Stop typing error: ' + error.message);
        }
    }

    // Format text with proper line breaks
    formatText(text) {
        if (!text) return '';
        return String(text).replace(/\\n/g, '\n').trim();
    }

    // Get readable time
    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
        
        return parts.join(' ');
    }
}

// Store Implementation
class MessageStore {
    constructor() {
        this.messages = new Map();
        this.chats = new Map();
        this.lastMessages = new Map();
    }

    async getMessage(key) {
        return this.messages.get(key.id);
    }

    async setMessage(key, message) {
        this.messages.set(key.id, message);
        // Keep last 1000 messages per chat
        const jid = key.remoteJid;
        if (!this.lastMessages.has(jid)) {
            this.lastMessages.set(jid, []);
        }
        const messages = this.lastMessages.get(jid);
        messages.push({ key, message });
        if (messages.length > 1000) {
            messages.shift();
        }
    }

    async getChat(jid) {
        return this.chats.get(jid);
    }

    async setChat(jid, chat) {
        this.chats.set(jid, chat);
    }

    async getLastMessages(jid, count = 10) {
        return this.lastMessages.get(jid)?.slice(-count) || [];
    }
}

// Plugin Manager
class PluginManager {
    constructor() {
        this.commandHandlers = new Map();
        this.pluginInfo = new Map();
        this.functions = new Functions();
        this.pluginDir = 'silvaxlab';
    }

    async loadPlugins() {
        try {
            const pluginDir = path.join(__dirname, this.pluginDir);
            
            if (!fs.existsSync(pluginDir)) {
                fs.mkdirSync(pluginDir, { recursive: true });
                botLogger.log('INFO', `Created plugin directory: ${this.pluginDir}`);
                this.createExamplePlugins(pluginDir);
                return;
            }

            const pluginFiles = fs.readdirSync(pluginDir)
                .filter(file => file.endsWith('.js') && !file.startsWith('_'));

            botLogger.log('INFO', `Found ${pluginFiles.length} plugin(s) in ${this.pluginDir}`);

            // Clear existing handlers
            this.commandHandlers.clear();
            this.pluginInfo.clear();

            for (const file of pluginFiles) {
                try {
                    const pluginPath = path.join(pluginDir, file);
                    delete require.cache[require.resolve(pluginPath)];
                    
                    const pluginModule = require(pluginPath);
                    
                    if (pluginModule && pluginModule.handler && pluginModule.handler.command) {
                        const handler = pluginModule.handler;
                        this.commandHandlers.set(handler.command, handler);
                        
                        this.pluginInfo.set(handler.command.source, {
                            help: handler.help || [],
                            tags: handler.tags || [],
                            group: handler.group || false,
                            admin: handler.admin || false,
                            botAdmin: handler.botAdmin || false,
                            owner: handler.owner || false,
                            filename: file
                        });
                        
                        botLogger.log('SUCCESS', `✅ Loaded plugin: ${file.replace('.js', '')}`);
                    } else {
                        botLogger.log('WARNING', `Plugin ${file} has invalid format`);
                    }
                } catch (error) {
                    botLogger.log('ERROR', `Failed to load plugin ${file}: ${error.message}`);
                }
            }
        } catch (error) {
            botLogger.log('ERROR', "Plugin loading error: " + error.message);
        }
    }

    createExamplePlugins(pluginDir) {
        // Create simple plugins
        const stickerPlugin = `// Sticker plugin
const handler = {
    help: ['sticker', 'stiker'],
    tags: ['media'],
    command: /^(sticker|stiker|s)$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: false,
    
    execute: async ({ jid, sock, message, bot, args }) => {
        try {
            await bot.sendMessage(jid, { 
                text: '🖼️ *Sticker Creator*\n\nSend an image/video with caption ".sticker" or reply to media with ".sticker"'
            }, { quoted: message });
        } catch (error) {
            await bot.sendMessage(jid, {
                text: '❌ Error: ' + error.message
            }, { quoted: message });
        }
    }
};

module.exports = { handler };`;

        const pingPlugin = `// Ping command
const handler = {
    help: ['ping'],
    tags: ['info'],
    command: /^ping$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: false,
    
    execute: async ({ jid, sock, message, bot, args }) => {
        const start = Date.now();
        await bot.sendMessage(jid, { text: '🏓 Pong!' }, { quoted: message });
        const latency = Date.now() - start;
        
        await bot.sendMessage(jid, {
            text: \`*Ping Statistics*

⚡ Latency: \${latency}ms
📊 Uptime: \${(process.uptime() / 3600).toFixed(2)}h
💾 RAM: \${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB\`
        }, { quoted: message });
    }
};

module.exports = { handler };`;

        const menuPlugin = `// Menu command
const config = require('../config.js');
const handler = {
    help: ['menu'],
    tags: ['info'],
    command: /^menu$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: false,
    
    execute: async ({ jid, sock, message, bot, args }) => {
        const menuText = \`┌─「 *SILVA MD* 」─
│
│ ⚡ *BOT STATUS*
│ • Mode: \${config.BOT_MODE || 'public'}
│ • Prefix: \${config.PREFIX}
│ • Version: \${config.VERSION}
│
│ 📋 *AVAILABLE COMMANDS*
│ • \${config.PREFIX}ping - Check bot status
│ • \${config.PREFIX}sticker - Create sticker
│ • \${config.PREFIX}owner - Show owner info
│ • \${config.PREFIX}help - Show help
│ • \${config.PREFIX}menu - This menu
│ • \${config.PREFIX}plugins - List plugins
│ • \${config.PREFIX}stats - Bot statistics
│
│ └─「 *SILVA TECH* 」\`;
        
        await bot.sendMessage(jid, { text: menuText }, { quoted: message });
    }
};

module.exports = { handler };`;

        const plugins = [
            { name: 'sticker.js', content: stickerPlugin },
            { name: 'ping.js', content: pingPlugin },
            { name: 'menu.js', content: menuPlugin }
        ];

        for (const plugin of plugins) {
            fs.writeFileSync(path.join(pluginDir, plugin.name), plugin.content);
            botLogger.log('INFO', "Created example plugin: " + plugin.name);
        }
    }

    async executeCommand(context) {
        const { text, jid, sender, isGroup, message, sock, args, bot } = context;
        
        // Check if sender is owner
        if (this.functions.isOwner(sender)) {
            botLogger.log('INFO', 'Owner command detected from: ' + sender);
        }
        
        // Check if user is allowed
        if (!this.functions.isAllowed(sender, jid)) {
            if (config.BOT_MODE === 'private') {
                await bot.sendMessage(jid, { 
                    text: '🔒 *Private Mode*\nThis bot is in private mode. Contact the owner for access.' 
                }, { quoted: message });
                return true;
            }
            return false;
        }
        
        // Find matching command
        for (const [commandRegex, handler] of this.commandHandlers.entries()) {
            const commandMatch = text.split(' ')[0];
            if (commandRegex.test(commandMatch)) {
                try {
                    // Check owner restriction
                    if (handler.owner && !this.functions.isOwner(sender)) {
                        await bot.sendMessage(jid, { text: '⚠️ Owner only command' }, { quoted: message });
                        return true;
                    }
                    
                    // Check group restriction
                    if (handler.group && !isGroup) {
                        await bot.sendMessage(jid, { text: '⚠️ Group only command' }, { quoted: message });
                        return true;
                    }
                    
                    // Check admin restriction
                    if (handler.admin && isGroup) {
                        const isAdmin = await this.functions.isAdmin(message, sock);
                        if (!isAdmin) {
                            await bot.sendMessage(jid, { text: '⚠️ Admin required' }, { quoted: message });
                            return true;
                        }
                    }
                    
                    // Check bot admin restriction
                    if (handler.botAdmin && isGroup) {
                        const isBotAdmin = await this.functions.isBotAdmin(jid, sock);
                        if (!isBotAdmin) {
                            await bot.sendMessage(jid, { text: '⚠️ Bot needs to be admin' }, { quoted: message });
                            return true;
                        }
                    }
                    
                    // Execute command
                    await handler.execute(context);
                    return true;
                    
                } catch (error) {
                    botLogger.log('ERROR', "Command error: " + error.message);
                    await bot.sendMessage(jid, { 
                        text: '❌ Error: ' + error.message
                    }, { quoted: message });
                    return true;
                }
            }
        }
        return false;
    }

    getCommandList() {
        const commands = [];
        for (const [regex, info] of this.pluginInfo) {
            commands.push({
                command: regex.source ? regex.source.replace(/[\/\^$]/g, '') : regex,
                help: info.help[0] || 'No description',
                tags: info.tags,
                group: info.group,
                admin: info.admin,
                botAdmin: info.botAdmin,
                owner: info.owner
            });
        }
        return commands;
    }

    getPluginCount() {
        return this.commandHandlers.size;
    }
}

// Main Bot Class
class SilvaBot {
    constructor() {
        this.sock = null;
        this.store = new MessageStore();
        this.groupCache = new NodeCache({ stdTTL: 300, useClones: false });
        this.pluginManager = new PluginManager();
        this.functions = new Functions();
        this.isConnected = false;
        this.startTime = Date.now();
        
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000;
        this.keepAliveInterval = null;
        
        this.commands = {
            help: this.helpCommand.bind(this),
            menu: this.menuCommand.bind(this),
            ping: this.pingCommand.bind(this),
            owner: this.ownerCommand.bind(this),
            stats: this.statsCommand.bind(this),
            plugins: this.pluginsCommand.bind(this),
            start: this.startCommand.bind(this),
            reload: this.reloadCommand.bind(this)
        };
    }

    async init() {
        try {
            botLogger.log('BOT', `🚀 Starting ${config.BOT_NAME} v${config.VERSION}`);
            botLogger.log('INFO', `Mode: ${config.BOT_MODE || 'public'}`);
            botLogger.log('INFO', `Prefix: ${config.PREFIX}`);
            
            // Load session if available
            if (config.SESSION_ID) {
                await loadSession();
            }

            // Load plugins
            await this.pluginManager.loadPlugins();
            
            // Connect to WhatsApp
            await this.connect();
        } catch (error) {
            botLogger.log('ERROR', "Init failed: " + error.message);
            setTimeout(() => this.init(), 10000);
        }
    }

    async connect() {
        try {
            this.reconnectAttempts++;
            
            if (this.reconnectAttempts > this.maxReconnectAttempts) {
                botLogger.log('ERROR', 'Max reconnection attempts reached');
                this.reconnectAttempts = 0;
                setTimeout(() => this.init(), 30000);
                return;
            }

            const { state, saveCreds } = await useMultiFileAuthState('./sessions');
            const { version, isLatest } = await fetchLatestBaileysVersion();
            
            botLogger.log('INFO', `Using Baileys v${version.join('.')} ${isLatest ? '(latest)' : '(outdated)'}`);
            
            this.sock = makeWASocket({
                version,
                logger: config.DEBUG_MODE ? logger : pino({ level: 'silent' }),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger)
                },
                browser: Browsers.macOS(config.BOT_NAME),
                markOnlineOnConnect: true,
                generateHighQualityLinkPreview: true,
                syncFullHistory: false,
                defaultQueryTimeoutMs: 60000,
                cachedGroupMetadata: async (jid) => this.groupCache.get(jid),
                retryRequestDelayMs: 2000,
                connectTimeoutMs: 30000,
                keepAliveIntervalMs: 15000,
                emitOwnEvents: true,
                fireInitQueries: true,
                mobile: false,
                shouldIgnoreJid: (jid) => {
                    if (!jid || typeof jid !== 'string') return false;
                    return jid.includes('@newsletter');
                },
                getMessage: async (key) => {
                    try {
                        return await this.store.getMessage(key);
                    } catch (error) {
                        return null;
                    }
                },
                printQRInTerminal: true
            });

            this.setupEvents(saveCreds);
            botLogger.log('SUCCESS', '✅ Bot initialized successfully');
            this.reconnectAttempts = 0;
        } catch (error) {
            botLogger.log('ERROR', "Connection error: " + error.message);
            await this.handleReconnect(error);
        }
    }

    async handleReconnect(error) {
        const delayTime = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
        botLogger.log('WARNING', `Reconnecting in ${delayTime/1000}s (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        await this.functions.sleep(delayTime);
        await this.connect();
    }

    setupEvents(saveCreds) {
        const sock = this.sock;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                botLogger.log('INFO', '📱 QR Code Generated - Scan with WhatsApp');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                this.isConnected = false;
                this.stopKeepAlive();
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.message;
                
                botLogger.log('WARNING', `Connection closed. Status: ${statusCode}, Error: ${errorMessage}`);
                
                if (statusCode === DisconnectReason.loggedOut) {
                    botLogger.log('ERROR', 'Logged out. Please scan QR again.');
                    this.cleanupSessions();
                    setTimeout(() => this.init(), 10000);
                } else if (statusCode === DisconnectReason.connectionLost) {
                    await this.handleReconnect(lastDisconnect?.error);
                } else {
                    await this.handleReconnect(lastDisconnect?.error);
                }
            } else if (connection === 'open') {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                botLogger.log('SUCCESS', '🔗 Connected to WhatsApp successfully');
                
                this.startKeepAlive();
                
                // Setup modular handlers
                this.setupModularHandlers();
                
                // Send welcome message to owner
                if (config.OWNER_NUMBER) {
                    try {
                        await delay(2000);
                        const ownerJid = this.functions.formatJid(config.OWNER_NUMBER);
                        if (ownerJid) {
                            const welcomeText = `✅ *${config.BOT_NAME} Connected Successfully!*

⚡ Mode: ${config.BOT_MODE || 'public'}
📅 Time: ${new Date().toLocaleString()}
🔌 Version: ${config.VERSION}
🤖 Status: Online and Ready

💡 Type ${config.PREFIX}menu for commands`;

                            await this.sendMessage(ownerJid, {
                                text: welcomeText
                            });
                            botLogger.log('INFO', 'Sent connected message to owner');
                        }
                    } catch (error) {
                        botLogger.log('ERROR', 'Failed to send owner message: ' + error.message);
                    }
                }
            } else if (connection === 'connecting') {
                botLogger.log('INFO', '🔄 Connecting to WhatsApp...');
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            try {
                await this.handleMessages(m);
            } catch (error) {
                botLogger.log('ERROR', "Messages upsert error: " + error.message);
            }
        });

        sock.ev.on('messages.update', async (updates) => {
            try {
                if (config.ANTI_DELETE) {
                    for (const update of updates) {
                        if (update.update && update.key) {
                            botLogger.log('DEBUG', 'Message update received');
                        }
                    }
                }
            } catch (error) {
                botLogger.log('DEBUG', 'Message update error: ' + error.message);
            }
        });

        sock.ev.on('group-participants.update', async (event) => {
            try {
                if (this.sock.user && this.sock.user.id) {
                    const botJid = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    if (event.action === 'add' && event.participants.includes(botJid)) {
                        const welcomeText = `🤖 *${config.BOT_NAME} Activated!*

Thank you for adding me to the group!

📝 *Available Commands:*
• ${config.PREFIX}menu - Show all commands
• ${config.PREFIX}ping - Check bot status
• ${config.PREFIX}help - Get help
• ${config.PREFIX}sticker - Create stickers

🔧 *Bot Info:*
• Prefix: ${config.PREFIX}
• Version: ${config.VERSION}
• Mode: ${config.BOT_MODE || 'public'}

Type ${config.PREFIX}menu for full command list!`;

                        await this.sendMessage(event.id, {
                            text: welcomeText
                        });
                        botLogger.log('INFO', 'Bot added to group: ' + event.id);
                    }
                }
            } catch (error) {
                botLogger.log('DEBUG', 'Group participants update error: ' + error.message);
            }
        });

        sock.ev.on('presence.update', (update) => {
            // Handle presence updates if needed
        });

        sock.ev.on('chats.update', (updates) => {
            // Handle chat updates
        });

        sock.ev.on('contacts.update', (updates) => {
            // Handle contact updates
        });
    }

    setupModularHandlers() {
        try {
            // Setup status handler
            if (statusHandler && typeof statusHandler.setup === 'function') {
                statusHandler.setup(this.sock, config);
                botLogger.log('INFO', '✅ Status handler initialized');
            }
            
            // Setup antidelete handler
            if (antideleteHandler && typeof antideleteHandler.setup === 'function') {
                antideleteHandler.setup(this.sock, config);
                botLogger.log('INFO', '✅ Antidelete handler initialized');
            }
            
            // Setup newsletter handler
            if (newsletterHandler) {
                if (typeof newsletterHandler.followChannels === 'function') {
                    newsletterHandler.followChannels(this.sock);
                }
                if (typeof newsletterHandler.setupNewsletterHandlers === 'function') {
                    newsletterHandler.setupNewsletterHandlers(this.sock);
                }
                botLogger.log('INFO', '✅ Newsletter handler initialized');
            }
        } catch (error) {
            botLogger.log('ERROR', 'Modular handler setup failed: ' + error.message);
        }
    }

    startKeepAlive() {
        this.stopKeepAlive();
        this.keepAliveInterval = setInterval(async () => {
            if (this.sock && this.isConnected) {
                try {
                    await this.sock.sendPresenceUpdate('available');
                } catch (error) {
                    botLogger.log('DEBUG', 'Keep-alive error: ' + error.message);
                }
            }
        }, 15000);
    }

    stopKeepAlive() {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
    }

    cleanupSessions() {
        try {
            const sessionsDir = './sessions';
            if (fs.existsSync(sessionsDir)) {
                fs.rmSync(sessionsDir, { recursive: true, force: true });
                fs.mkdirSync(sessionsDir, { recursive: true });
                botLogger.log('INFO', 'Sessions cleaned');
            }
        } catch (error) {
            botLogger.log('DEBUG', 'Cleanup error: ' + error.message);
        }
    }

    async handleMessages(m) {
        if (!m.messages || !Array.isArray(m.messages) || m.type !== 'notify') {
            return;
        }
        
        for (const message of m.messages) {
            try {
                // Skip newsletter/broadcast messages
                if (message.key.remoteJid.includes('@newsletter') ||
                    message.key.remoteJid.includes('@broadcast')) {
                    continue;
                }

                // Skip messages from the bot itself
                if (message.key.fromMe) {
                    continue;
                }

                // Store message
                await this.store.setMessage(message.key, message);

                const jid = message.key.remoteJid;
                const sender = message.key.participant || jid;
                const isGroup = jid.endsWith('@g.us');
                
                botLogger.log('DEBUG', `Message from ${sender} in ${jid}`);

                // Extract text from message
                let text = '';
                if (message.message?.conversation) {
                    text = message.message.conversation;
                } else if (message.message?.extendedTextMessage?.text) {
                    text = message.message.extendedTextMessage.text;
                } else if (message.message?.imageMessage?.caption) {
                    text = message.message.imageMessage.caption;
                } else if (message.message?.videoMessage?.caption) {
                    text = message.message.videoMessage.caption;
                } else if (message.message?.documentMessage?.caption) {
                    text = message.message.documentMessage.caption;
                }

                text = this.functions.formatText(text);

                // Check if message starts with prefix
                if (text && text.startsWith(config.PREFIX)) {
                    botLogger.log('INFO', `Command detected: ${text} from ${sender}`);
                    
                    const cmdText = text.slice(config.PREFIX.length).trim();
                    
                    // Start typing indicator
                    await this.functions.startTyping(jid, this.sock);
                    
                    // Try plugin commands first
                    const executed = await this.pluginManager.executeCommand({
                        text: cmdText,
                        jid,
                        sender,
                        isGroup,
                        args: cmdText.split(/ +/).slice(1),
                        message,
                        sock: this.sock,
                        bot: this
                    });
                    
                    // If no plugin handled it, try built-in commands
                    if (!executed) {
                        const args = cmdText.split(/ +/);
                        const command = args.shift().toLowerCase();
                        
                        if (this.commands[command]) {
                            botLogger.log('INFO', `Executing built-in command: ${command}`);
                            await this.commands[command]({
                                jid,
                                sender,
                                isGroup,
                                args,
                                message,
                                sock: this.sock,
                                bot: this
                            });
                        } else if (config.AUTO_REPLY) {
                            await this.sendMessage(jid, {
                                text: `❓ Unknown command. Type ${config.PREFIX}help for available commands.`
                            }, { quoted: message });
                        }
                    }
                    
                    // Stop typing indicator
                    await this.functions.stopTyping(jid, this.sock);
                }

            } catch (error) {
                botLogger.log('ERROR', "Message handling error: " + error.message);
                try {
                    await this.functions.stopTyping(message.key.remoteJid, this.sock);
                } catch (e) {
                    // Ignore
                }
            }
        }
    }

    // Command handlers
    async helpCommand(context) {
        const { jid, message } = context;
        const plugins = this.pluginManager.getCommandList();
        
        let helpText = `*${config.BOT_NAME} Help Menu*

📝 *Prefix:* ${config.PREFIX}
⚡ *Mode:* ${config.BOT_MODE || 'public'}
🔧 *Version:* ${config.VERSION}

📋 *Built-in Commands:*
• ${config.PREFIX}help - This menu
• ${config.PREFIX}menu - Main menu
• ${config.PREFIX}ping - Check bot status
• ${config.PREFIX}owner - Owner information
• ${config.PREFIX}plugins - List all plugins
• ${config.PREFIX}stats - Bot statistics
• ${config.PREFIX}reload - Reload all plugins`;
        
        if (plugins.length > 0) {
            helpText += '\n\n🔌 *Loaded Plugins:*\n';
            const grouped = {};
            
            for (const cmd of plugins) {
                const tag = cmd.tags && cmd.tags.length > 0 ? cmd.tags[0] : 'general';
                if (!grouped[tag]) grouped[tag] = [];
                grouped[tag].push(cmd);
            }
            
            for (const [tag, cmds] of Object.entries(grouped)) {
                helpText += `\n📁 *${tag.toUpperCase()}*\n`;
                for (const cmd of cmds) {
                    helpText += `• ${config.PREFIX}${cmd.command} - ${cmd.help}\n`;
                }
            }
        }
        
        helpText += '\n📍 *Silva Tech Nexus*';
        
        try {
            await this.sendMessage(jid, { text: helpText }, { quoted: message });
            botLogger.log('INFO', 'Help command executed');
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send help: ' + error.message);
        }
    }

    async menuCommand(context) {
        const { jid, message } = context;
        const menuText = `┌─「 *${config.BOT_NAME.toUpperCase()}* 」─
│
│ ⚡ *BOT STATUS*
│ • Mode: ${config.BOT_MODE || 'public'}
│ • Prefix: ${config.PREFIX}
│ • Version: ${config.VERSION}
│ • Plugins: ${this.pluginManager.getPluginCount()}
│
│ 📋 *CORE COMMANDS*
│ • ${config.PREFIX}ping - Check bot status
│ • ${config.PREFIX}help - Show help menu
│ • ${config.PREFIX}owner - Show owner info
│ • ${config.PREFIX}menu - This menu
│ • ${config.PREFIX}plugins - List plugins
│ • ${config.PREFIX}stats - Bot statistics
│ • ${config.PREFIX}reload - Reload plugins
│
│ 🎨 *MEDIA COMMANDS*
│ • ${config.PREFIX}sticker - Create sticker
│
│ └─「 *SILVA TECH* 」`;
        
        try {
            await this.sendMessage(jid, { text: menuText }, { quoted: message });
            botLogger.log('INFO', 'Menu command executed');
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send menu: ' + error.message);
        }
    }

    async pingCommand(context) {
        const { jid, message } = context;
        try {
            const start = Date.now();
            await this.sendMessage(jid, { text: '🏓 Pong!' }, { quoted: message });
            const latency = Date.now() - start;
            
            const uptime = this.functions.formatUptime(process.uptime());
            const memory = process.memoryUsage();
            
            const statsText = `*Status Report*

⚡ Latency: ${latency}ms
⏱️ Uptime: ${uptime}
💾 RAM: ${this.functions.formatBytes(memory.heapUsed)} / ${this.functions.formatBytes(memory.heapTotal)}
📊 RSS: ${this.functions.formatBytes(memory.rss)}
🌐 Connection: ${this.isConnected ? 'Connected ✅' : 'Disconnected ❌'}
🔌 Plugins: ${this.pluginManager.getPluginCount()}
🤖 Bot: ${config.BOT_NAME} v${config.VERSION}`;
            
            await this.sendMessage(jid, { text: statsText }, { quoted: message });
            botLogger.log('INFO', 'Ping command executed');
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send ping: ' + error.message);
        }
    }

    async ownerCommand(context) {
        const { jid, message } = context;
        if (config.OWNER_NUMBER) {
            try {
                const ownerText = `👑 *Bot Owner Information*

📞 Number: ${config.OWNER_NUMBER}
🤖 Bot Name: ${config.BOT_NAME}
⚡ Version: v${config.VERSION}
🌐 Mode: ${config.BOT_MODE || 'public'}

📊 *Bot Statistics*
• Uptime: ${this.functions.formatUptime(process.uptime())}
• Plugins: ${this.pluginManager.getPluginCount()}
• Status: ${this.isConnected ? 'Online ✅' : 'Offline ❌'}

📍 *Silva Tech Nexus*`;

                await this.sendMessage(jid, { text: ownerText }, { quoted: message });
                botLogger.log('INFO', 'Owner command executed');
            } catch (error) {
                botLogger.log('ERROR', 'Failed to send owner info: ' + error.message);
            }
        }
    }

    async statsCommand(context) {
        const { jid, message } = context;
        try {
            const uptime = this.functions.formatUptime(process.uptime());
            const memory = process.memoryUsage();
            const loadAvg = os.loadavg();
            
            const statsText = `📊 *Bot Statistics*

⏱️ Uptime: ${uptime}
💾 Memory Usage: ${this.functions.formatBytes(memory.heapUsed)}
📈 Memory Total: ${this.functions.formatBytes(memory.heapTotal)}
📉 RSS: ${this.functions.formatBytes(memory.rss)}
🔢 Load Average: ${loadAvg[0].toFixed(2)}, ${loadAvg[1].toFixed(2)}, ${loadAvg[2].toFixed(2)}
📦 Platform: ${process.platform} ${process.arch}
🔌 Plugins: ${this.pluginManager.getPluginCount()}
🌐 Status: ${this.isConnected ? 'Connected ✅' : 'Disconnected ❌'}
🤖 Bot: ${config.BOT_NAME} v${config.VERSION}`;
            
            await this.sendMessage(jid, { text: statsText }, { quoted: message });
            botLogger.log('INFO', 'Stats command executed');
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send stats: ' + error.message);
        }
    }

    async pluginsCommand(context) {
        const { jid, message } = context;
        try {
            const plugins = this.pluginManager.getCommandList();
            let pluginsText = `📦 *Loaded Plugins*

Total: ${plugins.length}

`;
            
            if (plugins.length === 0) {
                pluginsText += 'No plugins loaded.\nCheck the silvaxlab folder for plugins.';
            } else {
                for (const plugin of plugins) {
                    const tags = plugin.tags && plugin.tags.length > 0 ? `[${plugin.tags.join(', ')}]` : '';
                    const restrictions = [];
                    if (plugin.group) restrictions.push('Group');
                    if (plugin.admin) restrictions.push('Admin');
                    if (plugin.botAdmin) restrictions.push('Bot Admin');
                    if (plugin.owner) restrictions.push('Owner');
                    
                    const restrictionText = restrictions.length > 0 ? ` (${restrictions.join(', ')})` : '';
                    pluginsText += `• ${config.PREFIX}${plugin.command} - ${plugin.help}${restrictionText}\n`;
                }
            }
            
            await this.sendMessage(jid, { text: pluginsText }, { quoted: message });
            botLogger.log('INFO', 'Plugins command executed');
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send plugins list: ' + error.message);
        }
    }

    async startCommand(context) {
        const { jid, message } = context;
        try {
            const startText = `✨ *Welcome to ${config.BOT_NAME}!*

I am an advanced WhatsApp bot with a modular plugin system.

📝 *Quick Start:*
• Type ${config.PREFIX}menu for all commands
• Type ${config.PREFIX}help for detailed help
• Type ${config.PREFIX}ping to check my status

⚡ *Bot Information:*
• Mode: ${config.BOT_MODE || 'public'}
• Prefix: ${config.PREFIX}
• Version: ${config.VERSION}
• Plugins: ${this.pluginManager.getPluginCount()}

🔧 *Features:*
• Plugin system (silvaxlab folder)
• Group management
• Media handling
• Newsletter support
• Anti-delete messages

📍 *Silva Tech Nexus*`;
            
            await this.sendMessage(jid, { 
                text: startText
            }, { quoted: message });
            botLogger.log('INFO', 'Start command executed');
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send start message: ' + error.message);
        }
    }

    async reloadCommand(context) {
        const { jid, sender, message } = context;
        try {
            // Check if owner
            if (!this.functions.isOwner(sender)) {
                await this.sendMessage(jid, { text: '⚠️ Owner only command' }, { quoted: message });
                return;
            }
            
            await this.sendMessage(jid, { text: '🔄 Reloading plugins...' }, { quoted: message });
            
            // Reload plugins
            await this.pluginManager.loadPlugins();
            
            const pluginCount = this.pluginManager.getPluginCount();
            await this.sendMessage(jid, { 
                text: `✅ Plugins reloaded successfully!\n\n📦 Loaded ${pluginCount} plugin(s)\n🔄 Bot is ready to use!`
            }, { quoted: message });
            
            botLogger.log('INFO', `Plugins reloaded by ${sender}, ${pluginCount} plugins loaded`);
        } catch (error) {
            await this.sendMessage(jid, { 
                text: '❌ Failed to reload plugins: ' + error.message
            }, { quoted: message });
            botLogger.log('ERROR', 'Reload failed: ' + error.message);
        }
    }

    async sendMessage(jid, content, options = {}) {
        try {
            if (this.sock && this.isConnected) {
                // Format text content
                if (content.text) {
                    content.text = this.functions.formatText(content.text);
                }
                
                // Add global context info for newsletter tag
                const messageOptions = {
                    ...globalContextInfo,
                    ...options
                };
                
                // Send the message
                const result = await this.sock.sendMessage(jid, content, messageOptions);
                botLogger.log('DEBUG', `Message sent to ${jid}`);
                return result;
            } else {
                botLogger.log('WARNING', 'Cannot send message: Bot not connected');
                return null;
            }
        } catch (error) {
            botLogger.log('ERROR', "Send error: " + error.message);
            
            // Try to reconnect if send fails
            if (error.message.includes('not connected') || error.message.includes('socket')) {
                setTimeout(() => this.connect(), 5000);
            }
            
            return null;
        }
    }
}

// Create bot instance
const bot = new SilvaBot();

// Export bot instance for index.js
module.exports = {
    bot,
    config,
    logger: botLogger,
    functions: new Functions(),
    globalContextInfo
};

// Add global error handlers
process.on('uncaughtException', (error) => {
    botLogger.log('ERROR', `Uncaught Exception: ${error.message}\nStack: ${error.stack}`);
});

process.on('unhandledRejection', (reason, promise) => {
    botLogger.log('ERROR', `Unhandled Rejection at: ${promise}, reason: ${reason}`);
});
