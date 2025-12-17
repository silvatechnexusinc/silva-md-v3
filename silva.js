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
       
        if (fs.existsSync(credsPath)) {
            try {
                fs.unlinkSync(credsPath);
                botLogger.log('INFO', "♻️ Old session removed");
            } catch (e) {}
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
    constructor(sock) {
        this.sock = sock;
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
        let cleanSender = sender
            .replace(/@lid$/, '')
            .replace(/@s.whatsapp.net$/, '')
            .replace(/[^0-9]/g, '');

        let botNumber = null;
        if (this.sock?.user?.id) {
            botNumber = this.sock.user.id.split(':')[0].split('@')[0];
        }

        let ownerNumbers = [];
        if (config.OWNER_NUMBER) {
            if (Array.isArray(config.OWNER_NUMBER)) {
                ownerNumbers = config.OWNER_NUMBER.map(num => num.replace(/[^0-9]/g, ''));
            } else if (typeof config.OWNER_NUMBER === 'string') {
                ownerNumbers = [config.OWNER_NUMBER.replace(/[^0-9]/g, '')];
            }
        }
        if (config.CONNECTED_NUMBER) {
            ownerNumbers.push(config.CONNECTED_NUMBER.replace(/[^0-9]/g, ''));
        }
        if (botNumber) ownerNumbers.push(botNumber);

        ownerNumbers = [...new Set(ownerNumbers.filter(Boolean))];

        return ownerNumbers.includes(cleanSender);
    }

    isAllowed(sender, jid) {
        if (this.isOwner(sender)) return true;
        if (config.BOT_MODE === 'public') return true;
        if (config.BOT_MODE === 'private') {
            if (jid.endsWith('@g.us')) return true;
            if (config.ALLOWED_USERS && Array.isArray(config.ALLOWED_USERS)) {
                const senderNumber = sender.split('@')[0].replace(/[^0-9]/g, '');
                const allowed = config.ALLOWED_USERS.map(num => num.replace(/[^0-9]/g, ''));
                return allowed.includes(senderNumber);
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

    extractText(message) {
        if (!message) return '';
        if (message.conversation) return message.conversation;
        if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
        if (message.imageMessage?.caption) return message.imageMessage.caption;
        if (message.videoMessage?.caption) return message.videoMessage.caption;
        if (message.documentMessage?.caption) return message.documentMessage.caption;
        if (message.audioMessage?.caption) return message.audioMessage.caption;
        return '';
    }
}
// ==============================
// 💾 STORE IMPLEMENTATION
// ==============================
class MessageStore {
    constructor() {
        this.messageCache = new NodeCache({ stdTTL: 3600 });
        this.deletedMessages = new Map();
    }
    async getMessage(key) { return this.messageCache.get(key.id); }
    async setMessage(key, message) { this.messageCache.set(key.id, message); }
    async saveDeletedMessage(key, message) {
        if (message && !message.key?.fromMe) {
            this.deletedMessages.set(key.id, { ...message, timestamp: Date.now(), deletedAt: Date.now() });
            setTimeout(() => this.deletedMessages.delete(key.id), 300000);
        }
    }
    async getDeletedMessage(keyId) { return this.deletedMessages.get(keyId); }
}
// ==============================
// 🧩 PLUGIN MANAGER
// ==============================
class PluginManager {
    constructor() {
        this.commandHandlers = new Map();
        this.pluginInfo = new Map();
    }
    async loadPlugins(dir = 'silvaxlab') {
        try {
            const pluginDir = path.join(__dirname, dir);
            if (!fs.existsSync(pluginDir)) {
                fs.mkdirSync(pluginDir, { recursive: true });
                botLogger.log('INFO', "Created plugin directory: " + dir);
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
    async executeCommand(context) {
        const { text, jid, sender, isGroup, message, sock } = context;
        const functions = new Functions(sock);
       
        if (!functions.isOwner(sender)) {
            if (!functions.isAllowed(sender, jid)) {
                if (config.BOT_MODE === 'private') {
                    await sock.sendMessage(jid, { text: '🔒 Private mode: Contact owner for access.' }, { quoted: message });
                    return true;
                }
                return false;
            }
        }
       
        for (const [commandRegex, handler] of this.commandHandlers.entries()) {
            const commandMatch = text.split(' ')[0];
            if (commandRegex.test(commandMatch)) {
                try {
                    if (handler.owner && !functions.isOwner(sender)) {
                        await sock.sendMessage(jid, { text: '⚠️ Owner only command' }, { quoted: message });
                        return true;
                    }
                    if (handler.group && !isGroup) {
                        await sock.sendMessage(jid, { text: '⚠️ Group only command' }, { quoted: message });
                        return true;
                    }
                    if (handler.admin && isGroup) {
                        const isAdmin = await functions.isAdmin(message, sock);
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
                        } catch (e) {}
                    }
                    await handler.execute(context);
                    return true;
                } catch (error) {
                    botLogger.log('ERROR', "Command error: " + error.message);
                    await sock.sendMessage(jid, { text: '❌ Error: ' + error.message }, { quoted: message });
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
// 🤖 MAIN BOT CLASS (FIXED CRASH)
// ==============================
class SilvaBot {
    constructor() {
        this.sock = null;
        this.store = new MessageStore();
        this.groupCache = new NodeCache({ stdTTL: 300, useClones: false });
        this.pluginManager = new PluginManager();
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000;
        this.keepAliveInterval = null;
       
        this.antiDeleteEnabled = config.ANTIDELETE !== false;
        this.recentDeletedMessages = [];
        this.maxDeletedMessages = 20;
        this.autoStatusView = config.AUTO_STATUS_VIEW || false;
        this.autoStatusLike = config.AUTO_STATUS_LIKE || false;
       
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
           
            if (config.SESSION_ID) await loadSession();
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
                shouldIgnoreJid: (jid) => jid === 'status@broadcast' || jid.includes('@newsletter'),
                getMessage: async (key) => {
                    try { return await this.store.getMessage(key); } catch { return null; }
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
        await delay(delayTime);
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
                // Send connected message
                const ownerJid = this.functions.formatJid(config.CONNECTED_NUMBER || config.OWNER_NUMBER);
                if (ownerJid) {
                    await delay(2000);
                    await sock.sendMessage(ownerJid, { text: `✅ *${config.BOT_NAME} Connected!*\nTime: ${new Date().toLocaleString()}` });
                    botLogger.log('INFO', 'Sent connected message to owner');
                }
            }
        });
        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('messages.upsert', async (m) => {
            try { await this.handleMessages(m); } catch (e) { botLogger.log('ERROR', "Messages upsert error: " + e.message); }
        });
        sock.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                if (update.update && (update.update === 'delete' || update.update.messageStubType === 7)) {
                    await this.handleMessageDelete(update);
                }
            }
        });
        sock.ev.on('messages.delete', async (deletion) => {
            if (this.antiDeleteEnabled) await this.handleBulkMessageDelete(deletion);
        });
        sock.ev.on('group-participants.update', async (event) => {
            if (this.sock.user?.id && event.action === 'add' && event.participants.includes(this.sock.user.id.split(':')[0] + '@s.whatsapp.net')) {
                await sock.sendMessage(event.id, { text: '🤖 *Bot Activated!*\nType ' + config.PREFIX + 'menu' });
            }
        });
        sock.ev.on('messages.upsert', async (m) => {
            if (this.autoStatusView || this.autoStatusLike) await this.handleStatusMessages(m);
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
        } catch (error) {}
    }
    async handleStatusMessages(m) {
        for (const msg of m.messages || []) {
            if (msg.key.remoteJid === 'status@broadcast') {
                if (this.autoStatusView) await this.sock.readMessages([{ key: msg.key }]);
                if (this.autoStatusLike) await this.sock.sendMessage(msg.key.remoteJid, { react: { text: '❤️', key: msg.key } });
            }
        }
    }
    async handleMessageDelete(update) {
        if (!this.antiDeleteEnabled || !update.key) return;
        const deletedMsg = await this.store.getMessage(update.key);
        if (deletedMsg && !deletedMsg.key.fromMe) {
            await this.store.saveDeletedMessage(update.key, deletedMsg);
            const jid = update.key.remoteJid;
            const text = this.functions.extractText(deletedMsg.message);
            await this.sock.sendMessage(jid, { text: `🚨 *Message Deleted*\n${text || '[Media]'}` });
        }
    }
    async handleBulkMessageDelete(deletion) {
        if (deletion.keys) {
            for (const key of deletion.keys) {
                await this.handleMessageDelete({ key });
            }
        }
    }
    async handleMessages(m) {
        if (!m.messages) return;
        for (const message of m.messages) {
            try {
                if (message.key.fromMe) continue;
                if (message.key.remoteJid === 'status@broadcast' || message.key.remoteJid.includes('@newsletter')) continue;
                await this.store.setMessage(message.key, message);
                const jid = message.key.remoteJid;
                const sender = message.key.participant || jid;
                const isGroup = jid.endsWith('@g.us');
                const functions = new Functions(this.sock);
               
                if (functions.isOwner(sender)) {
                    botLogger.log('INFO', 'Owner message detected from: ' + sender);
                }
               
                await this.sock.sendPresenceUpdate('composing', jid);
                let text = this.functions.extractText(message.message);
                if (text && text.startsWith(config.PREFIX)) {
                    const cmdText = text.slice(config.PREFIX.length).trim();
                    await this.sock.sendPresenceUpdate('paused', jid);
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
                            await this.commands[command]({ jid, sender, isGroup, args, message, sock: this.sock, bot: this });
                        } else if (config.AUTO_REPLY) {
                            await this.sock.sendMessage(jid, { text: '❓ Unknown command. Type ' + config.PREFIX + 'help' }, { quoted: message });
                        }
                    }
                } else {
                    await this.sock.sendPresenceUpdate('paused', jid);
                }
            } catch (error) {
                botLogger.log('ERROR', "Message handling error: " + error.message);
            }
        }
    }
    // Built-in commands
    async helpCommand({ jid, sock, message }) {
        await sock.sendMessage(jid, { text: 'Type ' + config.PREFIX + 'menu for commands' }, { quoted: message });
    }
    async menuCommand({ jid, sock, message }) {
        await sock.sendMessage(jid, { text: 'Welcome to Silva MD!' }, { quoted: message });
    }
    async pingCommand({ jid, sock, message }) {
        await sock.sendMessage(jid, { text: '🏓 Pong!' }, { quoted: message });
    }
    async ownerCommand({ jid, sock, message }) {
        await sock.sendMessage(jid, { text: 'Owner: ' + config.CONNECTED_NUMBER }, { quoted: message });
    }
    async statsCommand({ jid, sock, message }) {
        await sock.sendMessage(jid, { text: 'Bot is running!' }, { quoted: message });
    }
    async pluginsCommand({ jid, sock, message }) {
        await sock.sendMessage(jid, { text: 'Plugins loaded: ' + this.pluginManager.getCommandList().length }, { quoted: message });
    }
    async startCommand({ jid, sock, message }) {
        await sock.sendMessage(jid, { text: 'Bot started!' }, { quoted: message });
    }
    async antideleteCommand({ jid, sock, message, args }) {
        await sock.sendMessage(jid, { text: 'Anti-delete: ' + (this.antiDeleteEnabled ? 'ON' : 'OFF') }, { quoted: message });
    }
    async statusviewCommand({ jid, sock, message, args }) {
        await sock.sendMessage(jid, { text: 'Status view: ' + (this.autoStatusView ? 'ON' : 'OFF') }, { quoted: message });
    }
    async sendMessage(jid, content, options = {}) {
        return this.sock.sendMessage(jid, content, { ...globalContextInfo, ...options });
    }
}
// ==============================
// 🚀 BOT INSTANCE
// ==============================
const bot = new SilvaBot();
module.exports = { bot, config, logger: botLogger };
