const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:8080', {
    perMessageDeflate: false
});

const threads = 4;
const msgSize = 2048*2048;
const size = threads * msgSize;

const dst = Buffer.alloc(size);
var msgCount = 0;
var totalMsgSize = 0;

ws.on('close', () => {
    for (var i = 0; i < threads; i++) {
        for (var j=0; j < msgSize; j++) {
            if (dst[i*msgSize + j] !== i) {
                console.log("mismatch at", i*msgSize + j, ":", dst[i*msgSize + j], "!==", i);
                process.exit();
            }
        }
    }
    console.log("All a-ok! Received %s messages, totaling %d bytes", msgCount, totalMsgSize);
});

var ok = new Uint32Array(1);

ws.on('message', (msg) => {
    msgCount++;
    totalMsgSize += msg.byteLength;
    var i = msg[0];
    dst.set(msg, i * msgSize);
    if (msgCount % threads === 0) {
        ws.send(ok);
    }
});

ws.on('open', () => {
    ws.send(ok);
});
