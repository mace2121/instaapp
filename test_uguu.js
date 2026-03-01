const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');

async function test() {
    fs.writeFileSync('test.txt', 'hello from uguu test');
    try {
        const { stdout } = await exec(`curl -s -F "files[]=@test.txt" https://uguu.se/upload.php`);
        console.log("Response:", stdout);
    } catch (e) {
        console.error("Error:", e);
    }
}
test();
