const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');

async function test() {
    fs.writeFileSync('test.txt', 'hello from instaapp test');
    try {
        const { stdout } = await exec(`curl -s -F "reqtype=fileupload" -F "fileToUpload=@test.txt" https://catbox.moe/user/api.php`);
        console.log("Catbox response:", stdout);
    } catch (e) {
        console.error("Catbox error:", e);
    }
}
test();
