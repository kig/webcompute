var canvas = document.createElement('canvas');
var gl = canvas.getContext('webgl');
var tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
var dst = new Uint8Array(2048*2048*4);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2048, 2048, 0, gl.RGBA, gl.UNSIGNED_BYTE, dst);

var log = document.createElement('pre');
document.body.appendChild(log);

var worker = new Worker('mmap_ws_recv_worker.js');
worker.onmessage = (msg) => {
    if (msg.data.buffer) {
        var i = msg.data.buffer[0];
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, i*512, 2048, 512, gl.RGBA, gl.UNSIGNED_BYTE, msg.data.buffer);
    }
    if (msg.data.message) {
        log.textContent = msg.data.message;
    }
};

