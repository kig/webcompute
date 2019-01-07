const ws = new WebSocket('ws://127.0.0.1:8080', );
ws.binaryType = 'arraybuffer';

const msgSize = 2048*64;
const threads = 16;
const size = threads * msgSize;

var msgCount = 0;
var totalMsgSize = 0;
var startTime;
var endTime;

const log = { textContent: '' };

ws.onclose = () => {
    endTime = performance.now();
    const elapsed = endTime - startTime;
    const bw = totalMsgSize / (elapsed / 1e3);
    log.textContent += `Done in ${elapsed} ms\n`;
    log.textContent += `Bandwidth ${Math.round(bw / 1e6) / 1000} GB/s (${Math.floor(bw / (1920*1080*3))} fps @ 1080p, ${Math.floor(bw / (3840*2160*3))} fps @ 4k)\n`;
    log.textContent += [`All a-ok! Received ${msgCount} messages, totaling ${totalMsgSize} bytes`].join(" ") + "\n";
    postMessage({message: log.textContent});
};

var ok = new Uint32Array(1);

ws.onmessage = (ev) => {
    msgCount++;
    totalMsgSize += ev.data.byteLength;
    var msg = new Uint8Array(ev.data);
    if (msgCount % threads === 0) {
        postMessage({message: `Received ${msgCount}\n`, buffer: msg}, [msg.buffer]);
        ws.send(ok);
    }
};

ws.onopen = () => {
    postMessage({message: "Socket open\n" });
    startTime = performance.now();
    ws.send(ok);
};
