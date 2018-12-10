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
    const argsString = stdinBuffer.slice(firstLine + 1, secondLine).toString();
    const args = JSON.parse(argsString);
    const program = JSON.parse(stdinBuffer.slice(secondLine + 1).toString());
    
    const startTime = info.time;
    
    var target = args.platform + "-" + args.arch + "-" + args.target + "/" + crypto.createHash('sha256').update(program).digest('hex');

    process.chdir('./ispc/build');

    if (!fs.existsSync(`./targets/${target}/program.o`)) {
        var myPlatform = 'linux';
        var myArch = execSync('uname -m').toString().replace(/\s/g,'').replace('_', '-');
        if (/^arm/.test(myArch)) {
            myArch = 'arm';
        }
        if (fs.existsSync('/proc/cpuinfo')) {
            if (execSync('uname -o').toString().replace(/\s/g, '') === 'Android') {
                myPlatform = 'android';
            }
        } else if (fs.existsSync('/Library/ColorSync')) {
            myPlatform = 'macos';
        } else {
            throw new Error("Unknown platform");
        }

        if (!fs.existsSync(`./targets/${target}`)) {
            execFileSync('mkdir', ['-p', `./targets/${target}`]);
        }
        const arch = /^arm/.test(args.arch) ? 'arm' : args.arch;
        const bits = arch === 'arm' ? '32' : '64';
        const ispc = 'ispc';
        fs.writeFileSync(`./targets/${target}/program.ispc`, program);
        execFileSync('/usr/bin/make', [
            'ispc',
            `ISPC=${ispc}`, 
            `BITS=${bits}`,
            `PLATFORM=${args.platform}`,
            `MY_PLATFORM=${myPlatform}`,
            `MY_ARCH=${myArch}`,
            `ARCH=${arch}`,
            `FLAGS=--arch=${arch} --target=${args.target} --addressing=${args.addressing}`,
            `TARGET=${target}`
        ]);
    }

    const output = fs.readFileSync(`./targets/${target}/program.o`);

    var t1 = Date.now();

    process.stdout.write("application/x-object\n");
    sendResult(output);


} catch (e) {

    process.stdout.write("error\n");
    sendResult(e.stack.toString());

}
