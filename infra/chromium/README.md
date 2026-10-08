# Chromium sandbox

The PDF renderer uses an unprivileged user-namespace sandbox and Chromium's seccomp-BPF sandbox. Its health port opens only after a startup check of `chrome://sandbox` confirms PID/network namespaces and seccomp-BPF. Production never falls back to `--no-sandbox`.

`seccomp.json` comes from [Playwright v1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json), based on Docker's default profile. The only local addition allows `chroot`: Debian Chromium needs it **inside its new user namespace**. The outer container still drops every capability, forbids privilege escalation, runs as `node`, has a read-only root and stays on its isolated renderer network. Neither `SYS_ADMIN`, host IPC nor an unconfined profile is granted.

See the [official Playwright Docker guidance](https://playwright.dev/docs/docker). A host must support unprivileged user namespaces. Unsupported hosts fail the renderer startup check; fix host support rather than disabling the sandbox. The upstream profile is licensed under Apache-2.0; its license is included here.
