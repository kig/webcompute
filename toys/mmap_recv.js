const mmap = require('mmap.js');
const fs = require('fs');

const size = 16 * 2e5;
const fd = fs.openSync("/tmp/testmmap", 'r+');
const buf = mmap.alloc(4096 + size, mmap.PROT_READ | mmap.PROT_WRITE, mmap.MAP_SHARED, fd, 0);

const slices = [];
for (var i=0 ; i < 16; i++) {
    slices.push(buf.slice(4096 + i * 2e5));
}

const dst = Buffer.alloc(size);

for (var j = 0; j < 1e5; j++) {
    for (var i = 0; i < 16; i++) {
        while (buf[i] === 1) {
        }
        dst.set(slices[i], i * 2e5)
        buf[i] = 1;
    }
}

fs.ftruncateSync(fd, 0);
fs.closeSync(fd);
