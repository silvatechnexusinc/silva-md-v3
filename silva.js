// ==================== CORE IMPORTS ====================
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
const Pino = require('pino');
require('dotenv').config();

// ==================== CONFIG ====================
const config = {
    BOT_NAME: process.env.BOT_NAME || 'Silva MD',
    VERSION: '3.0.0',
    PREFIX: process.env.PREFIX || '.',
    OWNER_NUMBER: process.env.OWNER_NUMBER,
    MODE: process.env.MODE || 'public', // public | private
    AUTO_READ: true,
    AUTO_TYPING: true,
    AUTO_RECORDING: true,
    AUTO_STATUS_VIEW: true,
    AUTO_STATUS_LIKE: true,
    SESSION_ID: process.env.SESSION_ID,
    NEWSLETTER_IDS: process.env.NEWSLETTER_IDS
        ? process.env.NEWSLETTER_IDS.split(',')
        : [
            '120363276154401733@newsletter',
            '120363200367779016@newsletter',
            '120363199904258143@newsletter',
            '120363422731708290@newsletter'
        ]
};

// ==================== LOGGER ====================
const logger = Pino({ level: 'silent' });
const log = (type, msg) => console.log(`[${type}] ${msg}`);

// ==================== GLOBAL CONTEXT ====================
const globalContextInfo = {
    forwardingScore: 999,
    isForwarded: true
};

// ==================== MESSAGE STORE ====================
const store = makeInMemoryStore({ logger });

// ==================== PLUGIN MANAGER ====================
class PluginManager {
    constructor() {
        this.handlers = new Map();
        this.pluginDir = path.join(__dirname, 'silvaxlab');
        if (!fs.existsSync(this.pluginDir)) {
            fs.mkdirSync(this.pluginDir, { recursive: true });
            log('INFO', 'Created plugin directory: silvaxlab');
        }
    }

    loadPlugins() {
        const files = fs.readdirSync(this.pluginDir).filter(f => f.endsWith('.js'));
        for (const file of files) {
            const pluginPath = path.join(this.pluginDir, file);
            delete require.cache[require.resolve(pluginPath)];
            const plugin = require(pluginPath);
            if (plugin.handler?.command) {
                this.handlers.set(plugin.handler.command, plugin.handler);
                log('SUCCESS', `Loaded plugin: ${file}`);
            }
        }
    }

    async execute(ctx) {
        for (const [regex, handler] of this.handlers) {
            if (regex.test(ctx.command)) {
                await handler.code(ctx);
                return true;
            }
        }
        return false;
    }
}

const pluginManager = new PluginManager();

// ==================== SESSION LOADER ====================
async function loadSession() {
    if (!config.SESSION_ID) return false;
    try {
        const [, b64] = config.SESSION_ID.split('~');
        const data = zlib.gunzipSync(Buffer.from(b64, 'base64'));
        fs.mkdirSync('./sessions', { recursive: true });
        fs.writeFileSync('./sessions/creds.json', data);
        log('SUCCESS', 'Session loaded');
        return true;
    } catch {
        log('ERROR', 'Session invalid');
        return false;
    }
}

// ==================== BOT ====================
async function startBot() {
    await loadSession();
    pluginManager.loadPlugins();

    const { state, saveCreds } = await useMultiFileAuthState('./sessions');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
        browser: Browsers.macOS(config.BOT_NAME),
        logger
    });

    store.bind(sock.ev);
    sock.ev.on('creds.update', saveCreds);

    // ==================== CONNECTION ====================
    sock.ev.on('connection.update', async ({ connection, qr }) => {
        if (qr) qrcode.generate(qr, { small: true });

        if (connection === 'open') {
            log('SUCCESS', 'Bot connected');

            for (const jid of config.NEWSLETTER_IDS) {
                if (sock.newsletterFollow) {
                    await sock.newsletterFollow(jid).catch(() => {});
                }
            }
        }
    });

    // ==================== MESSAGE HANDLER ====================
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const jid = msg.key.remoteJid;
            const sender = msg.key.participant || jid;
            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                '';

            // Auto presence
            if (config.AUTO_TYPING) await sock.sendPresenceUpdate('composing', jid);
            if (config.AUTO_RECORDING) await sock.sendPresenceUpdate('recording', jid);

            // MODE CHECK
            if (config.MODE === 'private') {
                const ownerJid = config.OWNER_NUMBER.replace(/\D/g, '') + '@s.whatsapp.net';
                if (sender !== ownerJid) return;
            }

            if (!text.startsWith(config.PREFIX)) return;

            const args = text.slice(1).trim().split(/\s+/);
            const command = args.shift().toLowerCase();

            await pluginManager.execute({
                sock,
                jid,
                sender,
                command,
                args,
                message: msg
            });

            await sock.sendPresenceUpdate('paused', jid);
        }
    });

    // ==================== ANTI DELETE ====================
    sock.ev.on('messages.update', async updates => {
        for (const u of updates) {
            if (u.update?.message === null) {
                const old = await store.loadMessage(u.key.remoteJid, u.key.id);
                if (old) {
                    await sock.sendMessage(u.key.remoteJid, {
                        text: `🛑 Deleted message recovered:\n\n${JSON.stringify(old.message, null, 2)}`
                    });
                }
            }
        }
    });
}

startBot();
