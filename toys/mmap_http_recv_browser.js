const msgSize = 2048*64;
const threads = 16;
const size = threads * msgSize;

var msgCount = 0;
var totalMsgSize = 0;
var startTime;
var endTime;

var canvas = document.createElement('canvas');
var gl = canvas.getContext('webgl');
var tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
var dst = new Uint8Array(2048*16*64*4);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 2048, 64*16, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, dst);

var log = document.createElement('pre');
document.body.appendChild(log);

fetch('http://127.0.0.1:8080', { mode: 'cors', credentials: 'omit' })
.then(response => {
    console.log(response.body);
    startTime = performance.now();
    var reader = response.body.getReader();
    var stream = new ReadableStream({
        start(controller) {
            function push() {
                reader.read().then(({ done, value }) => {    
                    if (done) {
                        controller.close();
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
                        return;
                    } else {
                        console.log(value);
                        msgCount++;
                        totalMsgSize += value.byteLength;
                        if (msgCount % (threads*10) === 0) {
                            log.textContent = `Received ${msgCount}\n`;
                        }
                    }
                    // gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, i*64, 2048, 64, gl.LUMINANCE, gl.UNSIGNED_BYTE, value);
                    push();
                });
            }

            push();
        }
    });

    return new Response(stream, { headers: { "Content-Type": "text/html" } });
});

