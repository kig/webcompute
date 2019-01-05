const WebSocket = require('ws');

const wss = new WebSocket.Server({
    port: 8080,
    perMessageDeflate: false
});

const mmap = require('mmap.js');
const fs = require('fs');

const msgSize = 1e5;
const size = 16 * msgSize;
const fd = fs.openSync("/tmp/testmmap", 'r+');
const buf = mmap.alloc(4096 + size, mmap.PROT_READ | mmap.PROT_WRITE, mmap.MAP_SHARED, fd, 0);

const slices = [];
for (var i=0 ; i < 16; i++) {
    slices.push(new Uint8Array(buf.buffer, 4096 + i * msgSize, msgSize));
}

const dataSlice = buf.slice(4096);

// Reads memory from mmap_send.c
// and sends it over the WebSocket

wss.on('connection', (ws) => {
    var msgCount = 0, msgSize = 0;

    for (var j = 0; j < 1e4; j++) {
        for (var i = 0; i < 16; i++) {
            while (buf[i] === 1) {
            }
            ws.send(slices[i]);
            msgCount++;
            msgSize += slices[i].byteLength;
            buf[i] = 1;
        }
    }

    ws.on('message', () => {
        console.log("Sent %d messages, totaling %d bytes", msgCount, msgSize);

        fs.ftruncateSync(fd, 0);
        fs.closeSync(fd);
        ws.close();
        wss.close();
    });


});
