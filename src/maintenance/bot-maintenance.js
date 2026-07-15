const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { t } = require('../i18n.js');

const execFileAsync = promisify(execFile);

class MaintenanceBusyError extends Error {
    constructor() {
        super(t('maintenance.actionBusy'));
        this.name = 'MaintenanceBusyError';
    }
}

function createBotMaintenance({
    ecosystemFile = 'commandbot.config.js',
    repositoryCwd,
    pm2ProcessName,
    execute = execFileAsync,
    spawnProcess = spawn,
    beforePm2Restart = async () => {},
    onBackgroundError = () => {},
    isExternalActionRunning = () => false
}) {
    let actionRunning = false;

    async function runExclusive(action) {
        if (actionRunning || isExternalActionRunning()) {
            throw new MaintenanceBusyError();
        }

        actionRunning = true;

        try {
            return await action();
        } finally {
            actionRunning = false;
        }
    }

    async function updateCode() {
        return runExclusive(async () => {
            await execute('pm2', ['describe', pm2ProcessName], {
                cwd: repositoryCwd,
                timeout: 30_000,
                windowsHide: true
            });

            await execute('git', ['rev-parse', '--is-inside-work-tree'], {
                cwd: repositoryCwd,
                timeout: 30_000,
                windowsHide: true
            });

            const { stdout: statusOutput } = await execute(
                'git',
                ['status', '--porcelain', '--untracked-files=no'],
                {
                    cwd: repositoryCwd,
                    timeout: 30_000,
                    windowsHide: true
                }
            );

            if (statusOutput.trim()) {
                throw new Error(t('maintenance.repositoryDirty'));
            }

            const { stdout, stderr } = await execute(
                'git',
                ['pull', '--ff-only'],
                {
                    cwd: repositoryCwd,
                    timeout: 120_000,
                    maxBuffer: 1024 * 1024,
                    windowsHide: true
                }
            );
            const {
                stdout: npmStdout,
                stderr: npmStderr
            } = await execute(
                'npm',
                ['ci', '--omit=dev'],
                {
                    cwd: repositoryCwd,
                    timeout: 300_000,
                    maxBuffer: 2 * 1024 * 1024,
                    windowsHide: true
                }
            );

            return [stdout, stderr, npmStdout, npmStderr]
                .filter(Boolean)
                .join('\n')
                .trim() || t('maintenance.gitNoOutput');
        });
    }

    function schedulePm2Restart(delayMs = 2_000) {
        setTimeout(async () => {
            await beforePm2Restart().catch(error => {
                console.error(
                    t('log.pm2ExpectedRestartMarkFailed'),
                    error
                );
                onBackgroundError(error);
            });

            const child = spawnProcess(
                'pm2',
                ['startOrRestart', ecosystemFile, '--update-env'],
                {
                    cwd: repositoryCwd,
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true
                }
            );

            child.on('error', error => {
                console.error(t('log.pm2RestartFailed'), error);
                onBackgroundError(error);
            });
            child.unref();
        }, delayMs);
    }

    return {
        isBusy: () => actionRunning,
        schedulePm2Restart,
        updateCode
    };
}

module.exports = {
    MaintenanceBusyError,
    createBotMaintenance
};
