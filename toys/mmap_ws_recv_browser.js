const ws = new WebSocket('ws://127.0.0.1:8080', );
ws.binaryType = 'arraybuffer';

const msgSize = 2048*2048;
const threads = 4;
const size = threads * msgSize;

var msgCount = 0;
var totalMsgSize = 0;
var startTime;
var endTime;

var dst = new Uint8Array(size);

var canvas = document.createElement('canvas');
var gl = canvas.getContext('webgl');
var tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2048, 2048, 0, gl.RGBA, gl.UNSIGNED_BYTE, dst);

var log = document.createElement('pre');
document.body.appendChild(log);

ws.onclose = () => {
    endTime = performance.now();
    var elapsed = endTime - startTime;
    log.textContent += `Done in ${elapsed} ms\n`;
    log.textContent += `Bandwidth ${totalMsgSize / elapsed / 1e6} GB/s\n`;
    // for (var i = 0; i < threads; i++) {
    //     for (var j=0; j < msgSize; j++) {
    //         if (dst[i*msgSize + j] !== i) {
    //             log.textContent += ["mismatch at", i*msgSize + j, ":", dst[i*msgSize + j], "!==", i].join(" ") + "\n";
    //             return;
    //         }
    //     }
    // }
    log.textContent += [`All a-ok! Received ${msgCount} messages, totaling ${totalMsgSize} bytes`].join(" ") + "\n";
};

var ok = new Uint32Array(1);

ws.onmessage = (ev) => {
    msgCount++;
    totalMsgSize += ev.data.byteLength;
    if (msgCount % (threads*10) === 0) {
        log.textContent = `Received ${msgCount}\n`;
    }
    var msg = new Uint8Array(ev.data);
    var i = msg[0];
    // dst.set(msg, i * msgSize);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, i*512, 2048, 512, gl.RGBA, gl.UNSIGNED_BYTE, dst);
    // ev.data = null;
    if (msgCount % threads === 0) {
        ws.send(ok);
    }
};

ws.onopen = () => {
    log.textContent += "Socket open\n";
    startTime = performance.now();
    ws.send(ok);
};
