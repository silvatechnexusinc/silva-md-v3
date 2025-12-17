// ==============================
// 📦 IMPORTS SECTION
// ==============================
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
    proto
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const NodeCache = require('node-cache');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// Import configuration
const config = require('./config.js');

// Import handlers
const statusHandler = require('./lib/status.js');
const newsletterHandler = require('./lib/newsletter.js');

// Global Context Info
const globalContextInfo = {
    forwardingScore: 999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363200367779016@newsletter',
        newsletterName: '◢◤ Silva Tech Nexus ◢◤',
        serverMessageId: 144
    }
};

// ==============================
// 🪵 LOGGER SECTION (ENHANCED FOR DEBUGGING)
// ==============================
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

// Enhanced logger for bot messages
class BotLogger {
    log(type, message) {
        const timestamp = new Date().toISOString();
        const colors = {
            SUCCESS: '\x1b[32m',
            ERROR: '\x1b[31m',
            INFO: '\x1b[36m',
            WARNING: '\x1b[33m',
            BOT: '\x1b[35m',
            DEBUG: '\x1b[90m',
            MESSAGE: '\x1b[34m',
            COMMAND: '\x1b[95m',
            RESET: '\x1b[0m'
        };
        console.log(`${colors[type] || colors.INFO}[${type}] ${timestamp} - ${message}${colors.RESET}`);
    }
}

const botLogger = new BotLogger();

// ==============================
// 🔐 SESSION MANAGEMENT
// ==============================
async function loadSession() {
    try {
        const credsPath = './sessions/creds.json';
        
        if (!fs.existsSync('./sessions')) {
            fs.mkdirSync('./sessions', { recursive: true });
        }
        
        // Clean old sessions if needed
        if (fs.existsSync(credsPath)) {
            try {
                fs.unlinkSync(credsPath);
                botLogger.log('INFO', "♻️ Old session removed");
            } catch (e) {
                // Ignore error
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

// ==============================
// 🔧 UTILITY FUNCTIONS (FIXED FOR LID OWNER DETECTION)
// ==============================
class FunctionsWrapper {
    constructor() {
        this.tempDir = path.join(__dirname, './temp');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        this.botNumber = null;
        this.botLid = null; // Store bot's LID
    }

    async isAdmin(message, sock) {
        if (!message.key.remoteJid.endsWith('@g.us')) return false;
        
        try {
            const metadata = await sock.groupMetadata(message.key.remoteJid);
            const participant = message.key.participant || message.key.remoteJid;
            const adminList = metadata.participants.filter(p => p.admin).map(p => p.id);
            return adminList.includes(participant);
        } catch {
            return false;
        }
    }

    isOwner(sender) {
        botLogger.log('DEBUG', `[OWNER CHECK] Checking if sender is owner: ${sender}`);
        
        // First: If message is from the bot itself (fromMe), it's automatically owner
        // We'll handle this in the message handler by checking fromMe flag
        
        // Extract phone number or LID from sender
        let phoneNumber = '';
        let isLid = false;
        
        if (sender.includes('@lid')) {
            // Handle LID format: 81712071631074@lid
            phoneNumber = sender.split('@')[0];
            isLid = true;
            botLogger.log('DEBUG', `[OWNER CHECK] Sender is LID: ${phoneNumber}`);
        } else if (sender.includes('@s.whatsapp.net')) {
            // Handle standard JID format: 254700143167@s.whatsapp.net
            phoneNumber = sender.split('@')[0];
            botLogger.log('DEBUG', `[OWNER CHECK] Sender is JID: ${phoneNumber}`);
        } else if (sender.includes(':')) {
            // Handle other formats with colon
            phoneNumber = sender.split(':')[0];
        } else {
            phoneNumber = sender;
        }
        
        // Clean the phone number (remove non-digits)
        const cleanSender = phoneNumber.replace(/[^0-9]/g, '');
        botLogger.log('DEBUG', `[OWNER CHECK] Cleaned sender: ${cleanSender}`);
        
        // Check 1: Is this the bot's LID?
        if (isLid && this.botLid) {
            const cleanBotLid = this.botLid.replace(/[^0-9]/g, '');
            if (cleanSender === cleanBotLid) {
                botLogger.log('DEBUG', '[OWNER CHECK] Sender is bot LID - GRANTING OWNER');
                return true;
            }
        }
        
        // Check 2: Is this the bot's phone number?
        if (this.botNumber) {
            const cleanBotNum = this.botNumber.replace(/[^0-9]/g, '');
            botLogger.log('DEBUG', `[OWNER CHECK] Bot number: ${cleanBotNum}`);
            if (cleanSender === cleanBotNum) {
                botLogger.log('DEBUG', '[OWNER CHECK] Sender is bot number - GRANTING OWNER');
                return true;
            }
        }
        
        // Check 3: Check against config owner numbers
        let ownerNumbers = [];
        if (config.OWNER_NUMBER) {
            if (Array.isArray(config.OWNER_NUMBER)) {
                ownerNumbers = config.OWNER_NUMBER.map(num => {
                    const cleanNum = num.replace(/[^0-9]/g, '');
                    botLogger.log('DEBUG', `[OWNER CHECK] Config owner: ${num} -> ${cleanNum}`);
                    return cleanNum;
                });
            } else if (typeof config.OWNER_NUMBER === 'string') {
                const cleanNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
                ownerNumbers = [cleanNum];
                botLogger.log('DEBUG', `[OWNER CHECK] Config owner: ${config.OWNER_NUMBER} -> ${cleanNum}`);
            }
        }
        
        // Check 4: Also check connected number from config
        if (config.CONNECTED_NUMBER) {
            const connectedNumber = config.CONNECTED_NUMBER.replace(/[^0-9]/g, '');
            ownerNumbers.push(connectedNumber);
            botLogger.log('DEBUG', `[OWNER CHECK] Connected number from config: ${connectedNumber}`);
        }
        
        // Remove duplicates
        ownerNumbers = [...new Set(ownerNumbers)];
        botLogger.log('DEBUG', `[OWNER CHECK] All owner numbers to check: ${ownerNumbers.join(', ')}`);
        
        // Check if sender matches any owner number
        const isOwner = ownerNumbers.some(ownerNum => {
            const match = cleanSender === ownerNum || 
                         cleanSender.endsWith(ownerNum) || 
                         ownerNum.endsWith(cleanSender);
            if (match) {
                botLogger.log('DEBUG', `[OWNER CHECK] Match found: ${cleanSender} === ${ownerNum}`);
            }
            return match;
        });
        
        botLogger.log('DEBUG', `[OWNER CHECK] Final result for ${cleanSender}: ${isOwner}`);
        return isOwner;
    }

    setBotNumber(number) {
        if (number) {
            this.botNumber = number.replace(/[^0-9]/g, '');
            botLogger.log('INFO', `🤖 Bot connected as: ${this.botNumber}`);
            
            // Also store as owner if not already in config
            if (config.OWNER_NUMBER) {
                const ownerNumbers = Array.isArray(config.OWNER_NUMBER) ? 
                    config.OWNER_NUMBER : [config.OWNER_NUMBER];
                const cleanBotNum = this.botNumber.replace(/[^0-9]/g, '');
                
                // Check if bot number is already in owner list
                const isAlreadyOwner = ownerNumbers.some(ownerNum => 
                    ownerNum.replace(/[^0-9]/g, '') === cleanBotNum
                );
                
                if (!isAlreadyOwner) {
                    botLogger.log('INFO', `✅ Added bot number ${this.botNumber} to owner list`);
                }
            }
        }
    }

    setBotLid(lid) {
        if (lid) {
            this.botLid = lid.split('@')[0]; // Store just the number part
            botLogger.log('INFO', `🔑 Bot LID detected: ${this.botLid}`);
        }
    }

    isAllowed(sender, jid) {
        // Owner is always allowed
        if (this.isOwner(sender)) {
            botLogger.log('INFO', `✅ Owner access granted for: ${sender}`);
            return true;
        }
        
        if (config.BOT_MODE === 'public') return true;
        
        if (config.BOT_MODE === 'private') {
            // Allow groups in private mode
            if (jid.endsWith('@g.us')) return true;
            
            // Check allowed users
            if (config.ALLOWED_USERS && Array.isArray(config.ALLOWED_USERS)) {
                const senderNumber = sender.split('@')[0].replace(/[^0-9]/g, '');
                const allowedNumbers = config.ALLOWED_USERS.map(num => num.replace(/[^0-9]/g, ''));
                return allowedNumbers.includes(senderNumber);
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

    // Extract text from message
    extractText(message) {
        if (!message) return '';
        
        if (message.conversation) {
            return message.conversation;
        } else if (message.extendedTextMessage?.text) {
            return message.extendedTextMessage.text;
        } else if (message.imageMessage?.caption) {
            return message.imageMessage.caption;
        } else if (message.videoMessage?.caption) {
            return message.videoMessage.caption;
        } else if (message.documentMessage?.caption) {
            return message.documentMessage.caption;
        } else if (message.audioMessage?.caption) {
            return message.audioMessage.caption;
        }
        return '';
    }
}

// ==============================
// 💾 STORE IMPLEMENTATION
// ==============================
class MessageStore {
    constructor() {
        this.messageCache = new NodeCache({ stdTTL: 3600 });
        this.chatCache = new NodeCache({ stdTTL: 300 });
        this.deletedMessages = new Map();
    }

    async getMessage(key) {
        return this.messageCache.get(key.id);
    }

    async setMessage(key, message) {
        this.messageCache.set(key.id, message);
    }

    async getChat(jid) {
        return this.chatCache.get(jid);
    }

    async setChat(jid, chat) {
        this.chatCache.set(jid, chat);
    }

    async saveDeletedMessage(key, message) {
        if (message && !message.key?.fromMe) {
            this.deletedMessages.set(key.id, {
                ...message,
                timestamp: Date.now(),
                deletedAt: Date.now()
            });
            
            setTimeout(() => {
                this.deletedMessages.delete(key.id);
            }, 300000);
        }
    }

    async getDeletedMessage(keyId) {
        return this.deletedMessages.get(keyId);
    }
}

// ==============================
// 🧩 PLUGIN MANAGER
// ==============================
class PluginManager {
    constructor() {
        this.commandHandlers = new Map();
        this.pluginInfo = new Map();
        this.functions = new FunctionsWrapper();
    }

    async loadPlugins(dir = 'silvaxlab') {
        try {
            const pluginDir = path.join(__dirname, dir);
            
            if (!fs.existsSync(pluginDir)) {
                fs.mkdirSync(pluginDir, { recursive: true });
                botLogger.log('INFO', "Created plugin directory: " + dir);
                this.createExamplePlugins(pluginDir);
                return;
            }

            const pluginFiles = fs.readdirSync(pluginDir)
                .filter(file => file.endsWith('.js') && !file.startsWith('_'));

            botLogger.log('INFO', "Found " + pluginFiles.length + " plugin(s) in " + dir);

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
                        
                        botLogger.log('SUCCESS', "✅ Loaded plugin: " + file.replace('.js', ''));
                    } else {
                        botLogger.log('WARNING', "Plugin " + file + " has invalid format");
                    }
                } catch (error) {
                    botLogger.log('ERROR', "Failed to load plugin " + file + ": " + error.message);
                }
            }
        } catch (error) {
            botLogger.log('ERROR', "Plugin loading error: " + error.message);
        }
    }

    createExamplePlugins(pluginDir) {
        // Create example plugins if needed
        const plugins = [];
        for (const plugin of plugins) {
            fs.writeFileSync(path.join(pluginDir, plugin.name), plugin.content);
            botLogger.log('INFO', "Created plugin: " + plugin.name);
        }
    }

    async executeCommand(context) {
        const { text, jid, sender, isGroup, message, sock, args } = context;
        
        botLogger.log('COMMAND', `🔄 Processing command: ${text} from ${sender}`);
        
        // Check if user is allowed
        if (!this.functions.isAllowed(sender, jid)) {
            if (config.BOT_MODE === 'private') {
                await sock.sendMessage(jid, { 
                    text: '🔒 Private mode: Contact owner for access.' 
                }, { quoted: message });
                return true;
            }
            return false;
        }
        
        for (const [commandRegex, handler] of this.commandHandlers.entries()) {
            const commandMatch = text.split(' ')[0];
            if (commandRegex.test(commandMatch)) {
                try {
                    // Check permissions - SPECIAL HANDLING FOR FROM_ME MESSAGES
                    if (handler.owner && !this.functions.isOwner(sender)) {
                        // If message is from bot itself (fromMe), allow it
                        if (!message.key.fromMe) {
                            await sock.sendMessage(jid, { text: '⚠️ Owner only command' }, { quoted: message });
                            return true;
                        }
                    }
                    
                    if (handler.group && !isGroup) {
                        await sock.sendMessage(jid, { text: '⚠️ Group only command' }, { quoted: message });
                        return true;
                    }
                    
                    if (handler.admin && isGroup) {
                        const isAdmin = await this.functions.isAdmin(message, sock);
                        if (!isAdmin) {
                            await sock.sendMessage(jid, { text: '⚠️ Admin required' }, { quoted: message });
                            return true;
                        }
                    }
                    
                    if (handler.botAdmin && isGroup) {
                        try {
                            const metadata = await sock.groupMetadata(jid);
                            const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                            const botParticipant = metadata.participants.find(p => p.id === botJid);
                            if (!botParticipant || !botParticipant.admin) {
                                await sock.sendMessage(jid, { text: '⚠️ Bot needs admin rights' }, { quoted: message });
                                return true;
                            }
                        } catch (e) {
                            // Ignore error
                        }
                    }
                    
                    // Execute command
                    botLogger.log('COMMAND', `✅ Executing plugin command: ${commandMatch} for ${sender}`);
                    await handler.execute(context);
                    return true;
                    
                } catch (error) {
                    botLogger.log('ERROR', "Command error: " + error.message);
                    await sock.sendMessage(jid, { 
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
                command: regex.replace(/[\/\^$]/g, ''),
                help: info.help[0] || 'No description',
                tags: info.tags,
                group: info.group,
                admin: info.admin
            });
        }
        return commands;
    }
}

// ==============================
// 🤖 MAIN BOT CLASS (WITH NEWSLETTER SUPPORT)
// ==============================
class SilvaBot {
    constructor() {
        this.sock = null;
        this.store = new MessageStore();
        this.groupCache = new NodeCache({ stdTTL: 300, useClones: false });
        this.pluginManager = new PluginManager();
        this.isConnected = false;
        this.functions = new FunctionsWrapper();
        
        // Settings
        this.antiDeleteEnabled = config.ANTIDELETE || true;
        this.recentDeletedMessages = [];
        this.maxDeletedMessages = 20;
        this.autoStatusView = config.AUTO_STATUS_VIEW || false;
        this.autoStatusLike = config.AUTO_STATUS_LIKE || false;
        this.autoFollowNewsletter = config.AUTO_FOLLOW_NEWSLETTER || false;
        this.newsletterCache = new NodeCache({ stdTTL: 3600 });
        
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000;
        this.keepAliveInterval = null;
        
        // Built-in commands
        this.commands = {
            help: this.helpCommand.bind(this),
            menu: this.menuCommand.bind(this),
            ping: this.pingCommand.bind(this),
            owner: this.ownerCommand.bind(this),
            stats: this.statsCommand.bind(this),
            plugins: this.pluginsCommand.bind(this),
            start: this.startCommand.bind(this),
            antidelete: this.antideleteCommand.bind(this),
            statusview: this.statusviewCommand.bind(this),
            newsletter: this.newsletterCommand.bind(this)
        };
    }

    async init() {
        try {
            botLogger.log('BOT', "🚀 Starting " + config.BOT_NAME + " v" + config.VERSION);
            botLogger.log('INFO', "Mode: " + (config.BOT_MODE || 'public'));
            botLogger.log('INFO', "Owner: " + (config.OWNER_NUMBER || 'Not configured'));
            botLogger.log('INFO', "Prefix: " + config.PREFIX);
            
            if (config.SESSION_ID) {
                await loadSession();
            }

            await this.pluginManager.loadPlugins('silvaxlab');
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
            const { version } = await fetchLatestBaileysVersion();
            
            this.sock = makeWASocket({
                version,
                logger: logger,
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
                retryRequestDelayMs: 3000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 25000,
                emitOwnEvents: true,
                fireInitQueries: true,
                mobile: false,
                shouldIgnoreJid: (jid) => {
                    if (!jid || typeof jid !== 'string') {
                        return false;
                    }
                    // We don't want to ignore newsletters anymore since we're handling them
                    return jid === 'status@broadcast';
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
            botLogger.log('SUCCESS', '✅ Bot initialized');
            this.reconnectAttempts = 0;
        } catch (error) {
            botLogger.log('ERROR', "Connection error: " + error.message);
            await this.handleReconnect(error);
        }
    }

    async handleReconnect(error) {
        const delayTime = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
        botLogger.log('WARNING', "Reconnecting in " + (delayTime/1000) + "s (Attempt " + this.reconnectAttempts + "/" + this.maxReconnectAttempts + ")");
        
        await this.functions.sleep(delayTime);
        await this.connect();
    }

    setupEvents(saveCreds) {
        const sock = this.sock;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                botLogger.log('INFO', '📱 QR Code Generated');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                this.isConnected = false;
                this.stopKeepAlive();
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.message;
                
                botLogger.log('WARNING', "Connection closed. Status: " + statusCode + ", Reason: " + reason);
                
                if (statusCode === DisconnectReason.loggedOut) {
                    botLogger.log('ERROR', 'Logged out. Please scan QR again.');
                    this.cleanupSessions();
                    setTimeout(() => this.init(), 10000);
                } else {
                    await this.handleReconnect(lastDisconnect?.error);
                }
            } else if (connection === 'open') {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                botLogger.log('SUCCESS', '🔗 Connected to WhatsApp');
                
                // Set bot's connected number
                if (sock.user && sock.user.id) {
                    const botNumber = sock.user.id.split(':')[0];
                    this.functions.setBotNumber(botNumber);
                    
                    // Try to detect bot's LID by sending a test message to itself
                    this.detectBotLid();
                }
                
                this.startKeepAlive();
                
                // Send connection message to owner
                if (config.OWNER_NUMBER) {
                    try {
                        await delay(2000);

                        const ownerNumbers = Array.isArray(config.OWNER_NUMBER)
                            ? config.OWNER_NUMBER
                            : [config.OWNER_NUMBER];

                        for (const ownerNum of ownerNumbers) {
                            const ownerJid = this.functions.formatJid(ownerNum);
                            if (!ownerJid) continue;

                            const now = new Date().toLocaleString();

                            const messageText = `
✅ *${config.BOT_NAME} Connected!*
Mode: ${config.BOT_MODE || 'public'}
Time: ${now}
Anti-delete: ${this.antiDeleteEnabled ? '✅' : '❌'}
Auto-follow Newsletter: ${this.autoFollowNewsletter ? '✅' : '❌'}
Connected Number: ${this.functions.botNumber || 'Unknown'}
                            `.trim();

                            await this.sendMessage(ownerJid, {
                                text: messageText,
                                contextInfo: {
                                    mentionedJid: [ownerJid],
                                    forwardingScore: 999,
                                    isForwarded: true,
                                    forwardedNewsletterMessageInfo: {
                                        newsletterJid: "120363200367779016@newsletter",
                                        newsletterName: "SILVA WELCOMES YOU 💖🥰",
                                        serverMessageId: 143
                                    }
                                }
                            });
                        }
                        botLogger.log('INFO', 'Sent connected message to owner(s)');
                    } catch (error) {
                        botLogger.log('ERROR', 'Failed to send owner message: ' + error.message);
                    }
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            try {
                const { messages, type } = m;
                botLogger.log('MESSAGE', `📥 Received ${messages?.length || 0} message(s) of type: ${type}`);
                
                // First, handle status updates using the status handler
                await statusHandler.handle({
                    messages,
                    type,
                    sock,
                    config,
                    logMessage: (level, msg) => {
                        console.log(`[${level}] ${msg}`);
                    },
                    unwrapStatus: this.unwrapStatus.bind(this),
                    saveMedia: this.saveMedia.bind(this)
                });
                
                // Then handle newsletter messages
                await newsletterHandler.handle({
                    messages,
                    type,
                    sock,
                    config,
                    logMessage: (level, msg) => {
                        console.log(`[${level}] ${msg}`);
                    },
                    unwrapNewsletter: this.unwrapNewsletter.bind(this),
                    saveMedia: this.saveMedia.bind(this),
                    bot: this
                });
                
                // Then handle regular messages
                await this.handleMessages(m);
            } catch (error) {
                botLogger.log('ERROR', "Messages upsert error: " + error.message);
            }
        });

        // Handle message updates
        sock.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                try {
                    if (update.update && (update.update === 'delete' || update.update.messageStubType === 7)) {
                        await this.handleMessageDelete(update);
                    }
                } catch (error) {
                    botLogger.log('ERROR', "Message update error: " + error.message);
                }
            }
        });

        // Handle message delete events
        sock.ev.on('messages.delete', async (deletion) => {
            try {
                await this.handleBulkMessageDelete(deletion);
            } catch (error) {
                botLogger.log('ERROR', "Message delete error: " + error.message);
            }
        });

        // Handle group participants updates
        sock.ev.on('group-participants
