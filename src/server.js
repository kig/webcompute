const express = require('express');
const cors = require('cors');
const escape = require('escape-html');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const bonjour = require('bonjour')({ interface: '0.0.0.0' });
const http = require('http');
const WebSocket = require('ws');

const { fork, exec, execFile, execSync, execFileSync, spawn } = require('child_process');


const app = express();
const port = 7172;

const httpServer = new http.Server(app);

const wss = new WebSocket.Server({ server: httpServer });

app.use(cors());

app.use('/monaco-editor/min/vs', express.static('node_modules/monaco-editor/min/vs'));

app.use('/', express.static('html'));


// Platform detection


var getTarget = function (nodeInfo) {
    if (nodeInfo.arch === 'aarch64' || nodeInfo.arch === 'armv7l') {
        return 'neon-i32x4';
    }
    if (nodeInfo.arch === 'x86-64') {
        if (nodeInfo.platform === 'linux' || nodeInfo.platform === 'android') {
            var keys = execSync(`grep -o -E ' mmx\\S* | sse\\S* | avx\\S* ' /proc/cpuinfo | sort -u`).toString().replace(/^\s+|\s+$/g, '').split(/\s+/);
            if (keys.indexOf('avx2') > -1) {
                return 'avx2-i32x8';
            } else if (keys.indexOf('avx') > -1) {
                return 'avx1-i32x8';
            } else if (keys.indexOf('sse4_1') > -1 || keys.indexOf('sse4a') > -1) {
                return 'sse4-i32x8';
            } else {
                return 'sse2-i32x8';
            }
        } else if (nodeInfo.platform === 'macos') {
            var keys = execSync(`sysctl -a | grep machdep.cpu | grep -o -E ' MMX\\S* | SSE\\S* | AVX\\S* '`).toString().toLowerCase().replace(/^\s+|\s+$/g, '').split(/\s+/);
            if (keys.indexOf('avx2') > -1) {
                return 'avx2-i32x8';
            } else if (keys.indexOf('avx1.0') > -1) {
                return 'avx1-i32x8';
            } else if (keys.indexOf('sse4.1') > -1) {
                return 'sse4-i32x8';
            } else {
                return 'sse2-i32x8';
            }
        } else if (nodeInfo.platform === 'windows') {
            return 'avx2-i32x8';
        } else {
            return 'avx2-i32x8';
        }
    }
    throw new Error("Unknown architecture");
}

var getThreadCount = function (nodeInfo) {
    if (nodeInfo.platform === 'linux' || nodeInfo.platform === 'android') {
        return parseInt(execSync(`grep processor /proc/cpuinfo | wc -l`).toString());
    } else if (nodeInfo.platform === 'macos') {
        return parseInt(execSync(`sysctl -a | grep machdep.cpu.thread_count | awk '{ print $2 }'`).toString());
    } else if (nodeInfo.platform === 'windows') {
        return 0;
    }
    throw new Error("Unknown platform");
}

var getMemorySize = function (nodeInfo) {
    if (nodeInfo.platform === 'linux' || nodeInfo.platform === 'android') {
        return parseInt(execSync(`grep MemTotal /proc/meminfo | awk '{ print $2 }'`).toString()) * 1000;
    } else if (nodeInfo.platform === 'macos') {
        return parseInt(execSync(`sysctl -a | grep hw.memsize | awk '{ print $2 }'`).toString());
    } else if (nodeInfo.platform === 'windows') {
        return 0;
    }
    throw new Error("Unknown platform");
}

var getCPUFreq = function (nodeInfo) {
    if (nodeInfo.platform === 'linux' || nodeInfo.platform === 'android') {
        return execSync(`cat /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq`).toString().replace(/^\s+|\s+$/g, '').split(/\s+/).map(s => parseInt(s));
    } else if (nodeInfo.platform === 'macos') {
        var freq = parseInt(execSync(`sysctl -a | grep hw.cpufrequency_max | awk '{ print $2 }'`).toString());
        var freqs = [];
        for (var i = 0; i < nodeInfo.threadCount; i++) {
            freqs.push(freq);
        }
        return freqs;
    } else if (nodeInfo.platform === 'windows') {
        return [];
    }
    return [];
}

var getVulkanDevices = function (nodeInfo) {
    try {
        var infoString = (nodeInfo.platform === 'windows'
            ? execFileSync(`${VulkanExtras}./spirv/vulkaninfo-${nodeInfo.platform}-${nodeInfo.arch}`)
            : execSync(`${VulkanExtras}./spirv/vulkaninfo-${nodeInfo.platform}-${nodeInfo.arch}`)
        ).toString();
        var gpus = infoString.split("\n").filter(l => /^\s*deviceName\s+=/.test(l) && !/Ivybridge/.test(l));
        var uuids = {};
        var uniqGPUs = [];
        gpus.forEach((gpu, index) => {
            var info = JSON.parse((nodeInfo.platform === 'windows'
                ? execFileSync(`${VulkanExtras}./spirv/vulkaninfo-${nodeInfo.platform}-${nodeInfo.arch}`, [`--json=${index}`])
                : execSync(`${VulkanExtras}./spirv/vulkaninfo-${nodeInfo.platform}-${nodeInfo.arch} --json=${index} | grep -v WARNING`)
            ).toString().replace("'DISPLAY' environment variable not set... skipping surface info", ''));
            var uuid = info.VkPhysicalDeviceProperties.pipelineCacheUUID.map(i => i.toString(16).padStart(2, "0")).join("");
            if (!uuids[uuid]) {
                uuids[uuid] = true;
                uniqGPUs.push(info);
            }
        });
        uniqGPUs.forEach(gpu =>
            console.log(
                "Found Vulkan device",
                gpu.VkPhysicalDeviceProperties.deviceName,
                gpu.VkPhysicalDeviceProperties.pipelineCacheUUID.map(i => i.toString(16).padStart(2, "0")).join("")
            )
        );
        return uniqGPUs;
    } catch (e) {
        return [];
    }
}

var nodeInfo = {
    platform: execSync('uname').toString().toLowerCase().replace(/\s/g, ''),
    arch: execSync('uname -m').toString().replace(/\s/g, '').replace('_', '-')
};
if (/darwin/.test(nodeInfo.platform)) {
    nodeInfo.platform = 'macos';
} else if (/mingw/.test(nodeInfo.platform)) {
    nodeInfo.platform = 'windows';
}
console.log(nodeInfo.platform);
var VulkanExtras = '';
if (nodeInfo.platform === 'macos') {
    VulkanExtras = '. ~/.bashrc; ';
} else if (nodeInfo.platform === 'linux' && execSync(`uname -o`).toString().match(/\bAndroid\b/)) {
    VulkanExtras = "LD_LIBRARY_PATH=/system/lib64:$PREFIX/lib ";
    nodeInfo.platform = 'android';
}
nodeInfo.target = getTarget(nodeInfo);
nodeInfo.threadCount = getThreadCount(nodeInfo);
nodeInfo.memorySize = getMemorySize(nodeInfo);
nodeInfo.cpuMaxFreq = getCPUFreq(nodeInfo);
const exeExt = nodeInfo.platform === 'windows' ? '.exe' : '';
nodeInfo.canBuild = fs.existsSync(`./ispc/ispc-${nodeInfo.arch}-${nodeInfo.platform}-${nodeInfo.arch}${exeExt}`);
nodeInfo.canCrossCompile = nodeInfo.canBuild && nodeInfo.platform === 'linux';
const testCmd = (cmd) => {
    try {
        execSync(cmd, {stdio: [null, null, null]});
        return true;
    } catch(e) {
        console.log(cmd, 'not found');
        return false;
    }
};
nodeInfo.canBuildSPIRV = fs.existsSync(`./spirv/glslangValidator-${nodeInfo.platform}-${nodeInfo.arch}${exeExt}`);
nodeInfo.canRunISPC = testCmd('clang++ -v') && testCmd('make -v');
console.log(nodeInfo);
nodeInfo.vulkanDevices = getVulkanDevices(nodeInfo);

app.get('/info', (req, res) => {
    res.writeHead(200);
    res.end(JSON.stringify(nodeInfo));
});


const getBuildTarget = () => {
    var cpusig;
    var platform = 'linux';
    var arch = execSync('uname -m').toString().replace(/\s/g, '').replace('_', '-');
    if (/^arm/.test(arch)) {
        arch = 'arm';
    }
    if (fs.existsSync('/proc/cpuinfo')) {
        if (execSync('uname -o').toString().replace(/\s/g, '') === 'Android') {
            platform = 'android';
        }
        cpusig = platform + '-' + execSync("grep -o -E ' mmx\\S* | sse\\S* | avx\\S* ' /proc/cpuinfo | sort -u | md5sum").toString().split(" ")[0];
    } else if (fs.existsSync('/Library/ColorSync')) {
        platform = 'macos';
        cpusig = platform + '-' + execSync(`sysctl -a | grep machdep.cpu | grep features | sed 's/.*: //' | tr '[:upper:]' '[:lower:]' | tr ' ' "\n" | sort | uniq | grep -E 'avx|sse|mmx' | md5`).toString().replace(/\s/g, '');
    } else {
        platform = 'windows'
        cpusig = platform + '-x86-64-avx2-i32x8';
        // throw new Error("Unknown platform");
    }
    return {
        cpusig: cpusig,
        platform: platform,
        arch: arch
    };
};

const BuildTarget = getBuildTarget();




// Main app



var vmuid = 0;

const findName = (name) => {
    if (name === undefined) {
        return `VM ${vmuid++}`;
    }
    var nameIdx = {};
    Object.values(processes).forEach(p => nameIdx[p.name] = true);
    if (nameIdx[name]) {
        var uid = 2;
        var uniqueName = name;
        do {
            uniqueName = name + " " + uid;
            uid++;
        } while (nameIdx[uniqueName]);
        return uniqueName;
    }
    return name;
};

function getStatus() {
    const pid = this.pid;
    const psOutput = execFileSync('/bin/ps', ['--ppid', pid, '--pid', pid, '--forest', '-u']);
    return psOutput;
}

const processes = {};
const processesByName = {};


const buildSPV = function (target, program, programInputObj) {

    /*
        cd spirv/build
        cp program.comp.glsl $TARGET/program.comp.glsl
        make TARGET=$TARGET spirv
    */
    if (!fs.existsSync(`./spirv/build/targets/${target}`)) {
        execFileSync('mkdir', ['-p', `./spirv/build/targets/${target}`]);
    }
    if (!programInputObj.binary && !fs.existsSync(`./spirv/build/targets/${target}/program.spv`)) {
        fs.writeFileSync(`./spirv/build/targets/${target}/program.comp.glsl`, program);
        execFileSync('make', [
            `TARGET=${target}`,
            `PLATFORM=${BuildTarget.platform}`,
            `ARCH=${BuildTarget.arch}`,
            `MY_PLATFORM=${BuildTarget.platform}`,
            `MY_ARCH=${BuildTarget.arch}`,
            `spirv`
        ], { cwd: './spirv/build' });
    }

};

const buildSPIRVToISPC = function (target, program, programInputObj) {
    const exe = BuildTarget.platform === 'windows' ? '.exe' : '';

    if (!fs.existsSync(`./spirv/build/targets/${target}/program${exe}`)) {
        if (programInputObj.binary) {
            fs.writeFileSync(`./spirv/build/targets/${target}/program.o`, program);
            execFileSync('make', [
                `TARGET=${target}`,
                `PLATFORM=${BuildTarget.platform}`,
                `ARCH=${BuildTarget.arch}`,
                `MY_PLATFORM=${BuildTarget.platform}`,
                `MY_ARCH=${BuildTarget.arch}`,
                `ispc-bin`
            ], { cwd: './spirv/build' });
        } else {
            execFileSync('make', [
                `TARGET=${target}`,
                `PLATFORM=${BuildTarget.platform}`,
                `ARCH=${BuildTarget.arch}`,
                `MY_PLATFORM=${BuildTarget.platform}`,
                `MY_ARCH=${BuildTarget.arch}`,
                `ispc-cross`, `ispc`, `ispc-bin`
            ], { cwd: './spirv/build' });
        }
    }
}

const createSPIRVProcess = function (target, program, programInputObj, programHash) {

    var ps;
    const exe = BuildTarget.platform === 'windows' ? '.exe' : '';

    buildSPV(target, program, programInputObj);

    if (programInputObj.vulkanDeviceIndex !== undefined) {
        /*
            Run on Vulkan
        */

        if (programInputObj.binary) {
            fs.writeFileSync(`./spirv/build/targets/${target}/program.spv`, program);
        }

        if (BuildTarget.platform === 'windows') {
            ps = spawn(
                `${VulkanExtras}bin/vulkanRunner-${BuildTarget.platform}-${BuildTarget.arch}`, 
                [`./targets/${target}/program.spv`], 
                {
                    encoding: 'buffer',
                    stdio: ['pipe', 'pipe', 'inherit'],
                    cwd: './spirv/build'
                }
            );
        } else {
            ps = spawn(
                `${VulkanExtras}bin/vulkanRunner-${BuildTarget.platform}-${BuildTarget.arch} ./targets/${target}/program.spv`, 
                [],
                {
                    shell: true,
                    encoding: 'buffer',
                    stdio: ['pipe', 'pipe', 'inherit'],
                    cwd: './spirv/build'
                }
            );
        }

    } else {
        /*
            Run on CPU
        */
        buildSPIRVToISPC(target, program, programInputObj)

        ps = spawn(`./targets/${target}/program`, [], {
            encoding: 'buffer',
            stdio: ['pipe', 'pipe', 'inherit'],
            cwd: './spirv/build'
        });

    }

    registerProcess(ps, programInputObj.name, programHash);
    return ps;
};

const registerProcess = function (ps, name, programHash) {
    ps.name = findName(name);
    Object.defineProperty(ps, 'status', { get: getStatus });

    processes[ps.pid] = ps;
    processesByName[ps.name] = ps;
    ps.on('exit', (code, signal) => {
        // process.stderr.write('Exit: ' + code + ' ' + signal + '\n')
        delete processes[ps.pid];
        delete processesByName[ps.name];
    });
    ps.imageHash = programHash;
};

const runSPIRVSocket = function (socket, req) {

    console.log("socket open");

    socket.send("READY.");

    var time = Date.now();

    var ps;

    var socketError;

    var programInputObj = {VkPhysicalDeviceProperties: {deviceName: '[no header received]'}};

    var headerMsg = true;
    var outputLength = 0;
    var pipelined = 0;
    var maxPipelined = 0;
    var t0 = Date.now();

    socket.on('message', msg => {
        if (headerMsg) {
            try {
                headerMsg = false;
                var body = msg;
                const firstLine = body.indexOf(10);
                programInputObj = JSON.parse(body.slice(0, firstLine).toString());
                const program = body.slice(firstLine + 1);

                programInputObj.vulkanDevice = nodeInfo.vulkanDevices[programInputObj.vulkanDeviceIndex];

                if (!programInputObj.vulkanDevice) {
                    programInputObj.vulkanDevice = {VkPhysicalDeviceProperties: {deviceName: "CPU [ISPC]"}};
                }

                console.log("socket first message", programInputObj.vulkanDevice.VkPhysicalDeviceProperties.deviceName);

                var programHash = crypto.createHash('sha256').update(program).digest('hex');
                var target = programInputObj.language + "-" + BuildTarget.cpusig + '/' + programHash;

                var programInput = new ArrayBuffer(24);
                var i32 = new Int32Array(programInput, 0, 6);
                i32[0] = programInputObj.outputLength;
                outputLength = i32[0];
                i32[1] = programInputObj.vulkanDeviceIndex || 0;
                i32[2] = programInputObj.workgroups[0];
                i32[3] = programInputObj.workgroups[1];
                i32[4] = programInputObj.workgroups[2];
                i32[5] = programInputObj.inputLength;

                ps = createSPIRVProcess(target, program, programInputObj, programHash);
                ps.stdin.on('drain', () => socket._socket.resume());


                console.log("  ps open", programInputObj.vulkanDevice.VkPhysicalDeviceProperties.deviceName);

                socket.send(
                    JSON.stringify({ pid: ps.pid, name: ps.name, hash: 'sha256:' + ps.imageHash, startTime: time })
                );

                ps.on('close', () => {
                    console.log("  ps close", programInputObj.vulkanDevice.VkPhysicalDeviceProperties.deviceName);
                    socket.close();
                });

                var dstBuffer1 = Buffer.alloc(outputLength/16);
                var dstBuffer2 = Buffer.alloc(outputLength/16);
                var tmp;
                var dstOffset = 0;
                var remaining = dstBuffer1.byteLength;
                var firstLen = 0;
                var secondOffset = 0;

                var inFlight = 0;

                var resume = function() {
                    inFlight--;
                    if (inFlight < 2) {
                        ps.stdout.resume();
                    }
                };

                var addBlock = function(data, offset) {
                    firstLen = data.byteLength - offset;
                    secondOffset = -1;
                    if (remaining < firstLen) {
                        firstLen = remaining;
                        secondOffset = offset + remaining;
                    }
                    data.copy(dstBuffer1, dstOffset, offset, offset+firstLen);
                    remaining -= firstLen;
                    dstOffset += firstLen;
                    if (remaining === 0) {
                        inFlight++;
                        if (inFlight > 1) {
                            ps.stdout.pause();
                        }
                        socket.send(dstBuffer1, resume);
                        tmp = dstBuffer1;
                        dstBuffer1 = dstBuffer2;
                        dstBuffer2 = tmp;
                        dstOffset = 0;
                        remaining = dstBuffer1.byteLength;
                    }
                    if (secondOffset > -1) {
                        addBlock(data, secondOffset);
                    }
                };

                var receivedBytes = 0;

                ps.stdout.on('data', (data) => {
                    try {
                        var t0 = new Date();
                        addBlock(data, 0);
                        if (new Date() - t0 > 100) {
                            console.log("slow addBlock", new Date() - t0);
                        }
                        // socket.send(data);
                        //if (socket._socket.bufferSize > 0) {
                        //    ps.stdout.pause();
                        //}
                    } catch (err) {
                        console.log(programInputObj.vulkanDevice.VkPhysicalDeviceProperties.deviceName, err);
                        socket.close();
                    }
                    receivedBytes += data.byteLength;
                    while (receivedBytes >= programInputObj.outputLength) {
                        receivedBytes -= programInputObj.outputLength;
                        pipelined--;
                        var t1 = Date.now();
                        if (t1 - t0 > 100) {
                            console.log('slow frame', pipelined, receivedBytes, t1 - t0);
                        }
                    }
                });
                socket._socket.on('drain', () => ps.stdout.resume());
                ps.stdout.on('close', () => {
                    console.log('  ps.stdout close', programInputObj.vulkanDevice.VkPhysicalDeviceProperties.deviceName);
                    socket.close();
                });

                ps.stdin.write(Buffer.from(programInput));
            } catch (err) {
                socketError = JSON.stringify(err);
                console.log(programInputObj.vulkanDevice.VkPhysicalDeviceProperties.deviceName, err);
                try {
                    socket.send(socketError);
                } catch(e) {}
            }
        } else {
            try {
                if (msg.byteLength === 0) {
                    ps.stdin.destroy();
                    console.log('close received');
                } else {
                    if (!ps.stdin.write(msg)) {
                    //    socket._socket.pause();
                    }
                    if (Date.now() - t0 > 100) {
                        console.log('slow frame receive', pipelined, Date.now() - t0);
                    }
                    t0 = Date.now();
                    pipelined++;
                    if (pipelined > maxPipelined) {
                        maxPipelined = pipelined;
                        console.log('max pipelined', maxPipelined);
                    }
                }
            } catch (err) {
                socketError = socketError || JSON.stringify(err);
                console.log(programInputObj.vulkanDevice.VkPhysicalDeviceProperties.deviceName, err);
                try {
                    socket.send(socketError);
                } catch(e) {}
            }

        }
    });

    socket.on('close', () => {
        console.log("closed socket", programInputObj.vulkanDevice.VkPhysicalDeviceProperties.deviceName);
        if (ps) {
            ps.stdin.end();
        }
    });

};

const runVM_ = function (name, body, res) {
    function sendResult(result) {
        try {
            res.write(result);
        } catch (err) {
            res.write('error\n');
            res.write(err.stack.toString());
            res.end();
        }
    }

    var time = Date.now();

    try {
        const firstLine = body.indexOf(10);
        const programInputObj = JSON.parse(body.slice(0, firstLine).toString());
        const program = body.slice(firstLine + 1);

        var programHash = crypto.createHash('sha256').update(program).digest('hex');
        var target = programInputObj.language + "-" + BuildTarget.cpusig + '/' + programHash;

        var ps;

        const exe = BuildTarget.platform === 'windows' ? '.exe' : '';

        if (programInputObj.language === 'ispc') {

            var programInput = new ArrayBuffer(programInputObj.input.length * 4 + 4);
            var i32 = new Int32Array(programInput, 0, 1);
            i32[0] = programInputObj.outputLength;
            var f32 = new Float32Array(programInput, 4);
            f32.set(programInputObj.input);

            if (!fs.existsSync(`./ispc/build/targets/${target}/program${exe}`)) {
                if (!fs.existsSync(`./ispc/build/targets/${target}`)) {
                    execFileSync('mkdir', ['-p', `./ispc/build/targets/${target}`]);
                }
                if (programInputObj.executable) {
                    fs.writeFileSync(`./ispc/build/targets/${target}/program${exe}`, program);
                } else if (programInputObj.binary) {
                    fs.writeFileSync(`./ispc/build/targets/${target}/program.o`, program);
                    execFileSync('make', [
                        `TARGET=${target}`,
                        `PLATFORM=${BuildTarget.platform}`,
                        `ARCH=${BuildTarget.arch}`,
                        `MY_PLATFORM=${BuildTarget.platform}`,
                        `MY_ARCH=${BuildTarget.arch}`,
                        `link`
                    ], { cwd: './ispc/build' });
                } else {
                    fs.writeFileSync(`./ispc/build/targets/${target}/program.ispc`, program);
                    execFileSync('make', [
                        `TARGET=${target}`,
                        `PLATFORM=${BuildTarget.platform}`,
                        `ARCH=${BuildTarget.arch}`,
                        `MY_PLATFORM=${BuildTarget.platform}`,
                        `MY_ARCH=${BuildTarget.arch}`,
                        `ispc`,
                        `link`
                    ], { cwd: './ispc/build' });
                }
            }

            fs.writeFileSync(`./ispc/build/targets/${target}/input`, Buffer.from(programInput));

            ps = execFile(`./targets/${target}/program`, [], {
                encoding: 'buffer',
                stdio: ['pipe', 'pipe', 'inherit'],
                maxBuffer: Infinity,
                // Set OMP_NUM_THREADS=8 for Android targets
                env: { ...process.env, 'OMP_NUM_THREADS': '8' },
                cwd: './ispc/build'
            });

        } else if (programInputObj.language === 'glsl') {

            var programInput = new ArrayBuffer(24 + 4 * programInputObj.input.length);
            var i32 = new Int32Array(programInput, 0, 6);
            i32[0] = programInputObj.outputLength;
            i32[1] = programInputObj.vulkanDeviceIndex || 0;
            i32[2] = programInputObj.workgroups[0];
            i32[3] = programInputObj.workgroups[1];
            i32[4] = programInputObj.workgroups[2];
            i32[5] = programInputObj.input.length * 4;

            var f32 = new Float32Array(programInput, 24, programInputObj.input.length);
            f32.set(programInputObj.input);

            /*
                cd spirv/build
                cp program.comp.glsl $TARGET/program.comp.glsl
                make TARGET=$TARGET spirv
            */
            if (!fs.existsSync(`./spirv/build/targets/${target}`)) {
                execFileSync('mkdir', ['-p', `./spirv/build/targets/${target}`]);
            }
            if (!programInputObj.binary && !fs.existsSync(`./spirv/build/targets/${target}/program.spv`)) {
                fs.writeFileSync(`./spirv/build/targets/${target}/program.comp.glsl`, program);
                execFileSync('make', [
                    `TARGET=${target}`,
                    `PLATFORM=${BuildTarget.platform}`,
                    `ARCH=${BuildTarget.arch}`,
                    `MY_PLATFORM=${BuildTarget.platform}`,
                    `MY_ARCH=${BuildTarget.arch}`,
                    `spirv`
                ], { cwd: './spirv/build' });
            }

            fs.writeFileSync(`./spirv/build/targets/${target}/input`, Buffer.from(programInput));

            if (programInputObj.vulkanDeviceIndex !== undefined) {
                /*
                    Run on Vulkan
                    bin/vulkanRunner $TARGET/program.spv <input >output
                */

                if (programInputObj.binary) {
                    fs.writeFileSync(`./spirv/build/targets/${target}/program.spv`, program);
                }

                if (BuildTarget.platform === 'windows') {
                    ps = execFile(`${VulkanExtras}bin/vulkanRunner-${BuildTarget.platform}-${BuildTarget.arch}`, [`./targets/${target}/program.spv`], {
                        encoding: 'buffer',
                        stdio: ['pipe', 'pipe', 'inherit'],
                        maxBuffer: Infinity,
                        cwd: './spirv/build'
                    });
                } else {
                    ps = exec(`${VulkanExtras}bin/vulkanRunner-${BuildTarget.platform}-${BuildTarget.arch} ./targets/${target}/program.spv`, {
                        encoding: 'buffer',
                        stdio: ['pipe', 'pipe', 'inherit'],
                        maxBuffer: Infinity,
                        cwd: './spirv/build'
                    });

                }

            } else {
                /*
                    Run on CPU
                    make TARGET=$TARGET ispc-cross ispc ispc-bin
                    $TARGET/program <input >output
                */
                if (!fs.existsSync(`./spirv/build/targets/${target}/program${exe}`)) {
                    if (programInputObj.binary) {
                        fs.writeFileSync(`./spirv/build/targets/${target}/program.o`, program);
                        execFileSync('make', [
                            `TARGET=${target}`,
                            `PLATFORM=${BuildTarget.platform}`,
                            `ARCH=${BuildTarget.arch}`,
                            `MY_PLATFORM=${BuildTarget.platform}`,
                            `MY_ARCH=${BuildTarget.arch}`,
                            `ispc-bin`
                        ], { cwd: './spirv/build' });
                    } else {
                        execFileSync('make', [
                            `TARGET=${target}`,
                            `PLATFORM=${BuildTarget.platform}`,
                            `ARCH=${BuildTarget.arch}`,
                            `MY_PLATFORM=${BuildTarget.platform}`,
                            `MY_ARCH=${BuildTarget.arch}`,
                            `ispc-cross`, `ispc`, `ispc-bin`
                        ], { cwd: './spirv/build' });
                    }
                }

                ps = execFile(`./targets/${target}/program`, [], {
                    encoding: 'buffer',
                    stdio: ['pipe', 'pipe', 'inherit'],
                    maxBuffer: Infinity,
                    // Set OMP_NUM_THREADS=8 for Android targets
                    env: { ...process.env, 'OMP_NUM_THREADS': '8' },
                    cwd: './spirv/build'
                });

            }

        }

        registerProcess(ps, name, programHash);

        ps.on('close', () => res.end());

        res.writeHead(200);
        res.write(JSON.stringify({ pid: ps.pid, name: ps.name, hash: 'sha256:' + ps.imageHash, startTime: time }) + '\n');
        res.write("application/octet-stream\n");

        ps.stdout.on('data', (msg) => res.write(msg));
        ps.stdout.on('close', () => res.end());

        ps.stdin.write(Buffer.from(programInput));
        ps.stdin.end();

    } catch (e) {

        res.write("error\n");
        sendResult(e.stack.toString());
        res.end();

    }
};

const runVM = function (instance, name, body, res) {
    var time = Date.now();

    var ps = fork(instance, { stdio: 'pipe' });
    ps.name = findName(name);
    Object.defineProperty(ps, 'status', { get: getStatus });
    ps.stdin.write(JSON.stringify({ pid: ps.pid, name: ps.name, time: time }) + '\n');
    ps.stdin.write(body);
    ps.stdin.end();
    ps.on('exit', (err) => {
        delete processes[ps.pid];
        delete processesByName[ps.name];
    });
    processes[ps.pid] = ps;
    processesByName[ps.name] = ps;
    res.writeHead(200);
    ps.imageHash = crypto.createHash('sha256').update(body).digest('hex');
    res.write(JSON.stringify({ pid: ps.pid, name: ps.name, hash: 'sha256:' + ps.imageHash, startTime: time }) + '\n');
    ps.stdout.on('close', () => res.end());
    ps.stdout.on('data', (msg) => res.write(msg));
}

app.post('/new/:name?', (req, res) =>
    bodyAsBuffer(req, buffer => runVM_(req.params.name, buffer, res))
);

wss.on('connection', runSPIRVSocket);

app.post('/build/:name?', (req, res) =>
    bodyAsBuffer(req, buffer => runVM('./src/build-instance', 'build-' + req.params.name, buffer, res))
);

app.get('/list', (req, res) => {
    res.send(
        "<h3>Running processes</h3>"
        + "<ul>"
        + Object.keys(processes).map(pid => `<li><a href="/vm/${pid}">${processes[pid].name} (PID ${pid}, hash ${processes[pid].imageHash})</a></li>`).join("")
        + "</ul>"
    );
});

app.get('/vm/:pid', (req, res) => {
    var pid = req.params.pid;
    var ps = processes[pid] || processesByName[pid];
    if (ps) {
        res.send(`
            <p>PID: ${pid}</p>
            <pre>${ escape(ps.status)}</pre>
            <form method="POST" action="/signal/${pid}/SIGTSTP"><button>Pause</button></form>
            <form method="POST" action="/signal/${pid}/SIGCONT"><button>Continue</button></form>
            <form method="POST" action="/signal/${pid}/SIGTERM"><button>Terminate</button></form>
            <form method="POST" action="/signal/${pid}/SIGKILL"><button>Kill</button></form>
        `);
    } else {
        res.send('Not found<br><a href=\"/list\">Back to process list</a>');
    }
});

app.post('/signal/:pid/:signal', (req, res) => {
    var pid = req.params.pid;
    var signal = req.params.signal || 'SIGTERM';
    if (processes[pid] || processesByName[pid]) {
        execFile('/usr/bin/pkill', [`-${signal}`, '-P', pid.toString()]);
        processes[pid].kill(signal);
        res.send(`OK<br><a href="/vm/${pid}">Back to process</a>`);
    } else {
        res.send("Not found<br><a href=\"/list\">Back to process list</a>");
    }
});

const bodyAsBuffer = (req, cb) => {
    var chunks = [];
    req.on('data', b => chunks.push(b));
    req.on('end', () => cb(Buffer.concat(chunks)));
}
const bodyAsString = (req, cb) => bodyAsBuffer(req, b => cb(b.toString()));
const bodyAsJson = (req, cb) => bodyAsString(req, s => cb(JSON.parse(s)));

const availableNodes = [];

app.get('/nodes', (req, res) => {
    res.end(JSON.stringify(availableNodes.map(n => ({
        url: n.url,
        info: n.info,
        addresses: n.addresses,
        name: n.name
    }))));
});

app.post('/nodes/add', (req, res) => {
    bodyAsString(req, s => {
        registerNode(JSON.parse(s))
        res.end('ok');
    });
});




// Service registration

/*
    Service discovery protocol:
        1. Advertise on mdns
        2. On receiving an advertisement (or manually adding a node), process the node
            a. node/info - Connect to the advertised node to get its details
            b. node/nodes - Fetch the list of nodes known to the advertised node
            c. Add the list of nodes to known nodes
        3. Process known nodes list in the background
*/


const fetchJson = (url, ok, fail) => {
    const onError = (err) => {
        if (fail) {
            fail(err);
        } else {
            console.error(err);
        }
    };
    http.get(url, (res) => {
        bodyAsJson(res, ok);
        res.on('error', onError);
    }).on('error', onError);
};

const pingNode = (service, ok, fail) => {
    fetchJson(service.url + '/info', (info) => {
        service.info = info;
        if (ok) {
            ok(service);
        }
    }, fail);
};

const fetchNodes = (service, ok, fail) => {
    fetchJson(service.url + '/nodes', (nodes) => {
        nodes.forEach(registerNode);
        if (ok) {
            ok(nodes);
        }
    }, fail);
};

const updateNodes = () => {
    setTimeout(updateNodes, 10000);
    availableNodes.forEach(n => fetchNodes(n, null, () => unregisterNode(n)));
};

const lanAddr = (addr) => {
    return /^(192\.168\.|10\.)/.test(addr);
};

const ipv4Addr = (addr) => {
    return /^(\d+\.){3}\d+$/.test(addr);
};

const nonLocalAddr = (addr) => {
    return !(/^(127\.|fe80)/.test(addr));
};

const findPrimaryAddress = (service) => {
    var addr = service.addresses.find(lanAddr);
    if (!addr) {
        return service.addresses.find(ipv4Addr) || service.addresses.find(nonLocalAddr) || '127.0.0.1';
    }
    return addr;
};

const getServiceURL = (service) => 'http://' + findPrimaryAddress(service) + ':' + service.port;
const parseService = (service) => ({ ...service, url: service.url || getServiceURL(service) });

const serviceIndex = (service) => availableNodes.findIndex(n => n.url === service.url);

const registerNode = (rawService) => {
    const service = parseService(rawService);
    if (serviceIndex(service) === -1) {
        pingNode(service, s => {
            if (serviceIndex(service) === -1) {
                console.log("Added node ", s.url);
                availableNodes.push(s);
                fetchNodes(s);
            }
        });
    }
};

const unregisterNode = (service) => {
    service.url = getServiceURL(service);
    const idx = serviceIndex(service);
    if (idx > -1) {
        console.log("Removed node ", service.url);
        availableNodes.splice(idx, 1);
        var bidx = browser.services.indexOf(service);
        if (bidx > -1) {
            browser.services.splice(bidx, 1);
        }
    }
};

var service, browser;

if (process.argv.length > 2) {
    process.argv.slice(2).forEach(host => {
        registerNode({
            url: 'http://' + host + ':' + 7172,
            host: host,
            port: 7172,
            addresses: [host]
        });
    });
}

httpServer.listen(port, () => {
    console.log(`NodeVM server up on port ${port} @ ${Date.now()}`)

    // Service discovery

    service = bonjour.publish({ name: 'Compute Worker ' + os.hostname() + " " + Date.now(), type: 'compute', port: port.toString() });
    browser = bonjour.find({ type: 'compute' }, registerNode);
    browser.on('down', unregisterNode);
    setInterval(() => browser.update(), 10000);

    updateNodes();

});




