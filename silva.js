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
// 🔧 UTILITY FUNCTIONS
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

    isOwner(sender) {
        if (!config.OWNER_NUMBER) return false;
        
        let ownerJid = config.OWNER_NUMBER;
        if (!ownerJid.includes('@s.whatsapp.net')) {
            ownerJid = ownerJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        }
        
        const cleanOwner = ownerJid.split(':')[0];
        const cleanSender = sender.split(':')[0];
        return cleanSender === cleanOwner;
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

    // Helper to format boolean values for display
    formatBool(value) {
        if (value === true || value === 'true') return '✅ Enabled';
        if (value === false || value === 'false') return '❌ Disabled';
        return '⚪ Not Set';
    }

    // Fix: Use proper newlines for WhatsApp
    formatText(text) {
        // Replace \\n with actual newlines
        return text.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
    }

    // Generate config summary for welcome message
    getConfigSummary() {
        const summary = [];
        
        // Bot Info
        summary.push('🤖 *BOT INFORMATION*');
        summary.push(`• Name: ${config.BOT_NAME || 'Not Set'}`);
        summary.push(`• Version: ${config.VERSION || 'Not Set'}`);
        summary.push(`• Mode: ${config.BOT_MODE || 'public'}`);
        summary.push(`• Prefix: ${config.PREFIX || '.'}`);
        summary.push(`• Owner: ${config.OWNER_NUMBER || 'Not Set'}`);
        summary.push('');
        
        // Status Features
        summary.push('📊 *STATUS FEATURES*');
        summary.push(`• Auto Seen: ${this.formatBool(config.AUTO_STATUS_SEEN)}`);
        summary.push(`• Auto React: ${this.formatBool(config.AUTO_STATUS_REACT)}`);
        summary.push(`• Auto Reply: ${this.formatBool(config.AUTO_STATUS_REPLY)}`);
        summary.push(`• Status Saver: ${this.formatBool(config.Status_Saver)}`);
        summary.push('');
        
        // Bot Settings
        summary.push('⚙️ *BOT SETTINGS*');
        summary.push(`• Auto Reply: ${this.formatBool(config.AUTO_REPLY)}`);
        summary.push(`• Debug Mode: ${this.formatBool(config.DEBUG_MODE)}`);
        summary.push(`• Session ID: ${config.SESSION_ID ? '✅ Set' : '❌ Not Set'}`);
        summary.push('');
        
        // Security
        summary.push('🔒 *SECURITY*');
        summary.push(`• Allowed Users: ${config.ALLOWED_USERS ? config.ALLOWED_USERS.length + ' users' : 'All users'}`);
        summary.push('');
        
        // System Info
        summary.push('💻 *SYSTEM INFO*');
        summary.push(`• Platform: ${process.platform}`);
        summary.push(`• Node.js: ${process.version}`);
        summary.push(`• Uptime: ${(process.uptime() / 3600).toFixed(2)}h`);
        summary.push(`• Memory: ${this.formatBytes(process.memoryUsage().heapUsed)}`);
        
        return summary.join('\n');
    }
}

// ==============================
// 💾 STORE IMPLEMENTATION
// ==============================
class MessageStore {
    constructor() {
        this.messages = new Map();
        this.chats = new Map();
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

// ==============================
// 🧩 PLUGIN MANAGER
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
        const stickerPlugin = `// Sticker plugin
const handler = {
    help: ['sticker', 'stiker'],
    tags: ['media'],
    command: /^(sticker|stiker|s)$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: false,
    
    execute: async ({ jid, sock, message }) => {
        try {
            const mime = message.message?.imageMessage?.mimetype || 
                        message.message?.videoMessage?.mimetype;
            
            if (!mime) {
                return await sock.sendMessage(jid, {
                    text: '🖼️ How to use sticker command:\\n\\n1. Send an image/video\\n2. Add caption ".sticker"\\n3. Or reply to media with ".sticker"'
                }, { quoted: message });
            }
            
            await sock.sendMessage(jid, { text: '🎨 Creating sticker...' }, { quoted: message });
            
            const { delay } = require('@whiskeysockets/baileys');
            await delay(1000);
            
            await sock.sendMessage(jid, {
                text: '✅ Sticker Created!\\n\\nThis is a demo. In real implementation, the sticker would be sent.'
            }, { quoted: message });
        } catch (error) {
            await sock.sendMessage(jid, {
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
    
    execute: async ({ jid, sock, message }) => {
        const start = Date.now();
        await sock.sendMessage(jid, { text: '🏓 Pong!' }, { quoted: message });
        const latency = Date.now() - start;
        
        await sock.sendMessage(jid, {
            text: '*Ping Statistics*\\n\\n⚡ Latency: ' + latency + 'ms\\n📊 Uptime: ' + (process.uptime() / 3600).toFixed(2) + 'h\\n💾 RAM: ' + (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + 'MB'
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
    
    execute: async ({ jid, sock, message }) => {
        const menuText = '┌─「 *SILVA MD* 」─\\n' +
                        '│\\n' +
                        '│ ⚡ *BOT STATUS*\\n' +
                        '│ • Mode: ' + (config.BOT_MODE || 'public') + '\\n' +
                        '│ • Prefix: ' + config.PREFIX + '\\n' +
                        '│ • Version: ' + config.VERSION + '\\n' +
                        '│\\n' +
                        '│ 📋 *AVAILABLE COMMANDS*\\n' +
                        '│ • ' + config.PREFIX + 'ping - Check bot status\\n' +
                        '│ • ' + config.PREFIX + 'sticker - Create sticker\\n' +
                        '│ • ' + config.PREFIX + 'owner - Show owner info\\n' +
                        '│ • ' + config.PREFIX + 'help - Show help\\n' +
                        '│ • ' + config.PREFIX + 'menu - This menu\\n' +
                        '│ • ' + config.PREFIX + 'plugins - List plugins\\n' +
                        '│ • ' + config.PREFIX + 'stats - Bot statistics\\n' +
                        '│\\n' +
                        '│ └─「 *SILVA TECH* 」';
        
        await sock.sendMessage(jid, { text: menuText }, { quoted: message });
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
        const { text, jid, sender, isGroup, message, sock, args } = context;
        
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
// 📊 STATUS HANDLER
// ==============================
class StatusHandler {
    constructor() {
        this.processedStatuses = new Set();
    }

    async handle({ messages, type, sock, config }) {
        // Only process notify/append messages
        if (type && !['notify', 'append'].includes(type)) {
            return;
        }

        if (!Array.isArray(messages)) return;

        for (const m of messages) {
            // Only process status@broadcast
            if (m.key.remoteJid === 'status@broadcast') {
                try {
                    const statusId = m.key.id;
                    const userJid = m.key.participant;
                    
                    if (!statusId || !userJid) continue;
                    
                    // Skip if already processed
                    const statusKey = `${userJid}_${statusId}`;
                    if (this.processedStatuses.has(statusKey)) {
                        continue;
                    }
                    this.processedStatuses.add(statusKey);
                    
                    // Clean old entries
                    if (this.processedStatuses.size > 1000) {
                        const keys = Array.from(this.processedStatuses);
                        for (let i = 0; i < 500; i++) {
                            this.processedStatuses.delete(keys[i]);
                        }
                    }
                    
                    botLogger.log('INFO', `Status update from ${userJid}: ${statusId}`);

                    // AUTO STATUS SEEN
                    if (config.AUTO_STATUS_SEEN) {
                        try {
                            await sock.readMessages([m.key]);
                            botLogger.log('INFO', `Status seen: ${statusId}`);
                        } catch (e) {
                            botLogger.log('WARN', `Status seen failed: ${e.message}`);
                        }
                    }

                    // AUTO STATUS REACT
                    if (config.AUTO_STATUS_REACT) {
                        try {
                            const emojis = (config.CUSTOM_REACT_EMOJIS || '❤️,🔥,💯,😍,👏').split(',');
                            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)].trim();
                            await sock.sendMessage(userJid, {
                                react: {
                                    text: randomEmoji,
                                    key: {
                                        remoteJid: 'status@broadcast',
                                        id: statusId,
                                        participant: userJid
                                    }
                                }
                            });
                            botLogger.log('INFO', `Reacted on status ${statusId} with: ${randomEmoji}`);
                        } catch (e) {
                            botLogger.log('WARN', `Status reaction failed: ${e.message}`);
                        }
                    }

                    // AUTO STATUS REPLY
                    if (config.AUTO_STATUS_REPLY) {
                        try {
                            await sock.sendMessage(userJid, {
                                text: config.AUTO_STATUS_MSG || '💖 Silva MD saw your status'
                            });
                            botLogger.log('INFO', `Status replied: ${statusId}`);
                        } catch (e) {
                            botLogger.log('WARN', `Status reply failed: ${e.message}`);
                        }
                    }
                } catch (e) {
                    botLogger.log('ERROR', `Status handler error: ${e.message}`);
                }
            }
        }
    }
}

// ==============================
// 🤖 MAIN BOT CLASS
// ==============================
class SilvaBot {
    constructor() {
        this.sock = null;
        this.store = new MessageStore();
        this.groupCache = new NodeCache({ stdTTL: 300, useClones: false });
        this.pluginManager = new PluginManager();
        this.isConnected = false;
        this.functions = new Functions();
        this.statusHandler = new StatusHandler();
        
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
            config: this.configCommand.bind(this),
            uptime: this.uptimeCommand.bind(this)
        };
    }

    async init() {
        try {
            botLogger.log('BOT', "🚀 Starting " + config.BOT_NAME + " v" + config.VERSION);
            botLogger.log('INFO', "Mode: " + (config.BOT_MODE || 'public'));
            
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
            
            // FIXED CONNECTION SETTINGS - Prevent decryption errors
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
                // FIX: Add these options to prevent decryption errors
                shouldIgnoreJid: (jid) => {
                    if (!jid || typeof jid !== 'string') return false;
                    // Ignore status broadcasts to prevent decryption errors
                    if (jid === 'status@broadcast') return true;
                    if (jid.includes('@broadcast')) return true;
                    return false;
                },
                // Disable message history sync for status
                shouldSyncHistoryMessage: (msg) => {
                    return msg.key.remoteJid !== 'status@broadcast';
                },
                // Fix for printQRInTerminal warning
                printQRInTerminal: config.QR_DISPLAY !== false
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
                
                // Send welcome message to owner
                if (config.OWNER_NUMBER) {
                    try {
                        await delay(3000);
                        
                        const ownerJid = this.functions.formatJid(config.OWNER_NUMBER);
                        if (ownerJid) {
                            const now = new Date().toLocaleString();
                            const configSummary = this.functions.getConfigSummary();
                            
                            const welcomeMessage = this.functions.formatText(`
✨ *${config.BOT_NAME || 'SILVA MD'} - CONNECTION ESTABLISHED*

📅 *Connection Time:* ${now}

${configSummary}

⚡ *Connection Status:* ✅ ACTIVE
🔧 *Bot Mode:* ${config.BOT_MODE || 'public'}
🔌 *Plugins Loaded:* ${this.pluginManager.getCommandList().length}

━━━━━━━━━━━━━━━━━━━━━━
💻 *Silva Tech Nexus v${config.VERSION || '3.0'}*
━━━━━━━━━━━━━━━━━━━━━━
                            `.trim());
                            
                            await this.sendMessage(ownerJid, {
                                text: welcomeMessage
                            });
                            
                            botLogger.log('INFO', 'Sent detailed config message to owner');
                        }
                    } catch (error) {
                        botLogger.log('ERROR', 'Failed to send owner message: ' + error.message);
                    }
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // FIXED: Messages handler - filter out problematic messages
        sock.ev.on('messages.upsert', async (m) => {
            try {
                if (!m.messages || !Array.isArray(m.messages)) {
                    return;
                }

                // Filter out problematic messages that cause decryption errors
                const filteredMessages = [];
                const statusMessages = [];

                for (const msg of m.messages) {
                    const jid = msg.key?.remoteJid;
                    
                    // Skip messages from the bot itself
                    if (msg.key?.fromMe) continue;
                    
                    // Separate status messages
                    if (jid === 'status@broadcast') {
                        statusMessages.push(msg);
                    } 
                    // Skip other problematic messages
                    else if (jid?.includes('@broadcast') || jid?.includes('@newsletter')) {
                        continue;
                    }
                    else {
                        filteredMessages.push(msg);
                    }
                }

                // Process status messages separately
                if (statusMessages.length > 0) {
                    try {
                        await this.statusHandler.handle({
                            messages: statusMessages,
                            type: m.type,
                            sock: sock,
                            config: config
                        });
                    } catch (statusError) {
                        botLogger.log('ERROR', `Status handler error: ${statusError.message}`);
                    }
                }

                // Process regular messages
                if (filteredMessages.length > 0) {
                    await this.handleMessages({ messages: filteredMessages, type: m.type });
                }
            } catch (error) {
                botLogger.log('ERROR', "Messages upsert error: " + error.message);
            }
        });

        sock.ev.on('messages.update', async (updates) => {
            // Handle message updates if needed
        });

        sock.ev.on('group-participants.update', async (event) => {
            try {
                if (this.sock.user && this.sock.user.id) {
                    const botJid = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    if (event.action === 'add' && event.participants.includes(botJid)) {
                        await this.sendMessage(event.id, {
                            text: `🤖 *${config.BOT_NAME} Activated!*\n\nType ${config.PREFIX}menu for commands\nType ${config.PREFIX}help for assistance`
                        });
                        botLogger.log('INFO', 'Bot added to group: ' + event.id);
                    }
                }
            } catch (error) {
                // Silent fail
            }
        });
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

    async handleMessages(m) {
        if (!m.messages || !Array.isArray(m.messages)) {
            return;
        }
        
        for (const message of m.messages) {
            try {
                if (message.key.fromMe) {
                    continue;
                }

                // Store message
                try {
                    await this.store.setMessage(message.key, message);
                } catch (storeError) {
                    botLogger.log('WARNING', 'Failed to store message: ' + storeError.message);
                }

                const jid = message.key.remoteJid;
                const sender = message.key.participant || jid;
                const isGroup = jid.endsWith('@g.us');
                
                // Send typing indicator
                try {
                    await this.sock.sendPresenceUpdate('recording', jid);
                } catch (presenceError) {
                    // Ignore presence errors
                }

                // Extract text from message
                let text = '';
                try {
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
                    } else if (message.message?.audioMessage?.caption) {
                        text = message.message.audioMessage.caption;
                    }
                } catch (extractError) {
                    botLogger.log('WARNING', 'Failed to extract text: ' + extractError.message);
                }

                // Check if message starts with prefix
                if (text && text.startsWith(config.PREFIX)) {
                    botLogger.log('INFO', 'Command detected: ' + text);
                    
                    const cmdText = text.slice(config.PREFIX.length).trim();
                    
                    // Stop typing indicator
                    try {
                        await this.sock.sendPresenceUpdate('paused', jid);
                    } catch (presenceError) {
                        // Ignore
                    }
                    
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
                                sock: this.sock
                            });
                        } else if (config.AUTO_REPLY) {
                            await this.sock.sendMessage(jid, {
                                text: '❓ Unknown command. Type ' + config.PREFIX + 'help for available commands.'
                            }, { quoted: message });
                        }
                    }
                } else {
                    // Stop typing indicator for non-commands
                    try {
                        await this.sock.sendPresenceUpdate('paused', jid);
                    } catch (presenceError) {
                        // Ignore
                    }
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
    // 💬 COMMAND HANDLERS
    // ==============================
    
    async helpCommand(context) {
        const { jid, sock, message } = context;
        const plugins = this.pluginManager.getCommandList();
        
        let helpText = '*Silva MD Help Menu*\n\n';
        helpText += 'Prefix: ' + config.PREFIX + '\n';
        helpText += 'Mode: ' + (config.BOT_MODE || 'public') + '\n';
        helpText += 'Version: ' + (config.VERSION || '3.0') + '\n\n';
        helpText += '*Built-in Commands:*\n';
        helpText += '• ' + config.PREFIX + 'help - This menu\n';
        helpText += '• ' + config.PREFIX + 'menu - Main menu\n';
        helpText += '• ' + config.PREFIX + 'ping - Check status\n';
        helpText += '• ' + config.PREFIX + 'owner - Owner info\n';
        helpText += '• ' + config.PREFIX + 'config - Show bot config\n';
        helpText += '• ' + config.PREFIX + 'plugins - List plugins\n';
        helpText += '• ' + config.PREFIX + 'stats - Bot statistics\n';
        helpText += '• ' + config.PREFIX + 'uptime - Check bot uptime\n';
        
        if (plugins.length > 0) {
            helpText += '\n*Loaded Plugins:*\n';
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
        const plugins = this.pluginManager.getCommandList();
        
        let menuText = '┌─「 *SILVA MD v' + (config.VERSION || '3.0') + '* 」─\n';
        menuText += '│\n';
        menuText += '│ ⚡ *BOT STATUS*\n';
        menuText += '│ • Mode: ' + (config.BOT_MODE || 'public') + '\n';
        menuText += '│ • Prefix: ' + config.PREFIX + '\n';
        menuText += '│ • Plugins: ' + plugins.length + '\n';
        menuText += '│ • Connection: ' + (this.isConnected ? '✅' : '❌') + '\n';
        menuText += '│\n';
        menuText += '│ 📋 *CORE COMMANDS*\n';
        menuText += '│ • ' + config.PREFIX + 'ping - Check bot status\n';
        menuText += '│ • ' + config.PREFIX + 'help - Show help\n';
        menuText += '│ • ' + config.PREFIX + 'owner - Show owner info\n';
        menuText += '│ • ' + config.PREFIX + 'config - Show config\n';
        menuText += '│ • ' + config.PREFIX + 'plugins - List plugins\n';
        menuText += '│ • ' + config.PREFIX + 'stats - Bot statistics\n';
        menuText += '│ • ' + config.PREFIX + 'uptime - Check uptime\n';
        menuText += '│\n';
        
        if (plugins.length > 0) {
            menuText += '│ 🎯 *PLUGIN COMMANDS*\n';
            const pluginCount = Math.min(plugins.length, 8);
            for (let i = 0; i < pluginCount; i++) {
                menuText += '│ • ' + config.PREFIX + plugins[i].command + '\n';
            }
            if (plugins.length > 8) {
                menuText += '│ • ... and ' + (plugins.length - 8) + ' more\n';
            }
        }
        
        menuText += '│\n';
        menuText += '│ └─「 *SILVA TECH NEXUS* 」';
        
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
                text: '*Status Report*\n\n⚡ Latency: ' + latency + 'ms\n📊 Uptime: ' + (process.uptime() / 3600).toFixed(2) + 'h\n💾 RAM: ' + this.functions.formatBytes(process.memoryUsage().heapUsed) + '\n🌐 Connection: ' + (this.isConnected ? 'Connected ✅' : 'Disconnected ❌') + '\n🔌 Plugins: ' + this.pluginManager.getCommandList().length
            }, { quoted: message });
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send ping: ' + error.message);
        }
    }

    async ownerCommand(context) {
        const { jid, sock, message } = context;
        if (config.OWNER_NUMBER) {
            try {
                await sock.sendMessage(jid, {
                    text: '👑 *Bot Owner*\n\n📞 ' + config.OWNER_NUMBER + '\n🤖 ' + config.BOT_NAME + '\n⚡ v' + config.VERSION + '\n🔧 ' + config.BOT_MODE + ' mode'
                }, { quoted: message });
            } catch (error) {
                botLogger.log('ERROR', 'Failed to send owner info: ' + error.message);
            }
        }
    }

    async statsCommand(context) {
        const { jid, sock, message } = context;
        try {
            const statsText = '📊 *Bot Statistics*\n\n' +
                             '⏱️ Uptime: ' + (process.uptime() / 3600).toFixed(2) + 'h\n' +
                             '💾 Memory: ' + this.functions.formatBytes(process.memoryUsage().heapUsed) + '\n' +
                             '📦 Platform: ' + process.platform + '\n' +
                             '🔌 Plugins: ' + this.pluginManager.getCommandList().length + '\n' +
                             '🌐 Connection: ' + (this.isConnected ? 'Connected ✅' : 'Disconnected ❌') + '\n' +
                             '🤖 Bot: ' + config.BOT_NAME + ' v' + config.VERSION + '\n' +
                             '🔧 Mode: ' + config.BOT_MODE;
            
            await sock.sendMessage(jid, { text: statsText }, { quoted: message });
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send stats: ' + error.message);
        }
    }

    async pluginsCommand(context) {
        const { jid, sock, message } = context;
        try {
            const plugins = this.pluginManager.getCommandList();
            let pluginsText = '📦 *Loaded Plugins*\n\nTotal: ' + plugins.length + ' plugins\n\n';
            
            if (plugins.length === 0) {
                pluginsText += 'No plugins loaded.\nCheck silvaxlab folder.';
            } else {
                for (const plugin of plugins) {
                    const tags = plugin.tags && plugin.tags.length > 0 ? ` [${plugin.tags.join(',')}]` : '';
                    pluginsText += '• ' + config.PREFIX + plugin.command + tags + ' - ' + plugin.help + '\n';
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
            const startText = '✨ *Welcome to Silva MD!*\n\n' +
                             'I am an advanced WhatsApp bot with plugin support.\n\n' +
                             '🤖 *Bot Info:*\n' +
                             '• Mode: ' + (config.BOT_MODE || 'public') + '\n' +
                             '• Prefix: ' + config.PREFIX + '\n' +
                             '• Version: ' + config.VERSION + '\n\n' +
                             'Type ' + config.PREFIX + 'help for commands\n' +
                             'Type ' + config.PREFIX + 'menu for main menu\n' +
                             'Type ' + config.PREFIX + 'config for configuration';
            
            await sock.sendMessage(jid, { 
                text: startText
            }, { quoted: message });
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send start message: ' + error.message);
        }
    }

    async configCommand(context) {
        const { jid, sock, message } = context;
        try {
            const configSummary = this.functions.getConfigSummary();
            const configText = '⚙️ *Bot Configuration*\n\n' + configSummary;
            
            await sock.sendMessage(jid, { 
                text: configText
            }, { quoted: message });
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send config: ' + error.message);
        }
    }

    async uptimeCommand(context) {
        const { jid, sock, message } = context;
        try {
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);
            
            const uptimeText = '⏱️ *Bot Uptime*\n\n' +
                              '🕒 ' + hours + 'h ' + minutes + 'm ' + seconds + 's\n' +
                              '📅 Since: ' + new Date(Date.now() - (uptime * 1000)).toLocaleString() + '\n' +
                              '⚡ Status: ' + (this.isConnected ? '✅ Online' : '❌ Offline') + '\n' +
                              '🔌 Plugins: ' + this.pluginManager.getCommandList().length;
            
            await sock.sendMessage(jid, { 
                text: uptimeText
            }, { quoted: message });
        } catch (error) {
            botLogger.log('ERROR', 'Failed to send uptime: ' + error.message);
        }
    }

    async sendMessage(jid, content, options = {}) {
        try {
            if (this.sock && this.isConnected) {
                // Format text if it exists
                if (content.text) {
                    content.text = this.functions.formatText(content.text);
                }
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

// Export bot instance
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
