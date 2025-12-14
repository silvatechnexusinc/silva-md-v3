const {
    makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    makeInMemoryStore,
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

// FIXED LOGGER
const { default: makeWASocketLogger } = require('pino');
const logger = makeWASocketLogger({
    level: config.DEBUG_MODE ? 'trace' : 'error',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    }
});

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
            fs.unlinkSync(credsPath);
            botLogger.log('INFO', "♻️ ᴏʟᴅ ꜱᴇꜱꜱɪᴏɴ ʀᴇᴍᴏᴠᴇᴅ");
        }

        if (!config.SESSION_ID || typeof config.SESSION_ID !== 'string') {
            throw new Error("❌ SESSION_ID is missing or invalid");
        }

        const [header, b64data] = config.SESSION_ID.split('~');

        if (header !== "Silva" || !b64data) {
            throw new Error("❌ Invalid session format. Expected 'Silva~.....'");
        }

        const cleanB64 = b64data.replace('...', '');
        const compressedData = Buffer.from(cleanB64, 'base64');
        const decompressedData = zlib.gunzipSync(compressedData);

        fs.writeFileSync(credsPath, decompressedData, "utf8");
        botLogger.log('SUCCESS', "✅ ɴᴇᴡ ꜱᴇꜱꜱɪᴏɴ ʟᴏᴀᴅᴇᴅ ꜱᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ");

        return true;
    } catch (e) {
        botLogger.log('ERROR', `Session Error: ${e.message}`);
        if (config.SESSION_ID) {
            botLogger.log('WARNING', "Falling back to QR code authentication");
        }
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

    // Check if user is admin in group
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

    // Check if user is owner
    isOwner(sender) {
        if (!config.OWNER_NUMBER) return false;
        
        let ownerJid = config.OWNER_NUMBER;
        if (!ownerJid.includes('@s.whatsapp.net')) {
            ownerJid = ownerJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        }
        
        return sender === ownerJid;
    }

    // Check if user is allowed (for private mode)
    isAllowed(sender, jid) {
        // Owner is always allowed
        if (this.isOwner(sender)) return true;
        
        // If bot is in public mode, everyone is allowed
        if (config.BOT_MODE === 'public') return true;
        
        // If bot is in private mode, check if in allowed list
        if (config.BOT_MODE === 'private') {
            // Allow group messages if bot is in group
            if (jid.endsWith('@g.us')) {
                return true;
            }
            
            // Check allowed users
            if (config.ALLOWED_USERS && Array.isArray(config.ALLOWED_USERS)) {
                const senderNumber = sender.split('@')[0];
                return config.ALLOWED_USERS.includes(senderNumber);
            }
            return false;
        }
        
        return true;
    }

    // Format bytes to readable size
    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    // Format phone number to JID
    formatJid(number) {
        if (!number) return null;
        const cleaned = number.replace(/[^0-9]/g, '');
        if (cleaned.length < 10) return null;
        return cleaned + '@s.whatsapp.net';
    }

    // Sleep function
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
        this.deletedMessages = new Map(); // Store deleted messages
        this.viewOnceMessages = new Map(); // Store view once messages
    }

    async getMessage(key) {
        return this.messages.get(key.id);
    }

    async setMessage(key, message) {
        this.messages.set(key.id, message);
        
        // Check if it's a view once message and store it
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

    // Store deleted message
    async storeDeletedMessage(key, message) {
        this.deletedMessages.set(key.id, {
            ...message,
            deletedAt: Date.now(),
            from: key.remoteJid,
            participant: key.participant
        });
    }

    // Get deleted message
    async getDeletedMessage(key) {
        return this.deletedMessages.get(key.id);
    }

    // Get view once message
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
                
                // Create example plugins in silvaxlab directory
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
`,
            'add.js': `
// Add member to group
handler.help = ['add <number>'];
handler.tags = ['group'];
handler.command = /^add$/i;
handler.group = true;
handler.admin = true;
handler.botAdmin = true;

handler.code = async ({ jid, sock, args, message }) => {
    if (!args[0]) {
        return await sock.sendMessage(jid, {
            text: 'Please provide a phone number\\nExample: .add 1234567890'
        }, { quoted: message });
    }
    
    const number = args[0].replace(/[^0-9]/g, '');
    if (number.length < 10) {
        return await sock.sendMessage(jid, {
            text: '❌ Invalid phone number'
        }, { quoted: message });
    }
    
    const userJid = \`\${number}@s.whatsapp.net\`;
    
    try {
        await sock.groupParticipantsUpdate(jid, [userJid], 'add');
        await sock.sendMessage(jid, {
            text: \`✅ Added \${number} to the group\`
        }, { quoted: message });
    } catch (error) {
        await sock.sendMessage(jid, {
            text: \`❌ Failed: \${error.message}\`
        }, { quoted: message });
    }
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
        
        // Check if user is allowed based on bot mode
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
        
        // Status tracking
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
            
            if (config.SESSION_ID) {
                await loadSession();
            }

            await this.pluginManager.loadPlugins('silvaxlab');
            await this.connect();
        } catch (error) {
            botLogger.log('ERROR', `Initialization failed: ${error.message}`);
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
                retryRequestDelayMs: 2000,
                connectTimeoutMs: 30000,
                printQRInTerminal: false
            });

            this.setupEvents(saveCreds);
            botLogger.log('SUCCESS', '✅ Bot initialized successfully');
        } catch (error) {
            botLogger.log('ERROR', `Connection error: ${error.message}`);
            setTimeout(() => this.connect(), 5000);
        }
    }

    setupEvents(saveCreds) {
        const sock = this.sock;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                this.qrCode = qr;
                botLogger.log('INFO', '📱 QR Code Generated:');
                qrcode.generate(qr, { small: true });
                
                const qrText = `QR Code for session: ${qr}`;
                botLogger.log('INFO', qrText);
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                botLogger.log('WARNING', `Connection closed. Reconnecting: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    setTimeout(() => this.connect(), 5000);
                }
            } else if (connection === 'open') {
                this.isConnected = true;
                botLogger.log('SUCCESS', '🔗 Connected to WhatsApp');
                
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
                
                // Auto follow newsletters/channels
                if (config.AUTO_CHANNEL_FOLLOW) {
                    await this.autoFollowChannels();
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            await this.handleMessages(m);
        });

        sock.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                // Handle message deletions
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
                    botLogger.log('ERROR', `Group update error: ${error.message}`);
                }
            }
        });

        sock.ev.on('group-participants.update', async (event) => {
            try {
                const metadata = await sock.groupMetadata(event.id);
                this.groupCache.set(event.id, metadata);
                await this.handleGroupParticipantsUpdate(event);
            } catch (error) {
                botLogger.log('ERROR', `Group participants update error: ${error.message}`);
            }
        });

        // Handle status updates
        sock.ev.on('presence.update', async (update) => {
            await this.handlePresenceUpdate(update);
        });

        // Handle status broadcasts
        sock.ev.on('messages.upsert', async (m) => {
            if (m.type === 'append' || m.type === 'notify') {
                for (const msg of m.messages) {
                    if (msg.key.remoteJid === 'status@broadcast') {
                        await this.handleStatusUpdate(msg);
                    }
                }
            }
        });

        sock.ev.on('contacts.update', (updates) => {
            // Update contacts store
        });

        sock.ev.on('chats.upsert', (chats) => {
            for (const chat of chats) {
                this.store.setChat(chat.id, chat);
            }
        });
    }

    async autoFollowChannels() {
        try {
            const newsletterIds = config.NEWSLETTER_IDS || [
                '120363276154401733@newsletter',
                '120363200367779016@newsletter',
                '120363199904258143@newsletter',
                '120363422731708290@newsletter'
            ];
            
            for (const jid of newsletterIds) {
                try {
                    if (typeof this.sock.newsletterFollow === 'function') {
                        await this.sock.newsletterFollow(jid);
                        botLogger.log('SUCCESS', `✅ Followed newsletter ${jid}`);
                    } else {
                        botLogger.log('DEBUG', `newsletterFollow not available in this Baileys version`);
                    }
                } catch (err) {
                    botLogger.log('ERROR', `Failed to follow newsletter ${jid}: ${err.message}`);
                }
            }
        } catch (error) {
            botLogger.log('ERROR', `Auto follow channels error: ${error.message}`);
        }
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

                // Store message
                await this.store.setMessage(message.key, message);

                // Handle view once messages
                if (this.viewOnceReveal && 
                    (message.message?.viewOnceMessage || 
                     message.message?.ephemeralMessage?.message?.viewOnceMessage)) {
                    await this.handleViewOnceMessage(message);
                }

                // Check for status updates
                if (message.key.remoteJid === 'status@broadcast') {
                    await this.handleStatusUpdate(message);
                    continue;
                }

                // Auto read messages
                if (config.AUTO_READ) {
                    await this.sock.readMessages([message.key]);
                }

                // Auto typing indicator
                if (config.AUTO_TYPING) {
                    await this.sock.sendPresenceUpdate('composing', message.key.remoteJid);
                    setTimeout(async () => {
                        await this.sock.sendPresenceUpdate('paused', message.key.remoteJid);
                    }, 2000);
                }

                // Get message content
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
                const pushName = message.pushName || 'User';

                // Check if message starts with prefix
                if (text.startsWith(config.PREFIX)) {
                    const cmdText = text.slice(config.PREFIX.length).trim();
                    
                    // Check if user is allowed
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
                        pushName,
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
                                pushName,
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
            if (deletion.keys) {
                for (const key of deletion.keys) {
                    const message = await this.store.getMessage(key);
                    if (message && config.RECOVER_DELETED_MESSAGES) {
                        await this.store.storeDeletedMessage(key, message);
                        
                        // Notify owner
                        if (config.OWNER_NUMBER) {
                            const ownerJid = this.functions.formatJid(config.OWNER_NUMBER);
                            if (ownerJid) {
                                let text = `🗑️ *Message Deleted*\n\n`;
                                text += `• From: ${key.remoteJid}\n`;
                                if (key.participant) text += `• Sender: ${key.participant}\n`;
                                text += `• Time: ${new Date().toLocaleString()}\n`;
                                
                                // Try to get message content
                                let content = '';
                                if (message.message?.conversation) {
                                    content = message.message.conversation;
                                } else if (message.message?.extendedTextMessage?.text) {
                                    content = message.message.extendedTextMessage.text;
                                }
                                
                                if (content) {
                                    text += `• Content: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`;
                                }
                                
                                await this.sendMessage(ownerJid, { text });
                            }
                        }
                    }
                }
            }
        } catch (error) {
            botLogger.log('ERROR', `Message delete handler error: ${error.message}`);
        }
    }

    async handleViewOnceMessage(message) {
        try {
            const jid = message.key.remoteJid;
            const sender = message.key.participant || jid;
            
            // Only reveal for owner if configured
            if (this.functions.isOwner(sender) || config.VIEW_ONCE_REVEAL_ALL) {
                let mediaData = null;
                let mimeType = '';
                
                // Extract view once message
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
            botLogger.log('ERROR', `View once handler error: ${error.message}`);
        }
    }

    async handleStatusUpdate(message) {
        try {
            if (config.AUTO_STATUS_VIEW) {
                await this.sock.readMessages([message.key]);
            }
            
            if (config.AUTO_STATUS_LIKE) {
                await delay(1000); // Wait a bit before liking
                await this.sock.sendMessage(message.key.remoteJid, {
                    react: { text: '❤️', key: message.key }
                });
            }
        } catch (error) {
            // Silent fail for status updates
        }
    }

    async handlePresenceUpdate(update) {
        // Handle presence updates if needed
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
        try {
            const pollCreation = await this.store.getMessage(update.key);
            if (pollCreation) {
                botLogger.log('INFO', 'Poll update received');
            }
        } catch (error) {
            botLogger.log('ERROR', `Poll update error: ${error.message}`);
        }
    }

    // Command Handlers
    async helpCommand(context) {
        const { jid, sock, message } = context;
        
        const commands = this.pluginManager.getCommandList();
        const groupedCommands = {};
        
        for (const cmd of commands) {
            for (const tag of cmd.tags || []) {
                if (!groupedCommands[tag]) groupedCommands[tag] = [];
                groupedCommands[tag].push(cmd);
            }
        }
        
        let helpText = `*${config.BOT_NAME} Help Menu*\n\n`;
        helpText += `*Prefix:* ${config.PREFIX}\n`;
        helpText += `*Mode:* ${config.BOT_MODE || 'public'}\n`;
        helpText += `*Plugins:* ${commands.length}\n\n`;
        
        helpText += `*Core Commands:*\n`;
        for (const [cmd, fn] of Object.entries(this.commands)) {
            helpText += `• ${config.PREFIX}${cmd}\n`;
        }
        
        for (const [tag, cmds] of Object.entries(groupedCommands)) {
            if (cmds.length > 0) {
                helpText += `\n*${tag.toUpperCase()} Commands:*\n`;
                cmds.forEach(cmd => {
                    helpText += `• ${config.PREFIX}${cmd.command} - ${cmd.help}\n`;
                });
            }
        }
        
        helpText += `\n📍 *${config.AUTHOR}*`;
        
        await sock.sendMessage(jid, { text: helpText }, { quoted: message });
    }

    async menuCommand(context) {
        const { jid, sock, message } = context;
        
        const menuText = `┌─「 *${config.BOT_NAME}* 」\n` +
                        `│\n` +
                        `│ ʜᴇʟʟᴏ! ɪ'ᴍ ${config.BOT_NAME}\n` +
                        `│ ᴍᴏᴅᴇ: ${config.BOT_MODE || 'public'}\n` +
                        `│\n` +
                        `├─「 *ᴜsᴇʀ* 」\n` +
                        `│ • ${config.PREFIX}ping\n` +
                        `│ • ${config.PREFIX}help\n` +
                        `│ • ${config.PREFIX}owner\n` +
                        `│ • ${config.PREFIX}mode\n` +
                        `│\n` +
                        `├─「 *ᴘʟᴜɢɪɴs* 」\n` +
                        `│ • ${config.PREFIX}plugins\n` +
                        `│ • ${config.PREFIX}sticker\n` +
                        `│\n` +
                        `├─「 *sᴇᴄᴜʀɪᴛʏ* 」\n` +
                        `│ • ${config.PREFIX}deleted\n` +
                        `│ • ${config.PREFIX}reveal\n` +
                        `│\n` +
                        `└─「 *sɪʟᴠᴀ ᴛᴇᴄʜ* 」\n\n` +
                        `📌 *ᴘʟᴜɢɪɴs:* ${this.pluginManager.getCommandList().length}\n` +
                        `⚡ *ᴜᴘᴛɪᴍᴇ:* ${(process.uptime() / 3600).toFixed(2)}h\n` +
                        `🔧 *ᴠᴇʀsɪᴏɴ:* ${config.VERSION}`;
        
        await sock.sendMessage(jid, { text: menuText }, { quoted: message });
    }

    async pingCommand(context) {
        const { jid, sock, message } = context;
        const start = Date.now();
        
        const pingMsg = await sock.sendMessage(jid, { text: '🏓 Pong!' }, { quoted: message });
        const latency = Date.now() - start;
        
        await sock.sendMessage(jid, { 
            text: `*Ping Statistics:*\n\n⚡ Latency: ${latency}ms\n📊 Uptime: ${(process.uptime() / 3600).toFixed(2)}h\n💾 RAM: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB\n🌐 Connection: ${this.isConnected ? 'Connected ✅' : 'Disconnected ❌'}`
        }, { quoted: message });
    }

    async ownerCommand(context) {
        const { jid, sock, message } = context;
        
        if (config.OWNER_NUMBER) {
            const ownerJid = this.functions.formatJid(config.OWNER_NUMBER);
            if (ownerJid) {
                await sock.sendMessage(jid, {
                    text: `👑 *Bot Owner*\n\n📞 *Contact:* ${ownerJid.split('@')[0]}\n🤖 *Bot:* ${config.BOT_NAME}\n⚡ *Version:* ${config.VERSION}\n🌐 *Mode:* ${config.BOT_MODE || 'public'}`
                }, { quoted: message });
            }
        }
    }

    async modeCommand(context) {
        const { jid, sock, message, sender } = context;
        
        if (!this.functions.isOwner(sender)) {
            await sock.sendMessage(jid, {
                text: '⚠️ This command is only for the bot owner.'
            }, { quoted: message });
            return;
        }
        
        const currentMode = config.BOT_MODE || 'public';
        await sock.sendMessage(jid, {
            text: `*Bot Mode Settings*\n\nCurrent: ${currentMode}\n\nTo change mode, update BOT_MODE in config.js\n\nOptions:\n• public - Everyone can use commands\n• private - Only allowed users can use commands`
        }, { quoted: message });
    }

    async deletedCommand(context) {
        const { jid, sock, message, sender } = context;
        
        if (!this.functions.isOwner(sender)) {
            await sock.sendMessage(jid, {
                text: '⚠️ This command is only for the bot owner.'
            }, { quoted: message });
            return;
        }
        
        if (!config.RECOVER_DELETED_MESSAGES) {
            await sock.sendMessage(jid, {
                text: '❌ Message recovery is disabled. Enable RECOVER_DELETED_MESSAGES in config.'
            }, { quoted: message });
            return;
        }
        
        await sock.sendMessage(jid, {
            text: '📝 Message recovery is active. Deleted messages are logged to owner.'
        }, { quoted: message });
    }

    async revealCommand(context) {
        const { jid, sock, message, sender } = context;
        
        if (!this.functions.isOwner(sender)) {
            await sock.sendMessage(jid, {
                text: '⚠️ This command is only for the bot owner.'
            }, { quoted: message });
            return;
        }
        
        const status = config.AUTO_VIEW_ONCE_REVEAL ? 'enabled' : 'disabled';
        await sock.sendMessage(jid, {
            text: `👁️ *View Once Reveal*\n\nStatus: ${status}\n\nTo enable/disable, set AUTO_VIEW_ONCE_REVEAL in config.`
        }, { quoted: message });
    }

    async statsCommand(context) {
        const { jid, sock, message } = context;
        
        const stats = {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            platform: process.platform,
            nodeVersion: process.version,
            plugins: this.pluginManager.getCommandList().length
        };
        
        const statsText = `📊 *Bot Statistics*\n\n` +
                         `⏱️ *Uptime:* ${(stats.uptime / 3600).toFixed(2)}h\n` +
                         `💾 *Memory:* ${(stats.memory.heapUsed / 1024 / 1024).toFixed(2)}MB\n` +
                         `📦 *Platform:* ${stats.platform}\n` +
                         `⚡ *Node.js:* ${stats.nodeVersion}\n` +
                         `🔌 *Plugins:* ${stats.plugins}\n` +
                         `🌐 *Connection:* ${this.isConnected ? 'Connected ✅' : 'Disconnected ❌'}\n` +
                         `🔒 *Mode:* ${config.BOT_MODE || 'public'}\n` +
                         `🤖 *Bot:* ${config.BOT_NAME} v${config.VERSION}`;
        
        await sock.sendMessage(jid, { text: statsText }, { quoted: message });
    }

    async pluginsCommand(context) {
        const { jid, sock, message } = context;
        
        const plugins = this.pluginManager.getCommandList();
        
        let pluginsText = `📦 *Loaded Plugins*\n\n`;
        
        if (plugins.length === 0) {
            pluginsText += `No plugins loaded. Check the silvaxlab folder.\n`;
        } else {
            pluginsText += `Total: ${plugins.length} plugin(s)\n\n`;
            
            for (const plugin of plugins) {
                const tags = plugin.tags?.join(', ') || 'general';
                pluginsText += `• *${plugin.command}* - ${plugin.help}\n  📍 Tags: ${tags}\n\n`;
            }
        }
        
        pluginsText += `\n📍 Add more plugins to silvaxlab/ folder`;
        
        await sock.sendMessage(jid, { text: pluginsText }, { quoted: message });
    }

    async startCommand(context) {
        const { jid, sock, message } = context;
        
        const startText = `✨ *Welcome to ${config.BOT_NAME}!*\n\n` +
                         `I'm an advanced WhatsApp bot with plugin support.\n\n` +
                         `*Mode:* ${config.BOT_MODE || 'public'}\n` +
                         `*Prefix:* ${config.PREFIX}\n\n` +
                         `*Quick Start:*\n` +
                         `1. Type ${config.PREFIX}help for commands\n` +
                         `2. Type ${config.PREFIX}menu for main menu\n` +
                         `3. Add plugins to silvaxlab/ folder\n\n` +
                         `*Features:*\n` +
                         `• Message recovery\n` +
                         `• View once reveal\n` +
                         `• Auto status view/like\n` +
                         `• Channel auto-follow\n` +
                         `• Plugin system\n\n` +
                         `🔧 *Silva Tech Nexus*`;
        
        await sock.sendMessage(jid, { text: startText }, { quoted: message });
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
