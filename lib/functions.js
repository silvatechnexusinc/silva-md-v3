const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

class Functions {
    constructor(botLogger = console) {
        this.logger = botLogger;
        this.tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        this.botNumber = null;
        this.botLid = null;
    }

    // Generate random string
    randomString(length = 10) {
        return crypto.randomBytes(length).toString('hex').slice(0, length);
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

    // Format time
    formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    // Download file from URL
    async downloadFile(url, filename = null) {
        try {
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream'
            });

            if (!filename) {
                filename = path.basename(url.split('?')[0]) || `file_${Date.now()}`;
            }

            const filePath = path.join(this.tempDir, filename);
            const writer = fs.createWriteStream(filePath);

            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(filePath));
                writer.on('error', reject);
            });
        } catch (error) {
            throw new Error(`Download failed: ${error.message}`);
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

    // Check if user is owner (enhanced for LID support)
    isOwner(sender) {
        this.logger.log('DEBUG', `[OWNER CHECK] Checking if sender is owner: ${sender}`);
        
        // Handle LID format: 81712071631074@lid
        let phoneNumber = '';
        let isLid = false;
        
        if (sender.includes('@lid')) {
            phoneNumber = sender.split('@')[0];
            isLid = true;
            this.logger.log('DEBUG', `[OWNER CHECK] Sender is LID: ${phoneNumber}`);
        } else if (sender.includes('@s.whatsapp.net')) {
            phoneNumber = sender.split('@')[0];
            this.logger.log('DEBUG', `[OWNER CHECK] Sender is JID: ${phoneNumber}`);
        } else if (sender.includes(':')) {
            phoneNumber = sender.split(':')[0];
        } else {
            phoneNumber = sender;
        }
        
        const cleanSender = phoneNumber.replace(/[^0-9]/g, '');
        this.logger.log('DEBUG', `[OWNER CHECK] Cleaned sender: ${cleanSender}`);
        
        // Check if this is the bot's LID
        if (isLid && this.botLid) {
            const cleanBotLid = this.botLid.replace(/[^0-9]/g, '');
            if (cleanSender === cleanBotLid) {
                this.logger.log('DEBUG', '[OWNER CHECK] Sender is bot LID - GRANTING OWNER');
                return true;
            }
        }
        
        // Check if this is the bot's phone number
        if (this.botNumber) {
            const cleanBotNum = this.botNumber.replace(/[^0-9]/g, '');
            this.logger.log('DEBUG', `[OWNER CHECK] Bot number: ${cleanBotNum}`);
            if (cleanSender === cleanBotNum) {
                this.logger.log('DEBUG', '[OWNER CHECK] Sender is bot number - GRANTING OWNER');
                return true;
            }
        }
        
        // Check config owner numbers
        const config = require('../config.js');
        if (config.OWNER_NUMBER) {
            let ownerNumbers = [];
            
            if (Array.isArray(config.OWNER_NUMBER)) {
                ownerNumbers = config.OWNER_NUMBER.map(num => num.replace(/[^0-9]/g, ''));
            } else if (typeof config.OWNER_NUMBER === 'string') {
                ownerNumbers = [config.OWNER_NUMBER.replace(/[^0-9]/g, '')];
            }
            
            // Also check connected number from config
            if (config.CONNECTED_NUMBER) {
                ownerNumbers.push(config.CONNECTED_NUMBER.replace(/[^0-9]/g, ''));
            }
            
            const isOwner = ownerNumbers.some(ownerNum => 
                cleanSender === ownerNum || 
                cleanSender.endsWith(ownerNum) || 
                ownerNum.endsWith(cleanSender)
            );
            
            this.logger.log('DEBUG', `[OWNER CHECK] Final result for ${cleanSender}: ${isOwner}`);
            return isOwner;
        }
        
        return false;
    }

    setBotNumber(number) {
        if (number) {
            this.botNumber = number.replace(/[^0-9]/g, '');
            this.logger.log('INFO', `🤖 Bot connected as: ${this.botNumber}`);
        }
    }

    setBotLid(lid) {
        if (lid) {
            this.botLid = lid.split('@')[0];
            this.logger.log('INFO', `🔑 Bot LID detected: ${this.botLid}`);
        }
    }

    isAllowed(sender, jid, config) {
        if (this.isOwner(sender)) {
            this.logger.log('INFO', `✅ Owner access granted for: ${sender}`);
            return true;
        }
        
        if (config.BOT_MODE === 'public') return true;
        
        if (config.BOT_MODE === 'private') {
            if (jid.endsWith('@g.us')) return true;
            
            if (config.ALLOWED_USERS && Array.isArray(config.ALLOWED_USERS)) {
                const senderNumber = sender.split('@')[0].replace(/[^0-9]/g, '');
                const allowedNumbers = config.ALLOWED_USERS.map(num => num.replace(/[^0-9]/g, ''));
                return allowedNumbers.includes(senderNumber);
            }
            return false;
        }
        
        return true;
    }

    // Extract URL from text
    extractURL(text) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        return text.match(urlRegex) || [];
    }

    // Get file extension from buffer
    getFileExtension(buffer) {
        const signatures = {
            '89504E47': 'png',
            'FFD8FF': 'jpg',
            '47494638': 'gif',
            '52494646': 'webp',
            '57454250': 'webp',
            '66747970': 'mp4',
            '00000020': 'mp4',
            '4F676753': 'ogg',
            '494433': 'mp3',
            'FFFB': 'mp3'
        };

        const hex = buffer.toString('hex', 0, 8).toUpperCase();
        for (const [signature, ext] of Object.entries(signatures)) {
            if (hex.startsWith(signature)) {
                return ext;
            }
        }
        return 'bin';
    }

    // Clean temporary files
    cleanTemp() {
        try {
            const files = fs.readdirSync(this.tempDir);
            const now = Date.now();
            const maxAge = 30 * 60 * 1000; // 30 minutes

            files.forEach(file => {
                const filePath = path.join(this.tempDir, file);
                const stats = fs.statSync(filePath);
                
                if (now - stats.mtimeMs > maxAge) {
                    fs.unlinkSync(filePath);
                }
            });
        } catch (error) {
            // Ignore cleanup errors
        }
    }

    // Sleep function
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Validate WhatsApp number
    validateNumber(number) {
        const cleaned = number.replace(/[^0-9]/g, '');
        if (cleaned.length < 10) return null;
        
        // Add country code if missing
        if (!cleaned.startsWith('1') && !cleaned.startsWith('62')) {
            // Default to US (+1) if not specified
            return '1' + cleaned.slice(-10) + '@s.whatsapp.net';
        }
        
        return cleaned + '@s.whatsapp.net';
    }

    // Format JID
    formatJid(number) {
        if (!number) return null;
        const cleaned = number.replace(/[^0-9]/g, '');
        if (cleaned.length < 10) return null;
        return cleaned + '@s.whatsapp.net';
    }

    // Parse command arguments
    parseArgs(text) {
        const args = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            
            if (char === '"' || char === "'") {
                inQuotes = !inQuotes;
            } else if (char === ' ' && !inQuotes) {
                if (current) {
                    args.push(current);
                    current = '';
                }
            } else {
                current += char;
            }
        }
        
        if (current) {
            args.push(current);
        }
        
        return args;
    }

    // Generate progress bar
    progressBar(percentage, length = 20) {
        const filled = Math.round((percentage / 100) * length);
        const empty = length - filled;
        return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percentage.toFixed(1)}%`;
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

module.exports = Functions;
