class Cluster {

	constructor(nodes) {
		this.buildNodes = nodes.filter(n => n.info.canBuild);
		this.nodes = nodes;
		this.availableNodes = {};
		this.availableNodes.ISPC = nodes.slice();
		this.availableNodes.SPIRV = [];
		nodes.forEach(n => {
			(n.info.vulkanDevices || []).forEach((vd, idx) => {
				this.availableNodes.SPIRV.push({ ...n, vulkanDeviceIndex: idx });
			});
			this.availableNodes.SPIRV.push(n);
		});
		this.workQueue = { ISPC: [], SPIRV: [] };
	}

	processWorkQueue(nodeType = 'ISPC') {
		if (this.workQueue[nodeType].length > 0 && this.availableNodes[nodeType].length > 0) {
			var node = this.availableNodes[nodeType].shift();
			while (node && node.disabled) {
				node = this.availableNodes[nodeType].shift();
			}
			if (!node) {
				return;
			}
			var callback = this.workQueue[nodeType].shift();
			var fired = false;
			var doNext = () => {
				if (!fired) {
					fired = true;
					this.availableNodes[nodeType].push(node);
					this.processWorkQueue(nodeType);
				}
			};
			callback(node, doNext);
		}
	}

	getNode(callback, nodeType = 'ISPC') {
		this.workQueue[nodeType].push(callback);
		this.processWorkQueue(nodeType);
	}

	async build(node, name, source, language, vulkanDeviceIndex) {
		if (node.info.canBuild || (vulkanDeviceIndex != null && language === 'glsl')) {
			return { blob: new Blob([source]), isBinary: false };
		} else {
			const vmSuffix = '/build/' + name;
			const args = {
				platform: node.info.platform,
				language: language,
				vulkanDeviceIndex: vulkanDeviceIndex,
				arch: node.info.arch,
				target: node.info.target,
				addressing: 32
			};
			var key = await sha256(JSON.stringify({ ...args, source: source }));
			if (!Cluster.buildCache[key]) {
				Cluster.buildCache[key] = new Promise(async (resolve, reject) => {
					const buildNode = this.buildNodes.find(bn => {
						return (
							bn.info.platform === args.platform &&
							(bn.info.canCrossCompile || bn.info.arch === args.arch)
						);
					});
					if (!buildNode) {
						resolve(false);
					}
					const bin = JSON.stringify(source);
					const body = new Blob([JSON.stringify(args), '\n', bin]);
					const url = buildNode.url + vmSuffix;
					const res = await fetch(url, { method: 'POST', body });
					const blob = await Cluster.responseToBlob(res);
					resolve({ blob, isBinary: true });
				});
			}
			return Cluster.buildCache[key];
		}
	}

	disableNode(node) {
		node.disabled = true;
	}

	static run(options) {
		var {
			nodes,
			name,
			language,
			source,
			params,
			outputLength,
			onResponse,
			workgroups,
			useHTTP
		} = options;
		var green = '';
		var cluster = this.parse(nodes);
		var inputs = this.expandParams(params);
		var vmSuffix = '/new' + green + '/' + name;
		var runJob = (jobInput, jobIndex) => {
			cluster.getNode(async (node, next) => {
				const program = await cluster.build(node, name, source, language, node.vulkanDeviceIndex);
				if (!program) {
					cluster.disableNode(node);
					return runJob(jobInput);
				}
				const bin = program.blob;
				const url = node.url + vmSuffix;

				if (!useHTTP && language === 'glsl') {
					if (!node.socket) {
						// open a WebSocket to SPIRV process
						this.createNodeSocket(node, runJob, onResponse, url, next, name, jobInput, jobIndex, outputLength, language, workgroups, program);
					} else {
						node.socket.queue.push([onResponse, jobInput, runJob, jobIndex, next]);
						node.socket.send(new Float32Array(jobInput).buffer);
					}
				} else {
					let jobIdx = jobIndex;
					// do a normal HTTP request
					const args = { input: jobInput, outputLength, language, workgroups, vulkanDeviceIndex: node.vulkanDeviceIndex, binary: program.isBinary };
					const body = new Blob([JSON.stringify(args), '\n', bin]);
					var res;
					try {
						res = await fetch(url, { method: 'POST', body });
					} catch (e) {
						cluster.disableNode(node);
						runJob(jobInput);
					}
					return onResponse(res, jobInput, runJob, jobIdx);
				}
			}, language === 'glsl' ? 'SPIRV' : 'ISPC');
		};
		inputs.forEach(runJob);
		return cluster;
	}

	static createNodeSocket(node, runJob, onResponse, url, next, name, jobInput, jobIndex, outputLength, language, workgroups, program) {
		const bin = program.blob;
		const args = { 
			name, 
			inputLength: jobInput.length * 4, 
			outputLength, 
			language, 
			workgroups, 
			vulkanDeviceIndex: node.vulkanDeviceIndex, 
			binary: program.isBinary
		};
		if (!node.socket) {
			var gotHeader = false;
			var header;
			var receivedBytes = 0;
			var blocks = [];
			const workQueue = [];
			var jobIdx = jobIndex;
			var input = jobInput;
			var [onHeader, onData, onBody] = onResponse;
			const onSocketResponse = (ev) => {
				if (ev.data === 'READY.') {
					// Connection init
					// Send kernel
					var blob = new Blob([JSON.stringify(args), '\n', bin]);
					var fr = new FileReader();
					fr.onload = () => {
						node.socket.send(fr.result);
						// Send first input
						node.socket.send(new Float32Array(jobInput).buffer);
					};
					fr.readAsArrayBuffer(blob);
				} else if (!gotHeader) {
					// Got kernel process header frame
					gotHeader = true;
					header = JSON.parse(ev.data);
					onHeader(header, jobInput, runJob, jobIndex, next);
					console.log("header", header);
				} else {
					receivedBytes += ev.data.byteLength;
					// console.log(receivedBytes);
					if (receivedBytes >= outputLength) {
						blocks.push(ev.data.slice(0, receivedBytes - outputLength));
						console.log("got full response", node.vulkanDeviceIndex, outputLength, receivedBytes);
						var blob = new Blob(blocks);
						var fr = new FileReader();
						var _onBody = onBody;
						var _jobIdx = jobIdx;
						fr.onload = () => {
							fr.result.header = header;
							_onBody(fr.result, input, runJob, _jobIdx, next);
						};
						fr.readAsArrayBuffer(blob);

						if (workQueue.length > 0) {
							blocks = [];
							[[onHeader, onData, onBody], input, runJob, jobIdx, next] = workQueue.shift();
							onHeader(header);
							receivedBytes -= outputLength;
							if (receivedBytes > 0) {
								var firstSlice = ev.data.slice(ev.data.byteLength - receivedBytes);
								onData(firstSlice, input, runJob, jobIdx, next);
								blocks.push(firstSlice);
							}
						} else {
							console.log('closing socket', node.vulkanDeviceIndex);
							node.socket.close();
						}

					} else {
						onData(ev.data, input, runJob, jobIdx, next);
						blocks.push(ev.data);
					}
				}
			};
			node.socket = new WebSocket(url.replace('http', 'ws'));
			node.socket.queue = workQueue;
			node.socket.binaryType = 'arraybuffer';
			node.socket.onmessage = onSocketResponse;
		}
	}

	static parse(nodeString) {
		return new Cluster(JSON.parse(nodeString));
	}

	static expandParam(param) {
		if ((/\.\./).test(param)) {
			const [startStr, endStr, stepStr] = param.split(/\.\.\.?|:/);
			const step = stepStr ? Math.abs(parseFloat(stepStr)) : 1;
			const start = parseFloat(startStr);
			const end = parseFloat(endStr);
			if (isNaN(start + end + step)) {
				throw new Error("Invalid range param");
			}
			var a = [];
			if (start < end) {
				for (var x = start; x < end; x += step) {
					a.push(x);
				}
			} else {
				for (var x = start; x > end; x -= step) {
					a.push(x);
				}
			}
			if (!(/\.\.\./).test(param)) {
				a.push(parseFloat(end));
			}
			return a;
		} else {
			return [parseFloat(param)];
		}
	}

	static expandParams(params) {
		if (params.length === 0) {
			return [];
		}
		var expanded = [];
		var colParams = params.map(this.expandParam);
		var indices = colParams.map(() => 0);
		while (true) {
			var arr = [];
			expanded.push(arr);
			for (var i = 0; i < indices.length; i++) {
				arr.push(colParams[i][indices[i]]);
			}
			indices[0]++;
			for (var i = 0; i < indices.length - 1; i++) {
				if (indices[i] === colParams[i].length) {
					indices[i] = 0;
					indices[i + 1]++;
				} else {
					break;
				}
			}
			if (indices[i] === colParams[i].length) {
				break;
			}
		}
		return expanded;
	}

	static responseToBlob(response, onheader, ondata) {
		return new Promise((resolve, reject) => {
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
					var headerString = '';
					function push() {
						reader.read().then(({ done, value }) => {
							if (done) {
								controller.close();
								var resultBlob = new Blob(resultBuffer, { type: resultHeader.type });
								resultBlob.header = resultHeader;
								resolve(resultBlob);
								return;
							}
							if (!gotHeader) {
								var endOfHeader = value.indexOf(10);
								var headerSlice = value.slice(0, endOfHeader);
								headerString += decoder.decode(headerSlice, { stream: true });
								if (endOfHeader > -1) {
									resultHeader = JSON.parse(headerString);
									gotHeader = true;
									if (onheader) {
										onheader(resultHeader);
									}
									value = value.slice(endOfHeader + 1);
								}
							}
							if (!gotType) {
								var endOfType = value.indexOf(10);
								var typeSlice = value.slice(0, endOfType);
								typeString += typeDecoder.decode(typeSlice, { stream: true });
								if (endOfType > -1) {
									resultHeader.type = typeString;
									gotType = true;
									if (onheader) {
										onheader(resultHeader);
									}
									value = value.slice(endOfType + 1);
								}
							}
							if (gotType) {
								resultBuffer.push(value);
								if (ondata) {
									ondata(value);
								}
							}
							push();
						});
					};

					push();
				},

				error: reject
			});

			return new Response(stream, { headers: { "Content-Type": "text/html" } });
		});
	}

	static responseToArrayBuffer(response, onheader, ondata) {
		return new Promise(async (resolve, reject) => {
			const resultBlob = await this.responseToBlob(response, onheader, ondata);
			var fileReader = new FileReader();
			fileReader.onload = function (event) {
				const arrayBuffer = event.target.result;
				arrayBuffer.header = resultBlob.header;
				resolve(arrayBuffer);
			};
			fileReader.onerror = reject;
			fileReader.readAsArrayBuffer(resultBlob);
		});
	}
}

Cluster.buildCache = {};
