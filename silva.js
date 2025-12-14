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
    proto
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const NodeCache = require('node-cache');
const qrcode = require('qrcode-terminal');

// Import configuration
const config = require('./config.js');

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

// SIMPLE LOGGER FOR PRODUCTION - NO PINO DEPENDENCY
class Logger {
    constructor() {
        this.colors = {
            SUCCESS: '\x1b[32m',
            ERROR: '\x1b[31m',
            INFO: '\x1b[36m',
            WARNING: '\x1b[33m',
            BOT: '\x1b[35m',
            RESET: '\x1b[0m'
        };
    }
    
    log(type, message) {
        const timestamp = new Date().toISOString();
        const color = this.colors[type] || this.colors.INFO;
        console.log(`${color}[${type}] ${timestamp} - ${message}${this.colors.RESET}`);
        
        // Also write to file in production
        if (process.env.NODE_ENV === 'production') {
            const logFile = `./logs/${new Date().toISOString().split('T')[0]}.log`;
            const logDir = path.dirname(logFile);
            
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            
            fs.appendFileSync(logFile, `[${type}] ${timestamp} - ${message}\n`);
        }
    }
}

const logger = new Logger();

// Load Session from Compressed Base64
async function loadSession() {
    try {
        const credsPath = './sessions/creds.json';
        
        // Create sessions directory if it doesn't exist
        if (!fs.existsSync('./sessions')) {
            fs.mkdirSync('./sessions', { recursive: true });
        }
        
        // Remove old session file if exists
        if (fs.existsSync(credsPath)) {
            fs.unlinkSync(credsPath);
            logger.log('INFO', "♻️ ᴏʟᴅ ꜱᴇꜱꜱɪᴏɴ ʀᴇᴍᴏᴠᴇᴅ");
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
        logger.log('SUCCESS', "✅ ɴᴇᴡ ꜱᴇꜱꜱɪᴏɴ ʟᴏᴀᴅᴇᴅ ꜱᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ");

        return true;
    } catch (e) {
        logger.log('ERROR', `Session Error: ${e.message}`);
        if (config.SESSION_ID) {
            logger.log('WARNING', "Falling back to QR code authentication");
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
        return sender === config.OWNER_NUMBER;
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

// Plugin Manager with Handler System
class PluginManager {
    constructor() {
        this.plugins = new Map(); // plugin name -> plugin object
        this.commandHandlers = new Map(); // command regex -> handler
        this.pluginInfo = new Map(); // plugin metadata for help
        this.functions = new Functions();
    }

    async loadPlugins(dir = config.PLUGINS_DIR) {
        try {
            const pluginDir = path.join(__dirname, dir);
            
            if (!fs.existsSync(pluginDir)) {
                fs.mkdirSync(pluginDir, { recursive: true });
                logger.log('INFO', `Created plugin directory: ${dir}`);
                
                // Create example plugins
                this.createExamplePlugins(pluginDir);
                return;
            }

            const pluginFiles = fs.readdirSync(pluginDir)
                .filter(file => file.endsWith('.js') && !file.startsWith('_'));

            logger.log('INFO', `Found ${pluginFiles.length} plugin(s)`);

            for (const file of pluginFiles) {
                try {
                    const pluginPath = path.join(pluginDir, file);
                    delete require.cache[require.resolve(pluginPath)];
                    
                    const plugin = require(pluginPath);
                    const pluginName = file.replace('.js', '');
                    
                    // Support both old and new plugin formats
                    if (plugin.handler) {
                        // New handler-based plugin
                        if (plugin.handler.command) {
                            this.commandHandlers.set(plugin.handler.command, plugin.handler);
                            
                            // Store plugin info
                            this.pluginInfo.set(plugin.handler.command.source, {
                                help: plugin.handler.help || [],
                                tags: plugin.handler.tags || [],
                                group: plugin.handler.group !== undefined ? plugin.handler.group : false,
                                admin: plugin.handler.admin || false,
                                botAdmin: plugin.handler.botAdmin || false,
                                owner: plugin.handler.owner || false,
                                filename: file
                            });
                            
                            logger.log('SUCCESS', `✅ Loaded plugin: ${pluginName} (${plugin.handler.command.source})`);
                        } else if (typeof plugin === 'function') {
                            // Old-style function plugin
                            this.plugins.set(pluginName, plugin);
                            logger.log('INFO', `📦 Loaded legacy plugin: ${pluginName}`);
                        }
                    } else if (typeof plugin === 'function') {
                        // Old-style function plugin
                        this.plugins.set(pluginName, plugin);
                        logger.log('INFO', `📦 Loaded legacy plugin: ${pluginName}`);
                    }
                } catch (error) {
                    logger.log('ERROR', `Failed to load plugin ${file}: ${error.message}`);
                }
            }
        } catch (error) {
            logger.log('ERROR', `Plugin loading error: ${error.message}`);
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
        
        // Implement sticker creation here
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
            logger.log('INFO', `Created example plugin: ${filename}`);
        }
    }

    async executeCommand(context) {
        const { text, jid, sender, isGroup, message, sock, args } = context;
        
        // Check handler-based commands first
        for (const [commandRegex, handler] of this.commandHandlers.entries()) {
            if (commandRegex.test(text.split(' ')[0])) {
                try {
                    // Check command restrictions
                    if (handler.owner && !this.functions.isOwner(sender)) {
                        await sock.sendMessage(jid, { 
                            text: config.MESSAGES.ownerOnly 
                        }, { quoted: message });
                        return true;
                    }
                    
                    if (handler.group && !isGroup) {
                        await sock.sendMessage(jid, { 
                            text: config.MESSAGES.groupOnly 
                        }, { quoted: message });
                        return true;
                    }
                    
                    if (handler.admin && isGroup) {
                        const isAdmin = await this.functions.isAdmin(message, sock);
                        if (!isAdmin) {
                            await sock.sendMessage(jid, { 
                                text: config.MESSAGES.adminOnly 
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
                    
                    // Execute the command
                    await handler.code(context);
                    return true;
                    
                } catch (error) {
                    logger.log('ERROR', `Command execution error: ${error.message}`);
                    await sock.sendMessage(jid, { 
                        text: `❌ Command error: ${error.message}` 
                    }, { quoted: message });
                    return true;
                }
            }
        }
        
        // Check old-style plugins
        const command = text.split(' ')[0];
        if (this.plugins.has(command)) {
            try {
                await this.plugins.get(command)(context);
                return true;
            } catch (error) {
                logger.log('ERROR', `Legacy plugin error: ${error.message}`);
                return false;
            }
        }
        
        return false; // No plugin matched
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
        
        // Built-in commands
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
            logger.log('BOT', `🚀 Starting ${config.BOT_NAME} v${config.VERSION}`);
            
            // Try to load session from compressed base64
            if (config.SESSION_ID) {
                await loadSession();
            }

            // Load plugins
            await this.pluginManager.loadPlugins();

            // Start connection
            await this.connect();
        } catch (error) {
            logger.log('ERROR', `Initialization failed: ${error.message}`);
            process.exit(1);
        }
    }

    async connect() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState('./sessions');
            
            const { version } = await fetchLatestBaileysVersion();
            
            this.sock = makeWASocket({
                version,
                printQRInTerminal: true,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, {
                        info: (msg) => logger.log('INFO', msg),
                        error: (msg) => logger.log('ERROR', msg),
                        warn: (msg) => logger.log('WARNING', msg)
                    })
                },
                browser: Browsers.macOS(config.BOT_NAME),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: true,
                syncFullHistory: false,
                defaultQueryTimeoutMs: 60000,
                cachedGroupMetadata: async (jid) => this.groupCache.get(jid),
                getMessage: async (key) => await this.store.getMessage(key),
                retryRequestDelayMs: 2000,
                connectTimeoutMs: 30000
            });

            // Set up event handlers
            this.setupEvents(saveCreds);
            
            logger.log('SUCCESS', '✅ Bot initialized successfully');
        } catch (error) {
            logger.log('ERROR', `Connection error: ${error.message}`);
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
                logger.log('INFO', '📱 Scan QR code above with WhatsApp');
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                logger.log('WARNING', `Connection closed. Reconnecting: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    setTimeout(() => this.connect(), 5000);
                }
            } else if (connection === 'open') {
                this.isConnected = true;
                logger.log('SUCCESS', '🔗 Connected to WhatsApp');
                
                // Send connected message to owner
                if (config.OWNER_NUMBER) {
                    this.sendMessage(config.OWNER_NUMBER, {
                        text: `✅ *${config.BOT_NAME} Connected!*\n\n• Time: ${new Date().toLocaleString()}\n• Platform: ${process.platform}\n• Node: ${process.version}\n• Plugins: ${this.pluginManager.getCommandList().length}`
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
                    
                    // Try to execute via plugin manager first
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
                    
                    // If no plugin handled it, check built-in commands
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
                        } else if (config.AUTO_REPLY && isGroup) {
                            // Optional: Auto reply for unknown commands
                            await this.sock.sendMessage(jid, {
                                text: `❓ Unknown command. Type ${config.PREFIX}help for available commands.`
                            }, { quoted: message });
                        }
                    }
                }

                // Reset typing
                if (config.AUTO_TYPING) {
                    setTimeout(async () => {
                        await this.sock.sendPresenceUpdate('paused', jid);
                    }, 1000);
                }

            } catch (error) {
                logger.log('ERROR', `Message handling error: ${error.message}`);
            }
        }
    }

    async handlePollUpdate(update) {
        try {
            const pollCreation = await this.store.getMessage(update.key);
            if (pollCreation) {
                logger.log('INFO', 'Poll update received');
                // Handle poll updates here
            }
        } catch (error) {
            logger.log('ERROR', `Poll update error: ${error.message}`);
        }
    }

    async handleGroupParticipantsUpdate(event) {
        const { id, participants, action } = event;
        
        // Get bot's JID
        if (this.sock.user && this.sock.user.id) {
            const botNumber = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
            
            if (action === 'add' && participants.includes(botNumber)) {
                await this.sendMessage(id, {
                    text: `🤖 *${config.BOT_NAME} Activated!*\n\nType ${config.PREFIX}menu to see commands!\n\n📌 *Features:*\n• Advanced Commands\n• Media Processing\n• Group Management\n• Plugin System\n\n🔧 *Version:* ${config.VERSION}`
                });
            }
        }
    }

    // Command Handlers
    async helpCommand(context) {
        const { jid, sock, message } = context;
        
        const commands = this.pluginManager.getCommandList();
        const groupedCommands = {};
        
        // Group commands by tags
        for (const cmd of commands) {
            for (const tag of cmd.tags || []) {
                if (!groupedCommands[tag]) groupedCommands[tag] = [];
                groupedCommands[tag].push(cmd);
            }
        }
        
        let helpText = `*${config.BOT_NAME} Help Menu*\n\n`;
        helpText += `*Prefix:* ${config.PREFIX}\n`;
        helpText += `*Plugins Loaded:* ${commands.length}\n\n`;
        
        // Add built-in commands
        helpText += `*Core Commands:*\n`;
        for (const [cmd, fn] of Object.entries(this.commands)) {
            helpText += `• ${config.PREFIX}${cmd}\n`;
        }
        
        // Add plugin commands by category
        for (const [tag, cmds] of Object.entries(groupedCommands)) {
            if (cmds.length > 0) {
                helpText += `\n*${tag.toUpperCase()} Commands:*\n`;
                cmds.forEach(cmd => {
                    const adminOnly = cmd.admin ? '👑 ' : '';
                    const groupOnly = cmd.group ? '👥 ' : '';
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
                        `│ ᴀɴ ᴀᴅᴠᴀɴᴄᴇᴅ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛ\n` +
                        `│\n` +
                        `├─「 *ᴜsᴇʀ* 」\n` +
                        `│ • ${config.PREFIX}ping\n` +
                        `│ • ${config.PREFIX}help\n` +
                        `│ • ${config.PREFIX}owner\n` +
                        `│\n` +
                        `├─「 *ᴘʟᴜɢɪɴs* 」\n` +
                        `│ • ${config.PREFIX}plugins\n` +
                        `│ • ${config.PREFIX}sticker\n` +
                        `│ • ${config.PREFIX}add\n` +
                        `│\n` +
                        `├─「 *ɢʀᴏᴜᴘ* 」\n` +
                        `│ • ${config.PREFIX}add <number>\n` +
                        `│ • ${config.PREFIX}kick @user\n` +
                        `│ • ${config.PREFIX}promote @user\n` +
                        `│\n` +
                        `└─「 *sɪʟᴠᴀ ᴛᴇᴄʜ* 」\n\n` +
                        `📌 *ᴘʟᴜɢɪɴs:* ${this.pluginManager.getCommandList().length} loaded\n` +
                        `⚡ *ᴜᴘᴛɪᴍᴇ:* ${(process.uptime() / 3600).toFixed(2)}h\n` +
                        `🔧 *ᴍᴏᴅᴇ:* Production`;
        
        await sock.sendMessage(jid, { text: menuText }, { quoted: message });
    }

    async pingCommand(context) {
        const { jid, sock, message } = context;
        const start = Date.now();
        
        const pingMsg = await sock.sendMessage(jid, { text: '🏓 Pong!' }, { quoted: message });
        const latency = Date.now() - start;
        
        await sock.sendMessage(jid, { 
            text: `*Ping Statistics:*\n\n⚡ Latency: ${latency}ms\n📊 Uptime: ${(process.uptime() / 3600).toFixed(2)} hours\n💾 RAM: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB\n🌐 Connection: ${this.isConnected ? 'Connected ✅' : 'Disconnected ❌'}`
        }, { quoted: message });
    }

    async ownerCommand(context) {
        const { jid, sock, message } = context;
        
        if (config.OWNER_NUMBER) {
            await sock.sendMessage(jid, {
                text: `👑 *Bot Owner*\n\n📞 *Contact:* ${config.OWNER_NUMBER.split('@')[0]}\n🤖 *Bot:* ${config.BOT_NAME}\n⚡ *Version:* ${config.VERSION}\n📚 *GitHub:* ${config.GITHUB}\n\nFor issues or suggestions, contact the owner directly.`
            }, { quoted: message });
        } else {
            await sock.sendMessage(jid, {
                text: 'Owner number not configured. Please set OWNER_NUMBER in environment variables.'
            }, { quoted: message });
        }
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
                         `⏱️ *Uptime:* ${(stats.uptime / 3600).toFixed(2)} hours\n` +
                         `💾 *Memory:* ${(stats.memory.heapUsed / 1024 / 1024).toFixed(2)}MB\n` +
                         `📦 *Platform:* ${stats.platform}\n` +
                         `⚡ *Node.js:* ${stats.nodeVersion}\n` +
                         `🔌 *Plugins:* ${stats.plugins}\n` +
                         `🌐 *Connection:* ${this.isConnected ? 'Connected ✅' : 'Disconnected ❌'}\n` +
                         `🤖 *Bot:* ${config.BOT_NAME} v${config.VERSION}`;
        
        await sock.sendMessage(jid, { text: statsText }, { quoted: message });
    }

    async pluginsCommand(context) {
        const { jid, sock, message } = context;
        
        const plugins = this.pluginManager.getCommandList();
        
        let pluginsText = `📦 *Loaded Plugins*\n\n`;
        
        if (plugins.length === 0) {
            pluginsText += `No plugins loaded. Check the ${config.PLUGINS_DIR} folder.\n`;
        } else {
            pluginsText += `Total: ${plugins.length} plugin(s)\n\n`;
            
            for (const plugin of plugins) {
                const tags = plugin.tags?.join(', ') || 'general';
                pluginsText += `• *${plugin.command}* - ${plugin.help}\n  📍 Tags: ${tags}\n\n`;
            }
        }
        
        pluginsText += `\n📍 Add more plugins to ${config.PLUGINS_DIR}/ folder`;
        
        await sock.sendMessage(jid, { text: pluginsText }, { quoted: message });
    }

    async startCommand(context) {
        const { jid, sock, message } = context;
        
        const startText = `✨ *Welcome to ${config.BOT_NAME}!*\n\n` +
                         `I'm an advanced WhatsApp bot with plugin support.\n\n` +
                         `*Quick Start:*\n` +
                         `1. Type ${config.PREFIX}help for commands\n` +
                         `2. Type ${config.PREFIX}menu for main menu\n` +
                         `3. Add plugins to ${config.PLUGINS_DIR}/ folder\n\n` +
                         `*Features:*\n` +
                         `• Media processing (sticker, image)\n` +
                         `• Group management tools\n` +
                         `• Download utilities\n` +
                         `• AI-powered responses\n` +
                         `• Plugin system\n\n` +
                         `🔧 *Silva Tech Nexus*`;
        
        await sock.sendMessage(jid, { text: startText }, { quoted: message });
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
            logger.log('ERROR', `Send message error: ${error.message}`);
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
            logger.log('ERROR', `Download media error: ${error.message}`);
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
    logger,
    functions: new Functions()
};

// Auto-start if this is the main module
if (require.main === module) {
    bot.init();
}
