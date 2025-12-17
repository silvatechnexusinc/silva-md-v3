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

// Custom logger for bot messages
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
// 🔧 UTILITY FUNCTIONS (FIXED)
// ==============================
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

    normalizePhoneNumber(number) {
        if (!number) return '';
        // Remove all non-digits
        let clean = number.replace(/[^0-9]/g, '');
        // If number starts with '0', remove it
        if (clean.startsWith('0')) {
            clean = clean.substring(1);
        }
        // If number starts with country code, keep it
        if (!clean.startsWith('254') && clean.length === 9) {
            clean = '254' + clean;
        }
        return clean;
    }

    isOwner(sender) {
        if (!config.OWNER_NUMBER) return false;
        
        // Extract the phone number from sender JID
        const senderJid = sender.split(':')[0]; // Remove device indicator
        const senderPhone = senderJid.split('@')[0];
        const normalizedSender = this.normalizePhoneNumber(senderPhone);
        
        if (!normalizedSender) return false;
        
        // Normalize owner numbers from config
        let ownerNumbers = [];
        if (Array.isArray(config.OWNER_NUMBER)) {
            ownerNumbers = config.OWNER_NUMBER.map(num => this.normalizePhoneNumber(num));
        } else if (typeof config.OWNER_NUMBER === 'string') {
            ownerNumbers = [this.normalizePhoneNumber(config.OWNER_NUMBER)];
        }
        
        // Also check connected number (the number the bot is running on)
        if (config.CONNECTED_NUMBER) {
            const connectedNumber = this.normalizePhoneNumber(config.CONNECTED_NUMBER);
            if (connectedNumber && !ownerNumbers.includes(connectedNumber)) {
                ownerNumbers.push(connectedNumber);
            }
        }
        
        // Debug logging for owner check
        if (config.DEBUG_MODE) {
            botLogger.log('INFO', `Owner Check - Sender: ${normalizedSender}`);
            botLogger.log('INFO', `Owner Numbers: ${ownerNumbers.join(', ')}`);
            botLogger.log('INFO', `Is Owner: ${ownerNumbers.includes(normalizedSender)}`);
        }
        
        // Check if sender matches any owner number
        return ownerNumbers.includes(normalizedSender);
    }

    isAllowed(sender, jid) {
        // Owner is always allowed
        if (this.isOwner(sender)) {
            if (config.DEBUG_MODE) {
                botLogger.log('INFO', `Owner ${sender} is always allowed`);
            }
            return true;
        }
        
        if (config.BOT_MODE === 'public') return true;
        
        if (config.BOT_MODE === 'private') {
            // Allow groups in private mode
            if (jid.endsWith('@g.us')) return true;
            
            // Check allowed users
            if (config.ALLOWED_USERS && Array.isArray(config.ALLOWED_USERS)) {
                const senderJid = sender.split(':')[0];
                const senderPhone = senderJid.split('@')[0];
                const normalizedSender = this.normalizePhoneNumber(senderPhone);
                const allowedNumbers = config.ALLOWED_USERS.map(num => this.normalizePhoneNumber(num));
                return allowedNumbers.includes(normalizedSender);
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
        const cleaned = this.normalizePhoneNumber(number);
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
// 💾 STORE IMPLEMENTATION (UPDATED FOR ANTIDELETE)
// ==============================
class MessageStore {
    constructor() {
        this.messageCache = new NodeCache({ stdTTL: 3600 }); // 1 hour TTL for messages
        this.chatCache = new NodeCache({ stdTTL: 300 });
        this.deletedMessages = new Map(); // Store recently deleted messages
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

    // Anti-delete methods
    async saveDeletedMessage(key, message) {
        if (message && !message.key?.fromMe) {
            this.deletedMessages.set(key.id, {
                ...message,
                timestamp: Date.now(),
                deletedAt: Date.now()
            });
            
            // Auto-clean after 5 minutes
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
// 🧩 PLUGIN MANAGER (FIXED)
// ==============================
class PluginManager {
    constructor() {
        this.commandHandlers = new Map();
        this.pluginInfo = new Map();
        this.functions = new Functions();
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
        // Create anti-delete plugin
        const antideletePlugin = `// Anti-delete plugin
const handler = {
    help: ['antidelete'],
    tags: ['tool'],
    command: /^(antidelete|ad)$/i,
    group: true,
    admin: false,
    botAdmin: false,
    owner: false,
    
    execute: async ({ jid, sock, message, args, bot }) => {
        if (!args[0]) {
            return await sock.sendMessage(jid, {
                text: '🚨 *Anti-Delete Commands*\\\\n\\\\n' +
                      '• \`\`\`${config.PREFIX}antidelete on\`\`\` - Enable anti-delete\\\\n' +
                      '• \`\`\`${config.PREFIX}antidelete off\`\`\` - Disable anti-delete\\\\n' +
                      '• \`\`\`${config.PREFIX}antidelete list\`\`\` - Show recent deleted messages\\\\n' +
                      '• \`\`\`${config.PREFIX}antidelete recover [number]\`\`\` - Recover deleted message'
            }, { quoted: message });
        }
        
        const action = args[0].toLowerCase();
        
        switch(action) {
            case 'on':
                bot.antiDeleteEnabled = true;
                await sock.sendMessage(jid, {
                    text: '✅ Anti-delete enabled! Bot will now recover deleted messages.'
                }, { quoted: message });
                break;
                
            case 'off':
                bot.antiDeleteEnabled = false;
                await sock.sendMessage(jid, {
                    text: '❌ Anti-delete disabled.'
                }, { quoted: message });
                break;
                
            case 'list':
                if (bot.recentDeletedMessages && bot.recentDeletedMessages.length > 0) {
                    let listText = '📋 *Recently Deleted Messages*\\\\n\\\\n';
                    bot.recentDeletedMessages.forEach((msg, index) => {
                        const timeAgo = Math.floor((Date.now() - msg.deletedAt) / 1000);
                        listText += \`\${index + 1}. \${msg.senderName} - \${timeAgo}s ago\\\\n\`;
                    });
                    listText += '\\\\nUse \`${config.PREFIX}antidelete recover [number]\` to recover.';
                    await sock.sendMessage(jid, { text: listText }, { quoted: message });
                } else {
                    await sock.sendMessage(jid, {
                        text: 'No deleted messages found.'
                    }, { quoted: message });
                }
                break;
                
            case 'recover':
                const index = parseInt(args[1]) - 1;
                if (bot.recentDeletedMessages && bot.recentDeletedMessages[index]) {
                    const deletedMsg = bot.recentDeletedMessages[index];
                    await sock.sendMessage(jid, {
                        text: \`🔁 *Message Recovered*\\\\n\\\\nFrom: \${deletedMsg.senderName}\\\\nTime: \${new Date(deletedMsg.timestamp).toLocaleTimeString()}\\\\n\\\\nMessage: \${deletedMsg.text || '[Media Message]'}\`
                    }, { quoted: message });
                } else {
                    await sock.sendMessage(jid, {
                        text: 'Invalid message number. Use \`${config.PREFIX}antidelete list\` to see available messages.'
                    }, { quoted: message });
                }
                break;
                
            default:
                await sock.sendMessage(jid, {
                    text: 'Invalid option. Use \`${config.PREFIX}antidelete\` for help.'
                }, { quoted: message });
        }
    }
};

module.exports = { handler };`;

        const statusPlugin = `// Status auto-view/like plugin
const handler = {
    help: ['statusview'],
    tags: ['tool'],
    command: /^(statusview|autoview|autolike)$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: true, // Only owner can control this
    
    execute: async ({ jid, sock, message, args, bot }) => {
        const action = args[0]?.toLowerCase();
        
        if (!action) {
            const status = {
                view: bot.autoStatusView ? '✅ Enabled' : '❌ Disabled',
                like: bot.autoStatusLike ? '✅ Enabled' : '❌ Disabled'
            };
            
            await sock.sendMessage(jid, {
                text: \`📊 *Status Auto Settings*\\\\n\\\\n\` +
                      \`Auto View: \${status.view}\\\\n\` +
                      \`Auto Like: \${status.like}\\\\n\\\\n\` +
                      \`Commands:\\\\n\` +
                      \`• ${config.PREFIX}statusview on - Enable both\\\\n\` +
                      \`• ${config.PREFIX}statusview off - Disable both\\\\n\` +
                      \`• ${config.PREFIX}statusview view - Toggle auto-view\\\\n\` +
                      \`• ${config.PREFIX}statusview like - Toggle auto-like\`
            }, { quoted: message });
            return;
        }
        
        switch(action) {
            case 'on':
                bot.autoStatusView = true;
                bot.autoStatusLike = true;
                await sock.sendMessage(jid, {
                    text: '✅ Auto-view and auto-like enabled for status updates.'
                }, { quoted: message });
                break;
                
            case 'off':
                bot.autoStatusView = false;
                bot.autoStatusLike = false;
                await sock.sendMessage(jid, {
                    text: '❌ Auto-view and auto-like disabled.'
                }, { quoted: message });
                break;
                
            case 'view':
                bot.autoStatusView = !bot.autoStatusView;
                await sock.sendMessage(jid, {
                    text: \`Auto-view: \${bot.autoStatusView ? '✅ Enabled' : '❌ Disabled'}\`
                }, { quoted: message });
                break;
                
            case 'like':
                bot.autoStatusLike = !bot.autoStatusLike;
                await sock.sendMessage(jid, {
                    text: \`Auto-like: \${bot.autoStatusLike ? '✅ Enabled' : '❌ Disabled'}\`
                }, { quoted: message });
                break;
                
            default:
                await sock.sendMessage(jid, {
                    text: 'Invalid option. Use \`${config.PREFIX}statusview\` for help.'
                }, { quoted: message });
        }
    }
};

module.exports = { handler };`;

        const plugins = [
            { name: 'antidelete.js', content: antideletePlugin },
            { name: 'statusview.js', content: statusPlugin }
        ];

        for (const plugin of plugins) {
            fs.writeFileSync(path.join(pluginDir, plugin.name), plugin.content);
            botLogger.log('INFO', "Created plugin: " + plugin.name);
        }
    }

    async executeCommand(context) {
        const { text, jid, sender, isGroup, message, sock, args } = context;
        
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
                    // Check permissions
                    if (handler.owner && !this.functions.isOwner(sender)) {
                        await sock.sendMessage(jid, { text: '⚠️ Owner only command' }, { quoted: message });
                        return true;
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
// 🤖 MAIN BOT CLASS (FIXED & ENHANCED)
// ==============================
class SilvaBot {
    constructor() {
        this.sock = null;
        this.store = new MessageStore();
        this.groupCache = new NodeCache({ stdTTL: 300, useClones: false });
        this.pluginManager = new PluginManager();
        this.isConnected = false;
        this.functions = new Functions();
        
        // Anti-delete settings
        this.antiDeleteEnabled = config.ANTIDELETE || true;
        this.recentDeletedMessages = [];
        this.maxDeletedMessages = 20;
        
        // Auto status settings
        this.autoStatusView = config.AUTO_STATUS_VIEW || false;
        this.autoStatusLike = config.AUTO_STATUS_LIKE || false;
        
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
            statusview: this.statusviewCommand.bind(this)
        };
    }

    async init() {
        try {
            botLogger.log('BOT', "🚀 Starting " + config.BOT_NAME + " v" + config.VERSION);
            botLogger.log('INFO', "Mode: " + (config.BOT_MODE || 'public'));
            botLogger.log('INFO', "Anti-delete: " + (this.antiDeleteEnabled ? 'Enabled' : 'Disabled'));
            botLogger.log('INFO', "Auto Status View: " + (this.autoStatusView ? 'Enabled' : 'Disabled'));
            botLogger.log('INFO', "Auto Status Like: " + (this.autoStatusLike ? 'Enabled' : 'Disabled'));
            
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
Anti-delete: ${this.antiDeleteEnabled ? '✅' : '❌'}
Auto Status View: ${this.autoStatusView ? '✅' : '❌'}
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
                await this.handleMessages(m);
            } catch (error) {
                botLogger.log('ERROR', "Messages upsert error: " + error.message);
            }
        });

        // Handle message updates (for anti-delete)
        sock.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                try {
                    // Check if message was deleted
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
        sock.ev.on('group-participants.update', async (event) => {
            try {
                if (this.sock.user && this.sock.user.id) {
                    const botJid = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    if (event.action === 'add' && event.participants.includes(botJid)) {
                        await this.sendMessage(event.id, {
                            text: '🤖 *' + config.BOT_NAME + ' Activated!*\\\\nType ' + config.PREFIX + 'menu for commands'
                        });
                        botLogger.log('INFO', 'Bot added to group: ' + event.id);
                    }
                }
            } catch (error) {
                // Silent fail
            }
        });

        // Handle status updates (for auto-view/like)
        sock.ev.on('messages.upsert', async (m) => {
            try {
                await this.handleStatusMessages(m);
            } catch (error) {
                // Silent fail
            }
        });
    }

    // Handle status messages for auto-view/like
    async handleStatusMessages(m) {
        if (!m.messages || !Array.isArray(m.messages)) return;
        
        for (const message of m.messages) {
            try {
                // Check if it's a status message
                if (message.key.remoteJid === 'status@broadcast') {
                    botLogger.log('INFO', '📊 Status update detected');
                    
                    // Auto view status
                    if (this.autoStatusView) {
                        try {
                            await this.sock.readMessages([{ 
                                key: { 
                                    remoteJid: message.key.remoteJid, 
                                    id: message.key.id,
                                    fromMe: false,
                                    participant: undefined
                                } 
                            }]);
                            botLogger.log('SUCCESS', '✅ Status auto-viewed');
                        } catch (error) {
                            botLogger.log('ERROR', 'Failed to auto-view status: ' + error.message);
                        }
                    }
                    
                    // Auto like status
                    if (this.autoStatusLike) {
                        try {
                            await this.sock.sendMessage(message.key.remoteJid, {
                                react: {
                                    text: '❤️',
                                    key: message.key
                                }
                            });
                            botLogger.log('SUCCESS', '✅ Status auto-liked');
                        } catch (error) {
                            botLogger.log('ERROR', 'Failed to auto-like status: ' + error.message);
                        }
                    }
                }
            } catch (error) {
                // Silent fail
            }
        }
    }

    // Handle single message delete
    async handleMessageDelete(update) {
        if (!this.antiDeleteEnabled || !update.key) return;
        
        try {
            const deletedMessage = await this.store.getMessage(update.key);
            if (deletedMessage && !deletedMessage.key?.fromMe) {
                // Save deleted message
                await this.store.saveDeletedMessage(update.key, deletedMessage);
                
                // Get sender info
                const sender = deletedMessage.key.participant || deletedMessage.key.remoteJid;
                const text = this.functions.extractText(deletedMessage.message);
                
                if (text || deletedMessage.message) {
                    // Store in recent deleted messages
                    this.recentDeletedMessages.unshift({
                        key: update.key,
                        sender: sender,
                        senderName: await this.getContactName(sender),
                        text: text,
                        message: deletedMessage.message,
                        timestamp: deletedMessage.messageTimestamp,
                        deletedAt: Date.now()
                    });
                    
                    // Keep only recent messages
                    if (this.recentDeletedMessages.length > this.maxDeletedMessages) {
                        this.recentDeletedMessages.pop();
                    }
                    
                    // Notify in chat
                    const jid = update.key.remoteJid;
                    if (jid.endsWith('@g.us')) {
                        // In group, notify with mention
                        await this.sock.sendMessage(jid, {
                            text: `🚨 *Message Deleted*\\\\n\\\\n` +
                                  `👤 *Sender:* @${sender.split('@')[0]}\\\\n` +
                                  `💬 *Message:* ${text || '[Media Message]'}\\\\n\\\\n` +
                                  `Type \`${config.PREFIX}antidelete recover 1\` to recover`,
                            mentions: [sender]
                        });
                    } else {
                        // In private chat
                        await this.sock.sendMessage(jid, {
                            text: `🚨 *You deleted a message*\\\\n\\\\n` +
                                  `💬 *Message:* ${text || '[Media Message]'}\\\\n\\\\n` +
                                  `Type \`${config.PREFIX}antidelete recover 1\` to recover`
                        });
                    }
                    
                    botLogger.log('INFO', 'Anti-delete: Saved deleted message from ' + sender);
                }
            }
        } catch (error) {
            botLogger.log('ERROR', 'Anti-delete error: ' + error.message);
        }
    }

    // Handle bulk message delete
    async handleBulkMessageDelete(deletion) {
        if (!this.antiDeleteEnabled) return;
        
        try {
            if (deletion.keys && Array.isArray(deletion.keys)) {
                for (const key of deletion.keys) {
                    await this.handleMessageDelete({ key: key });
                }
            }
        } catch (error) {
            botLogger.log('ERROR', 'Bulk delete error: ' + error.message);
        }
    }

    // Get contact name
    async getContactName(jid) {
        try {
            const contact = await this.sock.onWhatsApp(jid);
            return contact && contact[0] ? contact[0].name || contact[0].jid.split('@')[0] : jid.split('@')[0];
        } catch {
            return jid.split('@')[0];
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
                botLogger.log('INFO', 'Sessions cleaned');
            }
        } catch (error) {
            // Silent fail
        }
    }

    // Enhanced message handling with owner command fix
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

                // Skip messages from the bot itself
                if (message.key.fromMe) {
                    continue;
                }

                // Store message
                await this.store.setMessage(message.key, message);

                const jid = message.key.remoteJid;
                const sender = message.key.participant || jid;
                const isGroup = jid.endsWith('@g.us');
                
                // Debug: Log who sent the message
                const isOwner = this.functions.isOwner(sender);
                if (isOwner) {
                    botLogger.log('INFO', 'Owner message detected from: ' + sender);
                }

                // Send typing indicator
                await this.sock.sendPresenceUpdate('composing', jid);

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

                // Check if message starts with prefix
                if (text && text.startsWith(config.PREFIX)) {
                    botLogger.log('INFO', 'Command detected: ' + text + ' from ' + sender + ' (Owner: ' + isOwner + ')');
                    
                    const cmdText = text.slice(config.PREFIX.length).trim();
                    
                    // Stop typing indicator
                    await this.sock.sendPresenceUpdate('paused', jid);
                    
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
                            botLogger.log('INFO', 'Executing built-in command: ' + command);
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
                } else {
                    // Stop typing indicator for non-commands
                    await this.sock.sendPresenceUpdate('paused', jid);
                }

            } catch (error) {
                botLogger.log('ERROR', "Message handling error: " + error.message);
                try {
                    await this.sock.sendPresenceUpdate('paused', message.key.remoteJid);
                } catch (e) {
                    // Ignore
                }
            }
        }
    }

    // ==============================
    // 💬 COMMAND HANDLERS (UPDATED)
    // ==============================
    
    async antideleteCommand(context) {
        const { jid, sock, message, args, sender } = context;
        
        // Only allow in groups or private chats
        if (!this.antiDeleteEnabled && !this.functions.isOwner(sender)) {
            await sock.sendMessage(jid, {
                text: '⚠️ Anti-delete is disabled. Owner can enable it.'
            }, { quoted: message });
            return;
        }
        
        if (!args[0]) {
            const status = this.antiDeleteEnabled ? '✅ Enabled' : '❌ Disabled';
            await sock.sendMessage(jid, {
                text: '🚨 *Anti-Delete System*\\\\n\\\\n' +
                      `Status: ${status}\\\\n` +
                      `Stored Messages: ${this.recentDeletedMessages.length}\\\\n\\\\n` +
                      `• \`${config.PREFIX}antidelete on\` - Enable\\\\n` +
                      `• \`${config.PREFIX}antidelete off\` - Disable\\\\n` +
                      `• \`${config.PREFIX}antidelete list\` - Show recent\\\\n` +
                      `• \`${config.PREFIX}antidelete recover [num]\` - Recover message`
            }, { quoted: message });
            return;
        }
        
        const action = args[0].toLowerCase();
        
        switch(action) {
            case 'on':
                if (!this.functions.isOwner(sender)) {
                    await sock.sendMessage(jid, { text: '⚠️ Owner only command' }, { quoted: message });
                    return;
                }
                this.antiDeleteEnabled = true;
                await sock.sendMessage(jid, {
                    text: '✅ Anti-delete enabled!'
                }, { quoted: message });
                break;
                
            case 'off':
                if (!this.functions.isOwner(sender)) {
                    await sock.sendMessage(jid, { text: '⚠️ Owner only command' }, { quoted: message });
                    return;
                }
                this.antiDeleteEnabled = false;
                await sock.sendMessage(jid, {
                    text: '❌ Anti-delete disabled.'
                }, { quoted: message });
                break;
                
            case 'list':
                if (this.recentDeletedMessages.length > 0) {
                    let listText = '📋 *Recently Deleted Messages*\\\\n\\\\n';
                    this.recentDeletedMessages.forEach((msg, index) => {
                        const timeAgo = Math.floor((Date.now() - msg.deletedAt) / 1000);
                        listText += `${index + 1}. ${msg.senderName} - ${timeAgo}s ago\\\\n`;
                        if (msg.text && msg.text.length > 50) {
                            listText += `   ${msg.text.substring(0, 50)}...\\\\n`;
                        } else if (msg.text) {
                            listText += `   ${msg.text}\\\\n`;
                        }
                    });
                    listText += '\\\\nUse `' + config.PREFIX + 'antidelete recover [number]` to recover.';
                    await sock.sendMessage(jid, { text: listText }, { quoted: message });
                } else {
                    await sock.sendMessage(jid, {
                        text: 'No deleted messages stored.'
                    }, { quoted: message });
                }
                break;
                
            case 'recover':
                const index = parseInt(args[1]) - 1;
                if (index >= 0 && index < this.recentDeletedMessages.length) {
                    const deletedMsg = this.recentDeletedMessages[index];
                    
                    // Try to resend the original message
                    if (deletedMsg.message) {
                        await sock.sendMessage(jid, {
                            forward: deletedMsg.message,
                            contextInfo: {
                                mentionedJid: [deletedMsg.sender],
                                forwardingScore: 999,
                                isForwarded: true
                            }
                        });
                        
                        await sock.sendMessage(jid, {
                            text: `🔁 *Message Recovered*\\\\n\\\\nFrom: ${deletedMsg.senderName}\\\\nDeleted: ${Math.floor((Date.now() - deletedMsg.deletedAt) / 1000)}s ago`
                        }, { quoted: message });
                    } else if (deletedMsg.text) {
                        await sock.sendMessage(jid, {
                            text: `🔁 *Message Recovered*\\\\n\\\\nFrom: ${deletedMsg.senderName}\\\\n\\\\n${deletedMsg.text}`,
                            mentions: [deletedMsg.sender]
                        }, { quoted: message });
                    }
                    
                    // Remove from list
                    this.recentDeletedMessages.splice(index, 1);
                } else {
                    await sock.sendMessage(jid, {
                        text: 'Invalid message number. Use `' + config.PREFIX + 'antidelete list` to see available messages.'
                    }, { quoted: message });
                }
                break;
                
            default:
                await sock.sendMessage(jid, {
                    text: 'Invalid option. Use `' + config.PREFIX + 'antidelete` for help.'
                }, { quoted: message });
        }
    }
    
    async statusviewCommand(context) {
        const { jid, sock, message, args, sender } = context;
        
        // Owner only command
        if (!this.functions.isOwner(sender)) {
            await sock.sendMessage(jid, { text: '⚠️ Owner only command' }, { quoted: message });
            return;
        }
        
        const action = args[0]?.toLowerCase();
        
        if (!action) {
            await sock.sendMessage(jid, {
                text: `📊 *Status Auto Settings*\\\\n\\\\n` +
                      `Auto View: ${this.autoStatusView ? '✅ Enabled' : '❌ Disabled'}\\\\n` +
                      `Auto Like: ${this.autoStatusLike ? '✅ Enabled' : '❌ Disabled'}\\\\n\\\\n` +
                      `Commands:\\\\n` +
                      `• ${config.PREFIX}statusview on - Enable both\\\\n` +
                      `• ${config.PREFIX}statusview off - Disable both\\\\n` +
                      `• ${config.PREFIX}statusview view - Toggle auto-view\\\\n` +
                      `• ${config.PREFIX}statusview like - Toggle auto-like`
            }, { quoted: message });
            return;
        }
        
        switch(action) {
            case 'on':
                this.autoStatusView = true;
                this.autoStatusLike = true;
                await sock.sendMessage(jid, {
                    text: '✅ Auto-view and auto-like enabled for status updates.'
                }, { quoted: message });
                break;
                
            case 'off':
                this.autoStatusView = false;
                this.autoStatusLike = false;
                await sock.sendMessage(jid, {
                    text: '❌ Auto-view and auto-like disabled.'
                }, { quoted: message });
                break;
                
            case 'view':
                this.autoStatusView = !this.autoStatusView;
                await sock.sendMessage(jid, {
                    text: `Auto-view: ${this.autoStatusView ? '✅ Enabled' : '❌ Disabled'}`
                }, { quoted: message });
                break;
                
            case 'like':
                this.autoStatusLike = !this.autoStatusLike;
                await sock.sendMessage(jid, {
                    text: `Auto-like: ${this.autoStatusLike ? '✅ Enabled' : '❌ Disabled'}`
                }, { quoted: message });
                break;
                
            default:
                await sock.sendMessage(jid, {
                    text: 'Invalid option. Use `' + config.PREFIX + 'statusview` for help.'
                }, { quoted: message });
        }
    }

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
        helpText += '• ' + config.PREFIX + 'statusview - Auto status settings (Owner)\n';
        
        if (plugins.length > 0) {
            helpText += '\\\\n*Loaded Plugins:*\\\\n';
            for (const cmd of plugins) {
                helpText += '• ' + config.PREFIX + cmd.command + ' - ' + cmd.help + '\n';
            }
        }
        
        helpText += '\n📍 *Silva Tech Nexus*';
        
        try {
            await sock.sendMessage(jid, { text: helpText }, { quoted: message });
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send help: ' + error.message);
        }
    }

    async menuCommand(context) {
        const { jid, sock, message } = context;
        const menuText = '┌─「 *Silva MD* 」─\\\\n' +
                        '│\\\\n' +
                        '│ ⚡ *BOT STATUS*\\\\n' +
                        '│ • Mode: ' + (config.BOT_MODE || 'public') + '\\\\n' +
                        '│ • Prefix: ' + config.PREFIX + '\\\\n' +
                        '│ • Version: ' + config.VERSION + '\\\\n' +
                        '│ • Anti-delete: ' + (this.antiDeleteEnabled ? '✅' : '❌') + '\\\\n' +
                        '│\\\\n' +
                        '│ 📋 *CORE COMMANDS*\\\\n' +
                        '│ • ' + config.PREFIX + 'ping - Check bot status\\\\n' +
                        '│ • ' + config.PREFIX + 'help - Show help\\\\n' +
                        '│ • ' + config.PREFIX + 'owner - Show owner info\\\\n' +
                        '│ • ' + config.PREFIX + 'menu - This menu\\\\n' +
                        '│ • ' + config.PREFIX + 'plugins - List plugins\\\\n' +
                        '│ • ' + config.PREFIX + 'stats - Bot statistics\\\\n' +
                        '│ • ' + config.PREFIX + 'antidelete - Recover deleted messages\\\\n' +
                        '│\\\\n' +
                        '│ 🎨 *MEDIA COMMANDS*\\\\n' +
                        '│ • ' + config.PREFIX + 'sticker - Create sticker\\\\n' +
                        '│\\\\n' +
                        '│ └─「 *SILVA TECH* 」';
        
        try {
            await sock.sendMessage(jid, { text: menuText }, { quoted: message });
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send menu: ' + error.message);
        }
    }

    async pingCommand(context) {
        const { jid, sock, message } = context;
        try {
            const start = Date.now();
            await sock.sendMessage(jid, { text: '🏓 Pong!' }, { quoted: message });
            const latency = Date.now() - start;
            
            await sock.sendMessage(jid, {
                text: '*Status Report*\\\\n\\\\n⚡ Latency: ' + latency + 'ms\\\\n📊 Uptime: ' + (process.uptime() / 3600).toFixed(2) + 'h\\\\n💾 RAM: ' + (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + 'MB\\\\n🌐 Connection: ' + (this.isConnected ? 'Connected ✅' : 'Disconnected ❌') + '\\\\n🚨 Anti-delete: ' + (this.antiDeleteEnabled ? 'Enabled ✅' : 'Disabled ❌')
            }, { quoted: message });
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send ping: ' + error.message);
        }
    }

    async ownerCommand(context) {
        const { jid, sock, message } = context;
        if (config.OWNER_NUMBER) {
            try {
                let ownerText = '👑 *Bot Owner*\\\\n\\\\n';
                
                if (Array.isArray(config.OWNER_NUMBER)) {
                    config.OWNER_NUMBER.forEach((num, idx) => {
                        ownerText += `📞 ${idx + 1}. ${num}\\\\n`;
                    });
                } else {
                    ownerText += `📞 ${config.OWNER_NUMBER}\\\\n`;
                }
                
                if (config.CONNECTED_NUMBER) {
                    ownerText += `\\\\n🔗 Connected: ${config.CONNECTED_NUMBER}\\\\n`;
                }
                
                ownerText += `🤖 ${config.BOT_NAME}\\\\n⚡ v${config.VERSION}`;
                
                await sock.sendMessage(jid, {
                    text: ownerText
                }, { quoted: message });
            } catch (error) {
                botLogger.log('ERROR', 'Failed to send owner info: ' + error.message);
            }
        }
    }

    async statsCommand(context) {
        const { jid, sock, message } = context;
        try {
            const statsText = '📊 *Bot Statistics*\\\\n\\\\n' +
                             '⏱️ Uptime: ' + (process.uptime() / 3600).toFixed(2) + 'h\\\\n' +
                             '💾 Memory: ' + (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + 'MB\\\\n' +
                             '📦 Platform: ' + process.platform + '\\\\n' +
                             '🔌 Plugins: ' + this.pluginManager.getCommandList().length + '\\\\n' +
                             '🚨 Deleted Msgs: ' + this.recentDeletedMessages.length + '\\\\n' +
                             '👁️ Auto-View: ' + (this.autoStatusView ? '✅' : '❌') + '\\\\n' +
                             '❤️ Auto-Like: ' + (this.autoStatusLike ? '✅' : '❌') + '\\\\n' +
                             '🌐 Status: ' + (this.isConnected ? 'Connected ✅' : 'Disconnected ❌') + '\\\\n' +
                             '🤖 Bot: ' + config.BOT_NAME + ' v' + config.VERSION;
            
            await sock.sendMessage(jid, { text: statsText }, { quoted: message });
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send stats: ' + error.message);
        }
    }

    async pluginsCommand(context) {
        const { jid, sock, message } = context;
        try {
            const plugins = this.pluginManager.getCommandList();
            let pluginsText = '📦 *Loaded Plugins*\\\\n\\\\nTotal: ' + plugins.length + '\\\\n\\\\n';
            
            if (plugins.length === 0) {
                pluginsText += 'No plugins loaded.\\\\nCheck silvaxlab folder.';
            } else {
                for (const plugin of plugins) {
                    pluginsText += '• ' + config.PREFIX + plugin.command + ' - ' + plugin.help + '\\\\n';
                }
            }
            
            await sock.sendMessage(jid, { text: pluginsText }, { quoted: message });
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send plugins list: ' + error.message);
        }
    }

    async startCommand(context) {
        const { jid, sock, message } = context;
        try {
            const startText = '✨ *Welcome to Silva MD!*\\\\n\\\\n' +
                             'I am an advanced WhatsApp bot with plugin support.\\\\n\\\\n' +
                             'Mode: ' + (config.BOT_MODE || 'public') + '\\\\n' +
                             'Prefix: ' + config.PREFIX + '\\\\n' +
                             'Anti-delete: ' + (this.antiDeleteEnabled ? 'Enabled ✅' : 'Disabled ❌') + '\\\\n\\\\n' +
                             'Type ' + config.PREFIX + 'help for commands';
            
            await sock.sendMessage(jid, { 
                text: startText
            }, { quoted: message });
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send start message: ' + error.message);
        }
    }

    async sendMessage(jid, content, options = {}) {
        try {
            if (this.sock && this.isConnected) {
                const result = await this.sock.sendMessage(jid, content, { ...globalContextInfo, ...options });
                return result;
            } else {
                botLogger.log('WARNING', 'Cannot send message: Bot not connected');
                return null;
            }
        } catch (error) {
            botLogger.log('ERROR', "Send error: " + error.message);
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
    functions: new Functions()
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
