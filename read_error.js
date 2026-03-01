const fs = require('fs');
const path = '/home/mahsum/.pm2/logs/instaapp-error.log';
const fileContent = fs.readFileSync(path, 'utf8');
const lines = fileContent.split('\n');
const errorLines = lines.filter(l => l.includes('Meta API Step 1 Error:'));
if (errorLines.length > 0) {
    console.log(errorLines[errorLines.length - 1]);
} else {
    console.log("No error found");
}
