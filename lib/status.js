class StatusHandler {
    constructor(bot, functions, config) {
        this.bot = bot;
        this.functions = functions;
        this.config = config;
        this.autoStatusView = config.AUTO_STATUS_VIEW || false;
        this.autoStatusLike = config.AUTO_STATUS_LIKE || false;
    }

    async handleStatusMessages(messages) {
        if (!messages || !Array.isArray(messages)) return;
        
        for (const message of messages) {
            try {
                if (message.key.remoteJid === 'status@broadcast') {
                    this.bot.logger.log('INFO', '📊 Status update detected');
                    
                    if (this.autoStatusView) {
                        await this.autoViewStatus(message);
                    }
                    
                    if (this.autoStatusLike) {
                        await this.autoLikeStatus(message);
                    }
                }
            } catch (error) {
                // Silent fail
            }
        }
    }

    async autoViewStatus(message) {
        try {
            await this.bot.sock.readMessages([message.key]);
            this.bot.logger.log('SUCCESS', '✅ Status auto-viewed');
        } catch (error) {
            this.bot.logger.log('ERROR', 'Failed to auto-view status: ' + error.message);
        }
    }

    async autoLikeStatus(message) {
        try {
            await this.bot.sock.sendMessage(message.key.remoteJid, {
                react: {
                    text: '❤️',
                    key: message.key
                }
            });
            this.bot.logger.log('SUCCESS', '✅ Status auto-liked');
        } catch (error) {
            this.bot.logger.log('ERROR', 'Failed to auto-like status: ' + error.message);
        }
    }

    async statusviewCommand(context) {
        const { jid, sock, message, args, sender } = context;
        const isOwner = message.key.fromMe ? true : this.functions.isOwner(sender);
        
        if (!isOwner) {
            await sock.sendMessage(jid, { text: '⚠️ Owner only command' }, { quoted: message });
            return;
        }
        
        const action = args[0]?.toLowerCase();
        
        if (!action) {
            await sock.sendMessage(jid, {
                text: `📊 *Status Auto Settings*\n\n` +
                      `Auto View: ${this.autoStatusView ? '✅ Enabled' : '❌ Disabled'}\n` +
                      `Auto Like: ${this.autoStatusLike ? '✅ Enabled' : '❌ Disabled'}\n\n` +
                      `Commands:\n` +
                      `• ${this.config.PREFIX}statusview on - Enable both\n` +
                      `• ${this.config.PREFIX}statusview off - Disable both\n` +
                      `• ${this.config.PREFIX}statusview view - Toggle auto-view\n` +
                      `• ${this.config.PREFIX}statusview like - Toggle auto-like`
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
                    text: 'Invalid option. Use `' + this.config.PREFIX + 'statusview` for help.'
                }, { quoted: message });
        }
    }
}

module.exports = StatusHandler;
