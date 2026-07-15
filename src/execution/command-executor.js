const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function quotePosixArgument(value) {
    return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function createLocalExecutor({ execute = execFileAsync, access = fs.access } = {}) {
    return {
        mode: 'local',
        execute,
        readFile: (filePath, encoding = 'utf8') =>
            fs.readFile(filePath, encoding),
        async assertAccess(filePath, requirements = {}) {
            let mode = 0;

            if (requirements.readable) {
                mode |= constants.R_OK;
            }

            if (requirements.executable) {
                mode |= constants.X_OK;
            }

            await access(filePath, mode);
        }
    };
}

function createRemoteExecutor({
    ssh,
    execute = execFileAsync
}) {
    const connectionArguments = [
        '-T',
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=yes',
        '-o', 'LogLevel=ERROR',
        '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=3',
        '-o', `ConnectTimeout=${Math.ceil(ssh.connectTimeoutMs / 1_000)}`,
        '-p', String(ssh.port)
    ];

    if (ssh.identityFile) {
        connectionArguments.push(
            '-o', 'IdentitiesOnly=yes',
            '-i', ssh.identityFile
        );
    }

    if (ssh.knownHostsFile) {
        connectionArguments.push(
            '-o',
            `UserKnownHostsFile=${ssh.knownHostsFile}`
        );
    }

    const target = `${ssh.user}@${ssh.host}`;

    async function executeRemote(file, args = [], options = {}) {
        const {
            cwd,
            windowsHide = true,
            ...processOptions
        } = options;
        const command = [file, ...args]
            .map(quotePosixArgument)
            .join(' ');
        const remoteCommand = cwd
            ? `cd -- ${quotePosixArgument(cwd)} && exec ${command}`
            : `exec ${command}`;

        return execute(
            ssh.binary,
            [...connectionArguments, target, remoteCommand],
            {
                ...processOptions,
                windowsHide
            }
        );
    }

    return {
        mode: 'remote',
        execute: executeRemote,
        async readFile(filePath, encoding = 'utf8') {
            const { stdout } = await executeRemote(
                '/usr/bin/cat',
                ['--', filePath],
                {
                    timeout: 30_000,
                    maxBuffer: 2 * 1024 * 1024,
                    encoding
                }
            );

            return stdout;
        },
        async assertAccess(filePath, requirements = {}) {
            const checks = [];

            if (requirements.readable) {
                checks.push('-r');
            }

            if (requirements.executable) {
                checks.push('-x');
            }

            for (const check of checks) {
                await executeRemote('/usr/bin/test', [check, filePath], {
                    timeout: 30_000
                });
            }
        }
    };
}

function createCommandExecutor(config, dependencies = {}) {
    if (config.mode === 'remote') {
        return createRemoteExecutor({
            ssh: config.ssh,
            execute: dependencies.execute
        });
    }

    return createLocalExecutor(dependencies);
}

module.exports = {
    createCommandExecutor,
    createLocalExecutor,
    createRemoteExecutor,
    quotePosixArgument
};
