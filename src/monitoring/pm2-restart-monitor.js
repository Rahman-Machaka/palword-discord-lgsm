const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const { promisify } = require('node:util');
const { t } = require('../i18n.js');

const execFileAsync = promisify(execFile);

function createPm2RestartMonitor({
    processName,
    stateFile,
    runtimeAlerts,
    execute = execFileAsync
}) {
    async function readState() {
        try {
            const content = await fs.readFile(stateFile, 'utf8');
            const state = JSON.parse(content);

            if (!Number.isSafeInteger(state.lastRestartCount)) {
                return null;
            }

            return {
                expectedRestart: state.expectedRestart === true,
                lastRestartCount: state.lastRestartCount
            };
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(t('log.pm2AlertStateReadFailed'), error);
            }

            return null;
        }
    }

    async function writeState(state) {
        await fs.writeFile(
            stateFile,
            JSON.stringify(state, null, 2),
            { encoding: 'utf8', mode: 0o600 }
        );
    }

    async function getProcessInfo() {
        const { stdout } = await execute('pm2', ['jlist'], {
            timeout: 30_000,
            maxBuffer: 4 * 1024 * 1024,
            windowsHide: true
        });
        const processes = JSON.parse(stdout);
        const processInfo = processes.find(entry =>
            entry.name === processName
        );

        if (!processInfo) {
            throw new Error(t('alert.pm2ProcessMissing', {
                process: processName
            }));
        }

        const restartCount = Number(processInfo.pm2_env?.restart_time);

        if (!Number.isSafeInteger(restartCount) || restartCount < 0) {
            throw new Error(t('alert.pm2RestartCountInvalid'));
        }

        return {
            exitCode: processInfo.pm2_env?.exit_code ??
                t('alert.unknownValue'),
            restartCount,
            status: processInfo.pm2_env?.status || t('alert.unknownValue')
        };
    }

    async function check() {
        const processInfo = await getProcessInfo();
        const state = await readState();

        if (!state || processInfo.restartCount < state.lastRestartCount) {
            await writeState({
                expectedRestart: false,
                lastRestartCount: processInfo.restartCount
            });
            return {
                detected: false,
                initialized: true,
                processInfo
            };
        }

        if (processInfo.restartCount === state.lastRestartCount) {
            return { detected: false, processInfo };
        }

        await writeState({
            expectedRestart: false,
            lastRestartCount: processInfo.restartCount
        });

        if (state.expectedRestart) {
            return {
                detected: false,
                expected: true,
                processInfo
            };
        }

        const notification = await runtimeAlerts.notify({
            source: 'pm2Restart',
            fatal: true,
            bypassCooldown: true,
            details: t('alert.pm2RestartDetails', {
                count: processInfo.restartCount,
                exitCode: processInfo.exitCode,
                process: processName,
                status: processInfo.status
            })
        });

        return {
            detected: true,
            notified: notification.sent,
            processInfo
        };
    }

    async function expectRestart() {
        const processInfo = await getProcessInfo();

        await writeState({
            expectedRestart: true,
            lastRestartCount: processInfo.restartCount
        });
    }

    return {
        check,
        expectRestart
    };
}

module.exports = {
    createPm2RestartMonitor
};
