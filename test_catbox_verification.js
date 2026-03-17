const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');

async function testCatbox() {
    console.log("Starting Catbox verification test...");
    const testFile = 'catbox_test_image.txt';
    fs.writeFileSync(testFile, 'This is a test image content for Catbox ' + Date.now());
    
    try {
        const { stdout } = await exec(`curl -s -F "reqtype=fileupload" -F "fileToUpload=@${testFile}" https://catbox.moe/user/api.php`);
        console.log("Catbox response:", stdout);
        if (stdout.startsWith('https://files.catbox.moe/')) {
            console.log("SUCCESS: Catbox returned a valid files.catbox.moe URL.");
        } else {
            console.error("FAILURE: Catbox returned an unexpected response format.");
        }
    } catch (e) {
        console.error("ERROR: Catbox upload failed:", e);
    } finally {
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
}

testCatbox();
