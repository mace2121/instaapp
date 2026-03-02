const fs = require('fs');
const path = require('path');

const filePath = process.argv[2];
if (!filePath) process.exit(1);

const content = fs.readFileSync(filePath, 'utf8');
// Clean up any carriage returns if present, and write as UTF-8 (no BOM)
fs.writeFileSync(filePath, content.replace(/\r\n/g, '\n'), 'utf8');
console.log('Normalized encoding to UTF-8 (LF) for ' + filePath);
