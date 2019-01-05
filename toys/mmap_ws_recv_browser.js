const ws = new WebSocket('ws://localhost:8080', );
ws.binaryType = 'arraybuffer';

const msgSize = 120000;
const size = 16 * msgSize;

const dst = new Uint8Array(size);
var msgCount = 0;
var totalMsgSize = 0;
var startTime;
var endTime;

var log = document.createElement('pre');
document.body.appendChild(log);

ws.onclose = () => {
    endTime = performance.now();
    var elapsed = endTime - startTime;
    log.textContent += `Done in ${elapsed} ms\n`;
    log.textContent += `Bandwidth ${totalMsgSize / elapsed / 1e6} GB/s\n`;
    for (var i = 0; i < 16; i++) {
        for (var j=0; j < msgSize; j++) {
            if (dst[i*msgSize + j] !== i) {
                log.textContent += ["mismatch at", i*msgSize + j, ":", dst[i*msgSize + j], "!==", i].join(" ") + "\n";
                return;
            }
        }
    }
    log.textContent += [`All a-ok! Received ${msgCount} messages, totaling ${totalMsgSize} bytes`].join(" ") + "\n";
};

var ok = new Uint32Array(1);

ws.onmessage = (ev) => {
    msgCount++;
    totalMsgSize += ev.data.byteLength;
    if (msgCount % 1600 === 0) {
        log.textContent = `Received ${msgCount}\n`;
    }
    if (msgCount % 160000 === 0) {
        ws.send(ok);
    }
    var msg = new Uint8Array(ev.data);
    ev.data = null;
    var i = msg[0];
    dst.set(msg, i * msgSize, msgSize);
};

ws.onopen = () => {
    log.textContent += "Socket open\n";
    startTime = performance.now();
    // ws.send(ok);
};
