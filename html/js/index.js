
function send() {
	window.event.preventDefault();
	output.textContent = '';
	var outputType = this.vmoutputtype.value;
	var outputWidth = parseInt(this.vmoutputwidth.value);
	var outputHeight = parseInt(this.vmoutputheight.value);
	Cluster.run({
		name: this.vmname.value,
		nodes: this.vmnodes.value,
		source: window.vmsrcEditor.getValue(),
		params: this.vmparams.value.replace(/\s+/, '').split(","),
		outputLength: parseInt(this.vmoutputsize.value),
		async onResponse(res) {
			const output = document.createElement('span');
			document.getElementById('output').append(output);
			const arrayBuffer = await Cluster.responseToArrayBuffer(res, (header) => {
				output.textContent = JSON.stringify(header);
			});
			processResponse(arrayBuffer, output, outputType, outputWidth, outputHeight);
		}
	});
}


function processResponse(arrayBuffer, output, outputType, outputWidth, outputHeight) {
	const resultHeader = arrayBuffer.header;
	if (resultHeader.type === 'image/ppm' || outputType === 'ppm') {
		output.append(ppmToCanvas(new Uint8Array(arrayBuffer)));
	} else {
		var resultArray = null;
		var outputFunc = (txt) => document.createTextNode(txt);

		if (outputType === 'uint8gray' || outputType === 'uint8rgba') {
			resultArray = new Uint8Array(arrayBuffer);
			outputFunc = outputType === 'uint8gray' ? rawGrayUint8ToCanvas : rawRGBAUint8ToCanvas;

		} else if (outputType === 'float32gray' || outputType === 'float32rgba') {
			resultArray = new Float32Array(arrayBuffer);
			outputFunc = outputType === 'float32gray' ? rawGrayFloat32ToCanvas : rawRGBAFloat32ToCanvas;

		} else {
			resultArray = String.fromCharCode.apply(null, new Uint8Array(arrayBuffer));

		}

		output.append(outputFunc(resultArray, outputWidth, outputHeight));
	}
}

window.vmsrcEditor = null;
require.config({ paths: { 'vs': 'monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], function () {
	window.vmsrcEditor = monaco.editor.create(document.getElementById('container'), {
		value: [
		].join('\\n'),
		language: 'c'
	});
});

window.onresize = function () {
	window.vmsrcEditor.layout();
};

fetch('/nodes').then(res => res.json()).then(obj => {
	document.getElementById('vmnodes').value = JSON.stringify(obj);
});