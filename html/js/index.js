
function send() {
	window.event.preventDefault();
	output.textContent = '';
	var outputType = this.vmoutputtype.value;
	var outputWidth = parseInt(this.vmoutputwidth.value);
	var outputHeight = parseInt(this.vmoutputheight.value);
	var outputAnimated = this.vmoutputanimated.checked;
	var outputTilesX = parseInt(this.vmoutputtilesx.value || 1);
	var outputTilesY = parseInt(this.vmoutputtilesy.value || 1);
	var workgroups = this.vmworkgroups.value.replace(/\s+/g,'').split(",").map(s => parseInt(s)).slice(0,3);
	while (workgroups.size < 3) workgroups.push(1);
	if (outputAnimated) {
		const canvas = document.createElement('canvas');
		canvas.width = outputWidth * outputTilesX;
		canvas.height = outputHeight * outputTilesY;
		document.getElementById('output').append(canvas);
	}
	Cluster.run({
		name: this.vmname.value,
		nodes: this.vmnodes.value,
		language: this.vmlanguage.value,
		workgroups: workgroups,
		source: window.vmsrcEditor.getValue(),
		params: this.vmparams.value.replace(/\s+/, '').split(","),
		outputLength: parseInt(this.vmoutputsize.value),
		onResponse: function (res, input, runJob, jobIdx) {
			return new Promise(async (resolve, reject) => {
				var tileCount = (outputTilesX * outputTilesY);
				var frame = Math.floor(jobIdx / tileCount);
				var tileIdx = jobIdx - (frame * tileCount);
				var y = Math.floor(tileIdx / outputTilesX);
				var x = tileIdx - (y * outputTilesX);
				var output = null;
				if (!outputAnimated) {
					output = document.createElement('span');
					document.getElementById('output').append(output);
				}
				const arrayBuffer = await Cluster.responseToArrayBuffer(
					res,
					(header) => {
						if (!outputAnimated) {
							output.textContent = JSON.stringify(header);
						}
					},
					(d) => {
						if (d.byteLength > 0) {
							resolve();
						}
					}
				);
				if (arrayBuffer.header.type === 'error') {
					if (!outputAnimated) {
						output.remove();
					}
					runJob(input);
				} else {
					processResponse(arrayBuffer, output, outputType, outputWidth, outputHeight, outputAnimated, x, y, frame, outputTilesX, outputTilesY);
				}
			});
		}
	});
}


function processResponse(arrayBuffer, output, outputType, outputWidth, outputHeight, outputAnimated, x, y, frame, outputTilesX, outputTilesY) {
	const resultHeader = arrayBuffer.header;
	var targetCanvas = outputAnimated && document.querySelector('#output canvas');
	if (resultHeader.type === 'image/ppm' || outputType === 'ppm') {
		targetCanvas = ppmToCanvas(new Uint8Array(arrayBuffer), targetCanvas);
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

		if (outputTilesX > 1 || outputTilesY > 1) {
			if (!window.tileCanvas) {
				window.tileCanvas = document.createElement('canvas');
				window.tileCanvas.width = outputWidth;
				window.tileCanvas.height = outputHeight;
			}
			outputFunc(resultArray, outputWidth, outputHeight, tileCanvas);
			var ctx = targetCanvas.getContext('2d');
			ctx.globalCompositeOperator = 'copy';
			ctx.drawImage(tileCanvas, x * tileCanvas.width, y * tileCanvas.height);

		} else {
			targetCanvas = outputFunc(resultArray, outputWidth, outputHeight, targetCanvas);
		}
	}
	if (!outputAnimated) {
		output.append(targetCanvas);
	}
}

window.vmsrcEditor = null;
require.config({ paths: { 'vs': 'monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], function () {
	fetch('examples/ao.comp.glsl').then(res => res.text()).then(text => {
		var config = {
			OutputSize: [4],
			Workgroups: [1,1,1],
			Inputs: [640, 480, 4, 0],
			OutputType: ['uint8gray', '640', '480'],
			Animated: ['false'],
			Tiles: []
		};
		text.split("\n").forEach(line => {
			var m = line.match(/^\/\/\s*(OutputSize|Workgroups|Inputs|OutputType|Animated|Tiles)\s+(.*)/);
			if (m) {
				var key = m[1];
				var value = m[2].replace(/^\s+|\s+$/g, '').split(/,| +/).map(s => s.replace(/\s+/g, ''));
				config[key] = value;
			}
		});
		vmoutputsize.value = config.OutputSize[0];
		vmworkgroups.value = config.Workgroups.join(", ");
		vmparams.value = config.Inputs.join(", ");
		vmoutputtype.value = config.OutputType[0] || 'text';
		vmoutputwidth.value = config.OutputType[1] || '';
		vmoutputheight.value = config.OutputType[2] || '';
		vmoutputanimated.checked = config.Animated[0] === 'true';
		vmoutputtilesx.value = config.Tiles[0] || '';
		vmoutputtilesy.value = config.Tiles[1] || '';
		window.vmsrcEditor = monaco.editor.create(document.getElementById('container'), {
			value: text,
			language: 'c'
		});
	});
});

window.onresize = function () {
	window.vmsrcEditor.layout();
};

var addNodes = function (nodeList) {
	var nodes = JSON.parse(document.getElementById('vmnodes').value || '[]');
	var hosts = {}
	nodes.map(n => hosts[n.url] = true);
	newNodes = nodeList.filter(n => !hosts[n.url]);
	if (newNodes.length > 0) {
		nodes = nodes.concat(newNodes);
		document.getElementById('vmnodes').value = JSON.stringify(nodes);
		updateVMNodes();
	}
}

var addNode = function () {
	if (window.event) {
		window.event.preventDefault();
	}

	var host = window.addnode.value;
	var url = 'http://' + host + ':7172';
	fetch(url + '/nodes').then(res => res.json()).then(addNodes);
};

var updateVMNodes = function () {
	var nodes = JSON.parse(document.getElementById('vmnodes').value);
	var nodeList = document.getElementById('vmnodelist');
	nodeList.innerHTML = '';
	nodes.forEach(n => {
		var el = document.createElement('span');
		el.textContent = n.url.split(/:(\/\/)?/)[2];
		nodeList.append(el);
	});
};

fetch('/nodes').then(res => res.json()).then(addNodes);
