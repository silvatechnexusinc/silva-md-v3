const {
    makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    makeInMemoryStore,
    downloadMediaMessage,
    getContentType,
    Browsers,
    proto,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const NodeCache = require('node-cache');
const qrcode = require('qrcode-terminal');

// Global Context Info (as requested)
const globalContextInfo = {
    forwardingScore: 999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363200367779016@newsletter',
        newsletterName: '◢◤ Silva Tech Nexus',
        serverMessageId: 144
    }
};

// Configuration
const config = {
    SESSION_ID: process.env.SESSION_ID || '',
    PREFIX: process.env.PREFIX || '.',
    BOT_NAME: process.env.BOT_NAME || 'Silva MD',
    OWNER_NUMBER: process.env.OWNER_NUMBER,
    MODS_ONLY: process.env.MODS_ONLY === 'true',
    DEBUG_MODE: process.env.DEBUG_MODE === 'true',
    AUTO_READ: process.env.AUTO_READ !== 'false',
    AUTO_TYPING: process.env.AUTO_TYPING === 'true',
    PLUGINS_DIR: process.env.PLUGINS_DIR || 'silvaxlab'
};

// Logger
const logger = P({
    level: config.DEBUG_MODE ? 'debug' : 'error',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    }
});

function logMessage(type, message) {
    const timestamp = new Date().toISOString();
    const colors = {
        SUCCESS: '\x1b[32m',
        ERROR: '\x1b[31m',
        INFO: '\x1b[36m',
        WARNING: '\x1b[33m',
        BOT: '\x1b[35m',
        RESET: '\x1b[0m'
    };
    console.log(`${colors[type] || colors.INFO}[${type}] ${timestamp} - ${message}${colors.RESET}`);
}

// Load Session from Compressed Base64
async function loadSession() {
    try {
        const credsPath = './sessions/creds.json';
        
        // Remove old session file if exists
        if (fs.existsSync(credsPath)) {
            fs.unlinkSync(credsPath);
            logMessage('INFO', "♻️ ᴏʟᴅ ꜱᴇꜱꜱɪᴏɴ ʀᴇᴍᴏᴠᴇᴅ");
        }

        if (!config.SESSION_ID || typeof config.SESSION_ID !== 'string') {
            throw new Error("❌ SESSION_ID is missing or invalid");
        }

        const [header, b64data] = config.SESSION_ID.split('~');

        if (header !== "Silva" || !b64data) {
            throw new Error("❌ Invalid session format. Expected 'Silva~.....'");
        }

        // Clean and decode base64
        const cleanB64 = b64data.replace('...', '');
        const compressedData = Buffer.from(cleanB64, 'base64');
        
        // Decompress using zlib
        const decompressedData = zlib.gunzipSync(compressedData);

        // Write the decompressed session data
        fs.writeFileSync(credsPath, decompressedData, "utf8");
        logMessage('SUCCESS', "✅ ɴᴇᴡ ꜱᴇꜱꜱɪᴏɴ ʟᴏᴀᴅᴇᴅ ꜱᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ");

        return true;
    } catch (e) {
        logMessage('ERROR', `Session Error: ${e.message}`);
        if (config.SESSION_ID) {
            logMessage('WARNING', "Falling back to QR code authentication");
        }
        return false;
    }
}

// Plugin Loader
class PluginManager {
    constructor() {
        this.plugins = new Map();
        this.commands = new Map();
    }

    async loadPlugins(dir = config.PLUGINS_DIR) {
        try {
            const pluginDir = path.join(__dirname, dir);
            
            if (!fs.existsSync(pluginDir)) {
                fs.mkdirSync(pluginDir, { recursive: true });
                logMessage('INFO', `Created plugin directory: ${dir}`);
                return;
            }

            const pluginFiles = fs.readdirSync(pluginDir)
                .filter(file => file.endsWith('.js') && !file.startsWith('_'));

            for (const file of pluginFiles) {
                try {
                    const pluginPath = path.join(pluginDir, file);
                    const plugin = require(pluginPath);
                    
                    if (typeof plugin === 'function') {
                        this.plugins.set(file.replace('.js', ''), plugin);
                        logMessage('SUCCESS', `✅ Loaded plugin: ${file}`);
                    }
                } catch (error) {
                    logMessage('ERROR', `Failed to load plugin ${file}: ${error.message}`);
                }
            }
        } catch (error) {
            logMessage('ERROR', `Plugin loading error: ${error.message}`);
        }
    }

    async executePlugin(pluginName, ...args) {
        const plugin = this.plugins.get(pluginName);
        if (plugin) {
            try {
                return await plugin(...args);
            } catch (error) {
                logMessage('ERROR', `Plugin ${pluginName} error: ${error.message}`);
                return null;
            }
        }
        return null;
    }
}

// Store Implementation
class MessageStore {
    constructor() {
        this.messages = new Map();
        this.chats = new Map();
        this.contacts = new Map();
    }

    async getMessage(key) {
        return this.messages.get(key.id);
    }

    async setMessage(key, message) {
        this.messages.set(key.id, message);
    }

    async getChat(jid) {
        return this.chats.get(jid);
    }

    async setChat(jid, chat) {
        this.chats.set(jid, chat);
    }
}

// Main Bot Class
class SilvaBot {
    constructor() {
        this.sock = null;
        this.store = new MessageStore();
        this.groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false });
        this.pluginManager = new PluginManager();
        this.isConnected = false;
        this.qrCode = null;
        
        this.commands = {
            help: this.helpCommand.bind(this),
            menu: this.menuCommand.bind(this),
            ping: this.pingCommand.bind(this),
            owner: this.ownerCommand.bind(this),
            stats: this.statsCommand.bind(this)
        };
    }

    async init() {
        try {
            logMessage('BOT', '🚀 Starting Silva MD Bot v3.0');
            
            // Try to load session from compressed base64
            if (config.SESSION_ID) {
                await loadSession();
            }

            // Load plugins
            await this.pluginManager.loadPlugins();

            // Start connection
            await this.connect();
        } catch (error) {
            logMessage('ERROR', `Initialization failed: ${error.message}`);
            process.exit(1);
        }
    }

    async connect() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState('./sessions');
            
            const { version } = await fetchLatestBaileysVersion();
            
            this.sock = makeWASocket({
                version,
                logger,
                printQRInTerminal: true,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger)
                },
                browser: Browsers.macOS('Silva MD'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: true,
                syncFullHistory: false,
                defaultQueryTimeoutMs: 60000,
                cachedGroupMetadata: async (jid) => this.groupCache.get(jid),
                getMessage: async (key) => await this.store.getMessage(key)
            });

            // Set up event handlers
            this.setupEvents(saveCreds);
            
            logMessage('SUCCESS', '✅ Bot initialized successfully');
        } catch (error) {
            logMessage('ERROR', `Connection error: ${error.message}`);
            setTimeout(() => this.connect(), 5000);
        }
    }

    setupEvents(saveCreds) {
        const sock = this.sock;

        // Connection update
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                this.qrCode = qr;
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                logMessage('WARNING', `Connection closed. Reconnecting: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    setTimeout(() => this.connect(), 5000);
                }
            } else if (connection === 'open') {
                this.isConnected = true;
                logMessage('SUCCESS', '🔗 Connected to WhatsApp');
                
                // Send connected message to owner
                if (config.OWNER_NUMBER) {
                    this.sendMessage(config.OWNER_NUMBER, {
                        text: `✅ *Silva MD Bot Connected!*\n\n• Time: ${new Date().toLocaleString()}\n• Platform: ${process.platform}\n• Node: ${process.version}`
                    });
                }
            }
        });

        // Credentials update
        sock.ev.on('creds.update', saveCreds);

        // Messages
        sock.ev.on('messages.upsert', async (m) => {
            await this.handleMessages(m);
        });

        // Message updates (for polls, reactions, etc.)
        sock.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                if (update.pollUpdates) {
                    await this.handlePollUpdate(update);
                }
            }
        });

        // Group updates
        sock.ev.on('groups.update', async (updates) => {
            for (const update of updates) {
                const metadata = await sock.groupMetadata(update.id);
                this.groupCache.set(update.id, metadata);
            }
        });

        // Group participants update
        sock.ev.on('group-participants.update', async (event) => {
            const metadata = await sock.groupMetadata(event.id);
            this.groupCache.set(event.id, metadata);
            await this.handleGroupParticipantsUpdate(event);
        });

        // Presence update
        sock.ev.on('presence.update', (update) => {
            // Handle presence updates if needed
        });

        // Contacts update
        sock.ev.on('contacts.update', (updates) => {
            for (const update of updates) {
                // Update contacts store
            }
        });

        // Chats update
        sock.ev.on('chats.upsert', (chats) => {
            for (const chat of chats) {
                this.store.setChat(chat.id, chat);
            }
        });
    }

    async handleMessages(m) {
        const messages = m.messages;
        
        for (const message of messages) {
            try {
                // Ignore if message is from the bot itself
                if (message.key.fromMe) {
                    if (config.AUTO_READ && !message.key.remoteJid.includes('status')) {
                        await this.sock.readMessages([message.key]);
                    }
                    continue;
                }

                // Auto read messages
                if (config.AUTO_READ) {
                    await this.sock.readMessages([message.key]);
                }

                // Auto typing indicator
                if (config.AUTO_TYPING) {
                    await this.sock.sendPresenceUpdate('composing', message.key.remoteJid);
                }

                // Get message content
                const messageType = getContentType(message.message);
                const text = message.message?.conversation || 
                           message.message?.extendedTextMessage?.text || 
                           message.message?.imageMessage?.caption || '';

                const jid = message.key.remoteJid;
                const sender = message.key.participant || jid;
                const isGroup = jid.endsWith('@g.us');
                const pushName = message.pushName || 'User';

                // Check if message starts with prefix
                if (text.startsWith(config.PREFIX)) {
                    const args = text.slice(config.PREFIX.length).trim().split(/ +/);
                    const command = args.shift().toLowerCase();

                    // Check if command exists
                    if (this.commands[command]) {
                        await this.commands[command]({
                            jid,
                            sender,
                            isGroup,
                            pushName,
                            args,
                            message,
                            sock: this.sock
                        });
                    } else {
                        // Try plugin command
                        await this.pluginManager.executePlugin(command, {
                            jid,
                            sender,
                            isGroup,
                            pushName,
                            args,
                            message,
                            sock: this.sock,
                            bot: this
                        });
                    }
                }

                // Reset typing
                if (config.AUTO_TYPING) {
                    setTimeout(async () => {
                        await this.sock.sendPresenceUpdate('paused', jid);
                    }, 1000);
                }

            } catch (error) {
                logMessage('ERROR', `Message handling error: ${error.message}`);
            }
        }
    }

    async handlePollUpdate(update) {
        try {
            const pollCreation = await this.store.getMessage(update.key);
            if (pollCreation) {
                logMessage('INFO', 'Poll update received');
                // Handle poll updates here
            }
        } catch (error) {
            logMessage('ERROR', `Poll update error: ${error.message}`);
        }
    }

    async handleGroupParticipantsUpdate(event) {
        const { id, participants, action } = event;
        
        if (action === 'add' && config.OWNER_NUMBER) {
            const metadata = await this.sock.groupMetadata(id);
            const botNumber = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
            
            if (participants.includes(botNumber)) {
                await this.sendMessage(id, {
                    text: `🤖 *${config.BOT_NAME} Activated!*\n\nType ${config.PREFIX}menu to see commands!\n\n📌 *Bot Features:*\n• Advanced Commands\n• Media Processing\n• Group Management\n• Plugin System`
                });
            }
        }
    }

    // Command Handlers
    async helpCommand(context) {
        const { jid, sock } = context;
        
        const helpText = `*${config.BOT_NAME} Help Menu*\n\n` +
                        `*Prefix:* ${config.PREFIX}\n\n` +
                        `*Core Commands:*\n` +
                        `• ${config.PREFIX}menu - Show main menu\n` +
                        `• ${config.PREFIX}ping - Check bot speed\n` +
                        `• ${config.PREFIX}owner - Contact owner\n` +
                        `• ${config.PREFIX}stats - Bot statistics\n` +
                        `• ${config.PREFIX}help - This help menu\n\n` +
                        `*Plugin Commands:*\n` +
                        `• Loaded from ${config.PLUGINS_DIR} folder\n\n` +
                        `📍 *Silva Tech Nexus*`;
        
        await sock.sendMessage(jid, { text: helpText });
    }

    async menuCommand(context) {
        const { jid, sock } = context;
        
        const menuText = `┌─「 *${config.BOT_NAME}* 」\n` +
                        `│\n` +
                        `│ ʜᴇʟʟᴏ! ɪ'ᴍ ${config.BOT_NAME}\n` +
                        `│ ᴀɴ ᴀᴅᴠᴀɴᴄᴇᴅ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛ\n` +
                        `│\n` +
                        `├─「 *ᴜsᴇʀ* 」\n` +
                        `│ • ${config.PREFIX}ping\n` +
                        `│ • ${config.PREFIX}owner\n` +
                        `│ • ${config.PREFIX}help\n` +
                        `│\n` +
                        `├─「 *ᴍᴇᴅɪᴀ* 」\n` +
                        `│ • ${config.PREFIX}sticker\n` +
                        `│ • ${config.PREFIX}toimg\n` +
                        `│ • ${config.PREFIX}tts\n` +
                        `│\n` +
                        `├─「 *ᴛᴏᴏʟs* 」\n` +
                        `│ • ${config.PREFIX}calc\n` +
                        `│ • ${config.PREFIX}wiki\n` +
                        `│ • ${config.PREFIX}weather\n` +
                        `│\n` +
                        `└─「 *sɪʟᴠᴀ ᴛᴇᴄʜ* 」\n\n` +
                        `📌 *ᴘʟᴜɢɪɴs:* ${this.pluginManager.plugins.size} loaded\n` +
                        `⚡ *ᴜᴘᴛɪᴍᴇ:* ${process.uptime().toFixed(2)}s\n` +
                        `🔧 *ᴍᴏᴅᴇ:* Production`;
        
        await sock.sendMessage(jid, { text: menuText });
    }

    async pingCommand(context) {
        const { jid, sock } = context;
        const start = Date.now();
        
        await sock.sendMessage(jid, { text: '🏓 Pong!' });
        const latency = Date.now() - start;
        
        await sock.sendMessage(jid, { 
            text: `*Pong!*\n\n` +
                  `⚡ *Latency:* ${latency}ms\n` +
                  `📊 *Uptime:* ${(process.uptime() / 3600).toFixed(2)} hours\n` +
                  `💾 *Memory:* ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB`
        });
    }

    async ownerCommand(context) {
        const { jid, sock } = context;
        
        if (config.OWNER_NUMBER) {
            await sock.sendMessage(jid, {
                text: `👑 *Bot Owner*\n\n` +
                      `📞 *Contact:* ${config.OWNER_NUMBER.split('@')[0]}\n` +
                      `🤖 *Bot:* ${config.BOT_NAME}\n` +
                      `⚡ *Version:* 3.0.0\n\n` +
                      `For issues or suggestions, contact the owner directly.`
            });
        } else {
            await sock.sendMessage(jid, {
                text: 'Owner number not configured. Please set OWNER_NUMBER in environment variables.'
            });
        }
    }

    async statsCommand(context) {
        const { jid, sock } = context;
        
        const stats = {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            platform: process.platform,
            nodeVersion: process.version,
            plugins: this.pluginManager.plugins.size
        };
        
        const statsText = `📊 *Bot Statistics*\n\n` +
                         `⏱️ *Uptime:* ${(stats.uptime / 3600).toFixed(2)} hours\n` +
                         `💾 *Memory:* ${(stats.memory.heapUsed / 1024 / 1024).toFixed(2)}MB\n` +
                         `📦 *Platform:* ${stats.platform}\n` +
                         `⚡ *Node.js:* ${stats.nodeVersion}\n` +
                         `🔌 *Plugins:* ${stats.plugins}\n` +
                         `🌐 *Connection:* ${this.isConnected ? 'Connected ✅' : 'Disconnected ❌'}\n\n` +
                         `*Silva MD Bot v3.0*`;
        
        await sock.sendMessage(jid, { text: statsText });
    }

    async sendMessage(jid, content, options = {}) {
        try {
            // Add global context info to all messages
            const messageOptions = {
                ...globalContextInfo,
                ...options
            };
            
            return await this.sock.sendMessage(jid, content, messageOptions);
        } catch (error) {
            logMessage('ERROR', `Send message error: ${error.message}`);
            return null;
        }
    }

    async downloadMedia(message, type = 'buffer') {
        try {
            return await downloadMediaMessage(
                message,
                type,
                {},
                {
                    logger,
                    reuploadRequest: this.sock.updateMediaMessage
                }
            );
        } catch (error) {
            logMessage('ERROR', `Download media error: ${error.message}`);
            return null;
        }
    }
}

// Create and start the bot
const bot = new SilvaBot();

// Handle process events
process.on('unhandledRejection', (reason, promise) => {
    logMessage('ERROR', `Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

process.on('uncaughtException', (error) => {
    logMessage('ERROR', `Uncaught Exception: ${error.message}`);
    logMessage('ERROR', error.stack);
});

// Start the bot
bot.init();

// Export for use in plugins
module.exports = {
    SilvaBot,
    bot,
    config,
    logger: {
        info: (msg) => logMessage('INFO', msg),
        error: (msg) => logMessage('ERROR', msg),
        success: (msg) => logMessage('SUCCESS', msg)
    }
};
