# Type one message into a running background Claude session: attach in a pseudo-terminal, type, press Enter, detach.
import os, pty, sys, time, select, signal, fcntl
sid, text = sys.argv[1], sys.argv[2]
# one typer per session at a time: two attaches at once mix their keystrokes and lose an Enter
lock = open(f'/tmp/gm-bgsay-{sid}.lock', 'w'); fcntl.flock(lock, fcntl.LOCK_EX)
pid, fd = pty.fork()
if pid == 0:
    os.environ['COLUMNS'], os.environ['LINES'] = '160', '48'
    os.execvp('claude', ['claude', 'attach', sid])
def drain(t):
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try: os.read(fd, 65536)
            except OSError: return
drain(4)
if text: os.write(fd, text.replace('\n', ' ').encode())
drain(1.0)
os.write(fd, b'\r')          # a long message can land as a paste, which eats the first Enter: a second one on an
drain(1.0)                   # empty prompt does nothing
os.write(fd, b'\r')
drain(1.5)
os.write(fd, b'\x1a')        # Ctrl+Z: back to the shell, the session keeps running
drain(1)
try: os.kill(pid, signal.SIGTERM)
except ProcessLookupError: pass
print('typed')
