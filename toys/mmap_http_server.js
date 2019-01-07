const http = require('http');

const mmap = require('mmap.js');
const fs = require('fs');

const msgSize = 2048*64;
const threads = 16;
const size = threads * msgSize;
const fd = fs.openSync("/tmp/testmmap", 'r+');
const buf = mmap.alloc(4096 + size, mmap.PROT_READ | mmap.PROT_WRITE, mmap.MAP_SHARED, fd, 0);

const slices = [];
for (var i=0 ; i < threads; i++) {
    slices.push(buf.slice(4096 + i * msgSize, 4096 + i * msgSize + msgSize));
}

const dataSlice = buf.slice(4096);

// Reads memory from mmap_send.c
// and sends it over the WebSocket

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS,POST,PUT",
        "Access-Control-Allow-Headers": "Origin, X-Requested-With, contentType, Content-Type, Accept, Authorization",
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-cache"
    });

    var msgCount = 0, msgSize = 0;

    for (var j = 0; j < 1e3; j++) {
        for (var i = 0; i < threads; i++) {
            while (buf[i] === 1) {
            }
            res.write(slices[i]);
            msgCount++;
            msgSize += slices[i].byteLength;
            buf[i] = 1;
        }
    }

    console.log("Sent %d messages, totaling %d bytes", msgCount, msgSize);

    // fs.ftruncateSync(fd, 0);
    // fs.closeSync(fd);
    res.end();
});

server.listen(8080);