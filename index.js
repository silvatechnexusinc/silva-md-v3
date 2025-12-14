require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Ensure required directories exist
const dirs = ['sessions', 'plugins', 'silvaxlab', 'assets', 'lib'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Import the main bot
require('./silva.js');
