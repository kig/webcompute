const mmap = require('mmap.js');
const fs = require('fs');

const threads = 4;
const msgSize = 2048*2048;
const size = threads * msgSize;
const fd = fs.openSync("/tmp/testmmap", 'r+');
const buf = mmap.alloc(4096 + size, mmap.PROT_READ | mmap.PROT_WRITE, mmap.MAP_SHARED, fd, 0);

const slices = [];
for (var i=0 ; i < threads; i++) {
    slices.push(new Uint8Array(buf.buffer, 4096 + i * msgSize, msgSize));
}

const dst = Buffer.alloc(size);

for (var j = 0; j < 1e2; j++) {
    for (var i = 0; i < threads; i++) {
        while (buf[i] === 1) {
        }
        dst.set(slices[i], i * msgSize);
        buf[i] = 1;
    }
}

fs.ftruncateSync(fd, 0);
fs.closeSync(fd);

for (var i = 0; i < threads; i++) {
    for (var j=0; j < msgSize; j++) {
        if (dst[i*msgSize + j] !== i) {
            console.log("mismatch at", i*msgSize + j, ":", dst[i*msgSize + j], "!==", i);
            process.exit();
        }
    }
}
console.log("All a-ok!");
