const { makeInMemoryStore } = require('@whiskeysockets/baileys');

class SilvaStore {
    constructor() {
        this.store = makeInMemoryStore({
            logger: require('pino')({ level: 'silent' })
        });
        this.messages = new Map();
    }

    bind(ev) {
        this.store.bind(ev);
        
        ev.on('messages.upsert', ({ messages }) => {
            for (const msg of messages) {
                this.messages.set(msg.key.id, msg);
            }
        });
    }

    async getMessage(key) {
        return this.messages.get(key.id) || this.store.getMessage(key);
    }

    async loadFromFile(file) {
        this.store.readFromFile(file);
    }

    async saveToFile(file) {
        this.store.writeToFile(file);
    }

    getChats() {
        return this.store.chats;
    }

    getContacts() {
        return this.store.contacts;
    }
}

module.exports = SilvaStore;
