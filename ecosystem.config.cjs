module.exports = {
    apps: [
        {
            name: "jerrybot-discord",
            script: "pnpm",
            args: "start",
            stop_exit_codes: [0],
        },
    ],
};