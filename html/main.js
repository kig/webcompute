var ppmToCanvas = function(u8) {
    var header = u8.slice(0, u8.indexOf(10));
    var dimensions = u8.slice(header.length+1, u8.indexOf(10, header.length+1));
    var maxValue = u8.slice(header.length+dimensions.length+2, u8.indexOf(10, header.length+dimensions.length+2));
    var hstr = String.fromCharCode.apply(null, header);
    var dstr = String.fromCharCode.apply(null, dimensions);
    var mstr = String.fromCharCode.apply(null, maxValue);
    var [width, height] = dstr.split(/\\s+/).map((x) => parseInt(x));
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    var id = ctx.getImageData(0,0,width,height);
    var idx = header.length + dimensions.length + maxValue.length + 3;
    for (var i = idx, j = 0; i < u8.length; i++, j++) {
        if (j % 4 === 3) { id.data[j++] = 255; }
       	id.data[j] = u8[i];
    }
    ctx.putImageData(id, 0, 0);
    return canvas;
}

var rawToCanvas = function(u32, width,height) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    var id = ctx.getImageData(0,0,width,height);
    for (var i = 0, j = 0; i < u32.length; i++, j+=4) {
       	id.data[j] = id.data[j+1] = id.data[j+2] = u32[i]/2; id.data[j+3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return canvas;
}; 


function send() {
    window.event.preventDefault();
    output.textContent = '';
    var green = '';
    var params = {
	input: this.vmparams.value.replace(/\s+/,'').split(",").map(x => parseFloat(x)),
	outputLength: parseInt(this.vmoutputsize.value)
    };
    var body = JSON.stringify(window.vmsrcEditor.getValue()) + '\n' + JSON.stringify(params);
    fetch('/new' + green + '/' + this.vmname.value, {
	method: 'POST',
	body: body
    })
	.then(response => {
	    const reader = response.body.getReader();
	    const stream = new ReadableStream({
		start(controller) {
		    var decoder = new TextDecoder('utf-8');
		    var typeDecoder = new TextDecoder('utf-8');
		    var gotHeader = false;
		    var gotType = false;
		    var resultBuffer = [];
		    var resultHeader = {};
		    var typeString = '';
		    function push() {
			reader.read().then(({ done, value }) => {
			    if (done) {
				controller.close();
				window.resultBlob = new Blob(resultBuffer, {type: resultHeader.type});
				if (resultHeader.type === 'image/ppm') {
				    var fileReader = new FileReader();
				    fileReader.onload = function(event) {
					output.append(ppmToCanvas(new Uint8Array(event.target.result)));
				    };
				    fileReader.readAsArrayBuffer(window.resultBlob);
				} else {
				    var fileReader = new FileReader();
				    fileReader.onload = function(event) {
					var i32 = new Int32Array(event.target.result);
					output.append(rawToCanvas(i32, params.input[4], params.input[5]));
				    };
				    fileReader.readAsArrayBuffer(window.resultBlob);
				}
				return;
			    }
			    if (!gotHeader) {
				var endOfHeader = value.indexOf(10);
				var headerSlice = value.slice(0, endOfHeader);
				output.textContent += decoder.decode(headerSlice, {stream: true});
				if (endOfHeader > -1) {
				    resultHeader = window.resultHeader = JSON.parse(output.textContent);
				    gotHeader = true;
				    value = value.slice(endOfHeader+1);
				}
			    }
			    if (!gotType) {
				var endOfType = value.indexOf(10);
				var typeSlice = value.slice(0, endOfType);
				typeString += typeDecoder.decode(typeSlice, {stream: true});
				if (endOfType > -1) {
				    resultHeader.type = typeString;
				    output.textContent = JSON.stringify(resultHeader);
				    gotType = true;
				    resultBuffer.push(value.slice(endOfType+1));
				}
			    } else {
				resultBuffer.push(value);
			    }
			    push();
			});
		    };

		    push();
		}
	    });

	    return new Response(stream, { headers: { "Content-Type": "text/html" } });
	});
}


window.vmsrcEditor = null;
require.config({ paths: { 'vs': 'monaco-editor/min/vs' }});
require(['vs/editor/editor.main'], function() {
    window.vmsrcEditor = monaco.editor.create(document.getElementById('container'), {
        value: [
        ].join('\\n'),
        language: 'c'
    });
});

window.onresize = function() {
    window.vmsrcEditor.layout();
};
