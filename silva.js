// ==============================
// 📦 IMPORTS SECTION
// ==============================
const {
    makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    Browsers,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    delay
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

// Import from lib folder
const Functions = require('./lib/functions.js');
const StatusHandler = require('./lib/status.js');
const NewsletterHandler = require('./lib/newsletter.js');
const AntideleteHandler = require('./lib/antidelete.js');

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
// 🪵 LOGGER SECTION
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
    constructor(functions, config) {
        this.commandHandlers = new Map();
        this.pluginInfo = new Map();
        this.functions = functions;
        this.config = config;
    }

    async loadPlugins(dir = 'silvaxlab') {
        try {
            const pluginDir = path.join(__dirname, dir);
            
            if (!fs.existsSync(pluginDir)) {
                fs.mkdirSync(pluginDir, { recursive: true });
                this.functions.logger.log('INFO', "Created plugin directory: " + dir);
                this.createExamplePlugins(pluginDir);
                return;
            }

            const pluginFiles = fs.readdirSync(pluginDir)
                .filter(file => file.endsWith('.js') && !file.startsWith('_'));

            this.functions.logger.log('INFO', "Found " + pluginFiles.length + " plugin(s) in " + dir);

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
                        
                        this.functions.logger.log('SUCCESS', "✅ Loaded plugin: " + file.replace('.js', ''));
                    } else {
                        this.functions.logger.log('WARNING', "Plugin " + file + " has invalid format");
                    }
                } catch (error) {
                    this.functions.logger.log('ERROR', "Failed to load plugin " + file + ": " + error.message);
                }
            }
        } catch (error) {
            this.functions.logger.log('ERROR', "Plugin loading error: " + error.message);
        }
    }

    createExamplePlugins(pluginDir) {
        // Create example plugins if needed
        const examplePlugin = {
            name: '_example.js',
            content: `module.exports = {
                handler: {
                    command: /^example$/i,
                    help: ['Example command', 'Usage: .example'],
                    tags: ['example'],
                    group: false,
                    owner: false,
                    async execute(context) {
                        const { jid, sock, message } = context;
                        await sock.sendMessage(jid, {
                            text: 'This is an example plugin!'
                        }, { quoted: message });
                    }
                }
            };`
        };
        
        fs.writeFileSync(path.join(pluginDir, examplePlugin.name), examplePlugin.content);
        this.functions.logger.log('INFO', "Created example plugin");
    }

    async executeCommand(context) {
        const { text, jid, sender, isGroup, message, sock, args } = context;
        
        this.functions.logger.log('COMMAND', `🔄 Processing command: ${text} from ${sender}`);
        
        // Check if user is allowed
        if (!this.functions.isAllowed(sender, jid, this.config)) {
            if (this.config.BOT_MODE === 'private') {
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
                    // Check permissions
                    if (handler.owner && !this.functions.isOwner(sender)) {
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
                    this.functions.logger.log('COMMAND', `✅ Executing plugin command: ${commandMatch} for ${sender}`);
                    await handler.execute(context);
                    return true;
                    
                } catch (error) {
                    this.functions.logger.log('ERROR', "Command error: " + error.message);
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
// 🤖 MAIN BOT CLASS (CLEANER VERSION)
// ==============================
class SilvaBot {
    constructor() {
        this.sock = null;
        this.store = new MessageStore();
        this.groupCache = new NodeCache({ stdTTL: 300, useClones: false });
        this.isConnected = false;
        this.logger = botLogger;
        
        // Initialize functions with logger
        this.functions = new Functions(botLogger);
        
        // Initialize handlers from lib
        this.statusHandler = new StatusHandler(this, this.functions, config);
        this.newsletterHandler = new NewsletterHandler(this, this.functions, config);
        this.antideleteHandler = new AntideleteHandler(this, this.functions, config);
        
        // Initialize plugin manager
        this.pluginManager = new PluginManager(this.functions, config);
        
        // Reconnect settings
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
            antidelete: this.antideleteHandler.antideleteCommand.bind(this.antideleteHandler),
            statusview: this.statusHandler.statusviewCommand.bind(this.statusHandler),
            newsletter: this.newsletterHandler.newsletterCommand.bind(this.newsletterHandler)
        };
    }

    async init() {
        try {
            this.logger.log('BOT', "🚀 Starting " + config.BOT_NAME + " v" + config.VERSION);
            this.logger.log('INFO', "Mode: " + (config.BOT_MODE || 'public'));
            this.logger.log('INFO', "Owner: " + (config.OWNER_NUMBER || 'Not configured'));
            this.logger.log('INFO', "Prefix: " + config.PREFIX);
            
            if (config.SESSION_ID) {
                await loadSession();
            }

            await this.pluginManager.loadPlugins('silvaxlab');
            await this.connect();
        } catch (error) {
            this.logger.log('ERROR', "Init failed: " + error.message);
            setTimeout(() => this.init(), 10000);
        }
    }

    async connect() {
        try {
            this.reconnectAttempts++;
            
            if (this.reconnectAttempts > this.maxReconnectAttempts) {
                this.logger.log('ERROR', 'Max reconnection attempts reached');
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
                    return jid === 'status@broadcast' || jid.includes('@newsletter');
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
            this.logger.log('SUCCESS', '✅ Bot initialized');
            this.reconnectAttempts = 0;
        } catch (error) {
            this.logger.log('ERROR', "Connection error: " + error.message);
            await this.handleReconnect(error);
        }
    }

    async handleReconnect(error) {
        const delayTime = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
        this.logger.log('WARNING', "Reconnecting in " + (delayTime/1000) + "s (Attempt " + this.reconnectAttempts + "/" + this.maxReconnectAttempts + ")");
        
        await this.functions.sleep(delayTime);
        await this.connect();
    }

    setupEvents(saveCreds) {
        const sock = this.sock;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                this.logger.log('INFO', '📱 QR Code Generated');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                this.isConnected = false;
                this.stopKeepAlive();
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.message;
                
                this.logger.log('WARNING', "Connection closed. Status: " + statusCode + ", Reason: " + reason);
                
                if (statusCode === DisconnectReason.loggedOut) {
                    this.logger.log('ERROR', 'Logged out. Please scan QR again.');
                    this.cleanupSessions();
                    setTimeout(() => this.init(), 10000);
                } else {
                    await this.handleReconnect(lastDisconnect?.error);
                }
            } else if (connection === 'open') {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.logger.log('SUCCESS', '🔗 Connected to WhatsApp');
                
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
                        
                        const ownerNumbers = Array.isArray(config.OWNER_NUMBER) ? 
                            config.OWNER_NUMBER : [config.OWNER_NUMBER];
                        
                        for (const ownerNum of ownerNumbers) {
                            const ownerJid = this.functions.formatJid(ownerNum);
                            if (ownerJid) {
                                const now = new Date().toLocaleString();
                                const messageText = `
✅ *${config.BOT_NAME} Connected!*
Mode: ${config.BOT_MODE || 'public'}
Time: ${now}
Anti-delete: ${this.antideleteHandler.antiDeleteEnabled ? '✅' : '❌'}
Connected Number: ${this.functions.botNumber || 'Unknown'}
                                `.trim();
                                
                                await this.sendMessage(ownerJid, {
                                    text: messageText,
                                    contextInfo: {
                                        mentionedJid: [ownerJid],
                                        forwardingScore: 999,
                                        isForwarded: true
                                    }
                                });
                            }
                        }
                        
                        this.logger.log('INFO', 'Sent connected message to owner(s)');
                    } catch (error) {
                        this.logger.log('ERROR', 'Failed to send owner message: ' + error.message);
                    }
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            try {
                this.logger.log('MESSAGE', `📥 Received ${m.messages?.length || 0} message(s)`);
                
                // Handle status messages
                await this.statusHandler.handleStatusMessages(m.messages);
                
                // Handle newsletter messages
                for (const message of m.messages || []) {
                    if (message.key.remoteJid.includes('@newsletter')) {
                        await this.newsletterHandler.handleNewsletterMessage(message);
                    }
                }
                
                // Handle regular messages
                await this.handleMessages(m);
            } catch (error) {
                this.logger.log('ERROR', "Messages upsert error: " + error.message);
            }
        });

        // Handle message updates for anti-delete
        sock.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                try {
                    if (update.update && (update.update === 'delete' || update.update.messageStubType === 7)) {
                        await this.antideleteHandler.handleMessageDelete(update);
                    }
                } catch (error) {
                    this.logger.log('ERROR', "Message update error: " + error.message);
                }
            }
        });

        // Handle bulk message delete
        sock.ev.on('messages.delete', async (deletion) => {
            try {
                await this.antideleteHandler.handleBulkMessageDelete(deletion);
            } catch (error) {
                this.logger.log('ERROR', "Message delete error: " + error.message);
            }
        });

        // Handle group participants updates
        sock.ev.on('group-participants.update', async (event) => {
            try {
                if (this.sock.user && this.sock.user.id) {
                    const botJid = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    if (event.action === 'add' && event.participants.includes(botJid)) {
                        await this.sendMessage(event.id, {
                            text: '🤖 *' + config.BOT_NAME + ' Activated!*\nType ' + config.PREFIX + 'menu for commands'
                        });
                        this.logger.log('INFO', 'Bot added to group: ' + event.id);
                    }
                }
            } catch (error) {
                // Silent fail
            }
        });

        // Log outgoing messages
        sock.ev.on('messages.upsert', async (m) => {
            if (m.type === 'notify') {
                for (const msg of m.messages || []) {
                    if (msg.key.fromMe) {
                        this.logger.log('MESSAGE', `📤 Sent message to: ${msg.key.remoteJid}`);
                        // If this is a message sent by the bot to itself, we can detect the LID
                        if (msg.key.remoteJid.includes('@lid') && !this.functions.botLid) {
                            const lid = msg.key.remoteJid.split('@')[0];
                            this.functions.setBotLid(lid + '@lid');
                        }
                    }
                }
            }
        });
    }

    // Detect bot's LID by checking messages sent by the bot
    async detectBotLid() {
        try {
            // Send a test message to ourselves to detect LID
            if (this.functions.botNumber) {
                const botJid = this.functions.botNumber + '@s.whatsapp.net';
                await delay(1000);
                await this.sock.sendMessage(botJid, {
                    text: '🤖 *Bot Activated!*\nType ' + config.PREFIX + 'help for commands'
                });
                this.logger.log('INFO', 'Test message sent to detect LID');
            }
        } catch (error) {
            this.logger.log('ERROR', 'Failed to detect bot LID: ' + error.message);
        }
    }

    startKeepAlive() {
        this.stopKeepAlive();
        this.keepAliveInterval = setInterval(async () => {
            if (this.sock && this.isConnected) {
                try {
                    await this.sock.sendPresenceUpdate('available');
                } catch (error) {
                    // Silent fail
                }
            }
        }, 20000);
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
                this.logger.log('INFO', 'Sessions cleaned');
            }
        } catch (error) {
            // Silent fail
        }
    }

    // Handle incoming messages
    async handleMessages(m) {
        if (!m.messages || !Array.isArray(m.messages)) {
            return;
        }
        
        for (const message of m.messages) {
            try {
                // Skip status broadcasts and newsletter messages
                if (message.key.remoteJid === 'status@broadcast' || 
                    message.key.remoteJid.includes('@newsletter') ||
                    message.key.remoteJid.includes('@broadcast')) {
                    continue;
                }

                // Store message
                await this.store.setMessage(message.key, message);

                const jid = message.key.remoteJid;
                const sender = message.key.participant || jid;
                const isGroup = jid.endsWith('@g.us');
                const isFromMe = message.key.fromMe;
                
                // Log ALL messages
                this.logger.log('MESSAGE', `📨 Message from: ${sender} (FromMe: ${isFromMe}, Group: ${isGroup})`);
                
                // If message is fromMe and we don't have bot LID yet, store it
                if (isFromMe && sender.includes('@lid') && !this.functions.botLid) {
                    const lid = sender.split('@')[0];
                    this.functions.setBotLid(lid + '@lid');
                }

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
                } else if (message.message?.audioMessage) {
                    text = message.message.audioMessage?.caption || '';
                }
                
                if (text) {
                    this.logger.log('MESSAGE', `📝 Message text: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
                }

                // Check if message starts with prefix
                if (text && text.startsWith(config.PREFIX)) {
                    this.logger.log('COMMAND', `⚡ Command detected: ${text} from ${sender}`);
                    
                    // SPECIAL FIX: If message is fromMe, automatically treat as owner
                    const isOwner = isFromMe ? true : this.functions.isOwner(sender);
                    this.logger.log('COMMAND', `👑 Is owner: ${isOwner} (FromMe: ${isFromMe})`);
                    
                    const cmdText = text.slice(config.PREFIX.length).trim();
                    
                    // Send typing indicator
                    await this.sock.sendPresenceUpdate('composing', jid);
                    
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
                    
                    // Stop typing indicator
                    await this.sock.sendPresenceUpdate('paused', jid);
                    
                    // If no plugin handled it, try built-in commands
                    if (!executed) {
                        const args = cmdText.split(/ +/);
                        const command = args.shift().toLowerCase();
                        
                        if (this.commands[command]) {
                            this.logger.log('COMMAND', `🛠️ Executing built-in command: ${command} for ${sender}`);
                            await this.commands[command]({
                                jid,
                                sender,
                                isGroup,
                                args,
                                message,
                                sock: this.sock,
                                bot: this
                            });
                        } else {
                            // Auto reply for unknown commands
                            if (config.AUTO_REPLY) {
                                await this.sock.sendMessage(jid, {
                                    text: '❓ Unknown command. Type ' + config.PREFIX + 'help for available commands.'
                                }, { quoted: message });
                            }
                        }
                    }
                }

            } catch (error) {
                this.logger.log('ERROR', "Message handling error: " + error.message);
                this.logger.log('ERROR', "Stack: " + error.stack);
            }
        }
    }

    // ==============================
    // 💬 BUILT-IN COMMAND HANDLERS
    // ==============================
    
    async helpCommand(context) {
        const { jid, sock, message } = context;
        const plugins = this.pluginManager.getCommandList();
        
        let helpText = '*Silva MD Help Menu*\n\n';
        helpText += 'Prefix: ' + config.PREFIX + '\n';
        helpText += 'Mode: ' + (config.BOT_MODE || 'public') + '\n\n';
        helpText += '*Built-in Commands:*\n';
        helpText += '• ' + config.PREFIX + 'help - This menu\n';
        helpText += '• ' + config.PREFIX + 'menu - Main menu\n';
        helpText += '• ' + config.PREFIX + 'ping - Check status\n';
        helpText += '• ' + config.PREFIX + 'owner - Owner info\n';
        helpText += '• ' + config.PREFIX + 'plugins - List plugins\n';
        helpText += '• ' + config.PREFIX + 'stats - Bot statistics\n';
        helpText += '• ' + config.PREFIX + 'antidelete - Recover deleted messages\n';
        helpText += '• ' + config.PREFIX + 'statusview - Auto status settings\n';
        helpText += '• ' + config.PREFIX + 'newsletter - Newsletter handler\n';
        
        if (plugins.length > 0) {
            helpText += '\n*Loaded Plugins:*\n';
            for (const cmd of plugins) {
                helpText += '• ' + config.PREFIX + cmd.command + ' - ' + cmd.help + '\n';
            }
        }
        
        helpText += '\n📍 *Silva Tech Nexus*';
        
        await sock.sendMessage(jid, { text: helpText }, { quoted: message });
    }

    async menuCommand(context) {
        const { jid, sock, message } = context;
        const menuText = '┌─「 *Silva MD* 」─\n' +
                        '│\n' +
                        '│ ⚡ *BOT STATUS*\n' +
                        '│ • Mode: ' + (config.BOT_MODE || 'public') + '\n' +
                        '│ • Prefix: ' + config.PREFIX + '\n' +
                        '│ • Version: ' + config.VERSION + '\n' +
                        '│ • Anti-delete: ' + (this.antideleteHandler.antiDeleteEnabled ? '✅' : '❌') + '\n' +
                        '│\n' +
                        '│ 📋 *CORE COMMANDS*\n' +
                        '│ • ' + config.PREFIX + 'ping - Check bot status\n' +
                        '│ • ' + config.PREFIX + 'help - Show help\n' +
                        '│ • ' + config.PREFIX + 'owner - Show owner info\n' +
                        '│ • ' + config.PREFIX + 'menu - This menu\n' +
                        '│ • ' + config.PREFIX + 'plugins - List plugins\n' +
                        '│ • ' + config.PREFIX + 'stats - Bot statistics\n' +
                        '│ • ' + config.PREFIX + 'antidelete - Recover deleted messages\n' +
                        '│ • ' + config.PREFIX + 'statusview - Auto status settings\n' +
                        '│ • ' + config.PREFIX + 'newsletter - Newsletter handler\n' +
                        '│\n' +
                        '│ └─「 *SILVA TECH* 」';
        
        await sock.sendMessage(jid, { text: menuText }, { quoted: message });
    }

    async pingCommand(context) {
        const { jid, sock, message } = context;
        const start = Date.now();
        await sock.sendMessage(jid, { text: '🏓 Pong!' }, { quoted: message });
        const latency = Date.now() - start;
        
        await sock.sendMessage(jid, {
            text: '*Status Report*\n\n⚡ Latency: ' + latency + 'ms\n📊 Uptime: ' + (process.uptime() / 3600).toFixed(2) + 'h\n💾 RAM: ' + (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + 'MB\n🌐 Connection: ' + (this.isConnected ? 'Connected ✅' : 'Disconnected ❌') + '\n🚨 Anti-delete: ' + (this.antideleteHandler.antiDeleteEnabled ? 'Enabled ✅' : 'Disabled ❌') + '\n👁️ Auto-view: ' + (this.statusHandler.autoStatusView ? '✅' : '❌') + '\n❤️ Auto-like: ' + (this.statusHandler.autoStatusLike ? '✅' : '❌') + '\n🤖 Bot Number: ' + (this.functions.botNumber || 'Unknown') + '\n🔑 Bot LID: ' + (this.functions.botLid || 'Not detected')
        }, { quoted: message });
    }

    async ownerCommand(context) {
        const { jid, sock, message } = context;
        let ownerText = '👑 *Bot Owner*\n\n';
        
        if (this.functions.botNumber) {
            ownerText += `🤖 Connected Bot: ${this.functions.botNumber}\n`;
        }
        
        if (this.functions.botLid) {
            ownerText += `🔑 Bot LID: ${this.functions.botLid}\n`;
        }
        
        if (config.OWNER_NUMBER) {
            if (Array.isArray(config.OWNER_NUMBER)) {
                config.OWNER_NUMBER.forEach((num, idx) => {
                    ownerText += `📞 Owner ${idx + 1}: ${num}\n`;
                });
            } else {
                ownerText += `📞 Owner: ${config.OWNER_NUMBER}\n`;
            }
        }
        
        ownerText += `⚡ ${config.BOT_NAME} v${config.VERSION}`;
        
        await sock.sendMessage(jid, {
            text: ownerText
        }, { quoted: message });
    }

    async statsCommand(context) {
        const { jid, sock, message } = context;
        const statsText = '📊 *Bot Statistics*\n\n' +
                         '⏱️ Uptime: ' + (process.uptime() / 3600).toFixed(2) + 'h\n' +
                         '💾 Memory: ' + (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + 'MB\n' +
                         '📦 Platform: ' + process.platform + '\n' +
                         '🔌 Plugins: ' + this.pluginManager.getCommandList().length + '\n' +
                         '🚨 Deleted Msgs: ' + this.antideleteHandler.recentDeletedMessages.length + '\n' +
                         '👁️ Auto-View: ' + (this.statusHandler.autoStatusView ? '✅' : '❌') + '\n' +
                         '❤️ Auto-Like: ' + (this.statusHandler.autoStatusLike ? '✅' : '❌') + '\n' +
                         '📰 Newsletters: ' + this.newsletterHandler.followedNewsletters.size + '\n' +
                         '🌐 Status: ' + (this.isConnected ? 'Connected ✅' : 'Disconnected ❌') + '\n' +
                         '🤖 Bot: ' + config.BOT_NAME + ' v' + config.VERSION + '\n' +
                         '📱 Connected as: ' + (this.functions.botNumber || 'Unknown');
        
        await sock.sendMessage(jid, { text: statsText }, { quoted: message });
    }

    async pluginsCommand(context) {
        const { jid, sock, message } = context;
        const plugins = this.pluginManager.getCommandList();
        let pluginsText = '📦 *Loaded Plugins*\n\nTotal: ' + plugins.length + '\n\n';
        
        if (plugins.length === 0) {
            pluginsText += 'No plugins loaded.\nCheck silvaxlab folder.';
        } else {
            for (const plugin of plugins) {
                pluginsText += '• ' + config.PREFIX + plugin.command + ' - ' + plugin.help + '\n';
            }
        }
        
        await sock.sendMessage(jid, { text: pluginsText }, { quoted: message });
    }

    async startCommand(context) {
        const { jid, sock, message } = context;
        const startText = '✨ *Welcome to Silva MD!*\n\n' +
                         'I am an advanced WhatsApp bot with plugin support.\n\n' +
                         'Mode: ' + (config.BOT_MODE || 'public') + '\n' +
                         'Prefix: ' + config.PREFIX + '\n' +
                         'Anti-delete: ' + (this.antideleteHandler.antiDeleteEnabled ? 'Enabled ✅' : 'Disabled ❌') + '\n' +
                         'Auto-view: ' + (this.statusHandler.autoStatusView ? '✅' : '❌') + '\n' +
                         'Auto-like: ' + (this.statusHandler.autoStatusLike ? '✅' : '❌') + '\n\n' +
                         'Type ' + config.PREFIX + 'help for commands';
        
        await sock.sendMessage(jid, { 
            text: startText
        }, { quoted: message });
    }

    async sendMessage(jid, content, options = {}) {
        try {
            if (this.sock && this.isConnected) {
                this.logger.log('MESSAGE', `📤 Sending message to: ${jid}`);
                const result = await this.sock.sendMessage(jid, content, { ...globalContextInfo, ...options });
                this.logger.log('MESSAGE', `✅ Message sent successfully to: ${jid}`);
                return result;
            } else {
                this.logger.log('WARNING', 'Cannot send message: Bot not connected');
                return null;
            }
        } catch (error) {
            this.logger.log('ERROR', "Send error: " + error.message);
            return null;
        }
    }
}

// ==============================
// 🚀 BOT INSTANCE CREATION
// ==============================
const bot = new SilvaBot();

// Export bot instance for index.js
module.exports = {
    bot,
    config,
    logger: botLogger,
    functions: new Functions(botLogger)
};

// ==============================
// 🛡️ ERROR HANDLERS
// ==============================
process.on('uncaughtException', (error) => {
    botLogger.log('ERROR', `Uncaught Exception: ${error.message}`);
    botLogger.log('ERROR', `Stack: ${error.stack}`);
});

process.on('unhandledRejection', (reason, promise) => {
    botLogger.log('ERROR', `Unhandled Rejection at: ${promise}, reason: ${reason}`);
});
