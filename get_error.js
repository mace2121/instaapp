const fs = require('fs');

const logOutput = fs.readFileSync('/home/mahsum/.pm2/logs/instaapp-error.log', 'utf8');
const lines = logOutput.split('\n');

for (let i = Math.max(0, lines.length - 100); i < lines.length; i++) {
    if (lines[i].includes('Meta API Step 1 Error')) {
        console.log("FOUND ERROR:", lines[i]);
    }
}
