const mmap = require('mmap.js');
const fs = require('fs');

const size = 16 * 2e5;
const fd = fs.openSync("/tmp/testmmap", 'r+');
const buf = mmap.alloc(4096 + size, mmap.PROT_READ | mmap.PROT_WRITE, mmap.MAP_SHARED, fd, 0);

const slices = [];
for (var i=0 ; i < 16; i++) {
    slices.push(new Uint8Array(buf.buffer, 4096 + i * 2e5, 2e5));
}

const dst = Buffer.alloc(size);

for (var j = 0; j < 1e4; j++) {
    for (var i = 0; i < 16; i++) {
        while (buf[i] === 1) {
        }
        dst.set(slices[i], i * 2e5);
        buf[i] = 1;
    }
}

fs.ftruncateSync(fd, 0);
fs.closeSync(fd);

for (var i = 0; i < 16; i++) {
    for (var j=0; j < 2e5; j++) {
        if (dst[i*2e5 + j] !== i) {
            console.log("mismatch at", i*2e5 + j, ":", dst[i*2e5 + j], "!==", i);
            process.exit();
        }
    }
}
console.log("All a-ok!");
