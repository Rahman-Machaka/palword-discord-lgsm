module.exports = {
    apps: [
        {
            name: 'command-bot',
            script: './src/index.js',
            cwd: __dirname,

            exec_mode: 'fork',
            instances: 1,

            autorestart: true,
            watch: false,

            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            min_uptime: '5s',
            max_restarts: 10,

            max_memory_restart: '500M',

            log_date_format: 'DD-MM-YYYY HH:mm:ss',
            out_file: '/root/discord/logs/command-bot-out.log',
            error_file: '/root/discord/logs/command-bot-error.log',
            merge_logs: true,

            env: {
                NODE_ENV: 'production'
            }
        },
        {
            name: 'command-bot-monitor',
            script: './src/monitor.js',
            cwd: __dirname,

            exec_mode: 'fork',
            instances: 1,

            autorestart: true,
            watch: false,

            restart_delay: 5000,
            min_uptime: '5s',
            max_restarts: 10,

            max_memory_restart: '150M',

            log_date_format: 'DD-MM-YYYY HH:mm:ss',
            out_file: '/root/discord/logs/command-bot-monitor-out.log',
            error_file: '/root/discord/logs/command-bot-monitor-error.log',
            merge_logs: true,

            env: {
                NODE_ENV: 'production'
            }
        }
    ]
};
