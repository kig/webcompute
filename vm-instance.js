var t0 = Date.now();
const fs = require('fs');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');

function sendResult(result) {
    try {
        process.stdout.write(result);
    } catch (err) {
        process.stdout.write(err.stack.toString());
    }
}
try {
    const stdinBuffer = fs.readFileSync(0);
    const firstLine = stdinBuffer.indexOf(10);
    const secondLine = stdinBuffer.indexOf(10, firstLine + 1);
    const infoString = stdinBuffer.slice(0, firstLine).toString();
    const info = JSON.parse(infoString);
    const programInputObj = JSON.parse(stdinBuffer.slice(firstLine + 1, secondLine).toString());
    const program = stdinBuffer.slice(secondLine + 1);

    const programInput = new ArrayBuffer(programInputObj.input.length * 4 + 4);
    const i32 = new Int32Array(programInput, 0, 1);
    i32[0] = programInputObj.outputLength;
    const f32 = new Float32Array(programInput, 4);
    f32.set(programInputObj.input);

    const startTime = info.time;


    var cpusig;
    var platform = 'linux';
    var arch = execSync('uname -m').toString().replace(/\s/g,'').replace('_', '-');
    if (fs.existsSync('/proc/cpuinfo')) {
        cpusig = 'linux-' + execSync("grep -o -E ' mmx\\S* | sse\\S* | avx\\S* ' /proc/cpuinfo | sort -u | md5sum").toString().split(" ")[0];
    } else if (fs.existsSync('/Library/ColorSync')) {
        platform = 'macos';
        cpusig = 'macos-' + execSync(`sysctl -a | grep machdep.cpu | grep features | sed 's/.*: //' | tr '[:upper:]' '[:lower:]' | tr ' ' "\n" | sort | uniq | grep -E 'avx|sse|mmx' | md5`).toString().replace(/\s/g, '');
    } else {
        throw new Error("Unknown platform");
    }
    var target = cpusig + '/' + crypto.createHash('sha256').update(program).digest('hex');

    process.chdir('./ispc/build');

    if (!fs.existsSync(`./targets/${target}/program`)) {
        if (!fs.existsSync(`./targets/${target}`)) {
            execFileSync('mkdir', ['-p', `./targets/${target}`]);
        }
        if (programInputObj.binary) {
            fs.writeFileSync(`./targets/${target}/program.o`, program);
            execFileSync('/usr/bin/make', [
                `TARGET=${target}`,
                `PLATFORM=${platform}`,
                `ARCH=${arch}`,
                `link`
            ]);
        } else {
            fs.writeFileSync(`./targets/${target}/program.ispc`, program);
            execFileSync('/usr/bin/make', [
                `TARGET=${target}`, 
                `PLATFORM=${platform}`,
                `ARCH=${arch}`,
                `ispc`, 
                `link`
            ]);
        }
    }

    fs.writeFileSync(`./targets/${target}/input`, Buffer.from(programInput));

    const output = execFileSync(`./targets/${target}/program`, [], { input: Buffer.from(programInput) });

    var t1 = Date.now();

    process.stdout.write("application/octet-stream\n");
    sendResult(output);


} catch (e) {

    sendResult(e.stack.toString());

}
