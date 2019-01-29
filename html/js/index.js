/*
	How _should_ this work?

	Interactive rendering:
		- set a latency limit X ms
		- measure kernel overhead & avg pipelined throughput for each node
		- calculate a tile distribution that achieves minimum runtime
		- update current state
		- send out tile pipelines for current frame
		- receive the tiles and write them to the frame surface
		- loop back to state update

	Low-latency rendering with compression:
		- Use libjpeg-turbo to compress tiles on server
		- createObjectURL(blob) => img.src => ctx.drawImage

	Low-latency rendering without compression:
		- Render image on the server to render buffer
		- Swap render buffer and read buffer
		- Start rendering next image
		- Read image from render buffer in 100k chunks to mmapped shared buffer
		[x] - Send mmap buffer over WebSocket to client
		[x] - Client does gl.texSubImage2D(ev.data) to copy received buffer to the GPU
	
	Compute networks:
		- Set up the data flow of the network
			--- This might not be a super useful taxonomy.
				Is there a perf/understandability/maintenance benefit to these restrictions?
				I mean, you could implement all of these using Transform nodes.
			- Fan 1:N (e.g. rasterizer)
			- Map 1:1 (e.g. vertex shader, fragment shader)
			- Reduce N:1 (e.g. fragment blend)
			- Filter N:m, m <= N (e.g. early depth test)
			- Expand m:N, N >= m (e.g. geometry shader)
			- Transform N:M, might be smaller, might be larger (e.g. task shader)

		- Writing compute networks that aggregate memory bandwidth
			=> Keep data in fastest memory possible
				- Registers, L1$, L2$, GPU memory, L3$, ..., DRAM
			=> Split kernels into compute-heavy tiles -- Array fusion
				- Instead of 1024x1024 (x) 1024x1024 (x) 1024x1024 = 1024x1024
							 1024x1024.tile(32,32){ 32x32 (x) 32x32 (x) 32x32) }.combine() = 1024x1024

	Auto-splitting workgroups:
		- Split frame along workgroups, adjust workgroup ids at worker
		- E.g. 1920 x 1080 frame rendered using 192 x 108 workgroups
		=>  RTX 2070 runs 192 x 70 wgs
			GTX 1050:     192 x 14 wgs
			iGPU:         192 x 6 wgs
			iGPU2:        192 x 5 wgs
			Mali G76:     192 x 4 wgs
			Adreno 540:   192 x 4 wgs
			TR2950X:      192 x 2 wgs
			Xeon-16c:     192 x 2 wgs
			i7-3770:      64 x 1 wgs
			i7-3770k:     64 x 1 wgs
			i7-8259U:     64 x 1 wgs
*/


function send(event) {
	event.preventDefault();
	output.textContent = '';
	var outputType = this.vmoutputtype.value;
	var outputWidth = parseInt(this.vmoutputwidth.value);
	var outputHeight = parseInt(this.vmoutputheight.value);
	var outputAnimated = this.vmoutputanimated.checked;
	var outputTilesX = parseInt(this.vmoutputtilesx.value || 1);
	var outputTilesY = parseInt(this.vmoutputtilesy.value || 1);
	var interactive = this.vminteractive.checked;
	var gpuOnly = this.vmgpuonly.checked;
	var workgroups = this.vmworkgroups.value.replace(/\s+/g, '').split(",").map(s => parseInt(s)).slice(0, 3);
	while (workgroups.size < 3) workgroups.push(1);
	if (outputAnimated) {
		var videoScreen = new VideoScreen(outputWidth * outputTilesX, outputHeight * outputTilesY, 4);
		document.getElementById('output').append(videoScreen.canvas);
	}
	var source = window.vmsrcEditor.getValue().split("\n")
		.filter(line => !(/^\/\/\s*(OutputSize|Workgroups|Inputs|OutputType|Animated|Tiles|GPUOnly|Interactive)\s+(.*)/).test(line))
		.join("\n");

	// var lastFrame = performance.now();
	var frameTileCounts = {};
	var currentFrame = 0;
	var waitForFrame = {};
	var frameResolvers = {};

	var startTime = performance.now();
	var bandwidthWindow = [];
	var bandwidthTimes = [startTime];
	var bandwidthWindowIndex = 0;
	var bandwidthWindowSize = 20;
	var totalBytes = 0;

	var byteOff = 0;
	var lastRow = 0;
	var rowOff = 0;

	// Interactive run
	// 	1. Create cluster, init sockets
	//	2. Listen for input events and edit scene state.
	//  3. Set frame time interval.
	//  4. Send out frame jobs to cluster (input array, scene state, frame time).
	//  5. On frame time interval, send out frame jobs again if have received frame before current.
	//		- E.g. sendFrame(3) ... frame timer hit: await receivedFrame(2); sendFrame(4); 
	//      - The aim is to get a frame pipeline without bubbles and with max UI responsiveness
	//		- Update at framerate not tied to vsync: e.g. 47 FPS instead of 30 FPS.
	//		- Two frames in pipeline: currently rendering and next frame
	//			- One frame of UI lag
	//			- No need to wait for current frame before starting on next frame
	//			- Suppose vsync is every 16.6ms, compute time is 15 ms, transfer time 16 ms, send overhead 1 ms
	//				grab scene state at 	t=0
	//				sent to compute 		t=1
	//				compute finishes at 	t=16
	//				receive frame at 		t=32
	//				frame displayed at 		t=33.3
	//				=> runs at 30 fps, UI lag 33.3 ms, 17.3 ms bubble
	//			- Pipelined frames:
	//				grab scene state N		t=-1
	//				compute N-1 finishes	t=0
	//				sent N to compute		t=0
	//				grab scene state N+1	t=14
	//				compute N finishes 		t=15 
	//				sent N+1 to compute		t=15
	//				receive frame N-1		t=16
	//				frame N-1 displayed		t=16.667
	//				grab scene state N+2	t=29
	//				compute N+1 finishes	t=30
	//				sent N+2 to compute		t=30
	//				receive frame N			t=31
	//				frame N displayed at 	t=33.3
	//				=> runs at 60 fps, UI lag 34.3 ms, 0 ms bubble

	/*
		Cluster improvements
			- separate job run and node init
			- on run, first bring up all nodes
				nodes.forEach(async n => { const p = await build(n); await createSocket(n, p)) })
			- jobs should be dispatched to nodes that are ready
				getNode(p) { availableNodes.find(n => n.isReady(p)) }
				isReady(p) { sockets[p] && sockets[p].header }
			- option to wait for all nodes ready before job dispatch
	*/
	/*
		In interactive mode, the cluster is passed single-frame inputs to run.
		To render a frame, the cluster calls the getInteractiveParams callback to get the frame params.
		The frame params are then dispatched to cluster nodes for computation.
		On receiving all the frame tiles for the previous frame, the cluster renders the next frame.
		
		async renderFrame() {
			this.currentFrame++;
			const interactiveParams = this.getInteractiveParams(this.currentFrame);
			await Promise.all(this.frameParams.map(tileParams => 
				this.runJob(tileParams.concat(interactiveParams), this.jobIdx++)
			));
			this.lastCompletedFrame++;
		}
		
		while (running) {
			if (lastCompletedFrame >= currentFrame - 1) {
				renderFrame();
			}
		}
	*/
	var mouse = {x: 0, y: 0};
	window.onmousemove = function(ev) {
		mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
		mouse.y = (ev.clientY / window.innerHeight) * 2 - 1;
	};
	var runStartTime = performance.now();
	var maxSpeed = 0;
	Cluster.run({
		name: this.vmname.value,
		nodes: this.vmnodes.value,
		language: this.vmlanguage.value,
		workgroups: workgroups,
		source: source,
		gpuOnly: gpuOnly,
		buffer: videoScreen.buffer.data,
		params: this.vmparams.value.replace(/\s+/, '').split(","),
		outputLength: parseInt(this.vmoutputsize.value),
		useHTTP: false,
		interactive: interactive,
		getInteractiveParams: function(frame) {
			return [mouse.x, mouse.y, (performance.now()-runStartTime)/1000.0, frame];
		},
		onResponse: this.vmlanguage.value === 'glsl'
			? [
				(header, input, runJob, jobIdx, next) => {
					var tileCount = (outputTilesX * outputTilesY);
					var frame = Math.floor(jobIdx / tileCount);
					if (frameTileCounts[frame] === undefined) {
						frameTileCounts[frame] = 0;
						waitForFrame[frame] = new Promise((resolve, reject) => {
							frameResolvers[frame] = resolve;
						});
					}
					byteOff = 0;
					rowOff = 0;
					lastRow = 0;
					//if (!outputAnimated) {
					//	output.textContent = JSON.stringify(header);
					//}
				}, (byteLength, input, runJob, jobIdx, next, node, header, u8) => {
					if (byteLength > 0) {
						next();
						var tileCount = (outputTilesX * outputTilesY);
						var frame = Math.floor(jobIdx / tileCount);
						var tileIdx = jobIdx - (frame * tileCount);
						var y = Math.floor(tileIdx / outputTilesX);
						var x = tileIdx - (y * outputTilesX);
						byteOff += byteLength;
						var rows = Math.floor((byteOff - rowOff)  / (outputWidth * 4));
						if (rows >= 1080 || rows + lastRow === outputHeight) {
							videoScreen.updateTexture(u8, x * outputWidth, y * outputHeight + lastRow, outputWidth, rows, rowOff);
							lastRow += rows;
							rowOff = lastRow * (outputWidth * 4);
						}
					}
				}, async (arrayBuffer, input, runJob, jobIdx, next, node, header, u8) => {
					// var t = performance.now();
					// var elapsed = t - lastFrame;
					// lastFrame = t;
					// console.log(elapsed);
					bandwidthWindow[bandwidthWindowIndex] = arrayBuffer.byteLength;
					bandwidthWindowIndex = (bandwidthWindowIndex + 1) % bandwidthWindowSize;
					bandwidthTimes[bandwidthWindowIndex] = performance.now();
					totalBytes = bandwidthWindow.reduce((s,i) => s+i, 0);
					startTime = bandwidthTimes.reduce((s,i) => Math.min(s,i));
					var currentSpeed = (totalBytes/1e9) / ((performance.now() - startTime)/1000);
					maxSpeed = Math.max(maxSpeed, currentSpeed);
					next();
					var tileCount = (outputTilesX * outputTilesY);
					var frame = Math.floor(jobIdx / tileCount);
					frameTileCounts[frame]++;
					if (frame !== currentFrame) {
						// var header = arrayBuffer.header;
						// arrayBuffer = arrayBuffer.slice(0);
						// arrayBuffer.header = header;
						// console.log('waiting for', frame, waitForFrame[frame], frameResolvers[frame]);
						await waitForFrame[frame];
					}
					var tileIdx = jobIdx - (frame * tileCount);
					var y = Math.floor(tileIdx / outputTilesX);
					var x = tileIdx - (y * outputTilesX);
					var output = null;
					if (!outputAnimated) {
						output = document.createElement('span');
						document.getElementById('output').append(output);
					}
					if (header.type === 'error') {
						if (!outputAnimated) {
							output.remove();
						}
						runJob(input, jobIdx);
					} else {
						processResponse(videoScreen, arrayBuffer, output, outputType, outputWidth, outputHeight, outputAnimated, x, y, frame, outputTilesX, outputTilesY);
					}

					if (frameTileCounts[frame] === tileCount) {
						delete waitForFrame[frame];
						delete frameTileCounts[frame];
						currentFrame = Math.max(currentFrame, frame + 1);
						videoScreen.update();
						videoScreen.ctx.fillStyle = 'black';
						videoScreen.ctx.fillText(maxSpeed, 10, 1060);
						videoScreen.ctx.fillText(currentSpeed, 10, 1040);
						videoScreen.ctx.fillStyle = 'white';
						videoScreen.ctx.fillText(maxSpeed, 10, 20);
						videoScreen.ctx.fillText(currentSpeed, 10, 40);
						// console.log('draw', frame);
						// console.log('resolving frame', frame);
						if (frameResolvers[currentFrame]) {
							frameResolvers[currentFrame]();
							delete frameResolvers[currentFrame];
						}
					}
				}
			]
			: function (res, input, runJob, jobIdx) {
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


async function processResponse(videoScreen, arrayBuffer, output, outputType, outputWidth, outputHeight, outputAnimated, x, y, frame, outputTilesX, outputTilesY) {
	// const resultHeader = arrayBuffer.header;
	// videoScreen.updateTexture(new Uint8Array(arrayBuffer), x * outputWidth, y * outputHeight, outputWidth, outputHeight);
	// console.log('updateTexture', frame);
	return;

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
			// console.log(x, y, outputWidth, outputHeight, tileCanvas.width, tileCanvas.height);
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
			OutputSize: [1228800],
			Workgroups: [1, 1, 1],
			Inputs: [640, 480, 4, 0],
			OutputType: ['float32gray', '640', '480'],
			Animated: ['false'],
			Tiles: []
		};
		text.split("\n").forEach(line => {
			var m = line.match(/^\/\/\s*(OutputSize|Workgroups|Inputs|OutputType|Animated|Tiles|GPUOnly|Interactive)\s+(.*)/);
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
		vmgpuonly.checked = config.GPUOnly[0] === 'true';
		vminteractive.checked = config.Interactive[0] === 'true';
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

var addNode = function (event) {
	if (event) {
		event.preventDefault();
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

output.onclick = (ev) => {
	if (ev.target.tagName === 'CANVAS') {
		ev.preventDefault();
		ev.target.requestFullscreen();
		if (ev.target.update) {
			window.requestAnimationFrame(() => {
				ev.target.update();
			});
		}
	}
};

window.vmform.onsubmit = send;
window.addnodebutton.onclick = addNode;
