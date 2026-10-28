# PR preview controller

This optional Linux controller starts and manages a Vite preview from a checkout of
the PR branch. It exposes an authenticated HTTP API on `127.0.0.1` only. It
does not manage a Vite server that was started separately.

On the webserver, stop any existing Vite server using the intended app port,
then update the checkout and start the controller:

```bash
cd ~/dc-lab-sim-pr1
git fetch origin
git switch fix/domain-filter-and-fault-injection
git pull --ff-only origin fix/domain-filter-and-fault-injection
npm ci
umask 077
test -f "$HOME/.dclab-pr-control-token" || node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > "$HOME/.dclab-pr-control-token"
export PR_CONTROL_TOKEN="$(cat "$HOME/.dclab-pr-control-token")"
nohup env PR_APP_HOST=0.0.0.0 node scripts/pr-control-server.mjs > "$HOME/.dclab-pr-control.log" 2>&1 < /dev/null &
```

`PR_APP_HOST=0.0.0.0` makes the **application** accessible on the server's
network interfaces, as in the existing webserver setup. Omit it for loopback
access only. The controller itself always listens on loopback. Protect the
token file; never put the token in a URL or commit it to the repository.

The controller starts the app on port 5173 by default. After loading the token
into the current shell, use:

```bash
export PR_CONTROL_TOKEN="$(cat "$HOME/.dclab-pr-control-token")"
curl -sS -H "Authorization: Bearer $PR_CONTROL_TOKEN" http://127.0.0.1:5174/status
curl -sS -X POST -H "Authorization: Bearer $PR_CONTROL_TOKEN" http://127.0.0.1:5174/sync
curl -sS -X POST -H "Authorization: Bearer $PR_CONTROL_TOKEN" http://127.0.0.1:5174/stop
curl -sS -X POST -H "Authorization: Bearer $PR_CONTROL_TOKEN" http://127.0.0.1:5174/start
```

`sync` fetches the configured branch from `origin`, fast-forwards the checked
out branch, installs dependencies if the package files changed, and restarts
the managed app. It refuses tracked local changes and a checkout on a different
branch; it never force-resets the checkout. Untracked files are left in place,
although Git will refuse a merge if they conflict. A failed dependency install
leaves the app stopped. `stop` stops the managed app while leaving the control
API running so `start` can bring it back. The controller itself must be
restarted separately after changes to its script.

For access from another computer, use an authenticated SSH tunnel to the
webserver's loopback port and use the same token locally. Do not expose the
control port directly to a network. A remote agent also needs a network route
to that tunnel and authorized access to the token.

Optional environment variables: `PR_CONTROL_BRANCH` (defaults to
`fix/domain-filter-and-fault-injection`), `PR_CONTROL_PORT` (5174),
`PR_APP_PORT` (5173), and `PR_APP_HOST` (`127.0.0.1` or `0.0.0.0`). `origin`
must point to the fork containing the configured branch.
