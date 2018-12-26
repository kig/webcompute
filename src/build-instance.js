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
    
    var target = (args.language || 'ispc') + "-" + args.platform + "-" + args.arch + "-" + args.target + "/" + crypto.createHash('sha256').update(program).digest('hex');

    var output;

    if (args.language === 'ispc') {

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
        output = fs.readFileSync(`./targets/${target}/program.o`);

    } else if (args.language === 'glsl') {
        /*
            cd spirv/build
            cp program.comp.glsl $TARGET/program.comp.glsl
            make TARGET=$TARGET spirv
        */
        if (!fs.existsSync(`./spirv/build/targets/${target}/program.spv`)) {
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
            var arch = /^arm/.test(args.arch) ? 'arm' : args.arch;
            var bits = arch === 'arm' ? '32' : '64';

            if (!fs.existsSync(`./spirv/build/targets/${target}`)) {
                execFileSync('mkdir', ['-p', `./spirv/build/targets/${target}`]);
            }
            fs.writeFileSync(`./spirv/build/targets/${target}/program.comp.glsl`, program);
            execFileSync('make', [
                `TARGET=${target}`,
                `PLATFORM=${args.platform}`,
                `MY_PLATFORM=${myPlatform}`,
                `MY_ARCH=${myArch}`,
                `ARCH=${arch}`,
                `spirv`
            ], { cwd: './spirv/build' });
        }

        if (info.vulkanDeviceIndex !== undefined) {

            output = fs.readFileSync(`./spirv/build/targets/${target}/program.spv`);

        } else {
            /*
                Run on CPU
                make TARGET=$TARGET ispc-cross ispc ispc-bin
                $TARGET/program <input >output
            */
            if (!fs.existsSync(`./spirv/build/targets/${target}/program.o`)) {
                if (myPlatform === undefined) {
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
                    var arch = /^arm/.test(args.arch) ? 'arm' : args.arch;
                    var bits = arch === 'arm' ? '32' : '64';        
                }
                execFileSync('make', [
                    `TARGET=${target}`,
                    `PLATFORM=${args.platform}`,
                    `MY_PLATFORM=${myPlatform}`,
                    `MY_ARCH=${myArch}`,
                    `ARCH=${arch}`,
                    `BITS=${bits}`,
                    `FLAGS=--arch=${arch} --target=${args.target} --addressing=${args.addressing}`,
                    `ispc-cross`, `ispc`
                ], { cwd: './spirv/build' });
            }

            output = fs.readFileSync(`./spirv/build/targets/${target}/program.o`);

        }
       
    }


    var t1 = Date.now();

    process.stdout.write("application/x-object\n");
    sendResult(output);


} catch (e) {

    process.stdout.write("error\n");
    sendResult(e.stack.toString());

}
