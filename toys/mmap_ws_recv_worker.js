const ws = new WebSocket('ws://127.0.0.1:8080', );
ws.binaryType = 'arraybuffer';

const msgSize = 2048*2048;
const threads = 4;
const size = threads * msgSize;

var msgCount = 0;
var totalMsgSize = 0;
var startTime;
var endTime;

var log = { textContent: '' };

ws.onclose = () => {
    endTime = performance.now();
    var elapsed = endTime - startTime;
    log.textContent += `Done in ${elapsed} ms\n`;
    log.textContent += `Bandwidth ${totalMsgSize / elapsed / 1e6} GB/s\n`;
    log.textContent += [`All a-ok! Received ${msgCount} messages, totaling ${totalMsgSize} bytes`].join(" ") + "\n";
    postMessage({message: log.textContent});
};

var ok = new Uint32Array(1);

ws.onmessage = (ev) => {
    msgCount++;
    totalMsgSize += ev.data.byteLength;
    var msg = new Uint8Array(ev.data);
    postMessage({message: `Received ${msgCount}\n`, buffer: msg}, [msg.buffer]);
    if (msgCount % threads === 0) {
        ws.send(ok);
    }
};

ws.onopen = () => {
    postMessage({message: "Socket open\n" });
    startTime = performance.now();
    ws.send(ok);
};
