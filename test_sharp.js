const sharp = require('sharp');
const fs = require('fs');

async function run() {
    const svg = `
    <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="200" height="200" fill="#333" />
        <image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" width="100" height="100" x="50" y="50" />
    </svg>`;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    fs.writeFileSync('test.png', buffer);
    console.log("Done!");
}
run();
