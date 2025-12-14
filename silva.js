const {
    makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    downloadMediaMessage,
    getContentType,
    Browsers,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    proto,
    delay
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const NodeCache = require('node-cache');
const qrcode = require('qrcode-terminal');

// Import configuration
const config = require('./config.js');

// Global Context Info
const globalContextInfo = {
    forwardingScore: 999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363200367779016@newsletter',
        newsletterName: '◢◤ Silva Tech Nexus',
        serverMessageId: 144
    }
};

// FIXED LOGGER - Using simpler logger for Heroku
const logger = {
    level: 'error',
    trace: () => {},
    debug: () => {},
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    fatal: (...args) => console.error('[FATAL]', ...args)
};

// Custom logger
class BotLogger {
    log(type, message) {
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
}

const botLogger = new BotLogger();

// Load Session from Compressed Base64
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
                // Ignore errors if file doesn't exist
            }
        }

        if (!config.SESSION_ID || typeof config.SESSION_ID !== 'string') {
            botLogger.log('WARNING', "SESSION_ID is missing or invalid, will use QR");
            return false;
        }

        const [header, b64data] = config.SESSION_ID.split('~');

        if (header !== "Silva" || !b64data) {
            botLogger.log('ERROR', "Invalid session format. Expected 'Silva~.....'");
            return false;
        }

        const cleanB64 = b64data.replace('...', '');
        const compressedData = Buffer.from(cleanB64, 'base64');
        const decompressedData = zlib.gunzipSync(compressedData);

        fs.writeFileSync(credsPath, decompressedData, "utf8");
        botLogger.log('SUCCESS', "✅ New session loaded successfully");

        return true;
    } catch (e) {
        botLogger.log('ERROR', `Session Error: ${e.message}`);
        botLogger.log('WARNING', "Falling back to QR code authentication");
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
        if (!config.OWNER_NUMBER) return false;
        
        let ownerJid = config.OWNER_NUMBER;
        if (!ownerJid.includes('@s.whatsapp.net')) {
            ownerJid = ownerJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        }
        
        return sender === ownerJid;
    }

    isAllowed(sender, jid) {
        if (this.isOwner(sender)) return true;
        
        if (config.BOT_MODE === 'public') return true;
        
        if (config.BOT_MODE === 'private') {
            if (jid.endsWith('@g.us')) {
                return true;
            }
            
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
}

// Store Implementation
class MessageStore {
    constructor() {
        this.messages = new Map();
        this.chats = new Map();
        this.contacts = new Map();
        this.deletedMessages = new Map();
        this.viewOnceMessages = new Map();
    }

    async getMessage(key) {
        return this.messages.get(key.id);
    }

    async setMessage(key, message) {
        this.messages.set(key.id, message);
        
        if (message.message?.viewOnceMessage || 
            message.message?.ephemeralMessage?.message?.viewOnceMessage) {
            this.viewOnceMessages.set(key.id, {
                ...message,
                timestamp: Date.now(),
                from: key.remoteJid
            });
        }
    }

    async getChat(jid) {
        return this.chats.get(jid);
    }

    async setChat(jid, chat) {
        this.chats.set(jid, chat);
    }

    async storeDeletedMessage(key, message) {
        this.deletedMessages.set(key.id, {
            ...message,
            deletedAt: Date.now(),
            from: key.remoteJid,
            participant: key.participant
        });
    }

    async getDeletedMessage(key) {
        return this.deletedMessages.get(key.id);
    }

    async getViewOnceMessage(key) {
        return this.viewOnceMessages.get(key.id);
    }
}

// Plugin Manager
class PluginManager {
    constructor() {
        this.plugins = new Map();
        this.commandHandlers = new Map();
        this.pluginInfo = new Map();
        this.functions = new Functions();
    }

    async loadPlugins(dir = 'silvaxlab') {
        try {
            const pluginDir = path.join(__dirname, dir);
            
            if (!fs.existsSync(pluginDir)) {
                fs.mkdirSync(pluginDir, { recursive: true });
                botLogger.log('INFO', `Created plugin directory: ${dir}`);
                
                this.createExamplePlugins(pluginDir);
                return;
            }

            const pluginFiles = fs.readdirSync(pluginDir)
                .filter(file => file.endsWith('.js') && !file.startsWith('_'));

            botLogger.log('INFO', `Found ${pluginFiles.length} plugin(s) in ${dir}`);

            for (const file of pluginFiles) {
                try {
                    const pluginPath = path.join(pluginDir, file);
                    delete require.cache[require.resolve(pluginPath)];
                    
                    const pluginModule = require(pluginPath);
                    const pluginName = file.replace('.js', '');
                    
                    if (pluginModule.handler && pluginModule.handler.command) {
                        this.commandHandlers.set(pluginModule.handler.command, pluginModule.handler);
                        
                        this.pluginInfo.set(pluginModule.handler.command.source, {
                            help: pluginModule.handler.help || [],
                            tags: pluginModule.handler.tags || [],
                            group: pluginModule.handler.group !== undefined ? pluginModule.handler.group : false,
                            admin: pluginModule.handler.admin || false,
                            botAdmin: pluginModule.handler.botAdmin || false,
                            owner: pluginModule.handler.owner || false,
                            filename: file
                        });
                        
                        botLogger.log('SUCCESS', `✅ Loaded plugin: ${pluginName}`);
                    } else if (typeof pluginModule === 'function') {
                        this.convertLegacyPlugin(pluginName, pluginModule, file);
                    } else {
                        botLogger.log('WARNING', `Plugin ${file} doesn't export a handler or function`);
                    }
                } catch (error) {
                    botLogger.log('ERROR', `Failed to load plugin ${file}: ${error.message}`);
                }
            }
        } catch (error) {
            botLogger.log('ERROR', `Plugin loading error: ${error.message}`);
        }
    }

    createExamplePlugins(pluginDir) {
        const examplePlugins = {
            'sticker.js': `
// Sticker maker plugin
handler.help = ['sticker', 'stiker'];
handler.tags = ['media'];
handler.command = /^(sticker|stiker|s)$/i;
handler.group = false;
handler.admin = false;
handler.botAdmin = false;

handler.code = async ({ jid, sock, message }) => {
    try {
        const mime = message.message?.imageMessage?.mimetype || 
                    message.message?.videoMessage?.mimetype;
        
        if (!mime) {
            return await sock.sendMessage(jid, {
                text: '🖼️ Please send an image/video with caption .sticker'
            }, { quoted: message });
        }
        
        await sock.sendMessage(jid, {
            text: 'Processing sticker... ⏳'
        }, { quoted: message });
        
        await sock.sendMessage(jid, {
            text: '✅ Sticker created! (This is a demo)'
        }, { quoted: message });
    } catch (error) {
        await sock.sendMessage(jid, {
            text: \`❌ Error: \${error.message}\`
        }, { quoted: message });
    }
};
`,
            'ping.js': `
// Ping command
handler.help = ['ping'];
handler.tags = ['info'];
handler.command = /^ping$/i;
handler.group = false;
handler.admin = false;
handler.botAdmin = false;

handler.code = async ({ jid, sock, message }) => {
    const start = Date.now();
    await sock.sendMessage(jid, { text: 'Pong! 🏓' }, { quoted: message });
    const latency = Date.now() - start;
    
    await sock.sendMessage(jid, {
        text: \`*Ping Statistics:*\\n\\n⚡ Latency: \${latency}ms\\n📊 Uptime: \${(process.uptime() / 3600).toFixed(2)} hours\\n💾 RAM: \${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB\`
    }, { quoted: message });
};
`
        };

        for (const [filename, content] of Object.entries(examplePlugins)) {
            fs.writeFileSync(path.join(pluginDir, filename), content.trim());
            botLogger.log('INFO', `Created example plugin: ${filename}`);
        }
    }

    convertLegacyPlugin(name, pluginFunc, filename) {
        const handler = {
            help: [name],
            tags: ['legacy'],
            command: new RegExp(`^${name}$`, 'i'),
            group: false,
            admin: false,
            botAdmin: false,
            owner: false,
            code: pluginFunc
        };
        
        this.commandHandlers.set(handler.command, handler);
        this.pluginInfo.set(handler.command.source, {
            help: handler.help,
            tags: handler.tags,
            group: handler.group,
            admin: handler.admin,
            botAdmin: handler.botAdmin,
            owner: handler.owner,
            filename: filename
        });
        
        botLogger.log('INFO', `📦 Converted legacy plugin: ${name}`);
    }

    async executeCommand(context) {
        const { text, jid, sender, isGroup, message, sock, args } = context;
        
        if (!this.functions.isAllowed(sender, jid)) {
            if (config.BOT_MODE === 'private') {
                await sock.sendMessage(jid, { 
                    text: '🔒 This bot is in private mode. Only allowed users can use commands.' 
                }, { quoted: message });
                return true;
            }
            return false;
        }
        
        for (const [commandRegex, handler] of this.commandHandlers.entries()) {
            if (commandRegex.test(text.split(' ')[0])) {
                try {
                    if (handler.owner && !this.functions.isOwner(sender)) {
                        await sock.sendMessage(jid, { 
                            text: '⚠️ This command is only for the bot owner.' 
                        }, { quoted: message });
                        return true;
                    }
                    
                    if (handler.group && !isGroup) {
                        await sock.sendMessage(jid, { 
                            text: '⚠️ This command only works in groups.' 
                        }, { quoted: message });
                        return true;
                    }
                    
                    if (handler.admin && isGroup) {
                        const isAdmin = await this.functions.isAdmin(message, sock);
                        if (!isAdmin) {
                            await sock.sendMessage(jid, { 
                                text: '⚠️ This command requires admin privileges.' 
                            }, { quoted: message });
                            return true;
                        }
                    }
                    
                    if (handler.botAdmin && isGroup) {
                        const metadata = await sock.groupMetadata(jid);
                        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                        const botParticipant = metadata.participants.find(p => p.id === botJid);
                        
                        if (!botParticipant || !botParticipant.admin) {
                            await sock.sendMessage(jid, { 
                                text: "❌ I need to be an admin to execute this command." 
                            }, { quoted: message });
                            return true;
                        }
                    }
                    
                    await handler.code(context);
                    return true;
                    
                } catch (error) {
                    botLogger.log('ERROR', `Command execution error: ${error.message}`);
                    await sock.sendMessage(jid, { 
                        text: `❌ Command error: ${error.message}` 
                    }, { quoted: message });
                    return true;
                }
            }
        }
        
        return false;
    }

    getPluginInfo() {
        return this.pluginInfo;
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

// Main Bot Class
class SilvaBot {
    constructor() {
        this.sock = null;
        this.store = new MessageStore();
        this.groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false });
        this.pluginManager = new PluginManager();
        this.isConnected = false;
        this.qrCode = null;
        this.functions = new Functions();
        
        // Connection management
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000;
        
        this.statusCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
        this.viewOnceReveal = config.AUTO_VIEW_ONCE_REVEAL || false;
        
        // Built-in commands
        this.commands = {
            help: this.helpCommand.bind(this),
            menu: this.menuCommand.bind(this),
            ping: this.pingCommand.bind(this),
            owner: this.ownerCommand.bind(this),
            stats: this.statsCommand.bind(this),
            plugins: this.pluginsCommand.bind(this),
            start: this.startCommand.bind(this),
            mode: this.modeCommand.bind(this),
            deleted: this.deletedCommand.bind(this),
            reveal: this.revealCommand.bind(this)
        };
    }

    async init() {
        try {
            botLogger.log('BOT', `🚀 Starting ${config.BOT_NAME} v${config.VERSION}`);
            botLogger.log('INFO', `Mode: ${config.BOT_MODE || 'public'}`);
            
            // Clean sessions directory
            this.cleanSessions();
            
            if (config.SESSION_ID) {
                await loadSession();
            }

            await this.pluginManager.loadPlugins('silvaxlab');
            await this.connect();
        } catch (error) {
            botLogger.log('ERROR', `Initialization failed: ${error.message}`);
            setTimeout(() => this.init(), 10000);
        }
    }

    cleanSessions() {
        try {
            const sessionsDir = './sessions';
            if (fs.existsSync(sessionsDir)) {
                const files = fs.readdirSync(sessionsDir);
                for (const file of files) {
                    if (file.endsWith('.json')) {
                        const filePath = path.join(sessionsDir, file);
                        const stats = fs.statSync(filePath);
                        const now = Date.now();
                        const fileAge = now - stats.mtimeMs;
                        
                        // Delete files older than 1 hour
                        if (fileAge > 3600000) {
                            fs.unlinkSync(filePath);
                            botLogger.log('INFO', `Cleaned old session file: ${file}`);
                        }
                    }
                }
            }
        } catch (error) {
            botLogger.log('ERROR', `Clean sessions error: ${error.message}`);
        }
    }

    async connect() {
        try {
            this.reconnectAttempts++;
            
            if (this.reconnectAttempts > this.maxReconnectAttempts) {
                botLogger.log('ERROR', 'Max reconnection attempts reached. Restarting...');
                this.reconnectAttempts = 0;
                setTimeout(() => this.init(), 30000);
                return;
            }

            const { state, saveCreds } = await useMultiFileAuthState('./sessions');
            
            // Use specific Baileys version for stability
            const { version } = await fetchLatestBaileysVersion();
            
            this.sock = makeWASocket({
                version,
                logger: config.DEBUG_MODE ? logger : { level: 'warn' },
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
                getMessage: async (key) => await this.store.getMessage(key),
                retryRequestDelayMs: 3000,
                connectTimeoutMs: 60000, // Increased timeout for Heroku
                keepAliveIntervalMs: 30000, // Keep connection alive
                emitOwnEvents: true,
                printQRInTerminal: false,
                fireInitQueries: true,
                mobile: false // Desktop connection
            });

            this.setupEvents(saveCreds);
            botLogger.log('SUCCESS', '✅ Bot initialized successfully');
            this.reconnectAttempts = 0; // Reset on successful connection
        } catch (error) {
            botLogger.log('ERROR', `Connection error: ${error.message}`);
            await this.handleReconnect(error);
        }
    }

    async handleReconnect(error) {
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts), 30000);
        botLogger.log('WARNING', `Reconnecting in ${delay/1000} seconds... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        await this.functions.sleep(delay);
        await this.connect();
    }

    setupEvents(saveCreds) {
        const sock = this.sock;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                this.qrCode = qr;
                botLogger.log('INFO', '📱 QR Code Generated:');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                this.isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const error = lastDisconnect?.error;
                
                botLogger.log('WARNING', `Connection closed. Status: ${statusCode}`);
                
                // Log the specific error
                if (error) {
                    botLogger.log('ERROR', `Disconnect error: ${error.message}`);
                }
                
                // Check if should reconnect
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                if (shouldReconnect) {
                    botLogger.log('INFO', 'Attempting to reconnect...');
                    await this.handleReconnect(error);
                } else {
                    botLogger.log('ERROR', 'Logged out from WhatsApp. Please scan QR again.');
                    this.cleanSessions();
                    setTimeout(() => this.init(), 10000);
                }
            } else if (connection === 'open') {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                botLogger.log('SUCCESS', '🔗 Connected to WhatsApp');
                
                // Send periodic presence updates to keep connection alive
                this.startKeepAlive();
                
                // Send connected message to owner
                if (config.OWNER_NUMBER) {
                    try {
                        await delay(2000);
                        const ownerJid = this.functions.formatJid(config.OWNER_NUMBER);
                        if (ownerJid) {
                            await this.sendMessage(ownerJid, {
                                text: `✅ *${config.BOT_NAME} Connected!*\n\n• Time: ${new Date().toLocaleString()}\n• Mode: ${config.BOT_MODE || 'public'}\n• Plugins: ${this.pluginManager.getCommandList().length}`
                            });
                        }
                    } catch (error) {
                        botLogger.log('ERROR', `Failed to send owner message: ${error.message}`);
                    }
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            await this.handleMessages(m);
        });

        sock.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                if (update.update?.messageStubType === 67 || update.update?.messageStubType === 0) {
                    await this.handleMessageDelete(update);
                }
                
                if (update.pollUpdates) {
                    await this.handlePollUpdate(update);
                }
            }
        });

        sock.ev.on('messages.delete', async (deletion) => {
            await this.handleMessageDelete(deletion);
        });

        sock.ev.on('groups.update', async (updates) => {
            for (const update of updates) {
                try {
                    const metadata = await sock.groupMetadata(update.id);
                    this.groupCache.set(update.id, metadata);
                } catch (error) {
                    // Silent fail for group updates
                }
            }
        });

        sock.ev.on('group-participants.update', async (event) => {
            try {
                const metadata = await sock.groupMetadata(event.id);
                this.groupCache.set(event.id, metadata);
                await this.handleGroupParticipantsUpdate(event);
            } catch (error) {
                // Silent fail
            }
        });

        sock.ev.on('presence.update', async (update) => {
            // Handle presence updates
        });
    }

    startKeepAlive() {
        // Clear existing interval
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
        }
        
        // Send presence update every 25 seconds to keep connection alive
        this.keepAliveInterval = setInterval(async () => {
            if (this.sock && this.isConnected) {
                try {
                    await this.sock.sendPresenceUpdate('available');
                } catch (error) {
                    // Silent fail for keep-alive
                }
            }
        }, 25000);
    }

    async handleMessages(m) {
        const messages = m.messages;
        
        for (const message of messages) {
            try {
                if (message.key.fromMe) {
                    if (config.AUTO_READ && !message.key.remoteJid.includes('status')) {
                        await this.sock.readMessages([message.key]);
                    }
                    continue;
                }

                await this.store.setMessage(message.key, message);

                if (this.viewOnceReveal && 
                    (message.message?.viewOnceMessage || 
                     message.message?.ephemeralMessage?.message?.viewOnceMessage)) {
                    await this.handleViewOnceMessage(message);
                }

                if (message.key.remoteJid === 'status@broadcast') {
                    await this.handleStatusUpdate(message);
                    continue;
                }

                if (config.AUTO_READ) {
                    await this.sock.readMessages([message.key]);
                }

                const messageType = getContentType(message.message);
                let text = '';
                
                if (message.message?.conversation) {
                    text = message.message.conversation;
                } else if (message.message?.extendedTextMessage?.text) {
                    text = message.message.extendedTextMessage.text;
                } else if (message.message?.imageMessage?.caption) {
                    text = message.message.imageMessage.caption;
                } else if (message.message?.videoMessage?.caption) {
                    text = message.message.videoMessage.caption;
                }

                const jid = message.key.remoteJid;
                const sender = message.key.participant || jid;
                const isGroup = jid.endsWith('@g.us');

                if (text.startsWith(config.PREFIX)) {
                    const cmdText = text.slice(config.PREFIX.length).trim();
                    
                    if (!this.functions.isAllowed(sender, jid)) {
                        if (config.BOT_MODE === 'private') {
                            await this.sock.sendMessage(jid, {
                                text: '🔒 This bot is in private mode. Contact owner for access.'
                            }, { quoted: message });
                        }
                        continue;
                    }
                    
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
                    
                    if (!executed) {
                        const args = cmdText.split(/ +/);
                        const command = args.shift().toLowerCase();
                        
                        if (this.commands[command]) {
                            await this.commands[command]({
                                jid,
                                sender,
                                isGroup,
                                args,
                                message,
                                sock: this.sock
                            });
                        } else if (config.AUTO_REPLY) {
                            await this.sock.sendMessage(jid, {
                                text: `❓ Unknown command. Type ${config.PREFIX}help for available commands.`
                            }, { quoted: message });
                        }
                    }
                }

            } catch (error) {
                botLogger.log('ERROR', `Message handling error: ${error.message}`);
            }
        }
    }

    async handleMessageDelete(deletion) {
        try {
            if (deletion.keys && config.RECOVER_DELETED_MESSAGES) {
                for (const key of deletion.keys) {
                    const message = await this.store.getMessage(key);
                    if (message) {
                        await this.store.storeDeletedMessage(key, message);
                    }
                }
            }
        } catch (error) {
            // Silent fail for message delete
        }
    }

    async handleViewOnceMessage(message) {
        try {
            const jid = message.key.remoteJid;
            const sender = message.key.participant || jid;
            
            if (this.functions.isOwner(sender) || config.VIEW_ONCE_REVEAL_ALL) {
                let mediaData = null;
                let mimeType = '';
                
                const viewOnceMsg = message.message?.viewOnceMessage?.message || 
                                   message.message?.ephemeralMessage?.message?.viewOnceMessage?.message;
                
                if (viewOnceMsg?.imageMessage) {
                    mediaData = await this.downloadMedia(message, 'buffer');
                    mimeType = viewOnceMsg.imageMessage.mimetype;
                } else if (viewOnceMsg?.videoMessage) {
                    mediaData = await this.downloadMedia(message, 'buffer');
                    mimeType = viewOnceMsg.videoMessage.mimetype;
                }
                
                if (mediaData && mimeType) {
                    const caption = `👁️ *View Once Message Revealed*\nFrom: ${sender.split('@')[0]}`;
                    
                    if (mimeType.startsWith('image/')) {
                        await this.sock.sendMessage(jid, {
                            image: mediaData,
                            caption: caption
                        });
                    } else if (mimeType.startsWith('video/')) {
                        await this.sock.sendMessage(jid, {
                            video: mediaData,
                            caption: caption
                        });
                    }
                }
            }
        } catch (error) {
            // Silent fail
        }
    }

    async handleStatusUpdate(message) {
        try {
            if (config.AUTO_STATUS_VIEW) {
                await this.sock.readMessages([message.key]);
            }
            
            if (config.AUTO_STATUS_LIKE) {
                await delay(1000);
                await this.sock.sendMessage(message.key.remoteJid, {
                    react: { text: '❤️', key: message.key }
                });
            }
        } catch (error) {
            // Silent fail
        }
    }

    async handleGroupParticipantsUpdate(event) {
        const { id, participants, action } = event;
        
        if (this.sock.user && this.sock.user.id) {
            const botNumber = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
            
            if (action === 'add' && participants.includes(botNumber)) {
                await this.sendMessage(id, {
                    text: `🤖 *${config.BOT_NAME} Activated!*\n\nType ${config.PREFIX}menu to see commands!\n\nMode: ${config.BOT_MODE || 'public'}\nVersion: ${config.VERSION}`
                });
            }
        }
    }

    async handlePollUpdate(update) {
        // Handle poll updates if needed
    }

    // Command Handlers (same as before but simplified for space)
    async helpCommand(context) {
        const { jid, sock, message } = context;
        await sock.sendMessage(jid, { 
            text: `*${config.BOT_NAME} Help*\n\nUse ${config.PREFIX}menu for command list\nUse ${config.PREFIX}plugins for loaded plugins` 
        }, { quoted: message });
    }

    async menuCommand(context) {
        const { jid, sock, message } = context;
        await sock.sendMessage(jid, { 
            text: `*${config.BOT_NAME} Menu*\n\n• ${config.PREFIX}help - Show help\n• ${config.PREFIX}ping - Check bot status\n• ${config.PREFIX}owner - Show owner info\n• ${config.PREFIX}plugins - List plugins\n• ${config.PREFIX}stats - Bot statistics` 
        }, { quoted: message });
    }

    async pingCommand(context) {
        const { jid, sock, message } = context;
        const start = Date.now();
        await sock.sendMessage(jid, { text: 'Pong! 🏓' }, { quoted: message });
        const latency = Date.now() - start;
        
        await sock.sendMessage(jid, { 
            text: `*Ping Statistics:*\n\n⚡ Latency: ${latency}ms\n📊 Uptime: ${(process.uptime() / 3600).toFixed(2)}h\n💾 RAM: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB`
        }, { quoted: message });
    }

    async ownerCommand(context) {
        const { jid, sock, message } = context;
        if (config.OWNER_NUMBER) {
            await sock.sendMessage(jid, {
                text: `👑 *Bot Owner*\n\n📞 Contact: ${config.OWNER_NUMBER}\n🤖 Bot: ${config.BOT_NAME}\n⚡ Version: ${config.VERSION}`
            }, { quoted: message });
        }
    }

    async statsCommand(context) {
        const { jid, sock, message } = context;
        const statsText = `📊 *Bot Statistics*\n\n` +
                         `⏱️ Uptime: ${(process.uptime() / 3600).toFixed(2)}h\n` +
                         `💾 Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB\n` +
                         `📦 Platform: ${process.platform}\n` +
                         `⚡ Node.js: ${process.version}\n` +
                         `🔌 Plugins: ${this.pluginManager.getCommandList().length}\n` +
                         `🌐 Connection: ${this.isConnected ? 'Connected ✅' : 'Disconnected ❌'}`;
        
        await sock.sendMessage(jid, { text: statsText }, { quoted: message });
    }

    async pluginsCommand(context) {
        const { jid, sock, message } = context;
        const plugins = this.pluginManager.getCommandList();
        let pluginsText = `📦 *Loaded Plugins*\n\nTotal: ${plugins.length} plugin(s)\n\n`;
        
        if (plugins.length === 0) {
            pluginsText += `No plugins loaded. Check the silvaxlab folder.\n`;
        } else {
            for (const plugin of plugins) {
                pluginsText += `• ${config.PREFIX}${plugin.command} - ${plugin.help}\n`;
            }
        }
        
        await sock.sendMessage(jid, { text: pluginsText }, { quoted: message });
    }

    async startCommand(context) {
        const { jid, sock, message } = context;
        await sock.sendMessage(jid, { 
            text: `✨ *Welcome to ${config.BOT_NAME}!*\n\nI'm an advanced WhatsApp bot with plugin support.\n\nMode: ${config.BOT_MODE || 'public'}\nPrefix: ${config.PREFIX}\n\nType ${config.PREFIX}help for commands` 
        }, { quoted: message });
    }

    async modeCommand(context) {
        const { jid, sock, message, sender } = context;
        if (!this.functions.isOwner(sender)) {
            await sock.sendMessage(jid, { text: '⚠️ Owner only command' }, { quoted: message });
            return;
        }
        await sock.sendMessage(jid, {
            text: `*Bot Mode Settings*\n\nCurrent: ${config.BOT_MODE || 'public'}\n\nUpdate config.js to change mode`
        }, { quoted: message });
    }

    async deletedCommand(context) {
        const { jid, sock, message, sender } = context;
        if (!this.functions.isOwner(sender)) {
            await sock.sendMessage(jid, { text: '⚠️ Owner only command' }, { quoted: message });
            return;
        }
        await sock.sendMessage(jid, {
            text: `📝 Message recovery: ${config.RECOVER_DELETED_MESSAGES ? 'Enabled' : 'Disabled'}`
        }, { quoted: message });
    }

    async revealCommand(context) {
        const { jid, sock, message, sender } = context;
        if (!this.functions.isOwner(sender)) {
            await sock.sendMessage(jid, { text: '⚠️ Owner only command' }, { quoted: message });
            return;
        }
        await sock.sendMessage(jid, {
            text: `👁️ View Once Reveal: ${config.AUTO_VIEW_ONCE_REVEAL ? 'Enabled' : 'Disabled'}`
        }, { quoted: message });
    }

    async sendMessage(jid, content, options = {}) {
        try {
            const messageOptions = {
                ...globalContextInfo,
                ...options
            };
            
            return await this.sock.sendMessage(jid, content, messageOptions);
        } catch (error) {
            botLogger.log('ERROR', `Send message error: ${error.message}`);
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
                    reuploadRequest: this.sock.updateMediaMessage
                }
            );
        } catch (error) {
            botLogger.log('ERROR', `Download media error: ${error.message}`);
            return null;
        }
    }
}

// Create and export the bot instance
const bot = new SilvaBot();

// Export for use in plugins
module.exports = {
    SilvaBot,
    bot,
    config,
    logger: botLogger,
    functions: new Functions()
};

// Auto-start if this is the main module
if (require.main === module) {
    bot.init();
}
