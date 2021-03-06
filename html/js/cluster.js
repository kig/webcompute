class Cluster {

	constructor(nodes, gpuOnly=false) {
		this.buildNodes = nodes.filter(n => n.info.canBuild);
		this.gpuOnly = gpuOnly;
		this.nodes = nodes;
		this.availableNodes = {};
		this.availableNodes.ISPC = nodes.slice();
		this.availableNodes.SPIRV = [];
		nodes.forEach(n => {
			(n.info.vulkanDevices || []).forEach((vd, idx) => {
				var vulkanNode = { ...n, vulkanDeviceIndex: idx, sockets: {} };
				this.availableNodes.SPIRV.push(vulkanNode);
			});
			if (!this.gpuOnly) {
				n.sockets = {};
				this.availableNodes.SPIRV.push(n);
			}
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

	async build(node, name, source, language, vulkanDeviceIndex, inputLength, outputLength) {
		var hash = await sha256(JSON.stringify({ language, vulkanDeviceIndex, inputLength, outputLength, source }));
		if (node.info.canBuild || (vulkanDeviceIndex != null && language === 'glsl')) {
			return { blob: new Blob([source]), isBinary: false, hash };
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
					resolve({ blob, isBinary: true, hash });
				});
			}
			return Cluster.buildCache[key];
		}
	}

	disableNode(node) {
		node.disabled = true;
	}

	static run(options) {
		const { 
			nodes, name, language, source, params, outputLength, onResponse, workgroups, 
			useHTTP, buffer, gpuOnly, interactive, getInteractiveParams, greenVM
		} = options;
		const green = greenVM ? '/green' : '';
		const cluster = this.parse(nodes, gpuOnly);
		const inputs = this.expandParams(params);
		const vmSuffix = '/new' + green + '/' + name;
		const log = document.createElement('pre');
		log.style.position = 'absolute';
		log.style.right = '10px';
		log.style.top = '10px';
		log.style.zIndex = 1000;
		log.style.background = 'white';
		log.style.padding = '10px';
		log.style.color = 'black';
		document.body.appendChild(log);
		var sendTime = performance.now();
		const runJob = function(jobInput, jobIndex) {
			return new Promise((resolve, reject) => {
				cluster.getNode(async function(node, next) {
					const inputLength = jobInput.length * 4;
					const program = await cluster.build(node, name, source, language, node.vulkanDeviceIndex, inputLength, outputLength);
					if (!program) {
						cluster.disableNode(node);
						await runJob(jobInput, jobIndex);
						return;
					}
					const bin = program.blob;
					const url = node.url + vmSuffix;

					if (!useHTTP && language === 'glsl') {
						const socket = await Cluster.getNodeSocket(node, url, name, language, workgroups, program, inputLength, outputLength, buffer);
						socket.queue.push([onResponse, resolve, jobInput, runJob, jobIndex, next]);
						// log.textContent = jobInput.map(n => Math.floor(n*100)/100).join("\n");
						var startTime = sendTime;
						sendTime = performance.now(); 
						var elapsed = performance.now() - startTime;
						if (elapsed > 100) {
							console.log("Slow frame send", elapsed);
						}
						socket.send(new Float32Array(jobInput).buffer);
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
							await runJob(jobInput, jobIndex);
							return;
						}
						await onResponse(res, jobInput, runJob, jobIdx);
						return;
					}
				}, language === 'glsl' ? 'SPIRV' : 'ISPC');
			});
		};
		if (interactive) {
			cluster.running = true;
			var jobIdx = 0;
			var currentFrame = 0;
			var pipelineFrames = 2;
			var framesInPipeline = 0;
			var enqueue = async function(x) {
				while (framesInPipeline < pipelineFrames) {
					var interactiveParams = getInteractiveParams(currentFrame);
					// log.textContent = inputs[0].concat(interactiveParams).map(n => Math.floor(n*100)/100).join("\n");
					// console.log(currentFrame, interactiveParams);
					framesInPipeline++;
					currentFrame++;
					var jobs = [];
					for (var i = 0*x; i < inputs.length; i++) {
						jobs[i] = runJob(inputs[0].concat(interactiveParams), jobIdx);
						jobIdx++;
					}
					await Promise.all(jobs);
					framesInPipeline--;
				}
			}
			// Hack to force quick GC of received frames.
			// This is needed to maintain a stable frame rate when receiving frames at > 400 MB/s.
			var gcOptimizationDisabler = 0; 
			var createGCLoad = function() {
				var s = new Uint8Array(20e6);
				for (var i = 0; i < 1000; i++) {
					s[i] = i;
				}
				gcOptimizationDisabler = s[47];
			};
			var ival = function() {
				enqueue(gcOptimizationDisabler);
			};
			setInterval(createGCLoad, 2);
			setInterval(ival, 1);
			var ft = performance.now();
			var tick = () => {
				var t = performance.now();
				if (t - ft > 100) {
					console.log('slow frame', t-ft);
				}
				ft = t;
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		} else {
			inputs.forEach(runJob);
		}
		return cluster;
	}

	static async getNodeSocket(node, url, name, language, workgroups, program, inputLength, outputLength, buffer) {
		if (!node.sockets[program.hash]) {
			node.sockets[program.hash] = new Promise((resolve, reject) => {
				const bin = program.blob;
				const workQueue = [];
				const socket = new WebSocket(url.replace('http', 'ws'));
				socket.programArgs = {
					name,
					inputLength,
					outputLength,
					language,
					workgroups,
					vulkanDeviceIndex: node.vulkanDeviceIndex,
					binary: program.isBinary
				};
				socket.u8 = buffer || new Uint8Array(outputLength);
				socket.program = program;
				socket.queue = workQueue;
				socket.kernelArgs = [];
				socket.gotHeader = false;
				socket.receivedBytes = 0;
				socket.binaryType = 'arraybuffer';
				socket.onerror = reject;
				socket.started = false;
				socket.closeTimeout = setInterval(() => {
					if (socket.gotHeader && !socket.started && performance.now() > socket.lastMessageTime + 100 && socket.queue.length === 0) {
						clearTimeout(socket.closeTimeout);
						delete node.sockets[program.hash];
						console.log("closing socket");
						socket.close();
					}
				}, 100);
				socket.processQueue = function () {
					if (this.queue.length > 0) {
						var [[onHeader, onData, onBody], onComplete, input, runJob, jobIdx, next] = this.queue.shift();
						this.onHeader = onHeader;
						this.onBody = onBody;
						this.onData = onData;
						this.onComplete = onComplete;
						this.kernelArgs = [input, runJob, jobIdx, next, node, this.header, this.u8];
						this.onHeader(this.header, ...this.kernelArgs);
					} else {
						this.started = false;
					}
				};
				socket.lastMessageTime = performance.now();
				socket.onmessage = function (ev) {
					this.lastMessageTime = performance.now();
					if (!this.gotHeader) {
						if (ev.data === 'READY.') {
							// Connection init
							// Send kernel
							var blob = new Blob([JSON.stringify(this.programArgs), '\n', bin]);
							var fr = new FileReader();
							fr.onload = () => {
								this.send(fr.result);
							};
							fr.readAsArrayBuffer(blob);
						} else {
							// Got kernel process header frame
							this.gotHeader = true;
							this.header = JSON.parse(ev.data);
							this.header.node = `${node.url} [${node.vulkanDeviceIndex === undefined ? 'CPU' : node.info.vulkanDevices[node.vulkanDeviceIndex].VkPhysicalDeviceProperties.deviceName}]`;
							console.log("header", this.header);
							resolve(this);
						}
					} else {
						var t0 = performance.now();
						this.addBlock(ev, 0);
						var elapsed = performance.now() - t0;
						if (elapsed > 100) {
							console.log("Slow addBlock", elapsed);
						}
					}
				};

				socket.addBlock = function (ev, blockOffset) {
					var block = ev.data;
					if (!this.started) {
						this.started = true;
						this.processQueue();
					}
					var blockByteLength = block.byteLength - blockOffset;
					this.receivedBytes += blockByteLength;
					if (this.receivedBytes >= this.programArgs.outputLength) {
						var offset = blockByteLength - (this.receivedBytes - this.programArgs.outputLength);
						if (this.onBody) {
							this.u8.set(new Uint8Array(block, blockOffset, offset), this.receivedBytes - blockByteLength);
							// console.log("got full response", node.vulkanDeviceIndex, outputLength, receivedBytes);
						}
						if (this.onData) {
							this.onData(offset, ...this.kernelArgs);
						}
						// delete lastSlice;
						this.handleResult(this.u8.buffer, offset, ev)
					} else {
						this.u8.set(new Uint8Array(block, blockOffset), this.receivedBytes - blockByteLength)
						if (this.onData) {
							this.onData(blockByteLength, ...this.kernelArgs);
						}
					}
				};

				socket.handleResult = function (result, offset, ev) {
					var block = ev.data;
					if (this.onBody) {
						this.onBody(result, ...this.kernelArgs);
						result = undefined;
					}
					this.onComplete();
					this.onHeader = this.onBody = this.onData = null;
					this.receivedBytes = 0;
					this.started = false;
					if (offset < block.byteLength) {
						this.addBlock(ev, offset);
					}
					block = undefined;
				};
			});
		}
		return node.sockets[program.hash];
	}

	static parse(nodeString, gpuOnly) {
		return new Cluster(JSON.parse(nodeString), gpuOnly);
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
