const {
    makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    downloadMediaMessage,
    getContentType,
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
    isForwarded: true
};

// Proper pino logger
const logger = pino({
    level: config.DEBUG_MODE ? 'debug' : 'warn',
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
                // Ignore
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
        botLogger.log('ERROR', `Session Error: ${e.message}`);
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
}

// Store Implementation
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

// Plugin Manager
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
            botLogger.log('ERROR', `Plugin loading error: ${error.message}`);
        }
    }

    createExamplePlugins(pluginDir) {
        const examplePlugins = {
            'sticker.js': `// Sticker plugin
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
                    text: '🖼️ *How to use sticker command:*\\n\\n1. Send an image/video\\n2. Add caption ".sticker"\\n3. Or reply to media with ".sticker"'
                }, { quoted: message });
            }
            
            await sock.sendMessage(jid, { text: '🎨 Creating sticker...' }, { quoted: message });
            await delay(1000);
            
            await sock.sendMessage(jid, {
                text: '✅ *Sticker Created!*\\n\\nThis is a demo. In real implementation, the sticker would be sent.'
            }, { quoted: message });
        } catch (error) {
            await sock.sendMessage(jid, {
                text: \`❌ Error: \${error.message}\`
            }, { quoted: message });
        }
    }
};

module.exports = { handler };
`,
            'ping.js': `// Ping command
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
            text: \`*Ping Statistics:*\\n\\n⚡ Latency: \${latency}ms\\n📊 Uptime: \${(process.uptime() / 3600).toFixed(2)}h\\n💾 RAM: \${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB\`
        }, { quoted: message });
    }
};

module.exports = { handler };
`,
            'menu.js': `// Menu command
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
        
        await sock.sendMessage(jid, { text: menuText }, { quoted: message });
    }
};

module.exports = { handler };
`
        };

        for (const [filename, content] of Object.entries(examplePlugins)) {
            fs.writeFileSync(path.join(pluginDir, filename), content.trim());
            botLogger.log('INFO', `Created example plugin: ${filename}`);
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
                    
                    await handler.execute(context);
                    return true;
                    
                } catch (error) {
                    botLogger.log('ERROR', `Command error: ${error.message}`);
                    await sock.sendMessage(jid, { 
                        text: \`❌ Error: \${error.message}\` 
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

// Main Bot Class
class SilvaBot {
    constructor() {
        this.sock = null;
        this.store = new MessageStore();
        this.groupCache = new NodeCache({ stdTTL: 300, useClones: false });
        this.pluginManager = new PluginManager();
        this.isConnected = false;
        this.functions = new Functions();
        
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
            start: this.startCommand.bind(this)
        };
    }

    async init() {
        try {
            botLogger.log('BOT', `🚀 Starting ${config.BOT_NAME} v${config.VERSION}`);
            botLogger.log('INFO', `Mode: ${config.BOT_MODE || 'public'}`);
            
            if (config.SESSION_ID) {
                await loadSession();
            }

            await this.pluginManager.loadPlugins('silvaxlab');
            await this.connect();
        } catch (error) {
            botLogger.log('ERROR', `Init failed: ${error.message}`);
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
                getMessage: async (key) => await this.store.getMessage(key),
                retryRequestDelayMs: 3000,
                connectTimeoutMs: 30000,
                keepAliveIntervalMs: 25000,
                emitOwnEvents: true,
                printQRInTerminal: true,
                fireInitQueries: true,
                mobile: false
            });

            this.setupEvents(saveCreds);
            botLogger.log('SUCCESS', '✅ Bot initialized');
            this.reconnectAttempts = 0;
        } catch (error) {
            botLogger.log('ERROR', `Connection error: ${error.message}`);
            await this.handleReconnect(error);
        }
    }

    async handleReconnect(error) {
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
        botLogger.log('WARNING', `Reconnecting in ${delay/1000}s (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        await this.functions.sleep(delay);
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
                
                botLogger.log('WARNING', `Connection closed. Status: ${statusCode}`);
                
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
                
                if (config.OWNER_NUMBER) {
                    try {
                        await delay(2000);
                        const ownerJid = this.functions.formatJid(config.OWNER_NUMBER);
                        if (ownerJid) {
                            await this.sendMessage(ownerJid, {
                                text: `✅ *${config.BOT_NAME} Connected!*\\nMode: ${config.BOT_MODE || 'public'}\\nTime: ${new Date().toLocaleString()}`
                            });
                        }
                    } catch (error) {
                        // Silent fail
                    }
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            try {
                await this.handleMessages(m);
            } catch (error) {
                botLogger.log('ERROR', `Messages error: ${error.message}`);
            }
        });

        sock.ev.on('group-participants.update', async (event) => {
            try {
                if (this.sock.user && this.sock.user.id) {
                    const botJid = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    if (event.action === 'add' && event.participants.includes(botJid)) {
                        await this.sendMessage(event.id, {
                            text: `🤖 *${config.BOT_NAME} Activated!*\\nType ${config.PREFIX}menu for commands`
                        });
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
            }
        } catch (error) {
            // Silent fail
        }
    }

    async handleMessages(m) {
        if (!m.messages || !Array.isArray(m.messages)) return;
        
        for (const message of m.messages) {
            try {
                if (message.key.fromMe || message.key.remoteJid === 'status@broadcast') {
                    continue;
                }

                await this.store.setMessage(message.key, message);

                const jid = message.key.remoteJid;
                const sender = message.key.participant || jid;
                const isGroup = jid.endsWith('@g.us');

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

                if (text.startsWith(config.PREFIX)) {
                    const cmdText = text.slice(config.PREFIX.length).trim();
                    
                    if (!this.functions.isAllowed(sender, jid)) {
                        if (config.BOT_MODE === 'private') {
                            await this.sock.sendMessage(jid, {
                                text: '🔒 Private mode: Contact owner.'
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
                        }
                    }
                }

            } catch (error) {
                botLogger.log('ERROR', `Message handling error: ${error.message}`);
            }
        }
    }

    // Command handlers
    async helpCommand(context) {
        const { jid, sock, message } = context;
        const plugins = this.pluginManager.getCommandList();
        
        let helpText = `*${config.BOT_NAME} Help Menu*\n\n`;
        helpText += `Prefix: ${config.PREFIX}\n`;
        helpText += `Mode: ${config.BOT_MODE || 'public'}\n\n`;
        helpText += `*Built-in Commands:*\n`;
        helpText += `• ${config.PREFIX}help - This menu\n`;
        helpText += `• ${config.PREFIX}menu - Main menu\n`;
        helpText += `• ${config.PREFIX}ping - Check status\n`;
        helpText += `• ${config.PREFIX}owner - Owner info\n`;
        helpText += `• ${config.PREFIX}plugins - List plugins\n`;
        helpText += `• ${config.PREFIX}stats - Bot statistics\n`;
        
        if (plugins.length > 0) {
            helpText += `\n*Loaded Plugins:*\n`;
            for (const cmd of plugins) {
                helpText += `• ${config.PREFIX}${cmd.command} - ${cmd.help}\n`;
            }
        }
        
        helpText += `\n📍 *Silva Tech Nexus*`;
        
        await sock.sendMessage(jid, { text: helpText }, { quoted: message });
    }

    async menuCommand(context) {
        const { jid, sock, message } = context;
        const menuText = `┌─「 *${config.BOT_NAME}* 」─
│
│ ⚡ *BOT STATUS*
│ • Mode: ${config.BOT_MODE || 'public'}
│ • Prefix: ${config.PREFIX}
│ • Version: ${config.VERSION}
│
│ 📋 *CORE COMMANDS*
│ • ${config.PREFIX}ping - Check bot status
│ • ${config.PREFIX}help - Show help
│ • ${config.PREFIX}owner - Show owner info
│ • ${config.PREFIX}menu - This menu
│ • ${config.PREFIX}plugins - List plugins
│ • ${config.PREFIX}stats - Bot statistics
│
│ 🎨 *MEDIA COMMANDS*
│ • ${config.PREFIX}sticker - Create sticker
│
│ └─「 *SILVA TECH* 」`;
        
        await sock.sendMessage(jid, { text: menuText }, { quoted: message });
    }

    async pingCommand(context) {
        const { jid, sock, message } = context;
        const start = Date.now();
        await sock.sendMessage(jid, { text: '🏓 Pong!' }, { quoted: message });
        const latency = Date.now() - start;
        
        await sock.sendMessage(jid, {
            text: `*Status Report*\n\n⚡ Latency: ${latency}ms\n📊 Uptime: ${(process.uptime() / 3600).toFixed(2)}h\n💾 RAM: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB\n🌐 Connection: ${this.isConnected ? 'Connected ✅' : 'Disconnected ❌'}`
        }, { quoted: message });
    }

    async ownerCommand(context) {
        const { jid, sock, message } = context;
        if (config.OWNER_NUMBER) {
            await sock.sendMessage(jid, {
                text: `👑 *Bot Owner*\n\n📞 ${config.OWNER_NUMBER}\n🤖 ${config.BOT_NAME}\n⚡ v${config.VERSION}`
            }, { quoted: message });
        }
    }

    async statsCommand(context) {
        const { jid, sock, message } = context;
        const statsText = `📊 *Bot Statistics*\n\n` +
                         `⏱️ Uptime: ${(process.uptime() / 3600).toFixed(2)}h\n` +
                         `💾 Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB\n` +
                         `📦 Platform: ${process.platform}\n` +
                         `🔌 Plugins: ${this.pluginManager.getCommandList().length}\n` +
                         `🌐 Status: ${this.isConnected ? 'Connected ✅' : 'Disconnected ❌'}\n` +
                         `🤖 Bot: ${config.BOT_NAME} v${config.VERSION}`;
        
        await sock.sendMessage(jid, { text: statsText }, { quoted: message });
    }

    async pluginsCommand(context) {
        const { jid, sock, message } = context;
        const plugins = this.pluginManager.getCommandList();
        let pluginsText = `📦 *Loaded Plugins*\n\nTotal: ${plugins.length}\n\n`;
        
        if (plugins.length === 0) {
            pluginsText += `No plugins loaded.\nCheck silvaxlab folder.`;
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
            text: `✨ *Welcome to ${config.BOT_NAME}!*\n\nI'm an advanced WhatsApp bot with plugin support.\n\nType ${config.PREFIX}help for commands` 
        }, { quoted: message });
    }

    async sendMessage(jid, content, options = {}) {
        try {
            if (this.sock && this.isConnected) {
                return await this.sock.sendMessage(jid, content, { ...globalContextInfo, ...options });
            }
            return null;
        } catch (error) {
            botLogger.log('ERROR', `Send error: ${error.message}`);
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
    functions: new Functions()
};
